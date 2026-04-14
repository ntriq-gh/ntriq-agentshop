import { config } from "dotenv";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { bazaarResourceServerExtension } from "@x402/extensions";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

config();

// --- Config ---
const evmAddress = process.env.EVM_ADDRESS as `0x${string}`;
if (!evmAddress) {
  console.error("EVM_ADDRESS is required");
  process.exit(1);
}

const facilitatorUrl =
  process.env.FACILITATOR_URL || "https://x402.org/facilitator";
const facilitatorClient = new HTTPFacilitatorClient({ url: facilitatorUrl });
const network = process.env.NETWORK || "eip155:8453";
const port = parseInt(process.env.SERVER_PORT || "4021");
const VISION_API = process.env.VISION_API_URL || "http://127.0.0.1:8100";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";

const VERSION = "2.0.0";
const SERVER_START = Date.now();

// --- Price Map (Local services only, 100% margin) ---
const PRICE_MAP: Record<string, number> = {
  "POST /document-intel": 0.05,
  "POST /invoice-extract": 0.03,
  "POST /screenshot-data": 0.02,
  "POST /alt-text": 0.01,
  "POST /pii-detect": 0.02,
  "POST /sentiment": 0.01,
  // Batch endpoints (flat rate, up to 500 items)
  "POST /alt-text-batch": 3.00,
  "POST /document-intel-batch": 15.00,
  "POST /invoice-extract-batch": 9.00,
  "POST /screenshot-data-batch": 6.00,
  "POST /pii-detect-batch": 6.00,
  "POST /sentiment-batch": 3.00,
  // New services
  "POST /content-generate": 0.02,
  "POST /compliance-check": 0.03,
  "POST /code-review": 0.05,
  "POST /blueprint": 0.05,
  "POST /phish-radar": 0.03,
  // New services batch
  "POST /content-generate-batch": 6.00,
  "POST /compliance-check-batch": 9.00,
  "POST /code-review-batch": 15.00,
  "POST /blueprint-batch": 15.00,
  "POST /phish-radar-batch": 9.00,
  "POST /audio-intel": 0.05,
  "POST /audio-intel-batch": 9.00,
  "POST /image-upscale": 0.10,
  "POST /image-upscale-batch": 30.00,
};


// --- KYA Trust Score (AsterPay) ---
const KYA_ENDPOINT = "https://x402.asterpay.io/v1/agent/trust-score";

interface KyaResult {
  score: number;
  status: string;
  [key: string]: unknown;
}

async function getKyaTrustScore(agentId: string): Promise<KyaResult | null> {
  try {
    const res = await fetch(KYA_ENDPOINT + "/" + encodeURIComponent(agentId), {
      method: "GET",
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    return await res.json() as KyaResult;
  } catch {
    return null; // non-blocking
  }
}

// --- Logging ---
function log(entry: Record<string, unknown>): void {
  console.log(
    JSON.stringify({ timestamp: new Date().toISOString(), ...entry }),
  );
}

// --- Ollama Helper ---
async function ollamaChat(
  model: string,
  prompt: string,
  systemPrompt?: string,
): Promise<string> {
  const messages: Array<{ role: string; content: string }> = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content: prompt });

  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: false }),
  });
  const data = (await res.json()) as { message?: { content?: string } };
  return data.message?.content || "";
}

