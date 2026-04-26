#!/usr/bin/env node
// Sync production Cloudflare D1/R2 directly to Obsidian via wrangler.
// This avoids local network issues reaching *.workers.dev from Node fetch.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const DB_NAME = process.env.MICROBLOG_D1_DATABASE || 'microblog-db';
const R2_BUCKET = process.env.MICROBLOG_R2_BUCKET || 'microblog-media';
const RENDER_FORMAT_VERSION = 5;

function parseArgs(argv) {
  return {
    watch: argv.includes('--watch'),
    configPath: argv.includes('--config') ? argv[argv.indexOf('--config') + 1] : path.join(__dirname, 'sync.config.json'),
  };
}

function loadConfig(configPath) {
  const config = JSON.parse(fs.readFileSync(path.resolve(configPath), 'utf8'));
  config.includePrivate = config.includePrivate !== false;
  config.intervalSeconds = Number(config.intervalSeconds) > 0 ? Number(config.intervalSeconds) : 60;
  return config;
}

function runWrangler(args) {
  const result = spawnSync('npx', ['wrangler', ...args], {
    cwd: path.resolve(__dirname, '../../api'),
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `wrangler ${args.join(' ')} failed`).trim());
  }
  return result.stdout;
}

function d1(sql) {
  const out = runWrangler(['d1', 'execute', DB_NAME, '--remote', '--json', '--command', sql]);
  const jsonStart = out.indexOf('[');
  if (jsonStart === -1) {
    throw new Error(`wrangler D1 returned non-JSON output: ${out.slice(0, 200)}`);
  }
  const parsed = JSON.parse(out.slice(jsonStart));
  return parsed[0]?.results || [];
}

function timestamp() {
  return new Date().toISOString();
}

function toBeijingTimeString(utcStr) {
  if (!utcStr) return utcStr;
  const d = new Date(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(utcStr) ? utcStr : `${utcStr.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return utcStr;
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

function sanitizeFilename(name) {
  return name.normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 200);
}

function postFilename(post) {
  const value = toBeijingTimeString(post.created_at);
  const prefix = value.replace(/:/g, '-').slice(0, 16);
  return sanitizeFilename(`${prefix} post-${post.id}.md`);
}

function mediaExt(media) {
  const key = media.url?.startsWith('r2://') ? media.url.slice('r2://'.length) : '';
  const ext = path.extname(key);
  if (ext) return ext;
  return media.type === 'image' ? '.jpg' : '';
}

function attachmentFilename(media) {
  return sanitizeFilename(`media-${media.id}${mediaExt(media)}`);
}

function atomicWrite(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, file);
}

function readExistingMeta(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf8');
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const get = (key) => {
    const line = match[1].split('\n').find((item) => item.startsWith(`${key}:`));
    return line ? line.replace(`${key}:`, '').trim() : null;
  };
  const id = get('post_id');
  return { postId: id ? Number(id) : null, fingerprint: get('fingerprint') };
}

function fingerprint(post, appends, media, tags) {
  const payload = JSON.stringify({
    _v: RENDER_FORMAT_VERSION,
    c: post.content,
    u: post.updated_at,
    v: post.visibility,
    p: post.pinned,
    t: tags.slice().sort(),
    m: media.map((item) => `${item.id}:${item.type}:${item.size}:${item.width || ''}:${item.height || ''}`).sort(),
    a: appends
      .slice()
      .sort((a, b) => a.id - b.id)
      .map((item) => `${item.id}|${item.created_at}|${item.content}`),
  });
  return crypto.createHash('sha1').update(payload).digest('hex');
}

function ensureAttachment(media, attachmentsDir) {
  const filename = attachmentFilename(media);
  const target = path.join(attachmentsDir, filename);
  if (fs.existsSync(target)) return filename;

  if (media.url?.startsWith('r2://')) {
    const key = media.url.slice('r2://'.length);
    runWrangler(['r2', 'object', 'get', `${R2_BUCKET}/${key}`, '--remote', '--file', target]);
    return filename;
  }

  if (media.url?.startsWith('data:')) {
    const [, base64] = media.url.split(',');
    atomicWrite(target, Buffer.from(base64 || '', 'base64'));
    return filename;
  }

  throw new Error(`unsupported media url for media ${media.id}`);
}

function renderMarkdown(post, appends, media, tags, attachmentMap, fp) {
  const tagLines = tags.length > 0
    ? tags.map((tag) => `  - "${String(tag).replace(/"/g, '\\"')}"`).join('\n')
    : '  - "microblog"';
  const frontmatter = [
    '---',
    `post_id: ${post.id}`,
    `created_at: "${toBeijingTimeString(post.created_at)}"`,
    `updated_at: "${toBeijingTimeString(post.updated_at)}"`,
    `visibility: "${post.visibility}"`,
    `pinned: ${post.pinned === 1 ? 'true' : 'false'}`,
    `media_count: ${media.length}`,
    `append_count: ${appends.length}`,
    `fingerprint: ${fp}`,
    'tags:',
    tagLines,
    '---',
  ].join('\n');

  const body = (post.content || '').split('\n').map((line) => line.replace(/[ \t]+$/, '')).join('\n').trim() || '_这条动态没有正文内容_';
  const mediaBlock = media.length > 0
    ? '\n\n' + media.map((item) => {
      const local = attachmentMap.get(item.id);
      if (!local) return '';
      return item.type === 'image' ? `![](attachments/${local})` : `![[attachments/${local}]]`;
    }).filter(Boolean).join('\n\n')
    : '';
  const appendsBlock = appends.length > 0
    ? '\n\n---\n\n#### 补充\n\n' + appends
      .slice()
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .map((item) => `##### ${toBeijingTimeString(item.created_at)}\n\n${item.content}`)
      .join('\n\n')
    : '';

  return `${frontmatter}\n\n${body}${mediaBlock}${appendsBlock}\n`;
}

