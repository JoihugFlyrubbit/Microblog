import { Context, Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { Env } from '../types';
import { enqueueR2Deletion, sweepConfirmedOrphanR2Media, sweepR2DeletionQueue, sweepStalePendingR2Uploads } from '../lib/media-deletion';

export const uploadRouter = new Hono<{ Bindings: Env }>();

// Validation schemas
const presignedUrlSchema = z.object({
  filename: z.string().min(1),
  contentType: z.string().min(1),
  size: z.number().max(100 * 1024 * 1024), // Max 100MB
});

const confirmUploadSchema = z.object({
  key: z.string().min(1),
  url: z.string(),
  type: z.enum(['image', 'video']),
  size: z.number(),
  mediaId: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  duration: z.number().optional(),
});

const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const allowedVideoTypes = new Set(['video/mp4', 'video/webm']);
const maxUploadBytes = 100 * 1024 * 1024;

function getMediaType(contentType: string): 'image' | 'video' | null {
  if (allowedImageTypes.has(contentType)) return 'image';
  if (allowedVideoTypes.has(contentType)) return 'video';
  return null;
}

function getExtension(filename: string, contentType: string): string {
  const ext = filename.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  if (ext) return ext;
  if (contentType === 'image/jpeg') return 'jpg';
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  if (contentType === 'image/gif') return 'gif';
  if (contentType === 'video/mp4') return 'mp4';
  if (contentType === 'video/webm') return 'webm';
  return 'bin';
}

// Generate unique key for upload
function generateKey(mediaId: number, filename: string, contentType: string): string {
  const random = Math.random().toString(36).substring(2, 10);
  return `media/${mediaId}-${random}.${getExtension(filename, contentType)}`;
}

function createUploadUrl(c: Context<{ Bindings: Env }>, key: string, mediaId: number, size: number, type: 'image' | 'video'): string {
  const encodedKey = encodeURIComponent(key);
  const forwardedHost = c.req.header('X-Forwarded-Host');
  const forwardedProto = c.req.header('X-Forwarded-Proto') || 'https';

  const uploadUrl = forwardedHost
    ? new URL(`${forwardedProto}://${forwardedHost}/api/upload/r2/${encodedKey}`)
    : new URL(`./r2/${encodedKey}`, c.req.url);

  uploadUrl.searchParams.set('mediaId', String(mediaId));
  uploadUrl.searchParams.set('size', String(size));
  uploadUrl.searchParams.set('type', type);

  return uploadUrl.toString();
}

// Reserve a media row and return the authenticated R2 upload URL.
uploadRouter.post('/presigned', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = presignedUrlSchema.safeParse(body);

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue?.path?.[0] === 'size' && issue.code === 'too_big') {
      return c.json({
        success: false,
        error: {
          code: 'FILE_TOO_LARGE',
          message: '视频不能超过 100MB',
        },
      }, 400);
    }

    return c.json({
      success: false,
      error: {
        code: 'INVALID_UPLOAD_REQUEST',
        message: '上传参数不合法',
      },
    }, 400);
  }

  const { filename, contentType, size } = parsed.data;

  const mediaType = getMediaType(contentType);
  if (!mediaType) {
    return c.json({
      success: false,
      error: { code: 'INVALID_TYPE', message: '只允许上传图片或视频' },
    }, 400);
  }

  try {
    if (mediaType === 'video') {
      return c.json({
        success: false,
        error: {
          code: 'LOCAL_VIDEO_UNSUPPORTED',
          message: '视频上传将在 Range 读路径验证后开放。',
        },
      }, 400);
    }

    const reserved = await c.env.DB.prepare(`
      INSERT INTO media (post_id, type, url, size, width, height, duration)
      VALUES (NULL, ?, 'pending:r2', ?, NULL, NULL, NULL)
      RETURNING id
    `).bind(mediaType, size).first<{ id: number }>();

    if (!reserved) {
      throw new Error('Failed to reserve media row');
    }

    const key = generateKey(reserved.id, filename, contentType);
    await c.env.DB.prepare(
      'UPDATE media SET url = ? WHERE id = ? AND url = ?'
    ).bind(`pending:r2:${key}`, reserved.id, 'pending:r2').run();

    return c.json({
      success: true,
      data: {
        mediaId: reserved.id,
        key,
        url: createUploadUrl(c, key, reserved.id, size, mediaType),
        authorization: 'r2',
        expireTime: Date.now() + 600000,
        headers: {
          'Content-Type': contentType,
        },
        mode: 'r2',
      },
    });
  } catch (error) {
    console.error('Generate presigned URL error:', error);
    return c.json({
      success: false,
      error: { code: 'GENERATE_FAILED', message: '生成上传地址失败' },
    }, 500);
  }
});

