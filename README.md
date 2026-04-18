# Microblog

单用户微型微博系统，面向“自己写、自己存、自己管理”的轻量使用场景。

当前实现基于：

- `frontend`: Next.js 14
- `api`: Hono + Cloudflare Workers
- 数据库: Cloudflare D1
- 媒体: Tencent COS
- 导出: JSON / CSV / HTML / Markdown

## 特性

- 单用户密码登录
- 公开 / 私密动态
- 标签、日期筛选、置顶
- 图片上传
- 补充内容
- 导出为 `JSON`、`CSV`、`HTML`、`Markdown`
- 移动端适配与 PWA 基础能力

## 项目结构

```text
microblog/
├── api/          # Hono Workers API
├── frontend/     # Next.js 前端
├── docs/         # 文档
├── active/       # 当前 run 文档
├── archive/      # 历史 run 记录
└── decisions/    # ADR / 决策记录
```

## 本地开发

### 1. API

```bash
cd api
cp .dev.vars.example .dev.vars
npm install
npm run dev -- --ip 0.0.0.0 --port 8787
```

### 2. Frontend

```bash
cd frontend
cp .env.local.example .env.local
npm install
npm run dev -- --hostname 0.0.0.0 --port 3000
```

### 3. 访问

- 桌面端：`http://localhost:3000`
- 同局域网手机：`http://<你的局域网 IP>:3000`

## 部署概览

生产部署建议拆成两部分：

1. `api` 部署到 Cloudflare Workers
2. `frontend` 部署为静态站点

完整步骤看：

- [docs/friend-deployment-guide.md](./docs/friend-deployment-guide.md)
- [docs/open-source-release-checklist.md](./docs/open-source-release-checklist.md)

## 适合谁

这个项目更适合：

- 想自己搭一个单用户微博 / 随手记系统的人
- 愿意自己准备 Cloudflare / COS 配置的人
- 想把内容继续导入 Obsidian 做知识管理的人

它目前**不是**“注册即用”的 SaaS，也不是“零配置傻瓜部署”模板。

## Obsidian

当前已支持导出 `Markdown`，可作为导入 Obsidian 的基础格式。  
如果需要“发一条就自动写进 Obsidian vault”，还需要额外的本地同步脚本或桌面端同步器。

方案草案见：[docs/obsidian-sync-plan.md](./docs/obsidian-sync-plan.md)。

## 开源说明

本项目采用 [MIT License](./LICENSE)。

如果你准备公开发布，先执行一遍：

- [docs/open-source-release-checklist.md](./docs/open-source-release-checklist.md)

## 当前已知限制

- 视频上传依赖 COS，未配置时不可用
- iOS Safari / 主屏幕模式下，弹窗与系统 UI 的边界仍需继续收口
- 自动同步 Obsidian 还未实现

## 相关文档

- [docs/local-deployment.md](./docs/local-deployment.md)
- [docs/friend-deployment-guide.md](./docs/friend-deployment-guide.md)
- [docs/open-source-release-checklist.md](./docs/open-source-release-checklist.md)
