# ── Stage 1: Build radio dashboard ──
FROM node:20-slim AS radio-builder
WORKDIR /dashboard
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY dashboard/ .
RUN npm run build

# ── Stage 2: Build main dashboard ──
FROM node:20-slim AS main-builder
WORKDIR /main-dashboard
COPY src/app/dashboard/package.json src/app/dashboard/package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY src/app/dashboard/ .
RUN npm run build

# ── Stage 3: Runtime ──
# Use standard node:20 which has build-essential & python3 pre-installed
FROM node:20

# OS dependencies (only ffmpeg needed now)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
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
COPY --from=radio-builder /dashboard/out ./dashboard/out/
COPY --from=main-builder /main-dashboard/out ./src/app/dashboard/out/

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