// R2 upload endpoint - receives binary body and writes to R2.
uploadRouter.put('/r2/:key', authMiddleware, async (c) => {
  const key = decodeURIComponent(c.req.param('key'));
  const mediaId = Number(c.req.query('mediaId'));
  const declaredSize = Number(c.req.query('size'));
  const declaredType = c.req.query('type');
  const contentType = c.req.header('Content-Type')?.split(';')[0].trim().toLowerCase() || '';
  const contentLengthHeader = c.req.header('Content-Length');
  const contentLength = contentLengthHeader ? Number(contentLengthHeader) : NaN;
  const mediaType = getMediaType(contentType);

  if (!Number.isInteger(mediaId) || mediaId <= 0 || !key.startsWith(`media/${mediaId}-`)) {
    return c.json({
      success: false,
      error: { code: 'INVALID_UPLOAD_KEY', message: '上传地址无效' },
    }, 400);
  }

  if (!mediaType || mediaType !== declaredType) {
    return c.json({
      success: false,
      error: { code: 'INVALID_TYPE', message: '文件类型无效' },
    }, 400);
  }

  if (!Number.isFinite(contentLength) || contentLength <= 0 || contentLength > maxUploadBytes || contentLength !== declaredSize) {
    return c.json({
      success: false,
      error: { code: 'INVALID_SIZE', message: '文件大小无效' },
    }, 400);
  }

  if (!c.req.raw.body) {
    return c.json({
      success: false,
      error: { code: 'EMPTY_BODY', message: '文件内容为空' },
    }, 400);
  }

  const reserved = await c.env.DB.prepare(
    'SELECT id, url FROM media WHERE id = ? AND post_id IS NULL'
  ).bind(mediaId).first<{ id: number; url: string }>();

  if (!reserved || reserved.url !== `pending:r2:${key}`) {
    return c.json({
      success: false,
      error: { code: 'INVALID_MEDIA_STATE', message: '媒体记录状态无效' },
    }, 409);
  }

  try {
    await c.env.MEDIA_BUCKET.put(key, c.req.raw.body, {
      httpMetadata: { contentType },
      customMetadata: {
        mediaId: String(mediaId),
        size: String(contentLength),
        type: mediaType,
      },
    });

    return c.json({
      success: true,
      data: { key, mediaId },
    });
  } catch (error) {
    console.error('R2 upload error:', error);
    return c.json({
      success: false,
      error: { code: 'UPLOAD_FAILED', message: '保存文件失败' },
    }, 500);
  }
});

// Local upload endpoint - receives base64 data
uploadRouter.post('/local/:key', authMiddleware, async (c) => {
  const db = c.env.DB;
  const key = decodeURIComponent(c.req.param('key'));

  try {
    const body = await c.req.json();
    const { data, type, size, width, height } = body;

    if (!data || !type) {
      return c.json({
        success: false,
        error: { code: 'INVALID_DATA', message: '缺少文件数据' },
      }, 400);
    }

    // Validate it's a data URL
    if (!data.startsWith('data:')) {
      return c.json({
        success: false,
        error: { code: 'INVALID_FORMAT', message: '文件数据格式无效' },
      }, 400);
    }

    // Insert media record with base64 data as URL
    const result = await db.prepare(`
      INSERT INTO media (post_id, type, url, size, width, height, duration)
      VALUES (NULL, ?, ?, ?, ?, ?, NULL)
      RETURNING id
    `).bind(
      type,
      data, // Store base64 data URL directly
      size,
      width || null,
      height || null
    ).first();

    if (!result) {
      throw new Error('Failed to insert media record');
    }

    return c.json({
      success: true,
      data: {
        mediaId: result.id,
        key,
        url: data,
      },
    });
  } catch (error) {
    console.error('Local upload error:', error);
    return c.json({
      success: false,
      error: { code: 'UPLOAD_FAILED', message: '保存文件失败' },
    }, 500);
  }
});

