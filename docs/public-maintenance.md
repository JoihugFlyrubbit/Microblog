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
2. Run validation:

```bash
cd api && npm run typecheck
cd ../frontend && npm run lint && npm run build
```

3. Scan the staged diff:

```bash
git diff --cached
git diff --cached --name-only
```

4. Scan the repository for accidental private values:

```bash
git grep -n -I -E "password|secret|token|private_key|latitude|longitude|192\\.168\\.|workers\\.dev|pages\\.dev"
```

Review each match. Placeholders and documentation examples are acceptable only
when they are generic and not personally identifying.

5. Commit only after the working tree contains source changes, not local data.

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
