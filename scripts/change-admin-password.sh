#!/usr/bin/env bash
set -euo pipefail

API_BASE="${1:-}"

if [[ -z "$API_BASE" ]]; then
  printf 'API base URL, for example https://your-pages-site.pages.dev/api: '
  read -r API_BASE
fi

API_BASE="${API_BASE%/}"

if [[ "$API_BASE" != https://* && "$API_BASE" != http://localhost:* && "$API_BASE" != http://127.0.0.1:* ]]; then
  echo "Refusing non-HTTPS API base outside localhost." >&2
  exit 1
fi

json_string() {
  node -e '
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => { process.stdout.write(JSON.stringify(input.replace(/\n$/, ""))); });
'
}

prompt_secret() {
  local label="$1"
  local value
  printf '%s: ' "$label" >&2
  read -r -s value
  printf '\n' >&2
  printf '%s' "$value"
}

OLD_PASSWORD="$(prompt_secret 'Current admin password')"
NEW_PASSWORD="$(prompt_secret 'New admin password')"
NEW_PASSWORD_CONFIRM="$(prompt_secret 'Confirm new admin password')"

if [[ "$NEW_PASSWORD" != "$NEW_PASSWORD_CONFIRM" ]]; then
  echo "New passwords do not match." >&2
  exit 1
fi

if (( ${#NEW_PASSWORD} < 12 )); then
  echo "New password must be at least 12 characters." >&2
  exit 1
fi

OLD_PASSWORD_JSON="$(printf '%s' "$OLD_PASSWORD" | json_string)"
NEW_PASSWORD_JSON="$(printf '%s' "$NEW_PASSWORD" | json_string)"

LOGIN_HEADERS="$(
  printf '{"password":%s}' "$OLD_PASSWORD_JSON" |
  curl -sS -D - -o /dev/null \
    -X POST "$API_BASE/auth/login" \
    -H 'Content-Type: application/json' \
    --data-binary @-
)"

SESSION_COOKIE="$(
  printf '%s\n' "$LOGIN_HEADERS" |
    awk 'BEGIN { IGNORECASE = 1 } /^set-cookie:/ { sub(/\r$/, ""); sub(/^[^:]+:[[:space:]]*/, ""); sub(/;.*/, ""); print; exit }'
)"

if [[ -z "$SESSION_COOKIE" ]]; then
  echo "Login failed or no session cookie was returned." >&2
  exit 1
fi

STATUS="$(
  printf '{"oldPassword":%s,"newPassword":%s}' "$OLD_PASSWORD_JSON" "$NEW_PASSWORD_JSON" |
  curl -sS -o /dev/null -w '%{http_code}' \
    -X POST "$API_BASE/auth/change-password" \
    -H 'Content-Type: application/json' \
    -H "Cookie: $SESSION_COOKIE" \
    --data-binary @-
)"

if [[ "$STATUS" != "200" ]]; then
  echo "Password change failed with HTTP status $STATUS." >&2
  exit 1
fi

echo "Password changed successfully."
