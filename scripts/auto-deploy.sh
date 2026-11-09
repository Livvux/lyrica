#!/bin/bash
# Deploys origin/main on the Mac Mini whenever it changed.
# Run every 5 min by the LaunchAgent com.lyrica.autodeploy from a dedicated clone
# (~/dev/lyrica-deploy-src), never from a working checkout. launchd never overlaps runs.
set -euo pipefail

main() {
  local src="$HOME/dev/lyrica-deploy-src"
  local state="$HOME/.lyrica-deployed-sha"

  git -C "$src" fetch -q origin main
  local sha
  sha=$(git -C "$src" rev-parse origin/main)
  [ "$sha" = "$(cat "$state" 2>/dev/null || true)" ] && return 0

  echo "$(date '+%F %T') deploying $sha"
  git -C "$src" reset -q --hard "$sha"
  # Recorded before building so a broken commit is not rebuilt every 5 minutes.
  echo "$sha" > "$state"
  (cd "$src" && ./deploy.sh)
  echo "$(date '+%F %T') deployed $sha"
}

# Defined and called on one parse so a self-updating reset cannot change the running script.
main "$@"; exit
