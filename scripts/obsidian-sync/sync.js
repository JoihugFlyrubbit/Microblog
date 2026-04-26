#!/usr/bin/env node
// obsidian-sync v2
// 每篇动态独立 .md，图片本地化到 attachments/，按内容指纹增量同步。

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

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

配置字段（sync.config.json）：
  apiBase         string   必填  API 根地址
  vaultPath       string   必填  Obsidian vault 目录绝对路径
  outputDir       string   必填  vault 内的输出目录（如 "Microblog"），脚本会建 posts/ 与 attachments/ 子目录
  password        string   必填  管理员登录密码
  includePrivate  boolean  可选  默认 true
  intervalSeconds number   可选  --watch 周期，默认 60
`);
}

function loadConfig(configPath) {
  const resolved = path.resolve(configPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`配置文件不存在：${resolved}（可复制 sync.config.example.json 并填写）`);
  }
  const config = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  // outputPath 是 v1 字段，兼容性提示
  if (config.outputPath && !config.outputDir) {
    throw new Error('配置已升级：请把 outputPath（单文件路径）改为 outputDir（目录名，如 "Microblog"）');
  }
  for (const key of ['apiBase', 'vaultPath', 'outputDir', 'password']) {
    if (!config[key] || typeof config[key] !== 'string') {
      throw new Error(`配置缺少必填字段：${key}`);
    }
  }
  if (!path.isAbsolute(config.vaultPath)) {
    throw new Error(`vaultPath 必须是绝对路径，当前：${config.vaultPath}`);
  }
  if (path.isAbsolute(config.outputDir)) {
    throw new Error(`outputDir 必须是相对 vault 的相对路径，当前：${config.outputDir}`);
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
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) {
    throw new Error('登录响应未包含 set-cookie，无法继续');
  }
  return setCookie.split(';')[0];
}

async function fetchExport(apiBase, cookie, includePrivate) {
  const res = await fetch(`${apiBase}/export`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify({ format: 'json', includePrivate }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`/export 失败：HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  if (!json.success || !json.data) {
    throw new Error(`/export 返回无效：${JSON.stringify(json).slice(0, 200)}`);
  }
  return json.data;
}

// 工具：原子写入
function atomicWrite(targetFile, contents) {
  const dir = path.dirname(targetFile);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${targetFile}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, targetFile);
}

// 工具：原子写入二进制（图片）
function atomicWriteBuffer(targetFile, buffer) {
  const dir = path.dirname(targetFile);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${targetFile}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, buffer);
  fs.renameSync(tmp, targetFile);
}

// 文件名安全化（保留中英文数字、空格、连字符、点）
function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 200);
}

// post 文件名：YYYY-MM-DD HH-mm post-NN.md（北京时间）
function postFilename(post) {
  const d = new Date(post.created_at.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) {
    return sanitizeFilename(`unknown post-${post.id}.md`);
  }
  const beijing = new Date(d.getTime() + 8 * 3600 * 1000);
  const Y = beijing.getUTCFullYear();
  const M = String(beijing.getUTCMonth() + 1).padStart(2, '0');
  const D = String(beijing.getUTCDate()).padStart(2, '0');
  const h = String(beijing.getUTCHours()).padStart(2, '0');
  const m = String(beijing.getUTCMinutes()).padStart(2, '0');
  return sanitizeFilename(`${Y}-${M}-${D} ${h}-${m} post-${post.id}.md`);
}

// mime → 扩展名
function mimeToExt(mime) {
  const map = {
    'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png',
    'image/gif': '.gif', 'image/webp': '.webp', 'image/heic': '.heic',
    'image/svg+xml': '.svg',
    'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm',
  };
  return map[mime?.toLowerCase()] || '';
}

// 从 media metadata 生成稳定 attachment 本地文件名。不要用 download_url：token 每次 export 都会变。
function attachmentFilename(media) {
  const ext = mimeToExt(media.mime) || (media.type === 'image' ? '.jpg' : '');
  return sanitizeFilename(`media-${media.id}${ext}`);
}

