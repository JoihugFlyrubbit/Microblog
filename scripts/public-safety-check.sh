#!/usr/bin/env bash
set -euo pipefail

MODE="${1:---staged}"

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

failures=()

add_failure() {
  failures+=("$1")
}

is_example_path() {
  case "$1" in
    *.example|*.example.*|*.sample|*.sample.*) return 0 ;;
    *) return 1 ;;
  esac
}

is_allowed_sql() {
  case "$1" in
    api/src/db/schema.sql|api/scripts/init-db.sql|api/scripts/add-pinned-column.sql) return 0 ;;
    *) return 1 ;;
  esac
}

list_files() {
  if [[ "$MODE" == "--all" ]]; then
    git ls-files -z
  elif [[ "$MODE" == "--staged" ]]; then
    git diff --cached --name-only --diff-filter=ACMR -z
  elif [[ "$MODE" == "--worktree" ]]; then
    git ls-files -z --cached --others --exclude-standard
  else
    echo "usage: $0 [--staged|--all|--worktree]" >&2
    exit 2
  fi
}

file_content() {
  local path="$1"
  if [[ "$MODE" == "--all" ]]; then
    [[ -f "$path" ]] && cat -- "$path"
  else
    git show ":$path" 2>/dev/null || true
  fi
}

is_text_file() {
  local path="$1"
  if [[ "$MODE" == "--all" ]]; then
    [[ -f "$path" ]] && LC_ALL=C grep -Iq . "$path"
  else
    git show ":$path" 2>/dev/null | LC_ALL=C grep -Iq .
  fi
}

scan_path() {
  local path="$1"
  local base
  base="$(basename "$path")"

  case "$path" in
    */.env|*/.env.*|.env|.env.*)
      if ! is_example_path "$path"; then
        add_failure "$path: environment files must stay out of git"
      fi
      ;;
    */.dev.vars|*/.dev.vars.*|.dev.vars|.dev.vars.*)
      if ! is_example_path "$path"; then
        add_failure "$path: Wrangler dev vars must stay out of git"
      fi
      ;;
    scripts/obsidian-sync/sync.config.json)
      add_failure "$path: Obsidian sync config contains private local paths and credentials"
      ;;
    */.obsidian/*|.obsidian/*)
      add_failure "$path: Obsidian sync state must stay out of git"
      ;;
    */.wrangler/*|.wrangler/*)
      add_failure "$path: Wrangler local state must stay out of git"
      ;;
    */backups/*|backups/*)
      add_failure "$path: backup directories must stay out of git"
      ;;
  esac

  case "$base" in
    *.bundle)
      add_failure "$path: git history backup bundles must stay out of git"
      ;;
    *.db|*.sqlite|*.sqlite3|*.sqlite-*|*.dump|*.bak|*.backup)
      add_failure "$path: database/runtime backup files must stay out of git"
      ;;
    *.sql)
      if ! is_allowed_sql "$path"; then
        add_failure "$path: SQL files are blocked unless they are approved schema/migration source files"
      fi
      ;;
  esac
}

scan_content() {
  local path="$1"

  is_example_path "$path" && return 0
  is_text_file "$path" || return 0

  local content
  content="$(file_content "$path")"

  if grep -En '/Users/(khamoro|agent01|Shared)(/|$)' <<<"$content" >/dev/null; then
    add_failure "$path: contains a private absolute local path"
  fi

  if grep -En '\b(192\.168|10\.|172\.(1[6-9]|2[0-9]|3[0-1]))\.[0-9]{1,3}\.[0-9]{1,3}\b' <<<"$content" >/dev/null; then
    add_failure "$path: contains a concrete private LAN IP"
  fi

  if grep -En 'database_id\s*=\s*"[0-9a-fA-F-]{24,}"' <<<"$content" >/dev/null; then
    add_failure "$path: contains a concrete Cloudflare D1 database id"
  fi

  if grep -En 'account_id\s*=\s*"[0-9a-fA-F]{32}"' <<<"$content" >/dev/null; then
    add_failure "$path: contains a concrete Cloudflare account id"
  fi

  if grep -En 'ENV_LATITUDE=(-?[1-9][0-9]*(\.[0-9]+)?|-?0\.[0-9]*[1-9][0-9]*)' <<<"$content" >/dev/null; then
    add_failure "$path: contains a concrete latitude"
  fi

  if grep -En 'ENV_LONGITUDE=(-?[1-9][0-9]*(\.[0-9]+)?|-?0\.[0-9]*[1-9][0-9]*)' <<<"$content" >/dev/null; then
    add_failure "$path: contains a concrete longitude"
  fi

  if grep -En '(SESSION_SECRET|SERVICE_TOKEN|API_TOKEN|PASSWORD|PRIVATE_KEY)\s*[:=]\s*["'\'']?[A-Za-z0-9_./+=@:-]{16,}' <<<"$content" | grep -Ev 'your-|REPLACE_|<|example|placeholder|min-32-characters' >/dev/null; then
    add_failure "$path: contains a high-risk secret-like assignment"
  fi

  if grep -En 'https://[A-Za-z0-9.-]+\.(workers|pages)\.dev' <<<"$content" | grep -Ev 'your-|example|<|placeholder' >/dev/null; then
    add_failure "$path: contains a concrete Cloudflare workers.dev/pages.dev URL"
  fi
}

while IFS= read -r -d '' path; do
  scan_path "$path"
  scan_content "$path"
done < <(list_files)

if (( ${#failures[@]} > 0 )); then
  printf 'Public safety check failed:\n' >&2
  printf ' - %s\n' "${failures[@]}" >&2
  exit 1
fi

echo "Public safety check passed ($MODE)."
