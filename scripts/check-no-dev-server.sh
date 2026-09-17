#!/usr/bin/env bash
# Local build preflight: do not run production builds while this checkout's
# Next.js dev server is alive. Next dev/build can churn .next-related outputs
# enough to trigger local CPU/RAM spikes, especially with Turbopack.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_NAME="$(basename "$SCRIPT_DIR")"
LOCK_FILE="$SCRIPT_DIR/.dev.lock"
PORT="${DEV_SERVER_PORT:-${PORT:-3000}}"

fail() {
  cat >&2 <<EOF
ERROR: A local Next.js dev server is already running for this checkout ($PROJECT_NAME).

Stop it first:
  pnpm dev:kill

Or run production build validation in CI or a separate git worktree.
Do not run pnpm build, next build, pnpm analyze, or production QA builds while
Next dev is running in the same checkout.
EOF
  exit 1
}

process_cwd() {
  local pid="$1"
  lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1
}

process_cmd() {
  local pid="$1"
  ps -o command= -p "$pid" 2>/dev/null || true
}

process_is_this_checkout_dev() {
  local pid="$1"
  local cwd cmd

  kill -0 "$pid" 2>/dev/null || return 1

  cwd="$(process_cwd "$pid")"
  cmd="$(process_cmd "$pid")"

  case "$cwd" in
    "$SCRIPT_DIR"|"$SCRIPT_DIR"/*)
      case "$cmd" in
        *"next dev"*|*"next-server"*|*".next/dev"*|*"pnpm dev"*|*"npm run dev"*|*"yarn dev"*|*"bun dev"*|*"./dev"*)
          return 0
          ;;
      esac
      ;;
  esac

  case "$cmd" in
    *"$SCRIPT_DIR"*next\ dev*|*"$SCRIPT_DIR"*"next-server"*|*"$SCRIPT_DIR"*".next/dev"*|*"$SCRIPT_DIR"*"pnpm dev"*|*"$SCRIPT_DIR"*"npm run dev"*|*"$SCRIPT_DIR"*"yarn dev"*|*"$SCRIPT_DIR"*"bun dev"*|*"$SCRIPT_DIR"*"./dev"*)
      return 0
      ;;
  esac

  return 1
}

check_pid_list() {
  local pid
  for pid in "$@"; do
    [ -n "${pid:-}" ] || continue
    if process_is_this_checkout_dev "$pid"; then
      fail
    fi
  done
}

if [ -f "$LOCK_FILE" ]; then
  lock_pid="$(cat "$LOCK_FILE" 2>/dev/null || true)"
  if [ -n "$lock_pid" ] && kill -0 "$lock_pid" 2>/dev/null; then
    if process_is_this_checkout_dev "$lock_pid"; then
      fail
    fi
  fi
fi

candidates=$(
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
for pid in $candidates; do
  check_pid_list "$pid"
done

port_pids="$(lsof -ti tcp:"$PORT" -sTCP:LISTEN 2>/dev/null | sort -u || true)"
for pid in $port_pids; do
  check_pid_list "$pid"
done

exit 0
