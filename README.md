# ntriq AgentShop — AI Data Services via x402 Micropayments

AI-powered data intelligence endpoints with **pay-per-use pricing via x402 micropayments** (USDC on Base). No API keys, no subscriptions, no rate limits. AI agents pay only for what they use. 100% local inference — zero external API calls.

## Services (11 types × 2 pricing tiers = 22 endpoints)

### Vision Services (Image Input)

| Service | Endpoint | Single | Batch (max 500) |
|---------|----------|--------|-----------------|
| **Alt Text** | `/alt-text` | $0.01 | `/alt-text-batch` $3.00 |
| **Document Intel** | `/document-intel` | $0.05 | `/document-intel-batch` $15.00 |
| **Invoice Extract** | `/invoice-extract` | $0.03 | `/invoice-extract-batch` $9.00 |
| **Screenshot Data** | `/screenshot-data` | $0.02 | `/screenshot-data-batch` $6.00 |
| **Blueprint** | `/blueprint` | $0.05 | `/blueprint-batch` $15.00 |

### Text / NLP Services

| Service | Endpoint | Single | Batch (max 500) |
|---------|----------|--------|-----------------|
| **PII Detect** | `/pii-detect` | $0.02 | `/pii-detect-batch` $6.00 |
| **Sentiment** | `/sentiment` | $0.01 | `/sentiment-batch` $3.00 |
| **Content Generate** | `/content-generate` | $0.02 | `/content-generate-batch` $6.00 |
| **Compliance Check** | `/compliance-check` | $0.03 | `/compliance-check-batch` $9.00 |
| **Code Review** | `/code-review` | $0.05 | `/code-review-batch` $15.00 |
| **Phish Radar** | `/phish-radar` | $0.03 | `/phish-radar-batch` $9.00 |

---

## How It Works

```
AI Agent
  │
  ▼  POST /alt-text
x402.ntriq.co.kr
  │
  ├─ 402 Payment Required ($0.01 USDC, Base mainnet)
  │
  ▼  Agent signs EIP-3009 (gasless) → retries with payment
  │
  ├─ Facilitator verifies payment
  │
  ▼  200 OK + JSON result
  │
Mac Mini (local Qwen2.5-VL / Qwen2.5:7b)
  └─ 100% local inference, zero external API calls
```

**Payment protocol**: [x402](https://x402.org) — USDC on Base, EIP-3009 gasless authorization

---

## Service Details

### Alt Text — `/alt-text` ($0.01) · `/alt-text-batch` ($3.00)

Generate WCAG-compliant alt text (≤125 chars) and detailed accessibility descriptions.

```bash
POST /alt-text
{ "image_url": "https://example.com/product.jpg" }

# Response
{ "alt_text": "Red leather handbag with gold clasp", "description": "..." }
```

**Batch**: `{ "images": ["url1", "url2", ...], "context": "e-commerce catalog" }`

---

### Document Intelligence — `/document-intel` ($0.05) · batch ($15.00)

OCR, classification, table extraction, and summarization from document images.

```bash
POST /document-intel
{ "image_url": "...", "analysis_type": "extract|summarize|classify|table" }
```

---

### Invoice Extract — `/invoice-extract` ($0.03) · batch ($9.00)

Extract structured fields from invoices and receipts: vendor, amounts, line items, dates.

```bash
POST /invoice-extract
{ "image_url": "..." }

# Response
{ "invoice": { "vendor_name": "...", "total": 1250.00, "line_items": [...] } }
```

---

### Screenshot Data — `/screenshot-data` ($0.02) · batch ($6.00)

Extract text, UI elements, layout, and data tables from screenshots.

```bash
POST /screenshot-data
{ "image_url": "...", "extract_type": "full|text|data|layout" }
```

---

### Blueprint — `/blueprint` ($0.05) · batch ($15.00)

Analyze architectural blueprints and floor plans. Extract rooms, dimensions, materials.

```bash
POST /blueprint
{ "image_url": "...", "analysis_type": "full|rooms|dimensions|materials" }

# Response
{ "rooms": [{"name": "Living Room", "area": "24 m²"}], "total_area": "85 m²" }
```

---

### PII Detect — `/pii-detect` ($0.02) · batch ($6.00)

Detect and optionally mask PII: emails, phones, SSNs, names, addresses, credit cards.

```bash
POST /pii-detect
{ "text": "Contact John at john@email.com", "mask": true }

# Response
{ "pii_found": [...], "risk_level": "high", "masked_text": "Contact [NAME] at [EMAIL]" }
```

---

### Sentiment — `/sentiment` ($0.01) · batch ($3.00)

Analyze sentiment, emotions, and intent with confidence scores.

```bash
POST /sentiment
{ "text": "This product is amazing!" }

# Response
{ "sentiment": "positive", "confidence": 0.95, "intent": "praise" }
```

---

### Content Generate — `/content-generate` ($0.02) · batch ($6.00)

Generate blog posts, emails, social media, product descriptions, reports, and ad copy.

```bash
POST /content-generate
{ "prompt": "benefits of standing desks", "style": "blog|email|social|product|report|ad", "tone": "professional", "max_words": 500 }
```

---

### Compliance Check — `/compliance-check` ($0.03) · batch ($9.00)

Analyze text for GDPR, HIPAA, SOX, or general compliance violations. Returns risk level and remediation recommendations.

```bash
POST /compliance-check
{ "text": "We store passwords in plain text.", "framework": "GDPR", "jurisdiction": "EU" }

# Response
{ "compliant": false, "risk_level": "critical", "issues": [...] }
```

---

### Code Review — `/code-review` ($0.05) · batch ($15.00)

AI-powered code review for security vulnerabilities, performance, and quality. Any language.

```bash
POST /code-review
{ "code": "SELECT * FROM users WHERE id='" + id + "'", "language": "sql", "focus": "security" }

# Response
{ "overall_score": 2, "issues": [{"severity": "critical", "description": "SQL injection"}] }
```

---

### Phish Radar — `/phish-radar` ($0.03) · batch ($9.00)

Detect phishing URLs and domains. Identifies typosquatting, homoglyph attacks, brand impersonation.

```bash
POST /phish-radar
{ "url": "https://paypa1.com/login" }

# Response
{ "is_suspicious": true, "risk_score": 92, "risk_level": "critical", "legitimate_brand": "PayPal" }
```

---

## Quick Start

### Service Catalog

```bash
curl https://x402.ntriq.co.kr/services
```

### Health Check

```bash
curl https://x402.ntriq.co.kr/health
```

### Test (expects 402 response)

```bash
curl -X POST https://x402.ntriq.co.kr/sentiment \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello world"}'
# → 402 Payment Required
```

---

## Architecture

```
Mac Mini (Apple Silicon)
├── x402 Server (Node.js + tsx)         :4021
├── qwen-vision-api (Python)            :8100  ← Qwen2.5-VL:7b
├── Ollama                              :11434 ← Qwen2.5:7b, Gemma4
└── Cloudflare Tunnel → x402.ntriq.co.kr
```

**Payment**: USDC on Base mainnet via [x402 protocol](https://x402.org)  
**Wallet**: `0x124AaFfF8Ef45F2cA953807aF09Aacec2D9F8307`  
**Facilitator**: `https://facilitator.openx402.ai`

---

## ClawHub Skills

Install via [ClawHub](https://clawhub.ai) to enable these services in your AI agent:

```bash
clawhub install ntriq-x402-alt-text
clawhub install ntriq-x402-sentiment
clawhub install ntriq-x402-code-review
# ... and more
```

---

*Built by [ntriq](https://x402.ntriq.co.kr) — 100% local inference, 100% margin*
