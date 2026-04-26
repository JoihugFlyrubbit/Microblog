import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth';
import { Env, Post, PostWithRelations } from '../types';
import { enqueueR2Deletion } from '../lib/media-deletion';

// Validation schemas
const createPostSchema = z.object({
  content: z.string().max(10000).default(''),
  visibility: z.enum(['public', 'private']).default('public'),
  tagNames: z.array(z.string()).default([]),
  mediaIds: z.array(z.string()).default([]),
}).refine(
  (data) => data.content.trim().length > 0 || data.mediaIds.length > 0,
  {
    message: '内容和媒体不能同时为空',
    path: ['content'],
  }
);

const updatePostSchema = z.object({
  content: z.string().max(10000).default(''),
  visibility: z.enum(['public', 'private']),
  tagNames: z.array(z.string()).default([]),
  mediaIds: z.array(z.string()).default([]),
}).refine(
  (data) => data.content.trim().length > 0 || data.mediaIds.length > 0,
  {
    message: '内容和媒体不能同时为空',
    path: ['content'],
  }
);

const listPostsSchema = z.object({
  page: z.string().optional().default('1'),
  limit: z.string().optional().default('20'),
  date: z.string().optional(), // YYYY-MM-DD
  tag: z.string().optional(),
  visibility: z.enum(['all', 'public', 'private']).optional().default('public'),
  pinned: z.enum(['true', 'false']).optional(),
});

const pinPostSchema = z.object({
  pinned: z.boolean(),
});

const visibilityPostSchema = z.object({
  visibility: z.enum(['public', 'private']),
});

export const postsRouter = new Hono<{ Bindings: Env }>();

