# Public Maintenance Guide

This project is intended to be safe as a public source repository. Runtime data,
local paths, private deployment details, and secrets must stay outside git.

## Ownership Boundary

Keep these two categories separate:

- Source code: tracked in git and safe to publish.
- Operations data: stored in Cloudflare, local ignored files, Obsidian, or local
  backups. Do not commit it.

Do not add real values for personal locations, private API hosts, Cloudflare
resource IDs, LAN IPs, passwords, tokens, database exports, or Obsidian vault
paths to tracked files.

The Pages Function and API Worker share a runtime-only `PROXY_SHARED_SECRET` to
authenticate the transient source used by endpoint rate limits. Keep the values
identical, at least 32 characters, and outside git. If either runtime lacks it,
protected requests through the Pages proxy fail safely: page-view counting stops
without affecting static page delivery, and login returns a temporary service
error before bcrypt or D1 login-log work.

## Files That Must Stay Private

These files and directories are intentionally ignored:

- `api/.dev.vars`
- `api/.dev.vars.*`
- `frontend/.env.local`
- `frontend/.env.*.local`
- `scripts/obsidian-sync/sync.config.json`
- `api/backups/`
- `**/backups/*.sql`
- `**/.wrangler/`
- `**/node_modules/`
- local git history backup bundles, such as `*.bundle`

Before committing, run:

```bash
git status --short --ignored
git diff --cached --name-only
```

If a private file appears as tracked or staged, stop and unstage it before
committing.

## Database, Media, and Obsidian Sync

The production source of truth is Cloudflare:

- Posts and metadata live in D1.
- Images live in R2.
- The frontend talks to the API through the same-origin Pages `/api` proxy.

Obsidian sync is a private local process. Configure it by copying
`scripts/obsidian-sync/sync.config.example.json` to
`scripts/obsidian-sync/sync.config.json`, then fill in local paths and private
credentials there. The real config is ignored by git.

For backups, export D1 data to an ignored local backup directory:

```bash
BACKUP_DIR=/path/to/private/backups ./scripts/dump-d1.sh
```

Do not place database exports under tracked docs or commit them to the public
repository. R2 object backup/export should also use private local storage or a
private bucket, not this repo.

## Change Workflow

Use this flow for future code changes:

1. Edit source files.
2. Install the local git hook once per clone:

```bash
./scripts/install-git-hooks.sh
```

3. Run validation:

```bash
cd api && npm run typecheck
cd ../frontend && npm run lint && npm run build
```

When endpoint protection changes, also run an isolated Wrangler smoke with local
D1 and Rate Limiting bindings. Confirm that rejected analytics requests do not
increase `page_view_daily`, and that throttled login requests do not add
`login_logs`. Never use production URLs or administrator credentials for this
test.

4. Stage only source changes, then run the public-safety scan:

```bash
./scripts/public-safety-check.sh --staged
```

The pre-commit hook runs the same staged scan automatically. GitHub Actions runs
the full tracked-file scan plus API/frontend validation on pushes and pull
requests.

The Gitleaks GitHub Actions job scans full checkout history and fails when it
finds a suspected secret. Its Action and scanner versions are pinned. Review
findings narrowly; never add a broad allowlist merely to make the job green.

5. Scan the staged diff:

```bash
git diff --cached
git diff --cached --name-only
```

6. When changing public-safety rules, scan all tracked files and the current
   worktree including untracked non-ignored files:

```bash
./scripts/public-safety-check.sh --all
./scripts/public-safety-check.sh --worktree
```

Review any failure before committing. Placeholders and documentation examples
are acceptable only when they are generic and not personally identifying.

7. Commit only after the working tree contains source changes, not local data.

## Password Rotation

The admin password is stored in D1 as a bcrypt hash in `users.password_hash`.
It is not a Cloudflare secret and should never be written to `.dev.vars`,
`.env.local`, `wrangler.toml`, sync config, README, or issue text.

Use the deployed HTTPS site or API endpoint to change it. Do not paste the new
password into chat or commit it. The `/auth/change-password` endpoint requires an
authenticated session and rejects new passwords shorter than 12 characters.

From a trusted terminal, rotate the production password with:

```bash
./scripts/change-admin-password.sh https://your-pages-site.pages.dev/api
```

The script prompts with hidden input. It refuses non-HTTPS API URLs except
localhost development URLs.

For production, browser requests should go to the Cloudflare Pages HTTPS site
and use the same-origin `/api` proxy. In that deployment shape, the password is
sent over HTTPS to Cloudflare, not as plaintext over the network. The login input
is a password field so it is not displayed on screen while typing.

## Response and session security

Cloudflare Pages reads `frontend/public/_headers` for static responses. Pages
Functions do not inherit that file, so the `/api` proxy and API Worker attach
their own API-specific security headers. The static CSP permits same-origin
assets and API requests plus `data:`/`blob:` images and media. Next.js static
export currently emits hydration scripts and runtime style attributes, so
`script-src 'unsafe-inline'` and `style-src 'unsafe-inline'` remain documented
exceptions. Removing either requires a separate build-time hash or nonce design
and browser regression testing.

Sessions include the user's integer `session_version`. Changing the password
increments that value and revokes every previously issued cookie, including the
current device. Deploying the migration also invalidates cookies issued before
the field existed, so users sign in once after deployment. Cookies remain
Secure in production, HttpOnly, SameSite=Lax, and use the 30-day rolling expiry.

Security login logs contain only a truncated request source (64 characters), a
truncated User-Agent (512 characters), success status, and timestamp. They do
not contain request bodies, passwords, cookies, or proxy signatures. A daily
Worker Cron Trigger deletes rows older than 90 days. Cleanup failures are logged
without exposing a public cleanup endpoint or interrupting page requests.

## Public Release Check

Before changing repository visibility or after any history rewrite, verify the
remote from a fresh clone:

```bash
git clone git@github.com:JoihugFlyrubbit/Microblog.git /tmp/microblog-public-check
cd /tmp/microblog-public-check
git grep -n -I -E "real-private-patterns-here" $(git rev-list --all)
cd api && npm ci && npm run typecheck
cd ../frontend && npm ci && npm run lint && npm run build
```

Replace `real-private-patterns-here` with the specific values that must not be
public, such as old hosts, old coordinates, LAN IPs, or deprecated security
patterns. Keep those real values out of this document.

## New Window Handoff

When starting a new assistant window, point it to this file and ask it to read:

- `README.md`
- `docs/public-maintenance.md`
- `.gitignore`
- `api/wrangler.toml`
- `frontend/functions/api/[[path]].ts`

The assistant should treat ignored files as private operations state and should
not print, commit, or move their contents unless explicitly requested.