// --- Vision Helper ---
async function visionAnalyze(
  imageUrl: string,
  prompt: string,
  language: string = "en",
): Promise<{ analysis: string; model: string; processing_time_ms: number }> {
  const res = await fetch(`${VISION_API}/analyze/image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image_url: imageUrl,
      prompt,
      language,
      max_tokens: 2000,
    }),
  });
  return (await res.json()) as {
    analysis: string;
    model: string;
    processing_time_ms: number;
  };
}

// --- Express App ---
const app = express();
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(
  rateLimit({
    windowMs: 60_000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests" },
  }),
);

// --- Health (free) ---
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    version: VERSION,
    uptime: Math.floor((Date.now() - SERVER_START) / 1000),
    services: Object.keys(PRICE_MAP).map((k) => {
      const [method, path] = k.split(" ");
      return { method, path, price: `$${PRICE_MAP[k]}` };
    }),
    wallet: evmAddress,
    facilitator: facilitatorUrl,
    timestamp: new Date().toISOString(),
  });
});

// --- Service Catalog (free, for agent discovery) ---
app.get("/services", (_req, res) => {
  res.json({
    name: "ntriq AgentShop",
    description:
      "AI data intelligence marketplace. 100% local inference — zero external API calls, zero commissions.",
    services: Object.entries(PRICE_MAP).map(([key, price]) => {
      const [method, path] = key.split(" ");
      return { method, path, price: `$${price}`, network, payTo: evmAddress };
    }),
    payment: { protocol: "x402", currency: "USDC", network },
  });
});

// --- Nonce mutex ---
class Mutex {
  private _queue: Array<() => void> = [];
  private _locked = false;
  async acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const tryAcquire = () => {
        if (!this._locked) {
          this._locked = true;
          resolve(() => {
            this._locked = false;
            const next = this._queue.shift();
            if (next) next();
          });
        } else {
          this._queue.push(tryAcquire);
        }
      };
      tryAcquire();
    });
  }
}
const paymentMutex = new Mutex();

app.use(async (req: Request, res: Response, next: NextFunction) => {
  const key = `${req.method} ${req.path}`;
  if (PRICE_MAP[key] !== undefined) {
    const release = await paymentMutex.acquire();
    res.on("finish", release);
    res.on("close", release);
  }
  next();
});

// --- x402 Payment Middleware ---
const paymentConfig: Record<
  string,
  {
    accepts: Array<{
      scheme: string;
      price: string;
      network: string;
      payTo: `0x${string}`;
    }>;
  }
> = {};
for (const [key, price] of Object.entries(PRICE_MAP)) {
  paymentConfig[key] = {
    accepts: [
      { scheme: "exact", price: `$${price}`, network, payTo: evmAddress },
    ],
  };
}

app.use(
  paymentMiddleware(
    paymentConfig,
    (() => {
      const rs = new x402ResourceServer(facilitatorClient);
      rs.registerExtension(bazaarResourceServerExtension);
      rs.register("eip155:*", new ExactEvmScheme());
      return rs;
    })(),
  ),
);

// --- Request Logger ---
app.use((req: Request, _res: Response, next: NextFunction) => {
  log({ method: req.method, path: req.path, ip: req.ip });
  next();
});


// --- KYA Middleware (AsterPay trust score, non-blocking) ---
app.use(async (req: Request, _res: Response, next: NextFunction) => {
  const key = `${req.method} ${req.path}`;
  if (PRICE_MAP[key] !== undefined && req.body?.agent_id) {
    const kya = await getKyaTrustScore(String(req.body.agent_id));
    (req as Request & { kyaTrust?: KyaResult | null }).kyaTrust = kya;
    if (kya) {
      log({ event: "kya_check", agent_id: req.body.agent_id, score: kya.score, status: kya.status });
    }
  }
  next();
});

// ============================================================
// LOCAL SERVICE ENDPOINTS — 100% local inference, zero commission
// ============================================================

// 1. Document Intelligence
app.post("/document-intel", async (req: Request, res: Response) => {
  try {
    const {
      image_url,
      image_base64,
      analysis_type = "extract",
      language = "en",
    } = req.body;
    if (!image_url && !image_base64) {
      return res.status(400).json({ error: "image_url or image_base64 required" });
    }

    const prompts: Record<string, string> = {
      extract: "Extract all text from this document image. Return the full text content preserving structure.",
      summarize: "Summarize this document. Key points, dates, amounts, and parties involved.",
      classify: "Classify this document type (invoice, receipt, contract, letter, form, report, other) and extract key metadata.",
      table: "Extract all tables from this document. Return as JSON array of objects.",
    };

    const prompt = prompts[analysis_type] || prompts.extract;
    const result = image_url
      ? await visionAnalyze(image_url, prompt, language)
      : await fetch(`${VISION_API}/analyze/image`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image_base64, prompt, language, max_tokens: 3000 }),
        }).then((r) => r.json());

    res.json({ status: "ok", analysis_type, ...result, kya_trust: (req as Request & { kyaTrust?: KyaResult | null }).kyaTrust ?? undefined });
  } catch (e: unknown) {
    log({ error: "document-intel failed", message: (e as Error).message });
    res.status(500).json({ error: "Document analysis failed" });
  }
});

// 2. Invoice Extraction
app.post("/invoice-extract", async (req: Request, res: Response) => {
  try {
    const { image_url, image_base64, language = "en" } = req.body;
    if (!image_url && !image_base64) {
      return res.status(400).json({ error: "image_url or image_base64 required" });
    }

    const prompt = `Extract all invoice/receipt fields as structured JSON:
{
  "vendor_name": "", "vendor_address": "", "vendor_tax_id": "",
  "invoice_number": "", "invoice_date": "", "due_date": "",
  "customer_name": "", "customer_address": "",
  "line_items": [{"description": "", "quantity": 0, "unit_price": 0, "amount": 0}],
  "subtotal": 0, "tax_rate": "", "tax_amount": 0, "total": 0,
  "currency": "", "payment_terms": "", "notes": ""
}
Return ONLY valid JSON. Fill empty string for missing fields.`;

    const body = image_url
      ? { image_url, prompt, language, max_tokens: 3000 }
      : { image_base64, prompt, language, max_tokens: 3000 };

    const result = (await fetch(`${VISION_API}/analyze/image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => r.json())) as { analysis?: string };

    let parsed = null;
    try {
      const text = result.analysis || "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch { /* JSON parse failed */ }

    res.json({ status: "ok", invoice: parsed, raw: parsed ? undefined : result, kya_trust: (req as Request & { kyaTrust?: KyaResult | null }).kyaTrust ?? undefined });
  } catch (e: unknown) {
    log({ error: "invoice-extract failed", message: (e as Error).message });
    res.status(500).json({ error: "Invoice extraction failed" });
  }
});

