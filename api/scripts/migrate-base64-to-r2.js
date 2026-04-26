#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const { mkdtempSync, readFileSync, statSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const args = new Set(process.argv.slice(2));
const isRemote = args.has('--remote');
const isLocal = args.has('--local') || !isRemote;
const dryRun = args.has('--dry-run') || (!args.has('--execute') && !args.has('--rollback'));
const execute = args.has('--execute');
const rollback = args.has('--rollback');
const database = process.env.MICROBLOG_D1_DATABASE || 'microblog-db-local';
const bucket = process.env.MICROBLOG_R2_BUCKET || 'microblog-media';
const modeFlag = isRemote ? '--remote' : '--local';
const legacyBackupRef = `api/backups/media-legacy-before-r2-${Date.now()}.json`;

if (execute && rollback) {
  throw new Error('Use only one of --execute or --rollback');
}

function runWrangler(parts, options = {}) {
  const output = execFileSync('npx', ['wrangler', ...parts], {
    cwd: join(__dirname, '..'),
    encoding: options.encoding || 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
  });
  return output;
}

function sqlEscape(value) {
  return String(value).replaceAll("'", "''");
}

function d1(command) {
  if (command.length > 100000) {
    const sqlDir = mkdtempSync(join(tmpdir(), 'microblog-d1-sql-'));
    const sqlPath = join(sqlDir, 'command.sql');
    writeFileSync(sqlPath, command);
    return runWrangler(['d1', 'execute', database, modeFlag, '--json', '--file', sqlPath]);
  }

  return runWrangler(['d1', 'execute', database, modeFlag, '--json', '--command', command]);
}

function d1Json(command) {
  const raw = d1(command);
  const jsonStart = raw.indexOf('[');
  if (jsonStart === -1) {
    throw new Error(`Wrangler did not return JSON: ${raw.slice(0, 200)}`);
  }
  const parsed = JSON.parse(raw.slice(jsonStart));
  return parsed[0]?.results || [];
}

function ensureLegacyTable() {
  d1(`
    CREATE TABLE IF NOT EXISTS media_legacy (
      media_id INTEGER PRIMARY KEY,
      old_url TEXT NOT NULL,
      old_size INTEGER,
      r2_key TEXT,
      status TEXT NOT NULL CHECK(status IN ('pending','r2_put_done','verified','d1_committed','rolled_back')),
      migrated_at TEXT,
      error TEXT
    )
  `);
}

function parseDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) {
    throw new Error('Malformed data URL');
  }
  return {
    mime: match[1],
    buffer: Buffer.from(match[2], 'base64'),
  };
}

function extFromMime(mime) {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  if (mime === 'video/mp4') return 'mp4';
  if (mime === 'video/webm') return 'webm';
  return 'bin';
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 10);
}

function putR2Object(key, filePath, contentType) {
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
  const verifyDir = mkdtempSync(join(tmpdir(), 'microblog-r2-verify-'));
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
    throw new Error(`R2 verification failed for ${key}: expected ${expectedBytes} bytes, got ${actualBytes}`);
  }
}