function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const value = row[key];
    const current = map.get(value) || [];
    current.push(row);
    map.set(value, current);
  }
  return map;
}

async function runOnce(config) {
  const visibility = config.includePrivate ? '' : "WHERE visibility = 'public'";
  const posts = d1(`SELECT * FROM posts ${visibility} ORDER BY created_at DESC`);
  const postIds = posts.map((post) => post.id);
  const idList = postIds.length > 0 ? postIds.join(',') : 'NULL';
  const appends = d1(`SELECT * FROM appends WHERE post_id IN (${idList}) ORDER BY created_at`);
  const media = d1(`SELECT * FROM media WHERE post_id IN (${idList}) ORDER BY created_at`);
  const postTags = d1(`
    SELECT pt.post_id, t.name
    FROM post_tags pt
    JOIN tags t ON t.id = pt.tag_id
    WHERE pt.post_id IN (${idList})
    ORDER BY pt.post_id, t.name
  `);

  const appendsByPost = groupBy(appends, 'post_id');
  const mediaByPost = groupBy(media, 'post_id');
  const tagsByPost = new Map();
  for (const row of postTags) {
    const current = tagsByPost.get(row.post_id) || [];
    current.push(row.name);
    tagsByPost.set(row.post_id, current);
  }

  const baseDir = path.join(config.vaultPath, config.outputDir);
  const postsDir = path.join(baseDir, 'posts');
  const attachmentsDir = path.join(baseDir, 'attachments');
  fs.mkdirSync(postsDir, { recursive: true });
  fs.mkdirSync(attachmentsDir, { recursive: true });

  let written = 0;
  let skipped = 0;
  let imagesDownloaded = 0;
  const livePostIds = new Set(postIds);

  for (const post of posts) {
    const postAppends = appendsByPost.get(post.id) || [];
    const postMedia = mediaByPost.get(post.id) || [];
    const postTagNames = tagsByPost.get(post.id) || [];
    const fp = fingerprint(post, postAppends, postMedia, postTagNames);
    const filename = postFilename(post);
    const target = path.join(postsDir, filename);

    for (const file of fs.readdirSync(postsDir)) {
      if (!file.endsWith('.md') || file.startsWith('_deleted_') || file === filename) continue;
      const meta = readExistingMeta(path.join(postsDir, file));
      if (meta?.postId === post.id) {
        fs.renameSync(path.join(postsDir, file), target);
        break;
      }
    }

    const existing = readExistingMeta(target);
    if (existing?.fingerprint === fp) {
      skipped++;
      continue;
    }

    const attachmentMap = new Map();
    for (const item of postMedia) {
      try {
        const before = fs.existsSync(path.join(attachmentsDir, attachmentFilename(item)));
        const local = ensureAttachment(item, attachmentsDir);
        attachmentMap.set(item.id, local);
        if (!before) imagesDownloaded++;
      } catch (error) {
        console.error(`[${timestamp()}] 警告：post ${post.id} 图片处理失败：${error.message}`);
      }
    }

    atomicWrite(target, renderMarkdown(post, postAppends, postMedia, postTagNames, attachmentMap, fp));
    written++;
  }

  let markedDeleted = 0;
  for (const file of fs.readdirSync(postsDir)) {
    if (!file.endsWith('.md') || file.startsWith('_deleted_')) continue;
    const fullPath = path.join(postsDir, file);
    const meta = readExistingMeta(fullPath);
    if (meta?.postId && !livePostIds.has(meta.postId)) {
      fs.renameSync(fullPath, path.join(postsDir, `_deleted_${file}`));
      markedDeleted++;
    }
  }

  console.log(`[${timestamp()}] remote D1 同步完成：共 ${posts.length} 篇，写入 ${written}，跳过 ${skipped}，新下载图片 ${imagesDownloaded}，标记删除 ${markedDeleted}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig(args.configPath);
  if (!args.watch) {
    await runOnce(config);
    return;
  }
  console.log(`[${timestamp()}] remote D1 watch 模式，每 ${config.intervalSeconds}s 同步一次`);
  while (true) {
    try {
      await runOnce(config);
    } catch (error) {
      console.error(`[${timestamp()}] 同步失败：${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, config.intervalSeconds * 1000));
  }
}

main().catch((error) => {
  console.error(`[${timestamp()}] 错误：${error.message}`);
  process.exit(1);
});