// 3. Screenshot to Data
app.post("/screenshot-data", async (req: Request, res: Response) => {
  try {
    const { image_url, image_base64, extract_type = "full", language = "en" } = req.body;
    if (!image_url && !image_base64) {
      return res.status(400).json({ error: "image_url or image_base64 required" });
    }

    const prompts: Record<string, string> = {
      full: "Analyze this screenshot. Extract all visible text, UI elements, layout structure, and data. Return structured JSON.",
      text: "Extract all visible text from this screenshot, preserving layout order.",
      layout: "Describe the UI layout: navigation, content areas, buttons, forms, and their positions.",
      data: "Extract any data tables, charts, numbers, or structured information visible in this screenshot.",
    };

    const prompt = prompts[extract_type] || prompts.full;
    const body = image_url
      ? { image_url, prompt, language, max_tokens: 3000 }
      : { image_base64, prompt, language, max_tokens: 3000 };

    const result = await fetch(`${VISION_API}/analyze/image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => r.json());

    res.json({ status: "ok", extract_type, ...result, kya_trust: (req as Request & { kyaTrust?: KyaResult | null }).kyaTrust ?? undefined });
  } catch (e: unknown) {
    log({ error: "screenshot-data failed", message: (e as Error).message });
    res.status(500).json({ error: "Screenshot analysis failed" });
  }
});

// 4. Alt Text
app.post("/alt-text", async (req: Request, res: Response) => {
  try {
    const { image_url, image_base64, language = "en" } = req.body;
    if (!image_url && !image_base64) {
      return res.status(400).json({ error: "image_url or image_base64 required" });
    }

    const prompt = 'Generate a concise alt text (max 125 characters) and a detailed description (2-3 sentences) for accessibility. Return JSON: {"alt_text": "...", "description": "..."}';
    const body = image_url
      ? { image_url, prompt, language, max_tokens: 500 }
      : { image_base64, prompt, language, max_tokens: 500 };

    const result = (await fetch(`${VISION_API}/analyze/image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => r.json())) as { analysis?: string };

    let parsed = null;
    try {
      const text = result.analysis || "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch { /* fallback */ }

    res.json({
      status: "ok",
      ...(parsed || { alt_text: result.analysis?.slice(0, 125), description: result.analysis }),
      kya_trust: (req as Request & { kyaTrust?: KyaResult | null }).kyaTrust ?? undefined,
    });
  } catch (e: unknown) {
    log({ error: "alt-text failed", message: (e as Error).message });
    res.status(500).json({ error: "Alt text generation failed" });
  }
});

// 5. PII Detection
app.post("/pii-detect", async (req: Request, res: Response) => {
  try {
    const { text, mask = false } = req.body;
    if (!text) return res.status(400).json({ error: "text required" });

    const action = mask ? "detect AND mask" : "detect";
    const prompt = `${action} all PII (Personally Identifiable Information) in the following text.
Return JSON: {
  "pii_found": [{"type": "email|phone|ssn|name|address|credit_card|passport|other", "value": "...", "position": [start, end]}],
  "risk_level": "none|low|medium|high|critical",
  "masked_text": "${mask ? "text with PII replaced by [TYPE]" : "null"}"
}

Text: ${text}`;

    const result = await ollamaChat(
      "qwen2.5:7b-instruct-q4_K_M",
      prompt,
      "You are a PII detection expert. Return ONLY valid JSON.",
    );

    let parsed = null;
    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch { /* fallback */ }

    res.json({ status: "ok", ...(parsed || { raw: result }), kya_trust: (req as Request & { kyaTrust?: KyaResult | null }).kyaTrust ?? undefined });
  } catch (e: unknown) {
    log({ error: "pii-detect failed", message: (e as Error).message });
    res.status(500).json({ error: "PII detection failed" });
  }
});

// 6. Sentiment Analysis
app.post("/sentiment", async (req: Request, res: Response) => {
  try {
    const { text, language = "en" } = req.body;
    if (!text) return res.status(400).json({ error: "text required" });

    const prompt = `Analyze the sentiment, emotions, and intent of the following text.
Return JSON: {
  "sentiment": "positive|negative|neutral|mixed",
  "confidence": 0.0-1.0,
  "emotions": {"joy": 0.0, "anger": 0.0, "sadness": 0.0, "fear": 0.0, "surprise": 0.0, "disgust": 0.0},
  "intent": "inform|request|complain|praise|question|suggest|other",
  "summary": "one sentence summary"
}

Text: ${text}`;

    const result = await ollamaChat(
      "qwen2.5:7b-instruct-q4_K_M",
      prompt,
      `You are a sentiment analysis expert. Respond in ${language}. Return ONLY valid JSON.`,
    );

    let parsed = null;
    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch { /* fallback */ }

    res.json({ status: "ok", ...(parsed || { raw: result }), kya_trust: (req as Request & { kyaTrust?: KyaResult | null }).kyaTrust ?? undefined });
  } catch (e: unknown) {
    log({ error: "sentiment failed", message: (e as Error).message });
    res.status(500).json({ error: "Sentiment analysis failed" });
  }
});


// ============================================================
// BATCH ENDPOINTS — flat rate, up to 500 items per call
// ============================================================

async function runConcurrent<T>(tasks: (() => Promise<T>)[], limit = 10): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < tasks.length; i += limit) {
    const chunk = tasks.slice(i, i + limit);
    const chunkResults = await Promise.all(chunk.map(t => t()));
    results.push(...chunkResults);
  }
  return results;
}

app.post('/alt-text-batch', async (req: Request, res: Response) => {
  try {
    const { images, context = '', max_length = 125, language = 'en' } = req.body;
    if (!Array.isArray(images) || images.length === 0)
      return res.status(400).json({ error: 'images array required' });
    if (images.length > 500)
      return res.status(400).json({ error: 'max 500 images per batch' });
    const prompt = (ctx: string) =>
      `Generate concise alt text (max ${max_length} chars) and a 2-3 sentence description for accessibility.${ctx ? ` Context: ${ctx}` : ''} Return JSON: {"alt_text":"...","description":"..."}`;
    const tasks = images.map((url: string) => async () => {
      try {
        const result = (await fetch(`${VISION_API}/analyze/image`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_url: url, prompt: prompt(context), language, max_tokens: 500 }),
        }).then(r => r.json())) as { analysis?: string };
        let parsed = null;
        try { const m = (result.analysis || '').match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); } catch {}
        return { image_url: url, status: 'ok', ...(parsed || { alt_text: result.analysis?.slice(0, max_length), description: result.analysis }) };
      } catch { return { image_url: url, status: 'error', error: 'processing failed' }; }
    });
    const results = await runConcurrent(tasks, 10);
    res.json({ status: 'ok', count: results.length, results });
  } catch (e: unknown) {
    log({ error: 'alt-text-batch failed', message: (e as Error).message });
    res.status(500).json({ error: 'Batch alt text generation failed' });
  }
});