const extractHashtags = (content: string) => {
  const matches = content.match(/#([\w\u4e00-\u9fa5]+)/g) || [];
  return matches.map((tag) => tag.slice(1));
};

const normalizeTagNames = (content: string, tagNames: string[]) => {
  const combined = [...tagNames, ...extractHashtags(content)];
  return Array.from(
    new Set(
      combined
        .map((tagName) => tagName.toLowerCase().trim().replace(/^#/, ''))
        .filter(Boolean)
    )
  );
};

async function findInvalidAttachableMediaIds(
  db: D1Database,
  mediaIds: string[],
  currentPostId?: number
) {
  const uniqueIds = Array.from(new Set(mediaIds));
  const invalid: string[] = [];

  for (const mediaId of uniqueIds) {
    const row = await db.prepare(
      'SELECT id, post_id, url FROM media WHERE id = ?'
    ).bind(mediaId).first<{ id: number; post_id: number | null; url: string }>();

    const ownedByCurrentPost = currentPostId !== undefined && row?.post_id === currentPostId;
    const isConfirmed = row?.url.startsWith('r2://') || row?.url.startsWith('data:');
    const isAttachableOwner = row?.post_id === null || ownedByCurrentPost;
    if (!row || !isConfirmed || !isAttachableOwner) {
      invalid.push(mediaId);
    }
  }

  return invalid;
}

// List posts (public endpoint, but visibility filter depends on auth)
postsRouter.get('/', optionalAuthMiddleware, zValidator('query', listPostsSchema), async (c) => {
  const db = c.env.DB;
  const { page, limit, date, tag, visibility, pinned } = c.req.valid('query');
  const isAuthenticated = c.get('userId') !== undefined;

  const pageNum = parseInt(page);
  const limitNum = Math.min(parseInt(limit), 100); // Max 100 per page
  const offset = (pageNum - 1) * limitNum;

  // Build query
  let conditions: string[] = [];
  let params: (string | number)[] = [];

  // Visibility filter - only authenticated users can see private/all posts
  if (!isAuthenticated && (visibility === 'private' || visibility === 'all')) {
    return c.json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required to view private posts' },
    }, 401);
  }

  if (visibility === 'public') {
    conditions.push('p.visibility = ?');
    params.push('public');
  } else if (visibility === 'private') {
    conditions.push('p.visibility = ?');
    params.push('private');
  }

  // Date filter
  if (date) {
    conditions.push("DATE(datetime(p.created_at, '+8 hours')) = ?");
    params.push(date);
  }

  if (pinned) {
    conditions.push('p.pinned = ?');
    params.push(pinned === 'true' ? 1 : 0);
  }

  // Tag filter
  let tagJoin = '';
  if (tag) {
    tagJoin = 'JOIN post_tags pt ON p.id = pt.post_id JOIN tags t ON pt.tag_id = t.id';
    conditions.push('t.name = ?');
    params.push(tag);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Get total count
  const countQuery = `
    SELECT COUNT(DISTINCT p.id) as total
    FROM posts p
    ${tagJoin}
    ${whereClause}
  `;
  const countResult = await db.prepare(countQuery).bind(...params).first();
  const total = countResult?.total as number || 0;

  // Get posts
  // P2.1: 不再返回 base64 data URL；改返 media metadata 列表（不含 url）。
  // 前端按 `/media/<id>?v=<post.updated_at>` 拼 URL 走 Worker 代理。
  // 用 SQLite json_group_array 一次性聚合所有 media metadata，避免列表多图退化为只显示首图。
  const postsQuery = `
    SELECT DISTINCT p.*,
      (SELECT COUNT(*) FROM appends WHERE post_id = p.id) as append_count,
      (SELECT COUNT(*) FROM media WHERE post_id = p.id) as media_count,
      (SELECT json_group_array(json_object(
          'id', id, 'type', type, 'width', width, 'height', height, 'size', size
        ))
       FROM (
         SELECT id, type, width, height, size
         FROM media
         WHERE post_id = p.id
         ORDER BY created_at
       )) as preview_media_list,
      (SELECT GROUP_CONCAT(t.name, ',')
        FROM post_tags pt
        JOIN tags t ON t.id = pt.tag_id
        WHERE pt.post_id = p.id) as preview_tags
    FROM posts p
    ${tagJoin}
    ${whereClause}
    ORDER BY p.created_at DESC
    LIMIT ? OFFSET ?
  `;

  const result = await db.prepare(postsQuery)
    .bind(...params, limitNum, offset)
    .all();

  // SQLite json_group_array 返回 string，需要 parse 后再返给前端
  const postsList = (result.results as any[]).map((row) => ({
    ...row,
    preview_media_list: row.preview_media_list ? JSON.parse(row.preview_media_list) : [],
  }));

  return c.json({
    success: true,
    data: {
      posts: postsList,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    },
  });
});

// Get single post with relations
postsRouter.get('/:id', optionalAuthMiddleware, async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));
  const isAuthenticated = c.get('userId') !== undefined;

  if (isNaN(id)) {
    return c.json({
      success: false,
      error: { code: 'INVALID_ID', message: 'Invalid post ID' },
    }, 400);
  }

  // Get post
  const post = await db.prepare(
    'SELECT * FROM posts WHERE id = ?'
  ).bind(id).first<Post>();

  if (!post) {
    return c.json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Post not found' },
    }, 404);
  }

  // Check visibility - private posts require authentication
  if (post.visibility === 'private' && !isAuthenticated) {
    return c.json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required to view this post' },
    }, 401);
  }

  // Get relations
  const [appends, media, tags] = await Promise.all([
    db.prepare('SELECT * FROM appends WHERE post_id = ? ORDER BY created_at').bind(id).all(),
    db.prepare('SELECT * FROM media WHERE post_id = ? ORDER BY created_at').bind(id).all(),
    db.prepare(`
      SELECT t.* FROM tags t
      JOIN post_tags pt ON t.id = pt.tag_id
      WHERE pt.post_id = ?
      ORDER BY t.name
    `).bind(id).all(),
  ]);

  const mediaRows = (media.results as any[]).map((item) => ({
    ...item,
    url: `/media/${item.id}?v=${encodeURIComponent(post.updated_at)}`,
  }));

  const postWithRelations: PostWithRelations = {
    ...post as Post,
    appends: appends.results as any[],
    media: mediaRows,
    tags: tags.results as any[],
  };

  return c.json({
    success: true,
    data: { post: postWithRelations },
  });
});

// Create post (requires auth)
postsRouter.post('/', authMiddleware, zValidator('json', createPostSchema), async (c) => {
  const db = c.env.DB;
  const { content, visibility, tagNames, mediaIds } = c.req.valid('json');
  const normalizedContent = content.trim();
  const normalizedTagNames = normalizeTagNames(normalizedContent, tagNames);

  try {
    const invalidMediaIds = await findInvalidAttachableMediaIds(db, mediaIds);
    if (invalidMediaIds.length > 0) {
      return c.json({
        success: false,
        error: { code: 'INVALID_MEDIA_STATE', message: '媒体未完成上传或已被其他动态使用' },
      }, 400);
    }

    // Insert post
    const postResult = await db.prepare(
      'INSERT INTO posts (content, visibility, pinned) VALUES (?, ?, 0) RETURNING id'
    ).bind(normalizedContent, visibility).first();

    if (!postResult) {
      throw new Error('Failed to create post');
    }

    const postId = postResult.id as number;

    // Handle tags
    if (normalizedTagNames.length > 0) {
      for (const normalizedTag of normalizedTagNames) {

        // Insert or get tag
        await db.prepare(
          'INSERT OR IGNORE INTO tags (name) VALUES (?)'
        ).bind(normalizedTag).run();

        const tag = await db.prepare(
          'SELECT id FROM tags WHERE name = ?'
        ).bind(normalizedTag).first();

        if (tag) {
          await db.prepare(
            'INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)'
          ).bind(postId, tag.id).run();
        }
      }
    }

    // Update media to link to post
    if (mediaIds.length > 0) {
      for (const mediaId of Array.from(new Set(mediaIds))) {
        await db.prepare(
          "UPDATE media SET post_id = ? WHERE id = ? AND post_id IS NULL AND (url LIKE 'r2://%' OR url LIKE 'data:%')"
        ).bind(postId, mediaId).run();
      }
    }

    // Get created post
    const post = await db.prepare(
      'SELECT * FROM posts WHERE id = ?'
    ).bind(postId).first();

    return c.json({
      success: true,
      data: { post },
    }, 201);

  } catch (error) {
    console.error('Create post error:', error);
    return c.json({
      success: false,
      error: { code: 'CREATE_FAILED', message: '创建动态失败' },
    }, 500);
  }
});