function resolveLegacyOldUrl(row) {
  if (row.old_url.startsWith('data:')) {
    return row.old_url;
  }

  const [backupRef, mediaRef] = row.old_url.split('#media-');
  if (!backupRef || !mediaRef) {
    throw new Error(`Unsupported legacy backup reference for media ${row.media_id}: ${row.old_url}`);
  }

  const backupPath = join(__dirname, '..', backupRef.replace(/^api\//, ''));
  const records = JSON.parse(readFileSync(backupPath, 'utf8'));
  const record = records.find((item) => Number(item.id) === Number(row.media_id));
  if (!record || typeof record.url !== 'string' || !record.url.startsWith('data:')) {
    throw new Error(`Legacy backup does not contain a data URL for media ${row.media_id}`);
  }
  return record.url;
}

function updateMediaUrlInChunks(mediaId, url, size) {
  const current = d1Json(`SELECT url FROM media WHERE id = ${mediaId}`);
  if (!current[0]?.url?.startsWith('r2://')) {
    throw new Error(`Rollback refused for media ${mediaId}: current url is not an R2 URL`);
  }

  d1(`
    UPDATE media
    SET url = 'restore:', size = ${size}
    WHERE id = ${mediaId}
      AND url LIKE 'r2://%'
  `);

  const chunkSize = 30000;
  for (let offset = 0; offset < url.length; offset += chunkSize) {
    const chunk = url.slice(offset, offset + chunkSize);
    d1(`UPDATE media SET url = url || '${sqlEscape(chunk)}' WHERE id = ${mediaId} AND url LIKE 'restore:%'`);
  }
  d1(`UPDATE media SET url = substr(url, 9) WHERE id = ${mediaId} AND url LIKE 'restore:data:%'`);

  const rows = d1Json(`SELECT url, size FROM media WHERE id = ${mediaId}`);
  if (rows[0]?.url !== url || Number(rows[0]?.size) !== Number(size)) {
    throw new Error(`Rollback validation failed for media ${mediaId}`);
  }
}

function migrate() {
  ensureLegacyTable();
  const rows = d1Json(`
    SELECT id, url, size
    FROM media
    WHERE url LIKE 'data:%'
    ORDER BY id
  `);

  console.log(`Found ${rows.length} base64 media rows (${isRemote ? 'remote' : 'local'}).`);
  if (dryRun) {
    for (const row of rows) {
      const { mime, buffer } = parseDataUrl(row.url);
      console.log(`[dry-run] media ${row.id}: ${mime}, ${buffer.length} bytes -> media/${row.id}-<random>.${extFromMime(mime)}`);
    }
    return;
  }

  writeFileSync(
    join(__dirname, '..', legacyBackupRef.replace(/^api\//, '')),
    JSON.stringify(rows.map((row) => ({ id: row.id, url: row.url, size: row.size })), null, 2)
  );
  console.log(`Wrote legacy media backup: ${legacyBackupRef}`);

  const workDir = mkdtempSync(join(tmpdir(), 'microblog-r2-migrate-'));

  for (const row of rows) {
    const { mime, buffer } = parseDataUrl(row.url);
    const key = `media/${row.id}-${randomSuffix()}.${extFromMime(mime)}`;
    const filePath = join(workDir, `${row.id}.${extFromMime(mime)}`);

    console.log(`Migrating media ${row.id} -> ${key}`);
    writeFileSync(filePath, buffer);

    d1(`
      INSERT OR IGNORE INTO media_legacy (media_id, old_url, old_size, status)
      VALUES (${row.id}, '${legacyBackupRef}#media-${row.id}', ${row.size || buffer.length}, 'pending')
    `);

    try {
      putR2Object(key, filePath, mime);
      d1(`UPDATE media_legacy SET r2_key = '${sqlEscape(key)}', status = 'r2_put_done', error = NULL WHERE media_id = ${row.id}`);
      verifyR2Object(key, buffer.length);
      d1(`UPDATE media_legacy SET status = 'verified', error = NULL WHERE media_id = ${row.id}`);
    } catch (error) {
      d1(`UPDATE media_legacy SET error = '${sqlEscape(error instanceof Error ? error.message : String(error))}' WHERE media_id = ${row.id}`);
      throw error;
    }

    const updateResult = d1Json(`
      UPDATE media
      SET url = 'r2://${sqlEscape(key)}', size = ${buffer.length}
      WHERE id = ${row.id}
        AND url LIKE 'data:%'
        AND length(url) = ${row.url.length}
      RETURNING id
    `);
    if (updateResult.length !== 1) {
      d1(`UPDATE media_legacy SET error = 'source media changed before commit' WHERE media_id = ${row.id}`);
      throw new Error(`Media ${row.id} changed before D1 commit`);
    }
    d1(`UPDATE media_legacy SET status = 'd1_committed', migrated_at = CURRENT_TIMESTAMP WHERE media_id = ${row.id}`);
  }
}

function rollbackMigration() {
  ensureLegacyTable();
  const rows = d1Json(`
    SELECT media_id, old_url, old_size
    FROM media_legacy
    WHERE status = 'd1_committed'
    ORDER BY media_id
  `);

  console.log(`Found ${rows.length} committed rows to roll back.`);
  if (dryRun) {
    for (const row of rows) {
      const oldUrl = resolveLegacyOldUrl(row);
      console.log(`[dry-run] rollback media ${row.media_id}: restorable ${oldUrl.length} chars`);
    }
    return;
  }

  for (const row of rows) {
    const oldUrl = resolveLegacyOldUrl(row);
    updateMediaUrlInChunks(row.media_id, oldUrl, row.old_size);
    d1(`UPDATE media_legacy SET status = 'rolled_back' WHERE media_id = ${row.media_id}`);
    console.log(`Rolled back media ${row.media_id}`);
  }
}

if (rollback) {
  rollbackMigration();
} else {
  migrate();
}
