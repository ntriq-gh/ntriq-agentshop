# ntriq-agentshop — Document Intelligence via x402 Micropayments

MCP server exposing AI-powered document intelligence endpoints with **pay-per-use pricing via x402 micropayments** (USDC on Base). No API keys, no subscriptions — AI agents pay only for what they use.

## MCP Tools

| Tool | Description | Price |
|------|-------------|-------|
| `document_intelligence` | Extract text, summarize, classify, or extract tables from document images | $0.05 |
| `invoice_extract` | Extract structured fields from invoices and receipts | $0.03 |
| `screenshot_data` | Extract structured data from UI screenshots and dashboards | $0.02 |
| `alt_text` | Generate accessible alt text for images | $0.01 |
| `pii_detect` | Detect and redact PII in text | $0.02 |
| `sentiment_analysis` | Analyze text sentiment with score and key phrases | $0.01 |

## Install

### Claude Code / Cursor / Windsurf

Add to your MCP config:

```json
{
  "mcpServers": {
    "ntriq-agentshop": {
      "command": "npx",
      "args": ["-y", "ntriq-agentshop"],
      "env": {
        "X402_PAYMENT_HEADER": "<your-x402-payment-header>"
      }
    }
  }
}
```

### Payment Setup

This server uses [x402](https://x402.org) micropayments on Base mainnet (USDC).

1. Get a Base wallet with USDC
2. Generate an EIP-3009 payment authorization for each request
3. Pass it as `X402_PAYMENT_HEADER` env var

Payment recipient: `0x124AaFfF8Ef45F2cA953807aF09Aacec2D9F8307`

## Architecture

```
AI Agent (Claude / Cursor / etc.)
    ↓ MCP stdio
ntriq-agentshop MCP Server
    ↓ HTTPS + x402 payment header
x402 Data Intelligence Server (https://x402.ntriq.co.kr)
    ↓
Local AI (qwen2.5-vl vision model)
```

## Partners & Ecosystem

### AsterPay

**Trust, discovery, and fiat settlement layer for AI agent commerce.**

KYA trust scoring (0-100), source-bounded fact-checking (AI Verify), USDC/EURe → EUR SEPA settlement. ERC-8004 native (Agent #16850).

- Website: [asterpay.io](https://asterpay.io)
- API docs: [asterpay.io/docs](https://asterpay.io/docs)
- MCP: `npx -y @asterpay/mcp-server`
- Demo: [asterpay.io/verify](https://asterpay.io/verify)

ntriq-agentshop is registered on the AsterPay ecosystem as **Agent #16850**. Agents interacting with this server can verify trust scores via:

```bash
POST https://x402.asterpay.io/v1/agent/trust-score
Body: { "agent_id": "erc8004:<address>" }
```

## Running Locally

```bash
git clone https://github.com/ntriq-gh/ntriq-agentshop
cd ntriq-agentshop
npm install
X402_BASE_URL=https://x402.ntriq.co.kr node --import tsx mcp-server.ts
```

## License

MIT
