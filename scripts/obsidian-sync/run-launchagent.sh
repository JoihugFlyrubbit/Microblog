#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$HOME/Claude/secrets/microblog-sync.env"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

exec /usr/local/bin/node "$SCRIPT_DIR/sync-remote-d1.js" --watch