// Update post (requires auth)
postsRouter.put('/:id', authMiddleware, zValidator('json', updatePostSchema), async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));
  const { content, visibility, tagNames, mediaIds } = c.req.valid('json');
  const normalizedContent = content.trim();
  const normalizedTagNames = normalizeTagNames(normalizedContent, tagNames);

  if (isNaN(id)) {
    return c.json({
      success: false,
      error: { code: 'INVALID_ID', message: 'Invalid post ID' },
    }, 400);
  }

  // Check post exists
  const existing = await db.prepare(
    'SELECT id FROM posts WHERE id = ?'
  ).bind(id).first();

  if (!existing) {
    return c.json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Post not found' },
    }, 404);
  }

  try {
    const invalidMediaIds = await findInvalidAttachableMediaIds(db, mediaIds, id);
    if (invalidMediaIds.length > 0) {
      return c.json({
        success: false,
        error: { code: 'INVALID_MEDIA_STATE', message: '媒体未完成上传或已被其他动态使用' },
      }, 400);
    }
    const oldMedia = await db.prepare(
      'SELECT id, url FROM media WHERE post_id = ?'
    ).bind(id).all<{ id: number; url: string }>();
    const requestedMediaIds = new Set(mediaIds.map((mediaId) => Number(mediaId)));
    const removedMedia = oldMedia.results.filter((media) => !requestedMediaIds.has(media.id));

    // Update post
    await db.prepare(
      'UPDATE posts SET content = ?, visibility = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).bind(normalizedContent, visibility, id).run();

    // Update tags
    await db.prepare('DELETE FROM post_tags WHERE post_id = ?').bind(id).run();

    if (normalizedTagNames.length > 0) {
      for (const normalizedTag of normalizedTagNames) {

        await db.prepare(
          'INSERT OR IGNORE INTO tags (name) VALUES (?)'
        ).bind(normalizedTag).run();

        const tag = await db.prepare(
          'SELECT id FROM tags WHERE name = ?'
        ).bind(normalizedTag).first();

        if (tag) {
          await db.prepare(
            'INSERT INTO post_tags (post_id, tag_id) VALUES (?, ?)'
          ).bind(id, tag.id).run();
        }
      }
    }

    for (const media of removedMedia) {
      await enqueueR2Deletion(db, media.url);
      await db.prepare(
        'DELETE FROM media WHERE id = ? AND post_id = ?'
      ).bind(media.id, id).run();
    }

    // Update media associations. Removed media rows were deleted and queued above.
    await db.prepare('UPDATE media SET post_id = NULL WHERE post_id = ?').bind(id).run();
    if (mediaIds.length > 0) {
      for (const mediaId of Array.from(new Set(mediaIds))) {
        await db.prepare(
          "UPDATE media SET post_id = ? WHERE id = ? AND post_id IS NULL AND (url LIKE 'r2://%' OR url LIKE 'data:%')"
        ).bind(id, mediaId).run();
      }
    }

    const post = await db.prepare(
      'SELECT * FROM posts WHERE id = ?'
    ).bind(id).first();

    return c.json({
      success: true,
      data: { post },
    });

  } catch (error) {
    console.error('Update post error:', error);
    return c.json({
      success: false,
      error: { code: 'UPDATE_FAILED', message: 'Failed to update post' },
    }, 500);
  }
});

