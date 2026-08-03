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

## Isolated Preview configuration

Preview deployments use a standalone Worker configuration. They do not inherit
from `api/wrangler.toml`, and they must never substitute Production resources for
missing Preview resources. The checked-in templates are deliberately unusable:

- `api/wrangler.preview.toml.example`: Worker name, exact Pages Origin, D1, R2,
  and two Rate Limit bindings.
- `api/.preview-worker-secrets.example`: local secret-presence and equality
  checks only.
- `api/.preview-production-refs.example`: comparison-only Production resource
  coordinates; it contains no secrets.
- `frontend/.preview-pages.example`: Pages Preview build/runtime values and the
  Pages copy of the shared secret.

Create the ignored local files without placing their contents in chat or logs:

```bash
cp api/wrangler.preview.toml.example api/wrangler.preview.toml
cp api/.preview-worker-secrets.example api/.preview-worker-secrets.local
cp api/.preview-production-refs.example api/.preview-production-refs.local
cp frontend/.preview-pages.example frontend/.preview-pages.local
```

Fill them locally. Real account IDs, resource IDs, bucket names, Worker/Pages
domains, and secrets stay in these ignored files or in Cloudflare. Never commit
them. The Production comparison file is required so the local gate can reject
resource reuse without printing either side's value.

The Preview Worker config must name an independent Preview/test D1 and an
independent or explicitly test-safe R2 bucket. Its two account-wide Rate Limit
namespace IDs must be different from each other and from both Production IDs:

- `ANALYTICS_RATE_LIMITER`: 6 requests per 60 seconds.
- `LOGIN_RATE_LIMITER`: 5 requests per 60 seconds.

The local gate can compare IDs supplied in the private files, but it cannot
prove account-wide uniqueness. A user must confirm in Cloudflare that neither
Preview namespace ID is used by any other Worker binding in the account.

Run the deterministic local gate from `api/`:

```bash
npm run preview:preflight
```

It exits nonzero for missing values, template placeholders, tracked private
files, wrong Rate Limit settings, Preview/Production D1 or R2 reuse, namespace
reuse, non-HTTPS or mismatched Origins, short secrets, or a Worker/Pages shared
secret mismatch. It reports only presence, minimum-length compliance, equality,
and isolation status; it never prints secret values, hashes, or fragments.

The exact Pages Preview HTTPS Origin must be both `PAGES_PREVIEW_ORIGIN` /
`NEXT_PUBLIC_SITE_URL` on the Pages side and the sole `ALLOWED_ORIGINS` value in
the Preview Worker config. Wildcards and broad domain matches are forbidden.
Set `MICROBLOG_API_ORIGIN` in the Pages Preview runtime to the exact Preview
Worker HTTPS Origin, never the Production API Origin.

Configure ordinary Pages Preview values in the Cloudflare Dashboard:

- Build variable: `NEXT_PUBLIC_SITE_URL`.
- Runtime variable: `MICROBLOG_API_ORIGIN` (used by the Pages Function).
- Runtime secret: `PROXY_SHARED_SECRET`.
- Build command: `npm run build`; output directory: `out`; root: `frontend`.
- Node version: the version pinned by `frontend/.node-version`.

`PAGES_PREVIEW_ORIGIN` is not consumed by application code; it exists in the
ignored local file so preflight can compare the exact Pages Origin with Worker
CORS. It need not be added to the deployed Pages runtime. `PROXY_SHARED_SECRET`
must be a Preview-only value of at least 32 characters and identical in Pages
and Worker. It is a secret, not a normal or `NEXT_PUBLIC_*` variable.

Configure Worker secrets interactively, always naming the standalone config:

```bash
cd api
npx wrangler secret put SESSION_SECRET --config wrangler.preview.toml
npx wrangler secret put PROXY_SHARED_SECRET --config wrangler.preview.toml
```

Do not pass secrets on the command line or use `--secrets-file` with a tracked
path. If Cloudflare authentication is unavailable, leave Dashboard/secret status
as pending; local placeholder values do not prove a deployed secret exists.

Every Worker Preview command must use the dedicated npm scripts below. These
scripts run preflight and hard-code `--config wrangler.preview.toml`; do not use
the generic `deploy` or `db:migrate` scripts for Preview:

```bash
cd api
npm run preview:dry-run
npm run preview:db:migrate
npm run preview:deploy
```

`preview:dry-run` never publishes. The other two commands mutate the remote
Preview environment and are reserved for a separately authorized F window.
Before either remote command, confirm the active Cloudflare account and every
binding in the Dashboard. Never add `--env production`, change the config path,
or replace a missing Preview resource with a Production one.

Use this order for the controlled Preview window:

1. Run `preview:preflight` against the ignored local files.
2. Confirm Cloudflare authentication, account-wide namespace uniqueness, and
   Worker/Pages/D1/R2 ownership and isolation in the Dashboard.
3. Create and record a recovery point for the Preview/test D1 only.
4. Apply migrations only to the `DB` binding in `wrangler.preview.toml` with
   `preview:db:migrate`.
5. Deploy the Preview Worker with `preview:deploy`.
6. Verify Worker health, exact CORS allow/reject behavior, login, both Rate Limit
   bindings, D1/R2 bindings, secrets, and Cron without querying Production.
7. Deploy Pages to its Preview environment with the reviewed Preview variables
   and secret; do not promote that deployment to Production.
8. Complete trusted HTTPS browser acceptance against the exact Preview Pages
   Origin.

Stop before migration or deployment if any local check fails, Cloudflare cannot
prove isolation, the D1 recovery point is missing, or either deployed secret is
unconfirmed. A successful local preflight is necessary but does not itself
approve migration, deployment, or Production access.

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

Anonymous tag responses expose only tags used by public posts. Their
`category_id` is `null`, `categories` is empty, and the compatibility
`collapsedLimit` is the non-sensitive default. Category names, ordering,
per-category display limits, empty categories, and private-only relationships
are available only to authenticated administration requests.

Successful public media responses remain cacheable for one year and immutable.
Successful private or orphan media responses use `private, no-store`. Every
media error or rejection, including invalid IDs and ranges, missing records or
objects, authorization failures, and corrupt or unsupported storage data, uses
`Cache-Control: no-store`. The Worker and Pages proxy preserve these explicit
route-level media policies instead of replacing them merely because the request
contains a Session Cookie.

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
