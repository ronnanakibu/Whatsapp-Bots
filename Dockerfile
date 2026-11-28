# ── Stage 1: Frontend Dashboard Builder ──
FROM node:20-slim AS frontend-builder

WORKDIR /build/dashboard

COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci

COPY dashboard/index.html dashboard/vite.config.ts dashboard/tsconfig.json ./
COPY dashboard/src ./src
COPY dashboard/public ./public

RUN npm run build

# ── Stage 2: Production Runtime Container ──
FROM node:20 AS runtime

# OS dependencies (ffmpeg, curl, tar, fontconfig, python3 for media & yt-dlp, noto color emoji)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    tar \
    fontconfig \
    fonts-liberation \
    fonts-noto-color-emoji \
    python3 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install backend production dependencies deterministically and generate Prisma client
COPY package.json package-lock.json ./
COPY prisma ./prisma/
RUN npm ci --omit=dev && npx prisma generate

# Copy backend source and built Vite dashboard output
COPY start.js .env.example ./
COPY src ./src/
COPY changelogs ./changelogs/
COPY --from=frontend-builder /build/dashboard/out ./dashboard/out/

# Create runtime storage layout, pre-install fonts & yt-dlp, assign non-root node user (UID 1000)
RUN mkdir -p storage/sessions storage/database storage/logs \
    storage/media storage/media/tmp storage/bin src/assets/fonts \
    storage/stickers && \
    curl -fsSL -o src/assets/fonts/impact.ttf https://raw.githubusercontent.com/theapache64/mufy/master/assets/impact.ttf && \
    cp src/assets/fonts/impact.ttf src/assets/fonts/Impact.ttf && \
    curl -fsSL -o src/assets/fonts/arialn.ttf https://raw.githubusercontent.com/genqiaolynn/fonts/master/ARIALN.TTF && \
    curl -fsSL -o storage/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux && \
    chmod 755 storage/bin/yt-dlp && \
    fc-cache -f && \
    chown -R node:node /app

USER node

# Canonical runtime defaults
ENV TZ=Asia/Jakarta
ENV NODE_ENV=production
ENV PORT=25637
ENV RADIO_LISTEN_HOST=0.0.0.0
ENV HOME=/home/node
ENV NODE_OPTIONS="--max-old-space-size=384 --expose-gc"
ENV PATH=/home/node/.local/bin:/app/storage/bin:$PATH

EXPOSE 25637

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD sh -c 'curl -fsS "http://localhost:${PORT:-25637}/healthz" || exit 1'

CMD ["node", "start.js"]