// Confirm upload after the browser has written the object to R2.
uploadRouter.post('/confirm', authMiddleware, zValidator('json', confirmUploadSchema), async (c) => {
  const db = c.env.DB;
  const { key, url, type, size, mediaId, width, height, duration } = c.req.valid('json');

  try {
    if (url.startsWith('r2://') || key.startsWith('media/')) {
      if (!mediaId || !key.startsWith(`media/${mediaId}-`)) {
        return c.json({
          success: false,
          error: { code: 'INVALID_UPLOAD_KEY', message: '上传地址无效' },
        }, 400);
      }

      const object = await c.env.MEDIA_BUCKET.head(key);
      if (!object || object.size !== size) {
        return c.json({
          success: false,
          error: { code: 'UPLOAD_NOT_FOUND', message: '上传文件未找到或大小不一致' },
        }, 400);
      }

      const reserved = await db.prepare(
        'SELECT id, type, size, url FROM media WHERE id = ? AND post_id IS NULL'
      ).bind(mediaId).first<{ id: number; type: 'image' | 'video'; size: number; url: string }>();

      const objectContentType = object.httpMetadata?.contentType?.split(';')[0].trim().toLowerCase();
      if (
        !reserved ||
        reserved.url !== `pending:r2:${key}` ||
        reserved.type !== type ||
        reserved.size !== size ||
        getMediaType(objectContentType || '') !== type ||
        object.customMetadata?.mediaId !== String(mediaId) ||
        object.customMetadata?.size !== String(size) ||
        object.customMetadata?.type !== type
      ) {
        return c.json({
          success: false,
          error: { code: 'INVALID_MEDIA_STATE', message: '媒体记录状态无效' },
        }, 409);
      }

      const result = await db.prepare(`
        UPDATE media
        SET type = ?, url = ?, size = ?, width = ?, height = ?, duration = ?
        WHERE id = ? AND post_id IS NULL AND url = ?
        RETURNING id
      `).bind(
        type,
        `r2://${key}`,
        size,
        width || null,
        height || null,
        duration || null,
        mediaId,
        `pending:r2:${key}`
      ).first<{ id: number }>();

      if (!result) {
        return c.json({
          success: false,
          error: { code: 'INVALID_MEDIA_STATE', message: '媒体记录状态无效' },
        }, 409);
      }

      return c.json({
        success: true,
        data: {
          mediaId: result.id,
          key,
          url: `/media/${result.id}`,
        },
      });
    }

    // For local mode with base64 data, the record is already created in /local/:key
    // Check if media already exists (local mode)
    const existingMedia = await db.prepare(
      'SELECT id FROM media WHERE url = ?'
    ).bind(url).first();

    if (existingMedia) {
      return c.json({
        success: true,
        data: {
          mediaId: existingMedia.id,
          key,
          url,
        },
      });
    }

    return c.json({
      success: false,
      error: { code: 'UNSUPPORTED_UPLOAD_MODE', message: '上传模式已停用，请刷新页面后重试' },
    }, 400);
  } catch (error) {
    console.error('Confirm upload error:', error);
    return c.json({
      success: false,
      error: { code: 'CONFIRM_FAILED', message: '保存媒体记录失败' },
    }, 500);
  }
});

uploadRouter.post('/sweep-deletions', authMiddleware, async (c) => {
  try {
    const [deletionQueue, stalePendingUploads] = await Promise.all([
      sweepR2DeletionQueue(c.env),
      sweepStalePendingR2Uploads(c.env),
    ]);
    const confirmedOrphanMedia = await sweepConfirmedOrphanR2Media(c.env);
    return c.json({
      success: true,
      data: { deletionQueue, stalePendingUploads, confirmedOrphanMedia },
    });
  } catch (error) {
    console.error('Sweep R2 deletion queue error:', error);
    return c.json({
      success: false,
      error: { code: 'SWEEP_FAILED', message: '清理 R2 删除队列失败' },
    }, 500);
  }
});

// Delete media
uploadRouter.delete('/:id', authMiddleware, async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));

  if (isNaN(id)) {
    return c.json({
      success: false,
      error: { code: 'INVALID_ID', message: '媒体 ID 无效' },
    }, 400);
  }

  try {
    const media = await db.prepare(
      'SELECT * FROM media WHERE id = ?'
    ).bind(id).first();

    if (!media) {
      return c.json({
        success: false,
        error: { code: 'NOT_FOUND', message: '未找到媒体文件' },
      }, 404);
    }

    await enqueueR2Deletion(db, typeof media.url === 'string' ? media.url : null);
    await db.prepare('DELETE FROM media WHERE id = ?').bind(id).run();

    return c.json({
      success: true,
      message: '媒体文件已删除',
    });
  } catch (error) {
    console.error('Delete media error:', error);
    return c.json({
      success: false,
      error: { code: 'DELETE_FAILED', message: '删除媒体文件失败' },
    }, 500);
  }
});
