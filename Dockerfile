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

# OS dependencies (ffmpeg, curl, tar, fontconfig, python3 for media & yt-dlp)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    tar \
    fontconfig \
    fonts-liberation \
    python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install bot dependencies (copy lockfile for deterministic installs)
COPY package.json package-lock.json ./
COPY prisma ./prisma/
RUN (npm ci --omit=dev || npm install --omit=dev --legacy-peer-deps) && npx prisma generate

# Copy bot source code
COPY src ./src/
COPY changelogs ./changelogs/
COPY start.js ./
COPY .env.example ./

# Copy built dashboard static files
COPY --from=radio-builder /dashboard/out ./dashboard/out/
COPY --from=main-builder /main-dashboard/out ./src/app/dashboard/out/

# Create storage directory structure, pre-download essential fonts & yt-dlp, and assign ownership to node user (UID 1000)
RUN mkdir -p storage/sessions storage/database storage/logs \
    storage/media storage/media/tmp storage/bin src/assets/fonts \
    storage/stickers && \
    curl -fsSL -o src/assets/fonts/impact.ttf https://raw.githubusercontent.com/theapache64/mufy/master/assets/impact.ttf && \
    cp src/assets/fonts/impact.ttf src/assets/fonts/Impact.ttf && \
    curl -fsSL -o src/assets/fonts/arialn.ttf https://raw.githubusercontent.com/genqiaolynn/fonts/master/ARIALN.TTF && \
    curl -fsSL -o storage/bin/yt-dlp https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp && \
    chmod 755 storage/bin/yt-dlp && \
    fc-cache -f && \
    chown -R node:node /app

USER node

# Environment defaults
ENV TZ=Asia/Jakarta
ENV NODE_ENV=production
ENV PORT=7860
ENV HOME=/home/node
ENV NODE_OPTIONS="--max-old-space-size=384 --expose-gc"
ENV PATH=/home/node/.local/bin:/app/storage/bin:$PATH

EXPOSE 7860

# Health check using the /api/system/ping endpoint on port 7860
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD curl -f http://localhost:7860/api/system/ping || exit 1

CMD ["node", "start.js"]