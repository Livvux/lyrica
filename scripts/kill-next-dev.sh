#!/usr/bin/env bash
# Stop Next.js dev processes that belong to this checkout only.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${DEV_SERVER_PORT:-${PORT:-3000}}"

process_cwd() {
  local pid="$1"
  lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1
}

process_cmd() {
  local pid="$1"
  ps -o command= -p "$pid" 2>/dev/null || true
}

process_in_checkout() {
  local pid="$1"
  local cwd cmd

  kill -0 "$pid" 2>/dev/null || return 1
  cwd="$(process_cwd "$pid")"
  cmd="$(process_cmd "$pid")"

  case "$cwd" in
    "$SCRIPT_DIR"|"$SCRIPT_DIR"/*) return 0 ;;
  esac

  case "$cmd" in
    *"$SCRIPT_DIR"*) return 0 ;;
  esac

  return 1
}

kill_pid() {
  local pid="$1"
  [ -n "${pid:-}" ] || return 0
  if process_in_checkout "$pid"; then
    kill -TERM "$pid" 2>/dev/null || true
  fi
}

pids=$(
  {
    pgrep -f "next dev" 2>/dev/null || true
    pgrep -f "next-server" 2>/dev/null || true
    pgrep -f "pnpm dev" 2>/dev/null || true
    pgrep -f "npm run dev" 2>/dev/null || true
    pgrep -f "yarn dev" 2>/dev/null || true
    pgrep -f "bun dev" 2>/dev/null || true
    pgrep -f "$SCRIPT_DIR/.next/dev" 2>/dev/null || true
  } | sort -u
)

for pid in $pids; do
  kill_pid "$pid"
done

port_pids="$(lsof -ti tcp:"$PORT" -sTCP:LISTEN 2>/dev/null | sort -u || true)"
for pid in $port_pids; do
  kill_pid "$pid"
done

sleep 1

survivors=$(
  {
    pgrep -f "next dev" 2>/dev/null || true
    pgrep -f "next-server" 2>/dev/null || true
    pgrep -f "$SCRIPT_DIR/.next/dev" 2>/dev/null || true
    lsof -ti tcp:"$PORT" -sTCP:LISTEN 2>/dev/null || true
  } | sort -u
)

for pid in $survivors; do
  if process_in_checkout "$pid"; then
    kill -9 "$pid" 2>/dev/null || true
  fi
done

rm -f "$SCRIPT_DIR/.dev.lock" "$SCRIPT_DIR/.dev.pids" \
  "$SCRIPT_DIR/.stripe-webhook.pid" "$SCRIPT_DIR/.stripe-webhook.status" \
  "$SCRIPT_DIR/.stripe-webhook.log"

printf 'Stopped local Next.js dev processes for %s\n' "$(basename "$SCRIPT_DIR")"