app.post('/document-intel-batch', async (req: Request, res: Response) => {
  try {
    const { images, analysis_type = 'extract', language = 'en' } = req.body;
    if (!Array.isArray(images) || images.length === 0)
      return res.status(400).json({ error: 'images array required' });
    if (images.length > 500)
      return res.status(400).json({ error: 'max 500 images per batch' });
    const prompts: Record<string, string> = {
      extract: 'Extract all text from this document image. Return the full text content preserving structure.',
      summarize: 'Summarize this document. Key points, dates, amounts, and parties involved.',
      classify: 'Classify this document type and extract key metadata.',
      table: 'Extract all tables from this document. Return as JSON array of objects.',
    };
    const prompt = prompts[analysis_type] || prompts.extract;
    const tasks = images.map((url: string) => async () => {
      try {
        const result = await fetch(`${VISION_API}/analyze/image`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_url: url, prompt, language, max_tokens: 3000 }),
        }).then(r => r.json());
        return { image_url: url, status: 'ok', analysis_type, ...result };
      } catch { return { image_url: url, status: 'error', error: 'processing failed' }; }
    });
    const results = await runConcurrent(tasks, 5);
    res.json({ status: 'ok', count: results.length, results });
  } catch (e: unknown) {
    log({ error: 'document-intel-batch failed', message: (e as Error).message });
    res.status(500).json({ error: 'Batch document analysis failed' });
  }
});

app.post('/invoice-extract-batch', async (req: Request, res: Response) => {
  try {
    const { images, language = 'en' } = req.body;
    if (!Array.isArray(images) || images.length === 0)
      return res.status(400).json({ error: 'images array required' });
    if (images.length > 500)
      return res.status(400).json({ error: 'max 500 images per batch' });
    const prompt = 'Extract all invoice/receipt fields as structured JSON: {"vendor_name":"","invoice_number":"","invoice_date":"","line_items":[],"total":0,"currency":""}. Return ONLY valid JSON.';
    const tasks = images.map((url: string) => async () => {
      try {
        const result = (await fetch(`${VISION_API}/analyze/image`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_url: url, prompt, language, max_tokens: 3000 }),
        }).then(r => r.json())) as { analysis?: string };
        let parsed = null;
        try { const m = (result.analysis || '').match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); } catch {}
        return { image_url: url, status: 'ok', invoice: parsed, raw: parsed ? undefined : result };
      } catch { return { image_url: url, status: 'error', error: 'processing failed' }; }
    });
    const results = await runConcurrent(tasks, 5);
    res.json({ status: 'ok', count: results.length, results });
  } catch (e: unknown) {
    log({ error: 'invoice-extract-batch failed', message: (e as Error).message });
    res.status(500).json({ error: 'Batch invoice extraction failed' });
  }
});

app.post('/screenshot-data-batch', async (req: Request, res: Response) => {
  try {
    const { images, extract_type = 'full', language = 'en' } = req.body;
    if (!Array.isArray(images) || images.length === 0)
      return res.status(400).json({ error: 'images array required' });
    if (images.length > 500)
      return res.status(400).json({ error: 'max 500 images per batch' });
    const prompts: Record<string, string> = {
      full: 'Analyze this screenshot. Extract all visible text, UI elements, and data. Return structured JSON.',
      text: 'Extract all visible text from this screenshot, preserving layout order.',
      data: 'Extract any data tables, charts, numbers, or structured information visible.',
    };
    const prompt = prompts[extract_type] || prompts.full;
    const tasks = images.map((url: string) => async () => {
      try {
        const result = await fetch(`${VISION_API}/analyze/image`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_url: url, prompt, language, max_tokens: 3000 }),
        }).then(r => r.json());
        return { image_url: url, status: 'ok', extract_type, ...result };
      } catch { return { image_url: url, status: 'error', error: 'processing failed' }; }
    });
    const results = await runConcurrent(tasks, 5);
    res.json({ status: 'ok', count: results.length, results });
  } catch (e: unknown) {
    log({ error: 'screenshot-data-batch failed', message: (e as Error).message });
    res.status(500).json({ error: 'Batch screenshot analysis failed' });
  }
});

app.post('/pii-detect-batch', async (req: Request, res: Response) => {
  try {
    const { texts, mask = false } = req.body;
    if (!Array.isArray(texts) || texts.length === 0)
      return res.status(400).json({ error: 'texts array required' });
    if (texts.length > 500)
      return res.status(400).json({ error: 'max 500 texts per batch' });
    const tasks = texts.map((text: string, idx: number) => async () => {
      try {
        const action = mask ? 'detect AND mask' : 'detect';
        const prompt = `${action} all PII in the following text. Return JSON: {"pii_found":[{"type":"...","value":"..."}],"risk_level":"none|low|medium|high|critical"${mask ? ',"masked_text":"..."' : ''}}. Text: ${text}`;
        const result = await ollamaChat('qwen2.5:7b-instruct-q4_K_M', prompt, 'You are a PII detection expert. Return ONLY valid JSON.');
        let parsed = null;
        try { const m = result.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); } catch {}
        return { index: idx, status: 'ok', ...(parsed || { raw: result }) };
      } catch { return { index: idx, status: 'error', error: 'processing failed' }; }
    });
    const results = await runConcurrent(tasks, 10);
    res.json({ status: 'ok', count: results.length, results });
  } catch (e: unknown) {
    log({ error: 'pii-detect-batch failed', message: (e as Error).message });
    res.status(500).json({ error: 'Batch PII detection failed' });
  }
});

