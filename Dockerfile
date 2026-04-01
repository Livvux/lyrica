FROM node:22-bookworm-slim

# System-Chromium (bringt alle eigenen Abhängigkeiten mit) + ffmpeg + Fonts
# System-Chromium ist in Debian vollständig gepatcht und funktioniert ohne Sandbox-Probleme
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ffmpeg \
    fontconfig \
    fonts-liberation \
    fonts-noto \
    && fc-cache -fv \
    && rm -rf /var/lib/apt/lists/*

# pnpm via corepack
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# Install deps first (layer cache)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY . .
RUN pnpm build

# Chrome Headless Shell vorab herunterladen → kein Download beim ersten Render
RUN npx remotion browser ensure

# Chrome-Wrapper → System-Chromium mit --no-sandbox + --disable-dev-shm-usage
# (--disable-dev-shm-usage verhindert shared memory Fehler in Docker)
RUN printf '#!/bin/sh\nexec /usr/bin/chromium --no-sandbox --disable-dev-shm-usage "$@"\n' > /usr/local/bin/chrome-wrapper && \
    chmod +x /usr/local/bin/chrome-wrapper

# Tmp dir for audio/video files
RUN mkdir -p tmp/lyrica

EXPOSE 3000

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

CMD ["pnpm", "start"]