// 落盘 attachment（export attachment token URL），返回相对文件名
async function ensureAttachment(media, attachmentsDir, apiBase) {
  const fname = attachmentFilename(media);
  const target = path.join(attachmentsDir, fname);
  if (fs.existsSync(target)) {
    return fname;
  }

  const downloadUrl = media.download_url?.startsWith('http')
    ? media.download_url
    : `${apiBase}${media.download_url}`;
  const res = await fetch(downloadUrl);
  if (!res.ok) {
    throw new Error(`下载图片失败：HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  atomicWriteBuffer(target, buf);
  return fname;
}

// 读取 .md 的 front-matter，返回 { fingerprint, postId } 或 null
function readExistingMeta(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf8');
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const lines = match[1].split('\n');
  const get = (key) => {
    const line = lines.find((l) => l.startsWith(`${key}:`));
    return line ? line.replace(`${key}:`, '').trim() : null;
  };
  const idStr = get('post_id');
  return {
    fingerprint: get('fingerprint'),
    postId: idStr ? Number(idStr) : null,
  };
}

// 渲染格式版本号。改动 renderPostMarkdown 的输出格式时 +1，触发全量重写。
const RENDER_FORMAT_VERSION = 4;

// D1 里 created_at/updated_at 是 UTC 字符串（"YYYY-MM-DD HH:mm:ss"）。
// 输出到 obsidian 的时间统一转北京时间（+8h），文件名 / front-matter / appends 时间戳一致。
function toBeijingTimeString(utcStr) {
  if (!utcStr) return utcStr;
  const d = new Date(utcStr.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return utcStr;
  const beijing = new Date(d.getTime() + 8 * 3600 * 1000);
  const Y = beijing.getUTCFullYear();
  const M = String(beijing.getUTCMonth() + 1).padStart(2, '0');
  const D = String(beijing.getUTCDate()).padStart(2, '0');
  const h = String(beijing.getUTCHours()).padStart(2, '0');
  const m = String(beijing.getUTCMinutes()).padStart(2, '0');
  const s = String(beijing.getUTCSeconds()).padStart(2, '0');
  return `${Y}-${M}-${D} ${h}:${m}:${s}`;
}

// 算指纹：覆盖正文、updated_at、tags、media metadata、appends（id+content+created_at）
function postFingerprint(post, postAppends, postMedia, postTagNames) {
  const payload = JSON.stringify({
    _v: RENDER_FORMAT_VERSION,
    c: post.content,
    u: post.updated_at,
    v: post.visibility,
    p: post.pinned,
    t: postTagNames.slice().sort(),
    m: postMedia.map((m) => `${m.id}:${m.type}:${m.size}:${m.width || ''}:${m.height || ''}`).sort(),
    a: postAppends
      .slice()
      .sort((x, y) => x.id - y.id)
      .map((a) => `${a.id}|${a.created_at}|${a.content}`),
  });
  return crypto.createHash('sha1').update(payload).digest('hex');
}

function escapeYaml(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function renderPostMarkdown({ post, postAppends, postMedia, postTagNames, attachmentMap, fingerprint }) {
  const fmTags = postTagNames.length > 0
    ? postTagNames.map((t) => `  - "${escapeYaml(t)}"`).join('\n')
    : '  - "microblog"';

  const frontmatter = [
    '---',
    `post_id: ${post.id}`,
    `created_at: "${toBeijingTimeString(post.created_at)}"`,
    `updated_at: "${toBeijingTimeString(post.updated_at)}"`,
    `visibility: "${post.visibility}"`,
    `pinned: ${post.pinned === 1 ? 'true' : 'false'}`,
    `media_count: ${postMedia.length}`,
    `append_count: ${postAppends.length}`,
    `fingerprint: ${fingerprint}`,
    'tags:',
    fmTags,
    '---',
  ].join('\n');

  // 逐行去末尾空白：避免 CommonMark 硬换行（行末 ≥2 空格）在 Obsidian 渲染成竖线。
  // 不改后端 content，仅清洗导出表示。
  const body = (post.content || '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .trim() || '_这条动态没有正文内容_';

  const mediaBlock = postMedia.length > 0
    ? '\n\n' + postMedia.map((m) => {
        const local = attachmentMap.get(m.id);
        if (!local) return '';
        return m.type === 'image'
          ? `![](attachments/${local})`
          : `![[attachments/${local}]]`;
      }).filter(Boolean).join('\n\n')
    : '';

  // front-matter 的 tags 字段 Obsidian 原生识别，正文里不再重复一行 #xxx。

  const appendsBlock = postAppends.length > 0
    ? '\n\n---\n\n#### 补充\n\n' + postAppends
        .slice()
        .sort((x, y) => new Date(x.created_at) - new Date(y.created_at))
        .map((a) => `##### ${toBeijingTimeString(a.created_at)}\n\n${a.content}`)
        .join('\n\n')
    : '';

  return `${frontmatter}\n\n${body}${mediaBlock}${appendsBlock}\n`;
}

async function syncPosts(config, data) {
  const baseDir = path.join(config.vaultPath, config.outputDir);
  const postsDir = path.join(baseDir, 'posts');
  const attachmentsDir = path.join(baseDir, 'attachments');
  fs.mkdirSync(postsDir, { recursive: true });
  fs.mkdirSync(attachmentsDir, { recursive: true });

  // 索引：post_id → tags / appends / media
  const tagsByPost = new Map();
  for (const tag of data.tags || []) {
    if (!tag.post_ids) continue;
    for (const idStr of String(tag.post_ids).split(',')) {
      const id = Number(idStr);
      if (!id) continue;
      const cur = tagsByPost.get(id) || [];
      cur.push(tag.name);
      tagsByPost.set(id, cur);
    }
  }
  const appendsByPost = new Map();
  for (const a of data.appends || []) {
    const cur = appendsByPost.get(a.post_id) || [];
    cur.push(a);
    appendsByPost.set(a.post_id, cur);
  }
  const mediaByPost = new Map();
  for (const m of data.media || []) {
    if (!m.post_id) continue;
    const cur = mediaByPost.get(m.post_id) || [];
    cur.push(m);
    mediaByPost.set(m.post_id, cur);
  }

  let written = 0;
  let skipped = 0;
  let imagesDownloaded = 0;
  let markedDeleted = 0;

  const livePostIds = new Set();

  for (const post of data.posts || []) {
    livePostIds.add(post.id);
    const postAppends = appendsByPost.get(post.id) || [];
    const postMedia = mediaByPost.get(post.id) || [];
    const postTagNames = tagsByPost.get(post.id) || [];

    const fingerprint = postFingerprint(post, postAppends, postMedia, postTagNames);
    const filename = postFilename(post);
    const target = path.join(postsDir, filename);

    // 时区切换或文件名规则变化时，同 post_id 的旧文件名可能不同。先把旧文件 rename 到新路径。
    for (const file of fs.readdirSync(postsDir)) {
      if (!file.endsWith('.md')) continue;
      if (file.startsWith('_deleted_')) continue;
      if (file === filename) continue;
      const fullPath = path.join(postsDir, file);
      const oldMeta = readExistingMeta(fullPath);
      if (oldMeta && oldMeta.postId === post.id) {
        fs.renameSync(fullPath, target);
        break;
      }
    }

    const existing = readExistingMeta(target);
    if (existing && existing.fingerprint === fingerprint) {
      skipped++;
      continue;
    }

    // 下载图片
    const attachmentMap = new Map();
    for (const m of postMedia) {
      try {
        const before = fs.existsSync(path.join(attachmentsDir, attachmentFilename(m)));
        const fname = await ensureAttachment(m, attachmentsDir, config.apiBase);
        attachmentMap.set(m.id, fname);
        if (!before) imagesDownloaded++;
      } catch (err) {
        console.error(`[${timestamp()}] 警告：post ${post.id} 图片处理失败：${err.message}`);
      }
    }

    const md = renderPostMarkdown({ post, postAppends, postMedia, postTagNames, attachmentMap, fingerprint });
    atomicWrite(target, md);
    written++;
  }

  // 检测被删除的 post：vault 里有但 export 没有的，文件名加 _deleted_ 前缀
  for (const file of fs.readdirSync(postsDir)) {
    if (!file.endsWith('.md')) continue;
    if (file.startsWith('_deleted_')) continue; // 已经标记过
    const fullPath = path.join(postsDir, file);
    const meta = readExistingMeta(fullPath);
    if (!meta || meta.postId == null) continue;
    if (livePostIds.has(meta.postId)) continue;
    const newPath = path.join(postsDir, `_deleted_${file}`);
    fs.renameSync(fullPath, newPath);
    markedDeleted++;
  }

  return { total: (data.posts || []).length, written, skipped, imagesDownloaded, markedDeleted };
}

async function runOnce(config) {
  console.log(`[${timestamp()}] 登录 ${config.apiBase} ...`);
  const cookie = await login(config.apiBase, config.password);
  console.log(`[${timestamp()}] 拉取 export json（includePrivate=${config.includePrivate}）...`);
  const data = await fetchExport(config.apiBase, cookie, config.includePrivate);
  const stats = await syncPosts(config, data);
  console.log(`[${timestamp()}] 同步完成：共 ${stats.total} 篇，写入 ${stats.written}，跳过 ${stats.skipped}，新下载图片 ${stats.imagesDownloaded}，标记删除 ${stats.markedDeleted}`);
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
