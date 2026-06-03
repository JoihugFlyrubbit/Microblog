#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$HOME/Claude/secrets/microblog-sync.env"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

if [[ -n "${CLOUDFLARE_OBSIDIAN_SYNC_API_TOKEN:-}" ]]; then
  export CLOUDFLARE_API_TOKEN="$CLOUDFLARE_OBSIDIAN_SYNC_API_TOKEN"
fi

exec /usr/local/bin/node "$SCRIPT_DIR/sync-remote-d1.js" --watch
