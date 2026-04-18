import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { Env } from '../types';

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
  width: z.number().optional(),
  height: z.number().optional(),
  duration: z.number().optional(),
});

// Local development: store base64 images in database
// Production: use COS

// Generate unique key for upload
function generateKey(filename: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 10);
  const ext = filename.split('.').pop() || '';
  const safeExt = ext.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  return `uploads/${timestamp}-${random}.${safeExt}`;
}

// Check if COS is configured
function isCOSConfigured(env: Env): boolean {
  return !!(
    env.COS_SECRET_ID &&
    env.COS_SECRET_KEY &&
    env.COS_BUCKET &&
    env.COS_REGION &&
    env.COS_SECRET_ID !== 'your-tencent-cos-secret-id'
  );
}

// Get presigned URL for COS upload (or local upload URL)
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

  // Check if file type is allowed
  if (!contentType.startsWith('image/') && !contentType.startsWith('video/')) {
    return c.json({
      success: false,
      error: { code: 'INVALID_TYPE', message: '只允许上传图片或视频' },
    }, 400);
  }

  try {
    const key = generateKey(filename);

    if (contentType.startsWith('video/') && !isCOSConfigured(c.env)) {
      return c.json({
        success: false,
        error: {
          code: 'LOCAL_VIDEO_UNSUPPORTED',
          message: '当前本地开发环境暂不支持视频上传，请先配置 COS 后再试。',
        },
      }, 400);
    }

    // For local development without COS, return a local upload endpoint
    if (!isCOSConfigured(c.env)) {
      // Return a local upload URL
      const localUrl = new URL(`./local/${encodeURIComponent(key)}`, c.req.url).toString();

      return c.json({
        success: true,
        data: {
          key,
          url: localUrl,
          authorization: 'local', // Marker for local upload
          expireTime: Date.now() + 3600000, // 1 hour
          headers: {
            'Content-Type': contentType,
          },
          mode: 'local', // Tell frontend to use local upload mode
        },
      });
    }

    // COS mode (production)
    const { COS_SECRET_ID, COS_SECRET_KEY, COS_BUCKET, COS_REGION } = c.env;

    // Generate COS presigned URL (simplified - in production implement proper COS signature)
    const url = `https://${COS_BUCKET}.cos.${COS_REGION}.myqcloud.com/${key}`;

    return c.json({
      success: true,
      data: {
        key,
        url,
        authorization: 'cos', // Frontend will handle COS upload
        expireTime: Date.now() + 600000, // 10 minutes
        headers: {
          'Content-Type': contentType,
        },
        mode: 'cos',
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

// Confirm upload (for COS mode, or direct pass-through for local mode)
uploadRouter.post('/confirm', authMiddleware, zValidator('json', confirmUploadSchema), async (c) => {
  const db = c.env.DB;
  const { key, url, type, size, width, height, duration } = c.req.valid('json');

  try {
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

    // For COS mode, insert new record
    // Validate the URL belongs to our bucket (security check)
    if (isCOSConfigured(c.env)) {
      const { COS_BUCKET, COS_REGION } = c.env;
      if (!url.includes(`${COS_BUCKET}.cos.${COS_REGION}.myqcloud.com`)) {
        return c.json({
          success: false,
          error: { code: 'INVALID_URL', message: '上传地址无效' },
        }, 400);
      }
    }

    const result = await db.prepare(`
      INSERT INTO media (post_id, type, url, size, width, height, duration)
      VALUES (NULL, ?, ?, ?, ?, ?, ?)
      RETURNING id
    `).bind(
      type,
      url,
      size,
      width || null,
      height || null,
      duration || null
    ).first();

    if (!result) {
      throw new Error('Failed to insert media record');
    }

    return c.json({
      success: true,
      data: {
        mediaId: result.id,
        key,
        url,
      },
    });
  } catch (error) {
    console.error('Confirm upload error:', error);
    return c.json({
      success: false,
      error: { code: 'CONFIRM_FAILED', message: '保存媒体记录失败' },
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