app.post('/sentiment-batch', async (req: Request, res: Response) => {
  try {
    const { texts, language = 'en' } = req.body;
    if (!Array.isArray(texts) || texts.length === 0)
      return res.status(400).json({ error: 'texts array required' });
    if (texts.length > 500)
      return res.status(400).json({ error: 'max 500 texts per batch' });
    const tasks = texts.map((text: string, idx: number) => async () => {
      try {
        const prompt = `Analyze sentiment of: "${text}". Return JSON: {"sentiment":"positive|negative|neutral|mixed","confidence":0.0,"intent":"inform|request|complain|praise|question|other","summary":"..."}`;
        const result = await ollamaChat('qwen2.5:7b-instruct-q4_K_M', prompt, `You are a sentiment expert. Respond in ${language}. Return ONLY valid JSON.`);
        let parsed = null;
        try { const m = result.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); } catch {}
        return { index: idx, status: 'ok', ...(parsed || { raw: result }) };
      } catch { return { index: idx, status: 'error', error: 'processing failed' }; }
    });
    const results = await runConcurrent(tasks, 10);
    res.json({ status: 'ok', count: results.length, results });
  } catch (e: unknown) {
    log({ error: 'sentiment-batch failed', message: (e as Error).message });
    res.status(500).json({ error: 'Batch sentiment analysis failed' });
  }
});


// ============================================================
// NEW SERVICES — content-generate, compliance-check, code-review, blueprint, phish-radar
// ============================================================

// 7. Content Generate
app.post('/content-generate', async (req: Request, res: Response) => {
  try {
    const { prompt, style = 'blog', tone = 'professional', language = 'en', max_words = 500 } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt required' });
    const styleGuide: Record<string, string> = {
      blog: 'Write a blog post',
      email: 'Write a professional email',
      social: 'Write a social media post (concise, engaging)',
      product: 'Write a product description',
      report: 'Write a formal report section',
      ad: 'Write marketing copy',
    };
    const instruction = styleGuide[style] || styleGuide.blog;
    const p = `${instruction} about: "${prompt}". Tone: ${tone}. Language: ${language}. Max words: ${max_words}. Return JSON: {"title":"...","content":"...","word_count":0}`;
    const result = await ollamaChat('qwen2.5:7b-instruct-q4_K_M', p, 'You are a professional content writer. Return ONLY valid JSON.');
    let parsed = null;
    try { const m = result.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); } catch {}
    res.json({ status: 'ok', style, ...(parsed || { content: result }), kya_trust: (req as Request & { kyaTrust?: KyaResult | null }).kyaTrust ?? undefined });
  } catch (e: unknown) {
    log({ error: 'content-generate failed', message: (e as Error).message });
    res.status(500).json({ error: 'Content generation failed' });
  }
});

// 8. Compliance Check
app.post('/compliance-check', async (req: Request, res: Response) => {
  try {
    const { text, framework = 'general', jurisdiction = 'US', language = 'en' } = req.body;
    if (!text) return res.status(400).json({ error: 'text required' });
    const p = `Analyze the following text for compliance issues under ${framework} framework (${jurisdiction}).
Return JSON: {
  "compliant": true|false,
  "risk_level": "none|low|medium|high|critical",
  "issues": [{"rule": "...", "description": "...", "severity": "low|medium|high", "recommendation": "..."}],
  "summary": "..."
}
Text: ${text}`;
    const result = await ollamaChat('qwen2.5:7b-instruct-q4_K_M', p, `You are a compliance expert. Respond in ${language}. Return ONLY valid JSON.`);
    let parsed = null;
    try { const m = result.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); } catch {}
    res.json({ status: 'ok', framework, jurisdiction, ...(parsed || { raw: result }), kya_trust: (req as Request & { kyaTrust?: KyaResult | null }).kyaTrust ?? undefined });
  } catch (e: unknown) {
    log({ error: 'compliance-check failed', message: (e as Error).message });
    res.status(500).json({ error: 'Compliance check failed' });
  }
});

// 9. Code Review
app.post('/code-review', async (req: Request, res: Response) => {
  try {
    const { code, language: lang = 'auto', focus = 'all' } = req.body;
    if (!code) return res.status(400).json({ error: 'code required' });
    const p = `Review the following ${lang} code. Focus: ${focus}.
Return JSON: {
  "overall_score": 0-10,
  "issues": [{"severity": "critical|high|medium|low|info", "line": 0, "description": "...", "suggestion": "..."}],
  "security_risks": ["..."],
  "performance_notes": ["..."],
  "summary": "..."
}
Code:
\`\`\`
${code}
\`\`\``;
    const result = await ollamaChat('qwen2.5:7b-instruct-q4_K_M', p, 'You are a senior code reviewer. Return ONLY valid JSON.');
    let parsed = null;
    try { const m = result.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); } catch {}
    res.json({ status: 'ok', language: lang, ...(parsed || { raw: result }), kya_trust: (req as Request & { kyaTrust?: KyaResult | null }).kyaTrust ?? undefined });
  } catch (e: unknown) {
    log({ error: 'code-review failed', message: (e as Error).message });
    res.status(500).json({ error: 'Code review failed' });
  }
});

