#!/bin/bash
set -euo pipefail

LOG="/opt/lyrica/deploy.log"
REPO="/opt/lyrica"

echo "========================================" >> "$LOG"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Deploy triggered" >> "$LOG"

cd "$REPO"

echo "[$(date '+%H:%M:%S')] Pulling latest code…" >> "$LOG"
git pull origin main >> "$LOG" 2>&1

echo "[$(date '+%H:%M:%S')] Building Docker image…" >> "$LOG"
docker build -t lyrica:latest . >> "$LOG" 2>&1

echo "[$(date '+%H:%M:%S')] Restarting container…" >> "$LOG"
docker compose down >> "$LOG" 2>&1
docker compose up -d >> "$LOG" 2>&1

echo "[$(date '+%H:%M:%S')] Deploy complete ✓" >> "$LOG"
