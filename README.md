# Microblog

单用户微型微博系统，面向“自己写、自己存、自己管理”的轻量使用场景。前端是 Next.js 静态站点，API 运行在 Cloudflare Workers，数据放在 D1，图片放在 R2。

## Features

- 单用户密码登录
- 公开 / 私密动态
- 标签、日期筛选、置顶
- 图片上传、裁剪、预览
- 补充内容
- JSON / CSV / HTML / Markdown 导出
- Obsidian 增量同步脚本
- 移动端适配与 PWA 基础能力

## Stack

- `frontend`: Next.js 14 static export
- `api`: Hono + Cloudflare Workers
- `DB`: Cloudflare D1
- `Media`: Cloudflare R2
- `Sync`: Node.js + Wrangler

## Project Structure

```text
microblog/
├── api/                    # Workers API
├── frontend/               # Next.js frontend
├── scripts/obsidian-sync/  # Obsidian sync scripts
└── shared/                 # shared notes/types when needed
```

## Local Development

### API

```bash
cd api
cp .dev.vars.example .dev.vars
npm install
npm run dev -- --ip 0.0.0.0 --port 8787
```

### Frontend

```bash
cd frontend
cp .env.local.example .env.local
npm install
npm run dev -- --hostname 0.0.0.0 --port 3000
```

Open `http://localhost:3000`. A phone on the same LAN can open `http://<your-lan-ip>:3000`.

## Cloudflare Setup

1. Create a D1 database:

```bash
cd api
npx wrangler d1 create microblog-db
```

2. Create an R2 bucket:

```bash
npx wrangler r2 bucket create microblog-media
```

3. Update `api/wrangler.toml` with your D1 database name/id and R2 bucket name.

4. Configure API variables:

```text
ALLOWED_ORIGINS=https://your-pages-site.pages.dev
SESSION_SAME_SITE=lax
ENV_LOCATION_LABEL=Your Location
ENV_LATITUDE=0
ENV_LONGITUDE=0
ENV_TIMEZONE=Asia/Shanghai
QWEATHER_API_HOST=your-qweather-api-host
```

`ALLOWED_ORIGINS` is an exact comma-separated allowlist for credentialed browser requests. Do not use broad wildcard domains for production.

5. Set API secrets:

```bash
npx wrangler secret put SESSION_SECRET
npx wrangler secret put QWEATHER_PRIVATE_KEY
npx wrangler secret put QWEATHER_KEY_ID
npx wrangler secret put QWEATHER_PROJECT_ID
```

Weather and location variables are optional. Without them, weather/AQI/UV fields return unavailable values.

6. Initialize the database schema:

```bash
npx wrangler d1 execute microblog-db --remote --file src/db/schema.sql
```

7. Deploy the API:

```bash
npm run deploy -- --env production
```

8. Deploy the frontend to Cloudflare Pages with:

```text
Build command: npm run build
Build output: out
Root directory: frontend
Environment variable: NEXT_PUBLIC_SITE_URL=https://your-pages-site.pages.dev
Runtime variable: MICROBLOG_API_ORIGIN=https://your-api.your-subdomain.workers.dev
```

## Obsidian Sync

Copy the example config and fill in local paths/secrets:

```bash
cd scripts/obsidian-sync
cp sync.config.example.json sync.config.json
```

API export mode:

```bash
node sync.js --watch
```

Remote D1/R2 mode, useful when local Node cannot reliably reach `*.workers.dev`:

```bash
node sync-remote-d1.js --watch
```

`sync.config.json` is ignored by git because it contains local paths and the admin password.

## Public Release Notes

Before making your fork public:

- Keep `.dev.vars`, `.env.local`, `sync.config.json`, database backups, and local Wrangler state out of git.
- Replace `api/wrangler.toml` placeholder resource IDs with your own values only in your deployment branch or private local copy.
- Rotate secrets if any real secret was ever committed.
- Review `LICENSE` and package metadata.

## Known Limits

- Video upload is still disabled until the R2 Range read path is fully validated for production.
- This is a self-hosted single-user app, not a multi-user SaaS template.
- The Obsidian watcher is a local process; on macOS, keep it running with LaunchAgent or another supervisor.

## License

[MIT](./LICENSE)