// 10. Blueprint Analysis
app.post('/blueprint', async (req: Request, res: Response) => {
  try {
    const { image_url, image_base64, analysis_type = 'full', language = 'en' } = req.body;
    if (!image_url && !image_base64) return res.status(400).json({ error: 'image_url or image_base64 required' });
    const prompts: Record<string, string> = {
      full: 'Analyze this architectural blueprint or floor plan. Extract: room names, dimensions, areas, structural elements, materials noted, scale. Return JSON: {"rooms":[{"name":"","area":"","dimensions":""}],"total_area":"","scale":"","structural_elements":[],"notes":""}',
      dimensions: 'Extract all measurements and dimensions from this blueprint. Return JSON with a dimensions array.',
      rooms: 'List all rooms/spaces in this floor plan with their names and approximate areas.',
      materials: 'Extract all material specifications and annotations from this blueprint.',
    };
    const prompt = prompts[analysis_type] || prompts.full;
    const body = image_url
      ? { image_url, prompt, language, max_tokens: 3000 }
      : { image_base64, prompt, language, max_tokens: 3000 };
    const result = (await fetch(`${VISION_API}/analyze/image`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(r => r.json())) as { analysis?: string };
    let parsed = null;
    try { const m = (result.analysis || '').match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); } catch {}
    res.json({ status: 'ok', analysis_type, ...(parsed || { analysis: result.analysis }), kya_trust: (req as Request & { kyaTrust?: KyaResult | null }).kyaTrust ?? undefined });
  } catch (e: unknown) {
    log({ error: 'blueprint failed', message: (e as Error).message });
    res.status(500).json({ error: 'Blueprint analysis failed' });
  }
});

// 11. Phish Radar
app.post('/phish-radar', async (req: Request, res: Response) => {
  try {
    const { url, domain, language = 'en' } = req.body;
    const target = url || domain;
    if (!target) return res.status(400).json({ error: 'url or domain required' });

    // DNS lookup for domain age/existence signal
    let dnsInfo = 'unknown';
    try {
      const { promises: dns } = await import('dns');
      const parts = target.replace(/^https?:\/\//, '').split('/')[0];
      const addresses = await dns.lookup(parts);
      dnsInfo = `resolves to ${addresses.address}`;
    } catch { dnsInfo = 'does not resolve (suspicious)'; }

    const p = `Analyze this URL/domain for phishing indicators: "${target}"
DNS info: ${dnsInfo}
Check for: typosquatting, homoglyph attacks, suspicious TLD, brand impersonation, suspicious patterns.
Return JSON: {
  "is_suspicious": true|false,
  "risk_score": 0-100,
  "risk_level": "safe|low|medium|high|critical",
  "indicators": [{"type": "typosquatting|homoglyph|suspicious_tld|brand_impersonation|other", "description": "..."}],
  "legitimate_brand": "brand name if impersonating, else null",
  "recommendation": "safe_to_visit|caution|avoid|block",
  "summary": "..."
}`;
    const result = await ollamaChat('qwen2.5:7b-instruct-q4_K_M', p, `You are a cybersecurity expert. Respond in ${language}. Return ONLY valid JSON.`);
    let parsed = null;
    try { const m = result.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); } catch {}
    res.json({ status: 'ok', target, dns_info: dnsInfo, ...(parsed || { raw: result }), kya_trust: (req as Request & { kyaTrust?: KyaResult | null }).kyaTrust ?? undefined });
  } catch (e: unknown) {
    log({ error: 'phish-radar failed', message: (e as Error).message });
    res.status(500).json({ error: 'Phishing analysis failed' });
  }
});

// ============================================================
// NEW SERVICES — BATCH ENDPOINTS
// ============================================================

// Content Generate Batch
app.post('/content-generate-batch', async (req: Request, res: Response) => {
  try {
    const { prompts: promptList, style = 'blog', tone = 'professional', language = 'en', max_words = 500 } = req.body;
    if (!Array.isArray(promptList) || promptList.length === 0) return res.status(400).json({ error: 'prompts array required' });
    if (promptList.length > 500) return res.status(400).json({ error: 'max 500 prompts per batch' });
    const styleGuide: Record<string, string> = { blog: 'Write a blog post', email: 'Write a professional email', social: 'Write a social media post', product: 'Write a product description', report: 'Write a formal report section', ad: 'Write marketing copy' };
    const instruction = styleGuide[style] || styleGuide.blog;
    const tasks = promptList.map((prompt: string, idx: number) => async () => {
      try {
        const p = `${instruction} about: "${prompt}". Tone: ${tone}. Language: ${language}. Max words: ${max_words}. Return JSON: {"title":"...","content":"...","word_count":0}`;
        const result = await ollamaChat('qwen2.5:7b-instruct-q4_K_M', p, 'You are a professional content writer. Return ONLY valid JSON.');
        let parsed = null;
        try { const m = result.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); } catch {}
        return { index: idx, status: 'ok', style, ...(parsed || { content: result }) };
      } catch { return { index: idx, status: 'error', error: 'processing failed' }; }
    });
    const results = await runConcurrent(tasks, 5);
    res.json({ status: 'ok', count: results.length, results, kya_trust: (req as Request & { kyaTrust?: KyaResult | null }).kyaTrust ?? undefined });
  } catch (e: unknown) {
    log({ error: 'content-generate-batch failed', message: (e as Error).message });
    res.status(500).json({ error: 'Batch content generation failed' });
  }
});

