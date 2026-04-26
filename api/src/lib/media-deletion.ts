import { Env } from '../types';

export async function ensureMediaDeletionQueue(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS media_deletion_queue (
      r2_key TEXT PRIMARY KEY,
      queued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    )
  `).run();
}

export function r2KeyFromUrl(url: string | null | undefined) {
  if (!url) return null;
  if (url.startsWith('pending:r2:')) return url.slice('pending:r2:'.length);
  if (!url.startsWith('r2://')) return null;
  return url.slice('r2://'.length);
}

export async function enqueueR2Deletion(db: D1Database, url: string | null | undefined) {
  const key = r2KeyFromUrl(url);
  if (!key) return;
  await ensureMediaDeletionQueue(db);
  await db.prepare(`
    INSERT OR IGNORE INTO media_deletion_queue (r2_key, queued_at)
    VALUES (?, CURRENT_TIMESTAMP)
  `).bind(key).run();
}

export async function sweepR2DeletionQueue(env: Env, limit = 50) {
  await ensureMediaDeletionQueue(env.DB);
  const rows = await env.DB.prepare(`
    SELECT r2_key
    FROM media_deletion_queue
    WHERE deleted_at IS NULL
    ORDER BY queued_at
    LIMIT ?
  `).bind(limit).all<{ r2_key: string }>();

  let deleted = 0;
  let skippedReferenced = 0;
  const errors: Array<{ key: string; message: string }> = [];

  for (const row of rows.results) {
    try {
      const stillReferenced = await env.DB.prepare(`
        SELECT id
        FROM media
        WHERE url = ?
        LIMIT 1
      `).bind(`r2://${row.r2_key}`).first<{ id: number }>();

      if (stillReferenced) {
        skippedReferenced++;
        continue;
      }

      await env.MEDIA_BUCKET.delete(row.r2_key);
      await env.DB.prepare(`
        UPDATE media_deletion_queue
        SET deleted_at = CURRENT_TIMESTAMP
        WHERE r2_key = ?
      `).bind(row.r2_key).run();
      deleted++;
    } catch (error) {
      errors.push({
        key: row.r2_key,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { scanned: rows.results.length, deleted, skippedReferenced, errors };
}

export async function sweepStalePendingR2Uploads(env: Env, limit = 50) {
  const rows = await env.DB.prepare(`
    SELECT id, url
    FROM media
    WHERE post_id IS NULL
      AND url LIKE 'pending:r2:%'
      AND created_at < datetime('now', '-1 hour')
    ORDER BY created_at
    LIMIT ?
  `).bind(limit).all<{ id: number; url: string }>();

  let deleted = 0;
  const errors: Array<{ id: number; key: string; message: string }> = [];

  for (const row of rows.results) {
    const key = r2KeyFromUrl(row.url);
    if (!key) continue;

    try {
      await env.MEDIA_BUCKET.delete(key);
      await env.DB.prepare(
        'DELETE FROM media WHERE id = ? AND post_id IS NULL AND url = ?'
      ).bind(row.id, row.url).run();
      deleted++;
    } catch (error) {
      errors.push({
        id: row.id,
        key,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { scanned: rows.results.length, deleted, errors };
}

export async function sweepConfirmedOrphanR2Media(env: Env, limit = 50, olderThanHours = 24) {
  await ensureMediaDeletionQueue(env.DB);
  const rows = await env.DB.prepare(`
    SELECT id, url
    FROM media
    WHERE post_id IS NULL
      AND url LIKE 'r2://%'
      AND created_at < datetime('now', ?)
    ORDER BY created_at
    LIMIT ?
  `).bind(`-${olderThanHours} hours`, limit).all<{ id: number; url: string }>();

  let queued = 0;
  let deletedRows = 0;
  const errors: Array<{ id: number; key: string; message: string }> = [];

  for (const row of rows.results) {
    const key = r2KeyFromUrl(row.url);
    if (!key) continue;

    try {
      await enqueueR2Deletion(env.DB, row.url);
      const result = await env.DB.prepare(
        'DELETE FROM media WHERE id = ? AND post_id IS NULL AND url = ?'
      ).bind(row.id, row.url).run();
      queued++;
      if (result.meta.changes > 0) deletedRows++;
    } catch (error) {
      errors.push({
        id: row.id,
        key,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { scanned: rows.results.length, queued, deletedRows, errors };
}
