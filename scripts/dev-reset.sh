#!/usr/bin/env bash
# Stop local Next.js dev and clear generated/cache directories only.
# This intentionally does not delete source content.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIR"

bash scripts/kill-next-dev.sh

rm -rf .next .turbo .content-collections/generated .content-collections/cache

cat <<'EOF'
Removed local generated/cache directories:
  .next
  .turbo
  .content-collections/generated
  .content-collections/cache

Restart dev with:
  pnpm dev
EOF
