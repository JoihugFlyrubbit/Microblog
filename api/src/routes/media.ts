import { Hono } from 'hono';
import { Env } from '../types';
import { optionalAuthMiddleware } from '../middleware/auth';

export const mediaRouter = new Hono<{ Bindings: Env }>();

function parseRange(rangeHeader: string | undefined, size: number): { offset: number; length: number } | null {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match) return null;

  const [, startRaw, endRaw] = match;
  if (!startRaw && !endRaw) return null;

  if (!startRaw) {
    const suffixLength = Number(endRaw);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    const length = Math.min(suffixLength, size);
    return { offset: size - length, length };
  }

  const start = Number(startRaw);
  const end = endRaw ? Number(endRaw) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) {
    return null;
  }

  return {
    offset: start,
    length: Math.min(end, size - 1) - start + 1,
  };
}

function mediaCacheControl(visibility: string | null): string {
  return visibility === 'public'
    ? 'public, max-age=31536000, immutable'
    : 'private, max-age=3600';
}

// GET /media/:id?v=<version>
//
// 返回媒体二进制流。视图侧请求 URL：`/media/<id>?v=<post.updated_at>`。
//
// 当前实现：base64 兼容路径——直接 decode media.url 中的 data URL。
// P2.4 迁移完成后接入 R2：
//   if media.url.startsWith('/media/')，则按 r2_key 走 c.env.MEDIA_BUCKET.get()
//
// 鉴权：
//   - public post 的 media → 公开放行
//   - private post 的 media / orphan media (post_id IS NULL) → 需要登录
mediaRouter.get('/:id', optionalAuthMiddleware, async (c) => {
  const db = c.env.DB;
  const idParam = c.req.param('id');
  const id = parseInt(idParam, 10);
  const isAuthenticated = c.get('userId') !== undefined;

  if (isNaN(id)) {
    return c.json(
      { success: false, error: { code: 'INVALID_ID', message: 'Invalid media ID' } },
      400
    );
  }

  const row = await db
    .prepare(
      `SELECT m.id, m.url, m.type, m.size, p.visibility, p.updated_at, m.post_id
       FROM media m
       LEFT JOIN posts p ON p.id = m.post_id
       WHERE m.id = ?`
    )
    .bind(id)
    .first<{
      id: number;
      url: string;
      type: 'image' | 'video';
      size: number;
      visibility: string | null;
      updated_at: string | null;
      post_id: number | null;
    }>();

  if (!row) {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Media not found' } },
      404
    );
  }

  const requiresAuth = row.visibility === 'private' || row.post_id === null;
  if (requiresAuth && !isAuthenticated) {
    return c.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
      401
    );
  }

  // base64 兼容路径
  if (row.url.startsWith('data:')) {
    const match = /^data:([^;]+);base64,(.+)$/s.exec(row.url);
    if (!match) {
      return c.json(
        { success: false, error: { code: 'CORRUPT_DATA_URL', message: 'Malformed data URL' } },
        500
      );
    }
    const [, mime, payload] = match;
    let binary: Uint8Array;
    try {
      binary = Uint8Array.from(atob(payload), (ch) => ch.charCodeAt(0));
    } catch {
      return c.json(
        { success: false, error: { code: 'BASE64_DECODE_FAILED', message: 'Invalid base64' } },
        500
      );
    }

    return new Response(binary.buffer as ArrayBuffer, {
      headers: {
        'Content-Type': mime,
        'Content-Length': String(binary.byteLength),
        'Cache-Control': mediaCacheControl(row.visibility),
        ETag: `"${row.id}-base64"`,
      },
    });
  }

  if (row.url.startsWith('r2://')) {
    const key = row.url.slice('r2://'.length);
    const rangeHeader = c.req.header('Range');
    const range = parseRange(rangeHeader, row.size);
    if (rangeHeader && !range) {
      return new Response(null, {
        status: 416,
        headers: {
          'Content-Range': `bytes */${row.size}`,
          'Cache-Control': mediaCacheControl(row.visibility),
        },
      });
    }
    const object = await c.env.MEDIA_BUCKET.get(
      key,
      range ? { range: { offset: range.offset, length: range.length } } : undefined
    );

    if (!object) {
      return c.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Media object not found' } },
        404
      );
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('Content-Type', headers.get('Content-Type') || (row.type === 'image' ? 'image/jpeg' : 'application/octet-stream'));
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Cache-Control', mediaCacheControl(row.visibility));
    headers.set('ETag', `"${row.id}-${row.updated_at || 'orphan'}-${object.etag}"`);

    if (range) {
      headers.set('Content-Length', String(range.length));
      headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${row.size}`);
      return new Response(object.body, { status: 206, headers });
    }

    headers.set('Content-Length', String(object.size));
    return new Response(object.body, { headers });
  }

  return c.json({
    success: false,
    error: { code: 'UNSUPPORTED_MEDIA_URL', message: 'Unsupported media storage format' },
  }, 500);
});
