#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
MODE="${1:-run}"
case "$MODE" in run|--build-only|--verify|--logs) ;; *) echo "usage: $0 [--build-only|--verify|--logs]" >&2; exit 2 ;; esac
if pgrep -x Lyrica >/dev/null; then
  osascript -e 'tell application id "com.livvux.lyrica" to quit'
  sleep 2
fi
if [ ! -d node_modules ]; then pnpm install --frozen-lockfile; fi
pnpm build
swift build --package-path macos -c release
pnpm exec remotion browser ensure
python3 scripts/package-macos.py
if [ "$MODE" = --build-only ]; then exit 0; fi
open "$ROOT/dist/Lyrica.app"
if [ "$MODE" = --verify ]; then
  sleep 3
  pgrep -x Lyrica >/dev/null
  echo "Lyrica process is running. Verify the editor and an export before release."
elif [ "$MODE" = --logs ]; then
  tail -f "$HOME/Library/Application Support/Lyrica/desktop.log"
fi