// Delete post (requires auth)
postsRouter.delete('/:id', authMiddleware, async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));

  if (isNaN(id)) {
    return c.json({
      success: false,
      error: { code: 'INVALID_ID', message: 'Invalid post ID' },
    }, 400);
  }

  const existing = await db.prepare(
    'SELECT id FROM posts WHERE id = ?'
  ).bind(id).first();

  if (!existing) {
    return c.json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Post not found' },
    }, 404);
  }

  try {
    const mediaRows = await db.prepare(
      'SELECT url FROM media WHERE post_id = ?'
    ).bind(id).all<{ url: string }>();

    for (const media of mediaRows.results) {
      await enqueueR2Deletion(db, media.url);
    }

    await db.prepare('DELETE FROM posts WHERE id = ?').bind(id).run();

    return c.json({
      success: true,
      message: 'Post deleted successfully',
    });

  } catch (error) {
    console.error('Delete post error:', error);
    return c.json({
      success: false,
      error: { code: 'DELETE_FAILED', message: 'Failed to delete post' },
    }, 500);
  }
});

postsRouter.post('/:id/pin', authMiddleware, zValidator('json', pinPostSchema), async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));
  const { pinned } = c.req.valid('json');

  if (isNaN(id)) {
    return c.json({
      success: false,
      error: { code: 'INVALID_ID', message: 'Invalid post ID' },
    }, 400);
  }

  const existing = await db.prepare(
    'SELECT id FROM posts WHERE id = ?'
  ).bind(id).first();

  if (!existing) {
    return c.json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Post not found' },
    }, 404);
  }

  try {
    await db.prepare(
      'UPDATE posts SET pinned = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).bind(pinned ? 1 : 0, id).run();

    const post = await db.prepare(
      'SELECT * FROM posts WHERE id = ?'
    ).bind(id).first();

    return c.json({
      success: true,
      data: { post },
    });
  } catch (error) {
    console.error('Pin post error:', error);
    return c.json({
      success: false,
      error: { code: 'PIN_FAILED', message: 'Failed to update pin status' },
    }, 500);
  }
});

postsRouter.post('/:id/visibility', authMiddleware, zValidator('json', visibilityPostSchema), async (c) => {
  const db = c.env.DB;
  const id = parseInt(c.req.param('id'));
  const { visibility } = c.req.valid('json');

  if (isNaN(id)) {
    return c.json({
      success: false,
      error: { code: 'INVALID_ID', message: 'Invalid post ID' },
    }, 400);
  }

  const existing = await db.prepare(
    'SELECT id FROM posts WHERE id = ?'
  ).bind(id).first();

  if (!existing) {
    return c.json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Post not found' },
    }, 404);
  }

  try {
    await db.prepare(
      'UPDATE posts SET visibility = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).bind(visibility, id).run();

    const post = await db.prepare(
      'SELECT * FROM posts WHERE id = ?'
    ).bind(id).first();

    return c.json({
      success: true,
      data: { post },
    });
  } catch (error) {
    console.error('Visibility update error:', error);
    return c.json({
      success: false,
      error: { code: 'VISIBILITY_FAILED', message: 'Failed to update visibility' },
    }, 500);
  }
});

// Append routes
postsRouter.post('/:id/appends', authMiddleware, async (c) => {
  const db = c.env.DB;
  const postId = parseInt(c.req.param('id'));

  if (isNaN(postId)) {
    return c.json({
      success: false,
      error: { code: 'INVALID_ID', message: 'Invalid post ID' },
    }, 400);
  }

  const body = await c.req.json();
  const content = body.content;

  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return c.json({
      success: false,
      error: { code: 'INVALID_CONTENT', message: 'Content is required' },
    }, 400);
  }

  const post = await db.prepare(
    'SELECT id FROM posts WHERE id = ?'
  ).bind(postId).first();

  if (!post) {
    return c.json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Post not found' },
    }, 404);
  }

  try {
    const result = await db.prepare(
      'INSERT INTO appends (post_id, content) VALUES (?, ?) RETURNING *'
    ).bind(postId, content.trim()).first();

    return c.json({
      success: true,
      data: { append: result },
    }, 201);

  } catch (error) {
    console.error('Create append error:', error);
    return c.json({
      success: false,
      error: { code: 'CREATE_FAILED', message: 'Failed to create append' },
    }, 500);
  }
});

postsRouter.delete('/:id/appends/:appendId', authMiddleware, async (c) => {
  const db = c.env.DB;
  const appendId = parseInt(c.req.param('appendId'));

  if (isNaN(appendId)) {
    return c.json({
      success: false,
      error: { code: 'INVALID_ID', message: 'Invalid append ID' },
    }, 400);
  }

  try {
    await db.prepare('DELETE FROM appends WHERE id = ?').bind(appendId).run();

    return c.json({
      success: true,
      message: 'Append deleted successfully',
    });

  } catch (error) {
    console.error('Delete append error:', error);
    return c.json({
      success: false,
      error: { code: 'DELETE_FAILED', message: 'Failed to delete append' },
    }, 500);
  }
});
