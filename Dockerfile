# Cookmate engine API (Hono + Bun). The Next.js UI deploys separately (Vercel).
FROM oven/bun:1-slim

WORKDIR /app

# Install prod deps first so Docker layer-caches them across code changes.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY tsconfig.json ./
COPY src ./src

# Config comes from env vars (see .env.example); PORT is injected by the host.
EXPOSE 8787
CMD ["bun", "src/server/index.ts"]
