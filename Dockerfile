FROM node:20-slim
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source
COPY . .

# Build TypeScript
RUN npx tsc --outDir . 2>/dev/null || true

# Run MCP server (stdio transport — Glama introspection)
CMD ["node", "mcp-server.js"]
