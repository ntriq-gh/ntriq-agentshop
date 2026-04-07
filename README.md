# ntriq AgentShop

> AI agent data market — pay-per-use analysis APIs via x402 micropayments

**Live endpoint**: https://x402.ntriq.co.kr

AI agents can autonomously pay with USDC on Base and receive instant document intelligence, invoice extraction, screenshot analysis, PII detection, and sentiment analysis. No API keys. No subscriptions. Just pay and go.

## How It Works

```
AI Agent → POST /document-intel
Server   → 402 Payment Required (USDC $0.05, Base mainnet)
Agent    → EIP-3009 signature (gasless)
Server   → Facilitator verification → 200 OK + results
```

## Endpoints

| Endpoint | Price | Description |
|----------|-------|-------------|
| `POST /document-intel` | $0.05 | Deep document analysis (qwen2.5vl:7b) |
| `POST /invoice-extract` | $0.03 | Invoice/receipt structured data extraction |
| `POST /screenshot-data` | $0.02 | UI screenshot to structured data |
| `POST /alt-text` | $0.01 | Image alt text generation |
| `POST /pii-detect` | $0.02 | PII detection and redaction |
| `POST /sentiment` | $0.01 | Sentiment + intent analysis |
| `GET /health` | Free | Health check |
| `GET /services` | Free | Service catalog for agent discovery |

## Payment

- Protocol: [x402](https://x402.org) (HTTP 402 + EIP-3009)
- Token: USDC on Base mainnet (eip155:8453)
- Gasless: Yes (EIP-3009 TransferWithAuthorization)
- Wallet: `0x124AaFfF8Ef45F2cA953807aF09Aacec2D9F8307`

## Quick Start (for AI agents)

```bash
# 1. Check available services
curl https://x402.ntriq.co.kr/services

# 2. Make a request (will return 402 with payment details)
curl -X POST https://x402.ntriq.co.kr/sentiment \
  -H "Content-Type: application/json" \
  -d '{"text": "This product is amazing!"}'

# 3. Pay and retry with EIP-3009 signature
# (Use x402-compatible client library)
```

## Infrastructure

- **Server**: Mac Mini (Apple Silicon)
- **Vision AI**: qwen2.5vl:7b (local, Ollama)
- **Text AI**: qwen2.5:7b (local, Ollama)
- **Uptime**: 24/7 via LaunchAgent
- **Origin cost**: $0 (100% local inference)

## MCP Skills (ClawHub)

59 OpenClaw skills published on ClawHub — each skill guides AI agents to use the x402 APIs for specific document analysis tasks.

## License

MIT
