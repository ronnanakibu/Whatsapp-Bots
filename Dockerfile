# ── Stage 1: Build dashboard ──
FROM node:20-slim AS dashboard-builder
WORKDIR /dashboard
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci
COPY dashboard/ .
RUN npm run build

# ── Stage 2: Runtime ──
FROM node:20-slim

# OS dependencies (FFmpeg, Python, build tools for native modules like sharp/better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    openssl \
    ca-certificates \
    curl \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install bot dependencies (copy lockfile for deterministic installs)
COPY package.json package-lock.json ./
COPY prisma ./prisma/
RUN npm ci --omit=dev && npx prisma generate

# Copy bot source code
COPY src ./src/
COPY start.js ./
COPY .env.example ./

# Copy built dashboard static files
COPY --from=dashboard-builder /dashboard/out ./dashboard/out/

# Create storage directory structure (volume will mount over /app/storage)
RUN mkdir -p storage/sessions storage/database storage/logs \
    storage/media storage/media/tmp storage/bin src/assets/fonts \
    storage/stickers

# Environment defaults
ENV TZ=Asia/Jakarta
ENV NODE_ENV=production

# Health check using the existing /api/system/ping endpoint
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD curl -f http://localhost:${PORT:-25637}/api/system/ping || exit 1

CMD ["node", "start.js"]