// Compliance Check Batch
app.post('/compliance-check-batch', async (req: Request, res: Response) => {
  try {
    const { texts, framework = 'general', jurisdiction = 'US', language = 'en' } = req.body;
    if (!Array.isArray(texts) || texts.length === 0) return res.status(400).json({ error: 'texts array required' });
    if (texts.length > 500) return res.status(400).json({ error: 'max 500 texts per batch' });
    const tasks = texts.map((text: string, idx: number) => async () => {
      try {
        const p = `Analyze for compliance issues under ${framework} (${jurisdiction}). Return JSON: {"compliant":true|false,"risk_level":"none|low|medium|high|critical","issues":[{"rule":"...","severity":"...","recommendation":"..."}],"summary":"..."}. Text: ${text}`;
        const result = await ollamaChat('qwen2.5:7b-instruct-q4_K_M', p, `Compliance expert. Respond in ${language}. Return ONLY valid JSON.`);
        let parsed = null;
        try { const m = result.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); } catch {}
        return { index: idx, status: 'ok', ...(parsed || { raw: result }) };
      } catch { return { index: idx, status: 'error', error: 'processing failed' }; }
    });
    const results = await runConcurrent(tasks, 5);
    res.json({ status: 'ok', count: results.length, results, kya_trust: (req as Request & { kyaTrust?: KyaResult | null }).kyaTrust ?? undefined });
  } catch (e: unknown) {
    log({ error: 'compliance-check-batch failed', message: (e as Error).message });
    res.status(500).json({ error: 'Batch compliance check failed' });
  }
});

// Code Review Batch
app.post('/code-review-batch', async (req: Request, res: Response) => {
  try {
    const { snippets, language: lang = 'auto', focus = 'all' } = req.body;
    if (!Array.isArray(snippets) || snippets.length === 0) return res.status(400).json({ error: 'snippets array required' });
    if (snippets.length > 500) return res.status(400).json({ error: 'max 500 snippets per batch' });
    const tasks = snippets.map((code: string, idx: number) => async () => {
      try {
        const p = `Review this ${lang} code. Focus: ${focus}. Return JSON: {"overall_score":0-10,"issues":[{"severity":"critical|high|medium|low","description":"...","suggestion":"..."}],"security_risks":[],"summary":"..."}. Code:\n\`\`\`\n${code}\n\`\`\``;
        const result = await ollamaChat('qwen2.5:7b-instruct-q4_K_M', p, 'Senior code reviewer. Return ONLY valid JSON.');
        let parsed = null;
        try { const m = result.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); } catch {}
        return { index: idx, status: 'ok', ...(parsed || { raw: result }) };
      } catch { return { index: idx, status: 'error', error: 'processing failed' }; }
    });
    const results = await runConcurrent(tasks, 3);
    res.json({ status: 'ok', count: results.length, results, kya_trust: (req as Request & { kyaTrust?: KyaResult | null }).kyaTrust ?? undefined });
  } catch (e: unknown) {
    log({ error: 'code-review-batch failed', message: (e as Error).message });
    res.status(500).json({ error: 'Batch code review failed' });
  }
});

// Blueprint Batch
app.post('/blueprint-batch', async (req: Request, res: Response) => {
  try {
    const { images, analysis_type = 'full', language = 'en' } = req.body;
    if (!Array.isArray(images) || images.length === 0) return res.status(400).json({ error: 'images array required' });
    if (images.length > 500) return res.status(400).json({ error: 'max 500 images per batch' });
    const prompt = 'Analyze this architectural blueprint. Extract rooms, dimensions, areas, structural elements. Return JSON: {"rooms":[{"name":"","area":"","dimensions":""}],"total_area":"","structural_elements":[],"notes":""}';
    const tasks = images.map((url: string) => async () => {
      try {
        const result = (await fetch(`${VISION_API}/analyze/image`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_url: url, prompt, language, max_tokens: 3000 }),
        }).then(r => r.json())) as { analysis?: string };
        let parsed = null;
        try { const m = (result.analysis || '').match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); } catch {}
        return { image_url: url, status: 'ok', ...(parsed || { analysis: result.analysis }) };
      } catch { return { image_url: url, status: 'error', error: 'processing failed' }; }
    });
    const results = await runConcurrent(tasks, 5);
    res.json({ status: 'ok', count: results.length, results, kya_trust: (req as Request & { kyaTrust?: KyaResult | null }).kyaTrust ?? undefined });
  } catch (e: unknown) {
    log({ error: 'blueprint-batch failed', message: (e as Error).message });
    res.status(500).json({ error: 'Batch blueprint analysis failed' });
  }
});

// Phish Radar Batch
app.post('/phish-radar-batch', async (req: Request, res: Response) => {
  try {
    const { targets, language = 'en' } = req.body;
    if (!Array.isArray(targets) || targets.length === 0) return res.status(400).json({ error: 'targets array required' });
    if (targets.length > 500) return res.status(400).json({ error: 'max 500 targets per batch' });
    const tasks = targets.map((target: string, idx: number) => async () => {
      try {
        let dnsInfo = 'unknown';
        try {
          const { promises: dns } = await import('dns');
          const host = target.replace(/^https?:\/\//, '').split('/')[0];
          const addr = await dns.lookup(host);
          dnsInfo = `resolves to ${addr.address}`;
        } catch { dnsInfo = 'does not resolve (suspicious)'; }
        const p = `Analyze URL/domain for phishing: "${target}". DNS: ${dnsInfo}. Return JSON: {"is_suspicious":true|false,"risk_score":0-100,"risk_level":"safe|low|medium|high|critical","indicators":[],"recommendation":"safe_to_visit|caution|avoid|block","summary":"..."}`;
        const result = await ollamaChat('qwen2.5:7b-instruct-q4_K_M', p, `Cybersecurity expert. Respond in ${language}. Return ONLY valid JSON.`);
        let parsed = null;
        try { const m = result.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); } catch {}
        return { index: idx, target, status: 'ok', dns_info: dnsInfo, ...(parsed || { raw: result }) };
      } catch { return { index: idx, target, status: 'error', error: 'processing failed' }; }
    });
    const results = await runConcurrent(tasks, 10);
    res.json({ status: 'ok', count: results.length, results, kya_trust: (req as Request & { kyaTrust?: KyaResult | null }).kyaTrust ?? undefined });
  } catch (e: unknown) {
    log({ error: 'phish-radar-batch failed', message: (e as Error).message });
    res.status(500).json({ error: 'Batch phishing analysis failed' });
  }
});


