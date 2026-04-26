#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const { mkdtempSync, readFileSync, statSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const args = new Set(process.argv.slice(2));
const execute = args.has('--execute');
const remote = args.has('--remote');
const argv = process.argv.slice(2);
const backupArgIndex = argv.indexOf('--backup');
const database = process.env.MICROBLOG_D1_DATABASE;
const bucket = process.env.MICROBLOG_R2_BUCKET;
const backupPath = process.env.MICROBLOG_MEDIA_BACKUP_SQL || (backupArgIndex >= 0 ? argv[backupArgIndex + 1] : '');
const modeFlag = remote ? '--remote' : '--local';

if (!database || !bucket || !backupPath) {
  throw new Error('Set MICROBLOG_D1_DATABASE, MICROBLOG_R2_BUCKET, and MICROBLOG_MEDIA_BACKUP_SQL or pass --backup <sql-file>');
}

function runWrangler(parts, options = {}) {
  return execFileSync('npx', ['wrangler', ...parts], {
    cwd: join(__dirname, '..'),
    encoding: options.encoding || 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
  });
}

function sqlEscape(value) {
  return String(value).replaceAll("'", "''");
}

function d1(command) {
  return runWrangler(['d1', 'execute', database, modeFlag, '--json', '--command', command]);
}

function parseSqlValue(value) {
  return value === 'NULL' ? null : Number(value);
}

function extFromMime(mime) {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  return 'bin';
}

function parseDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) throw new Error('Malformed data URL');
  return { mime: match[1], buffer: Buffer.from(match[2], 'base64') };
}

function parseMediaRows(sql) {
  return sql
    .split('\n')
    .filter((line) => line.startsWith('INSERT INTO "media" VALUES'))
    .map((line) => {
      const match = /^INSERT INTO "media" VALUES\((\d+),(NULL|\d+),'([^']+)','([^']+)',(\d+),(NULL|\d+),(NULL|\d+),(NULL|\d+),'([^']+)'\);$/.exec(line);
      if (!match) throw new Error(`Could not parse media row: ${line.slice(0, 120)}`);
      return {
        id: Number(match[1]),
        postId: parseSqlValue(match[2]),
        type: match[3],
        dataUrl: match[4],
        size: Number(match[5]),
        width: parseSqlValue(match[6]),
        height: parseSqlValue(match[7]),
        duration: parseSqlValue(match[8]),
        createdAt: match[9],
      };
    });
}

function uploadR2Object(key, filePath, contentType) {
  runWrangler([
    'r2',
    'object',
    'put',
    `${bucket}/${key}`,
    modeFlag,
    '--file',
    filePath,
    '--content-type',
    contentType,
  ], { stdio: 'inherit' });
}

function verifyR2Object(key, expectedBytes) {
  const verifyDir = mkdtempSync(join(tmpdir(), 'microblog-r2-restore-verify-'));
  const verifyPath = join(verifyDir, key.replaceAll('/', '_'));
  runWrangler([
    'r2',
    'object',
    'get',
    `${bucket}/${key}`,
    modeFlag,
    '--file',
    verifyPath,
  ], { stdio: 'inherit' });
  const actualBytes = statSync(verifyPath).size;
  if (actualBytes !== expectedBytes) {
    throw new Error(`R2 verification failed for ${key}: expected ${expectedBytes}, got ${actualBytes}`);
  }
}

const rows = parseMediaRows(readFileSync(backupPath, 'utf8'));
console.log(`Found ${rows.length} media rows in ${backupPath}`);

if (!execute) {
  for (const row of rows) {
    const { mime, buffer } = parseDataUrl(row.dataUrl);
    console.log(`[dry-run] media ${row.id}: ${mime}, ${buffer.length} bytes`);
  }
  process.exit(0);
}

const workDir = mkdtempSync(join(tmpdir(), 'microblog-r2-restore-'));
for (const row of rows) {
  const { mime, buffer } = parseDataUrl(row.dataUrl);
  const key = `media/${row.id}-restore.${extFromMime(mime)}`;
  const filePath = join(workDir, `${row.id}.${extFromMime(mime)}`);
  writeFileSync(filePath, buffer);

  console.log(`Restoring media ${row.id} -> ${key}`);
  uploadR2Object(key, filePath, mime);
  verifyR2Object(key, buffer.length);

  d1(`
    INSERT INTO media (id, post_id, type, url, size, width, height, duration, created_at)
    VALUES (
      ${row.id},
      ${row.postId === null ? 'NULL' : row.postId},
      '${sqlEscape(row.type)}',
      'r2://${sqlEscape(key)}',
      ${buffer.length},
      ${row.width === null ? 'NULL' : row.width},
      ${row.height === null ? 'NULL' : row.height},
      ${row.duration === null ? 'NULL' : row.duration},
      '${sqlEscape(row.createdAt)}'
    )
  `);
}
