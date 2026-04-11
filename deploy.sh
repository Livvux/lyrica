#!/bin/bash
# Deploy Lyrica to Mac Mini
# Schützt .env.local und ecosystem.config.js auf dem Ziel — werden nie überschrieben.

set -e

TARGET="macmini:~/dev/lyrica"

echo "→ Syncing code..."
rsync -avz --exclude-from=".rsyncignore" ./ "$TARGET/"

echo "→ Building..."
ssh macmini "cd ~/dev/lyrica && pnpm build"

echo "→ Restarting..."
ssh macmini "cd ~/dev/lyrica && pm2 restart ecosystem.config.js --update-env"

echo "✓ Done — https://lyrica.ts.lkmedia.xyz"
