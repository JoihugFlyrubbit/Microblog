# AGENTS.md

> `microblog` 代码仓库的项目入口。

全局规则：

- 共享工作区规则在本机 Claude workspace 的 `AGENTS.md`。
- 非代码仓库文档放在本机 Claude workspace 的 `projects/microblog/`。
- 全局路径规则在本机 Claude workspace 的 `path-governance-global.md`。

项目结构：

- API：`api/`，使用 Hono、Cloudflare Workers、D1、R2。
- 前端：`frontend/`，使用 Next.js static export。
- 公开仓库维护说明：`docs/public-maintenance.md`。

常用命令：

- API 类型检查：`cd api && npm run typecheck`
- 前端 lint：`cd frontend && npm run lint`
- 前端构建：`cd frontend && npm run build`
- 公开安全扫描：`./scripts/public-safety-check.sh --staged`

安全规则：

- 不暴露 `.dev.vars`、`.env.local`、`sync.config.json`、数据库备份、Wrangler 状态或本地 secrets。
- `.wrangler`、D1 状态、R2 媒体和同步状态都是持久数据，不是构建产物。
- 修改 auth、CORS、上传、D1、R2 或公开发布行为前，先读 `README.md` 和 `docs/public-maintenance.md`。
