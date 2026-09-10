# Cookmate engine API (Hono + Bun). Supports Render and the AWS Compose stack.
FROM oven/bun:1-slim

WORKDIR /app

# Install prod deps first so Docker layer-caches them across code changes.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY tsconfig.json ./
COPY src ./src
RUN mkdir -p /app/data && chown bun:bun /app/data
USER bun

# Config comes from env vars (see .env.example); PORT is injected by the host.
EXPOSE 8787
CMD ["bun", "src/server/index.ts"]
