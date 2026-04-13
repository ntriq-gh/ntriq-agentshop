#!/usr/bin/env node
/**
 * ntriq-agentshop MCP Server
 * Exposes x402 pay-per-use intelligence endpoints as MCP tools.
 * Each tool call makes a paid request to the x402 server (USDC on Base).
 *
 * x402 server: http://x402.ntriq.co.kr (port 4021 via Cloudflare Tunnel)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const X402_BASE = process.env.X402_BASE_URL || "https://x402.ntriq.co.kr";
const X402_PAYMENT_HEADER = process.env.X402_PAYMENT_HEADER || "";

const server = new McpServer({
  name: "ntriq-agentshop",
  version: "1.0.0",
});

/** Make a paid x402 request */
async function callX402(
  endpoint: string,
  body: Record<string, unknown>
): Promise<unknown> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (X402_PAYMENT_HEADER) {
    headers["X-Payment"] = X402_PAYMENT_HEADER;
  }

  const res = await fetch(`${X402_BASE}${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (res.status === 402) {
    const info = await res.json() as Record<string, unknown>;
    throw new Error(
      `Payment required. Price: ${JSON.stringify(info.accepts ?? info)}. ` +
      `Configure X402_PAYMENT_HEADER env var with a valid EIP-3009 payment. ` +
      `Wallet: 0x124AaFfF8Ef45F2cA953807aF09Aacec2D9F8307 (Base mainnet)`
    );
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API error ${res.status}: ${err}`);
  }

  return res.json();
}

// ── Tool 1: Document Intelligence ────────────────────────────────────────────
server.tool(
  "document_intelligence",
  "Analyze document images — extract text, summarize, classify, or extract tables. " +
  "Accepts image URL or base64. Cost: $0.05 USDC per call (x402, Base mainnet).",
  {
    image_url: z.string().url().optional().describe("Public URL of document image"),
    image_base64: z.string().optional().describe("Base64-encoded image data"),
    analysis_type: z
      .enum(["extract", "summarize", "classify", "table"])
      .default("extract")
      .describe("Type of analysis to perform"),
    language: z.string().default("en").describe("Output language code (e.g. en, ko, ja)"),
  },
  async ({ image_url, image_base64, analysis_type, language }) => {
    const result = await callX402("/document-intel", {
      image_url,
      image_base64,
      analysis_type,
      language,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ── Tool 2: Invoice Extraction ────────────────────────────────────────────────
server.tool(
  "invoice_extract",
  "Extract structured fields from invoice or receipt images. Returns vendor, " +
  "line items, totals, dates, and more as JSON. Cost: $0.03 USDC per call.",
  {
    image_url: z.string().url().optional().describe("Public URL of invoice image"),
    image_base64: z.string().optional().describe("Base64-encoded invoice image"),
    language: z.string().default("en").describe("Output language code"),
  },
  async ({ image_url, image_base64, language }) => {
    const result = await callX402("/invoice-extract", {
      image_url,
      image_base64,
      language,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ── Tool 3: Screenshot Data Extraction ───────────────────────────────────────
server.tool(
  "screenshot_data",
  "Extract structured data from screenshots of dashboards, tables, forms, or UIs. " +
  "Cost: $0.02 USDC per call.",
  {
    image_url: z.string().url().optional().describe("Public URL of screenshot"),
    image_base64: z.string().optional().describe("Base64-encoded screenshot"),
    extraction_hint: z
      .string()
      .optional()
      .describe("Hint about what to extract (e.g. 'extract all table data')"),
  },
  async ({ image_url, image_base64, extraction_hint }) => {
    const result = await callX402("/screenshot-data", {
      image_url,
      image_base64,
      extraction_hint,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ── Tool 4: Alt Text Generator ────────────────────────────────────────────────
server.tool(
  "alt_text",
  "Generate accessible alt text descriptions for images. " +
  "Cost: $0.01 USDC per call.",
  {
    image_url: z.string().url().optional().describe("Public URL of image"),
    image_base64: z.string().optional().describe("Base64-encoded image"),
    style: z
      .enum(["concise", "detailed", "seo"])
      .default("concise")
      .describe("Alt text style"),
  },
  async ({ image_url, image_base64, style }) => {
    const result = await callX402("/alt-text", {
      image_url,
      image_base64,
      style,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ── Tool 5: PII Detection ─────────────────────────────────────────────────────
server.tool(
  "pii_detect",
  "Detect and redact Personally Identifiable Information (PII) in text. " +
  "Returns detected PII types and redacted text. Cost: $0.02 USDC per call.",
  {
    text: z.string().describe("Text to scan for PII"),
    redact: z
      .boolean()
      .default(true)
      .describe("Whether to return redacted text"),
  },
  async ({ text, redact }) => {
    const result = await callX402("/pii-detect", { text, redact });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ── Tool 6: Sentiment Analysis ────────────────────────────────────────────────
server.tool(
  "sentiment_analysis",
  "Analyze sentiment of text — returns score, label, and key phrases. " +
  "Cost: $0.01 USDC per call.",
  {
    text: z.string().describe("Text to analyze"),
    language: z.string().default("en").describe("Language of the text"),
  },
  async ({ text, language }) => {
    const result = await callX402("/sentiment", { text, language });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ── Start ─────────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