// 12. Audio Intel
app.post('/audio-intel', async (req: Request, res: Response) => {
  try {
    const { audio_url, audio_base64, language } = req.body;
    if (!audio_url && !audio_base64) return res.status(400).json({ error: 'audio_url or audio_base64 required' });
    const body: Record<string, unknown> = { language };
    if (audio_url) body.audio_url = audio_url; else body.audio_base64 = audio_base64;
    const result = (await fetch(`${WHISPER_API}/transcribe`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(r => r.json())) as { text?: string; language?: string; duration?: number; segments?: unknown[] };
    res.json({ status: 'ok', ...result, kya_trust: (req as Request & { kyaTrust?: KyaResult | null }).kyaTrust ?? undefined });
  } catch (e: unknown) {
    log({ error: 'audio-intel failed', message: (e as Error).message });
    res.status(500).json({ error: 'Audio transcription failed' });
  }
});

// Audio Intel Batch
app.post('/audio-intel-batch', async (req: Request, res: Response) => {
  try {
    const { audio_urls, language = null } = req.body;
    if (!Array.isArray(audio_urls) || audio_urls.length === 0) return res.status(400).json({ error: 'audio_urls array required' });
    if (audio_urls.length > 500) return res.status(400).json({ error: 'max 500 audio files per batch' });
    const tasks = audio_urls.map((url: string, idx: number) => async () => {
      try {
        const result = (await fetch(`${WHISPER_API}/transcribe`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audio_url: url, language }),
        }).then(r => r.json())) as { text?: string; language?: string; duration?: number };
        return { index: idx, audio_url: url, status: 'ok', ...result };
      } catch { return { index: idx, audio_url: url, status: 'error', error: 'processing failed' }; }
    });
    const results = await runConcurrent(tasks, 3);
    res.json({ status: 'ok', count: results.length, results, kya_trust: (req as Request & { kyaTrust?: KyaResult | null }).kyaTrust ?? undefined });
  } catch (e: unknown) {
    log({ error: 'audio-intel-batch failed', message: (e as Error).message });
    res.status(500).json({ error: 'Batch audio transcription failed' });
  }
});

// 13. Image Upscale
app.post('/image-upscale', async (req: Request, res: Response) => {
  try {
    const { image_url, image_base64, scale = 4, mode = 'general' } = req.body;
    if (!image_url && !image_base64) return res.status(400).json({ error: 'image_url or image_base64 required' });
    const body: Record<string, unknown> = { scale, mode };
    if (image_url) body.image_url = image_url; else body.image_base64 = image_base64;
    const result = (await fetch(`${ESRGAN_API}/upscale`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(r => r.json())) as { image_base64?: string; scale?: number; model?: string; format?: string };
    res.json({ status: 'ok', ...result, kya_trust: (req as Request & { kyaTrust?: KyaResult | null }).kyaTrust ?? undefined });
  } catch (e: unknown) {
    log({ error: 'image-upscale failed', message: (e as Error).message });
    res.status(500).json({ error: 'Image upscale failed' });
  }
});

// Image Upscale Batch
app.post('/image-upscale-batch', async (req: Request, res: Response) => {
  try {
    const { images, scale = 4, mode = 'general' } = req.body;
    if (!Array.isArray(images) || images.length === 0) return res.status(400).json({ error: 'images array required' });
    if (images.length > 500) return res.status(400).json({ error: 'max 500 images per batch' });
    const tasks = images.map((url: string, idx: number) => async () => {
      try {
        const result = (await fetch(`${ESRGAN_API}/upscale`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_url: url, scale, mode }),
        }).then(r => r.json())) as { image_base64?: string; scale?: number; model?: string };
        return { index: idx, image_url: url, status: 'ok', ...result };
      } catch { return { index: idx, image_url: url, status: 'error', error: 'processing failed' }; }
    });
    const results = await runConcurrent(tasks, 2);
    res.json({ status: 'ok', count: results.length, results, kya_trust: (req as Request & { kyaTrust?: KyaResult | null }).kyaTrust ?? undefined });
  } catch (e: unknown) {
    log({ error: 'image-upscale-batch failed', message: (e as Error).message });
    res.status(500).json({ error: 'Batch image upscale failed' });
  }
});

// --- Error Handler ---
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  log({ error: "unhandled", message: err.message });
  res.status(500).json({ error: "Internal server error" });
});

// --- Start ---
const server = app.listen(port, () => {
  log({
    event: "start",
    port,
    version: VERSION,
    wallet: evmAddress,
    services: Object.keys(PRICE_MAP).length,
  });
});

const shutdown = () => {
  log({ event: "shutdown" });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
