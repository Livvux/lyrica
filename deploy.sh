#!/bin/bash
# Deploy Lyrica to the Mac Mini (~/dev/lyrica, PM2 app "lyrica").
# .env.local and ecosystem.config.js on the target are protected by .rsyncignore.
# Runs locally when already on the Mac Mini, otherwise over ssh ($DEPLOY_HOST, default "mini").

set -e

APP_DIR="dev/lyrica"
HOST="${DEPLOY_HOST:-mini}"

if [ "$(hostname -s)" = "mini" ]; then
  TARGET="$HOME/$APP_DIR"
  run() { (cd "$TARGET" && PATH="/opt/homebrew/bin:$PATH" bash -c "$1"); }
else
  TARGET="$HOST:~/$APP_DIR"
  run() { ssh "$HOST" "cd ~/$APP_DIR && $1"; }
fi

echo "→ Syncing code..."
rsync -az --exclude-from=".rsyncignore" ./ "$TARGET/"

echo "→ Installing & building..."
run "pnpm install --frozen-lockfile && pnpm build"

echo "→ Restarting..."
run "pm2 restart ecosystem.config.js --update-env"

echo "✓ Done — https://mini.tail9026f0.ts.net:13002"
