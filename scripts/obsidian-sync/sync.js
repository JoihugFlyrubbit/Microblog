#!/usr/bin/env node
// obsidian-sync Phase 1 MVP
// 拉取 Microblog Markdown 导出，原子写入 Obsidian vault 汇总文件。

const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
  const out = { configPath: null, watch: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--config' && argv[i + 1]) {
      out.configPath = argv[i + 1];
      i++;
    } else if (arg === '--watch') {
      out.watch = true;
    } else if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    }
  }
  return out;
}

function printHelp() {
  console.log(`用法：
  node sync.js [--config <path>] [--watch]

示例：
  node sync.js                           # 按默认 ./sync.config.json 同步一次
  node sync.js --config ./my.json        # 指定配置文件
  node sync.js --watch                   # 按 intervalSeconds 循环同步

配置字段（sync.config.json）：
  apiBase         string   必填  API 根地址，如 http://localhost:8787
  vaultPath       string   必填  Obsidian vault 目录绝对路径
  outputPath      string   必填  写入文件相对 vault 的路径，如 Microblog/microblog-export.md
  password        string   必填  管理员登录密码（Phase 2 会换成只读 token）
  includePrivate  boolean  可选  默认 true
  intervalSeconds number   可选  --watch 模式下的轮询周期，默认 60
`);
}

function loadConfig(configPath) {
  const resolved = path.resolve(configPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`配置文件不存在：${resolved}（可复制 sync.config.example.json 并填写）`);
  }
  const config = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  for (const key of ['apiBase', 'vaultPath', 'outputPath', 'password']) {
    if (!config[key] || typeof config[key] !== 'string') {
      throw new Error(`配置缺少必填字段：${key}`);
    }
  }
  if (!path.isAbsolute(config.vaultPath)) {
    throw new Error(`vaultPath 必须是绝对路径，当前：${config.vaultPath}`);
  }
  if (path.isAbsolute(config.outputPath)) {
    throw new Error(`outputPath 必须是相对 vault 的相对路径，当前：${config.outputPath}`);
  }
  config.includePrivate = config.includePrivate !== false;
  config.intervalSeconds = Number(config.intervalSeconds) > 0 ? Number(config.intervalSeconds) : 60;
  return config;
}

function timestamp() {
  return new Date().toISOString();
}

async function login(apiBase, password) {
  const res = await fetch(`${apiBase}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`登录失败：HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  // iron-session 返回 Set-Cookie；Node fetch 保留原始头
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) {
    throw new Error('登录响应未包含 set-cookie，无法继续');
  }
  return setCookie.split(';')[0];
}

async function fetchMarkdown(apiBase, cookie, includePrivate) {
  const res = await fetch(`${apiBase}/export`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify({ format: 'markdown', includePrivate }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`/export 失败：HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  return await res.text();
}

function atomicWrite(targetFile, contents) {
  const dir = path.dirname(targetFile);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${targetFile}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, contents, 'utf8');
  fs.renameSync(tmp, targetFile);
}

async function runOnce(config) {
  const outFile = path.join(config.vaultPath, config.outputPath);
  console.log(`[${timestamp()}] 登录 ${config.apiBase} ...`);
  const cookie = await login(config.apiBase, config.password);
  console.log(`[${timestamp()}] 请求 /export（includePrivate=${config.includePrivate}）...`);
  const markdown = await fetchMarkdown(config.apiBase, cookie, config.includePrivate);
  atomicWrite(outFile, markdown);
  console.log(`[${timestamp()}] 已写入 ${outFile}（${Buffer.byteLength(markdown, 'utf8')} 字节）`);
}

async function runWatch(config) {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await runOnce(config);
    } catch (err) {
      console.error(`[${timestamp()}] 同步失败：${err.message}`);
    }
    await new Promise((r) => setTimeout(r, config.intervalSeconds * 1000));
  }
}

async function main() {
  const { configPath, watch } = parseArgs(process.argv.slice(2));
  const defaultConfigPath = path.resolve(__dirname, 'sync.config.json');
  const config = loadConfig(configPath || defaultConfigPath);
  if (watch) {
    console.log(`[${timestamp()}] watch 模式，每 ${config.intervalSeconds}s 同步一次`);
    await runWatch(config);
  } else {
    await runOnce(config);
  }
}

main().catch((err) => {
  console.error(`[${timestamp()}] 错误：${err.message}`);
  process.exit(1);
});
