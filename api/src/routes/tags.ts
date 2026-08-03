import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth';
import { Env } from '../types';

export const tagsRouter = new Hono<{ Bindings: Env }>();

const tagNameSchema = z.string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[\w\u4e00-\u9fa5]+$/u, '标签只能包含中英文、数字和下划线')
  .transform((value) => value.toLowerCase());

const categoryNameSchema = z.string().trim().min(1).max(40);

const createCategorySchema = z.object({
  name: categoryNameSchema,
  tagIds: z.array(z.number().int().positive()).default([]),
  collapsedLimit: z.number().int().min(4).max(20).default(8),
});

const updateCategorySchema = z.object({
  name: categoryNameSchema.optional(),
  tagIds: z.array(z.number().int().positive()).optional(),
  collapsedLimit: z.number().int().min(4).max(20).optional(),
}).refine((value) => value.name !== undefined || value.tagIds !== undefined || value.collapsedLimit !== undefined, {
  message: '至少提供一个要修改的字段',
});

const reorderCategoriesSchema = z.object({
  categoryIds: z.array(z.number().int().positive()),
});

const updateTagSchema = z.object({ name: tagNameSchema });
const updateTagCategorySchema = z.object({ categoryId: z.number().int().positive().nullable() });
const batchUpdateTagCategorySchema = z.object({
  tagIds: z.array(z.number().int().positive()).min(1),
  categoryId: z.number().int().positive().nullable(),
});
const updateDisplaySettingsSchema = z.object({ collapsedLimit: z.number().int().min(4).max(20) });

const hashtagPattern = /#([\w\u4e00-\u9fa5]+)/g;

const rewriteHashtag = (content: string, oldName: string, newName?: string) =>
  content.replace(hashtagPattern, (token, capturedName: string) => (
    capturedName.toLowerCase() === oldName.toLowerCase()
      ? (newName ? `#${newName}` : '')
      : token
  ));

const dedupeHashtag = (content: string, name: string) => {
  let seen = false;
  return content.replace(hashtagPattern, (token, capturedName: string) => {
    if (capturedName.toLowerCase() !== name.toLowerCase()) return token;
    if (!seen) {
      seen = true;
      return token;
    }
    return '';
  });
};

const parsePositiveId = (value: string) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const shouldIncludePrivate = (includePrivate: string | undefined, isAuthenticated: boolean) =>
  isAuthenticated && includePrivate === 'true';

async function getCategories(db: D1Database) {
  return db.prepare(`
    SELECT id, name, sort_order, collapsed_limit, created_at, updated_at
    FROM tag_categories
    ORDER BY sort_order ASC, id ASC
  `).all();
}

async function assertTagIdsExist(db: D1Database, tagIds: number[]) {
  if (tagIds.length === 0) return true;
  const placeholders = tagIds.map(() => '?').join(', ');
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM tags WHERE id IN (${placeholders})`)
    .bind(...tagIds)
    .first<{ count: number }>();
  return Number(row?.count || 0) === new Set(tagIds).size;
}

async function buildContentRewriteStatements(
  db: D1Database,
  oldName: string,
  newName?: string,
  dedupeTarget = false
) {
  const [posts, appends] = await Promise.all([
    db.prepare('SELECT id, content FROM posts').all<{ id: number; content: string }>(),
    db.prepare('SELECT id, content FROM appends').all<{ id: number; content: string }>(),
  ]);

  const rewriteRows = (rows: Array<{ id: number; content: string }>) => rows.flatMap((row) => {
    const rewritten = rewriteHashtag(row.content, oldName, newName);
    const content = newName && dedupeTarget ? dedupeHashtag(rewritten, newName) : rewritten;
    return content === row.content ? [] : [{ id: row.id, content }];
  });

  const buildBulkStatements = (table: 'posts' | 'appends', rows: Array<{ id: number; content: string }>) => {
    const statements: D1PreparedStatement[] = [];
    // Two bindings per row; 45 stays below D1's 100-bound-parameter limit.
    for (let index = 0; index < rows.length; index += 45) {
      const chunk = rows.slice(index, index + 45);
      const values = chunk.map(() => '(?, ?)').join(', ');
      const bindings = chunk.flatMap((row) => [row.id, row.content]);
      statements.push(db.prepare(`
        WITH changes(id, content) AS (VALUES ${values})
        UPDATE ${table}
        SET content = (SELECT changes.content FROM changes WHERE changes.id = ${table}.id)
        WHERE id IN (SELECT id FROM changes)
      `).bind(...bindings));
    }
    return statements;
  };

  return [
    ...buildBulkStatements('posts', rewriteRows(posts.results)),
    ...buildBulkStatements('appends', rewriteRows(appends.results)),
  ];
}

// Get visible tags grouped by optional admin-defined categories.
tagsRouter.get('/', optionalAuthMiddleware, async (c) => {
  const db = c.env.DB;
  const isAuthenticated = c.get('userId') !== undefined;
  const includePrivate = shouldIncludePrivate(c.req.query('includePrivate'), isAuthenticated);

  try {
    const visibilityFilter = includePrivate ? '' : "AND p.visibility = 'public'";
    const categoryColumn = isAuthenticated ? 't.category_id' : 'NULL AS category_id';
    const tagsPromise = db.prepare(`
        SELECT
          t.id,
          t.name,
          ${categoryColumn},
          t.created_at,
          COUNT(DISTINCT p.id) AS post_count,
          MAX(CASE WHEN p.id IS NOT NULL THEN pt.created_at END) AS last_used_at
        FROM tags t
        LEFT JOIN post_tags pt ON t.id = pt.tag_id
        LEFT JOIN posts p ON pt.post_id = p.id ${visibilityFilter}
        GROUP BY t.id
        HAVING post_count > 0
        ORDER BY last_used_at DESC, post_count DESC, t.name ASC
      `).all();

    if (!isAuthenticated) {
      const tags = await tagsPromise;
      return c.json({
        success: true,
        data: {
          tags: tags.results,
          categories: [],
          collapsedLimit: 8,
        },
      });
    }

    const [tags, categories, settings] = await Promise.all([
      tagsPromise,
      getCategories(db),
      db.prepare('SELECT collapsed_limit FROM tag_display_settings WHERE id = 1')
        .first<{ collapsed_limit: number }>(),
    ]);

    return c.json({
      success: true,
      data: {
        tags: tags.results,
        categories: categories.results,
        collapsedLimit: Number(settings?.collapsed_limit || 8),
      },
    });
  } catch (error) {
    console.error('Get tags error:', error);
    return c.json({
      success: false,
      error: { code: 'FETCH_FAILED', message: 'Failed to fetch tags' },
    }, 500);
  }
});

// Full tag-management snapshot. Empty tags and categories are intentionally included.
tagsRouter.get('/manage', authMiddleware, async (c) => {
  const db = c.env.DB;
  const [tags, categories, settings] = await Promise.all([
    db.prepare(`
      SELECT
        t.id,
        t.name,
        t.category_id,
        t.created_at,
        COUNT(DISTINCT p.id) AS post_count,
        MAX(pt.created_at) AS last_used_at
      FROM tags t
      LEFT JOIN post_tags pt ON t.id = pt.tag_id
      LEFT JOIN posts p ON pt.post_id = p.id
      GROUP BY t.id
      ORDER BY last_used_at DESC, post_count DESC, t.name ASC
    `).all(),
    getCategories(db),
    db.prepare('SELECT collapsed_limit FROM tag_display_settings WHERE id = 1')
      .first<{ collapsed_limit: number }>(),
  ]);

  return c.json({
    success: true,
    data: {
      tags: tags.results,
      categories: categories.results,
      collapsedLimit: Number(settings?.collapsed_limit || 8),
    },
  });
});

tagsRouter.post('/categories', authMiddleware, zValidator('json', createCategorySchema), async (c) => {
  const db = c.env.DB;
  const { name, tagIds, collapsedLimit } = c.req.valid('json');
  if (!await assertTagIdsExist(db, tagIds)) {
    return c.json({ success: false, error: { code: 'INVALID_TAG_IDS', message: '包含不存在的标签' } }, 400);
  }

  const orderRow = await db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM tag_categories')
    .first<{ next_order: number }>();

  try {
    const category = await db.prepare(`
      INSERT INTO tag_categories (name, sort_order, collapsed_limit) VALUES (?, ?, ?) RETURNING *
    `).bind(name, Number(orderRow?.next_order || 0), collapsedLimit).first<{ id: number }>();
    if (!category) throw new Error('Failed to create category');

    if (tagIds.length > 0) {
      const placeholders = tagIds.map(() => '?').join(', ');
      await db.prepare(`UPDATE tags SET category_id = ? WHERE id IN (${placeholders})`)
        .bind(category.id, ...tagIds)
        .run();
    }
    return c.json({ success: true, data: { category } }, 201);
  } catch (error) {
    const message = error instanceof Error && error.message.includes('UNIQUE')
      ? '分类名称已存在'
      : '创建分类失败';
    return c.json({ success: false, error: { code: 'CREATE_FAILED', message } }, 400);
  }
});

tagsRouter.put('/categories/order', authMiddleware, zValidator('json', reorderCategoriesSchema), async (c) => {
  const db = c.env.DB;
  const { categoryIds } = c.req.valid('json');
  const categories = await getCategories(db);
  const existingIds = categories.results.map((item: any) => Number(item.id)).sort((a, b) => a - b);
  const requestedIds = [...new Set(categoryIds)].sort((a, b) => a - b);
  if (existingIds.length !== requestedIds.length || existingIds.some((id, index) => id !== requestedIds[index])) {
    return c.json({ success: false, error: { code: 'INVALID_ORDER', message: '分类顺序必须包含全部分类' } }, 400);
  }

  await db.batch(categoryIds.map((id, index) => (
    db.prepare('UPDATE tag_categories SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(index, id)
  )));
  return c.json({ success: true });
});

tagsRouter.put('/categories/:id', authMiddleware, zValidator('json', updateCategorySchema), async (c) => {
  const db = c.env.DB;
  const id = parsePositiveId(c.req.param('id'));
  if (!id) return c.json({ success: false, error: { code: 'INVALID_ID', message: '无效分类 ID' } }, 400);
  const existing = await db.prepare('SELECT id FROM tag_categories WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ success: false, error: { code: 'NOT_FOUND', message: '分类不存在' } }, 404);

  const { name, tagIds, collapsedLimit } = c.req.valid('json');
  if (tagIds && !await assertTagIdsExist(db, tagIds)) {
    return c.json({ success: false, error: { code: 'INVALID_TAG_IDS', message: '包含不存在的标签' } }, 400);
  }

  const statements: D1PreparedStatement[] = [];
  if (name !== undefined) {
    statements.push(db.prepare('UPDATE tag_categories SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(name, id));
  }
  if (collapsedLimit !== undefined) {
    statements.push(db.prepare('UPDATE tag_categories SET collapsed_limit = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(collapsedLimit, id));
  }
  if (tagIds !== undefined) {
    statements.push(db.prepare('UPDATE tags SET category_id = NULL WHERE category_id = ?').bind(id));
    if (tagIds.length > 0) {
      const placeholders = tagIds.map(() => '?').join(', ');
      statements.push(db.prepare(`UPDATE tags SET category_id = ? WHERE id IN (${placeholders})`).bind(id, ...tagIds));
    }
  }

  try {
    await db.batch(statements);
    return c.json({ success: true });
  } catch (error) {
    const message = error instanceof Error && error.message.includes('UNIQUE')
      ? '分类名称已存在'
      : '修改分类失败';
    return c.json({ success: false, error: { code: 'UPDATE_FAILED', message } }, 400);
  }
});

tagsRouter.delete('/categories/:id', authMiddleware, async (c) => {
  const id = parsePositiveId(c.req.param('id'));
  if (!id) return c.json({ success: false, error: { code: 'INVALID_ID', message: '无效分类 ID' } }, 400);
  const result = await c.env.DB.prepare('DELETE FROM tag_categories WHERE id = ?').bind(id).run();
  if (!result.meta.changes) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: '分类不存在' } }, 404);
  }
  return c.json({ success: true });
});

tagsRouter.put('/display-settings', authMiddleware, zValidator('json', updateDisplaySettingsSchema), async (c) => {
  const { collapsedLimit } = c.req.valid('json');
  await c.env.DB.prepare(`
    INSERT INTO tag_display_settings (id, collapsed_limit, updated_at)
    VALUES (1, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET collapsed_limit = excluded.collapsed_limit, updated_at = CURRENT_TIMESTAMP
  `).bind(collapsedLimit).run();
  return c.json({ success: true, data: { collapsedLimit } });
});

tagsRouter.put('/category/batch', authMiddleware, zValidator('json', batchUpdateTagCategorySchema), async (c) => {
  const db = c.env.DB;
  const { tagIds, categoryId } = c.req.valid('json');
  if (!await assertTagIdsExist(db, tagIds)) {
    return c.json({ success: false, error: { code: 'INVALID_TAG_IDS', message: '包含不存在的标签' } }, 400);
  }
  if (categoryId !== null) {
    const category = await db.prepare('SELECT id FROM tag_categories WHERE id = ?').bind(categoryId).first();
    if (!category) return c.json({ success: false, error: { code: 'CATEGORY_NOT_FOUND', message: '分类不存在' } }, 404);
  }
  const placeholders = tagIds.map(() => '?').join(', ');
  await db.prepare(`UPDATE tags SET category_id = ? WHERE id IN (${placeholders})`)
    .bind(categoryId, ...tagIds)
    .run();
  return c.json({ success: true });
});

tagsRouter.put('/:id/category', authMiddleware, zValidator('json', updateTagCategorySchema), async (c) => {
  const db = c.env.DB;
  const id = parsePositiveId(c.req.param('id'));
  if (!id) return c.json({ success: false, error: { code: 'INVALID_ID', message: '无效标签 ID' } }, 400);
  const { categoryId } = c.req.valid('json');
  if (categoryId !== null) {
    const category = await db.prepare('SELECT id FROM tag_categories WHERE id = ?').bind(categoryId).first();
    if (!category) return c.json({ success: false, error: { code: 'CATEGORY_NOT_FOUND', message: '分类不存在' } }, 404);
  }
  const result = await db.prepare('UPDATE tags SET category_id = ? WHERE id = ?').bind(categoryId, id).run();
  if (!result.meta.changes) return c.json({ success: false, error: { code: 'NOT_FOUND', message: '标签不存在' } }, 404);
  return c.json({ success: true });
});

tagsRouter.put('/:id', authMiddleware, zValidator('json', updateTagSchema), async (c) => {
  const db = c.env.DB;
  const id = parsePositiveId(c.req.param('id'));
  if (!id) return c.json({ success: false, error: { code: 'INVALID_ID', message: '无效标签 ID' } }, 400);
  const { name } = c.req.valid('json');
  const current = await db.prepare('SELECT id, name, category_id FROM tags WHERE id = ?')
    .bind(id)
    .first<{ id: number; name: string; category_id: number | null }>();
  if (!current) return c.json({ success: false, error: { code: 'NOT_FOUND', message: '标签不存在' } }, 404);
  if (current.name === name) return c.json({ success: true, data: { merged: false, tagId: id } });

  const target = await db.prepare('SELECT id, category_id FROM tags WHERE name = ?')
    .bind(name)
    .first<{ id: number; category_id: number | null }>();
  const contentStatements = await buildContentRewriteStatements(db, current.name, name, Boolean(target && target.id !== id));

  if (target && target.id !== id) {
    const categoryId = target.category_id ?? current.category_id;
    await db.batch([
      ...contentStatements,
      db.prepare(`
        INSERT OR IGNORE INTO post_tags (post_id, tag_id, created_at)
        SELECT post_id, ?, created_at FROM post_tags WHERE tag_id = ?
      `).bind(target.id, id),
      db.prepare('UPDATE tags SET category_id = ? WHERE id = ?').bind(categoryId, target.id),
      db.prepare('DELETE FROM post_tags WHERE tag_id = ?').bind(id),
      db.prepare('DELETE FROM tags WHERE id = ?').bind(id),
    ]);
    return c.json({ success: true, data: { merged: true, tagId: target.id } });
  }

  await db.batch([
    ...contentStatements,
    db.prepare('UPDATE tags SET name = ? WHERE id = ?').bind(name, id),
  ]);
  return c.json({ success: true, data: { merged: false, tagId: id } });
});

tagsRouter.delete('/:id', authMiddleware, async (c) => {
  const db = c.env.DB;
  const id = parsePositiveId(c.req.param('id'));
  if (!id) return c.json({ success: false, error: { code: 'INVALID_ID', message: '无效标签 ID' } }, 400);
  const tag = await db.prepare('SELECT name FROM tags WHERE id = ?').bind(id).first<{ name: string }>();
  if (!tag) return c.json({ success: false, error: { code: 'NOT_FOUND', message: '标签不存在' } }, 404);

  const contentStatements = await buildContentRewriteStatements(db, tag.name);
  await db.batch([
    ...contentStatements,
    db.prepare('DELETE FROM post_tags WHERE tag_id = ?').bind(id),
    db.prepare('DELETE FROM tags WHERE id = ?').bind(id),
  ]);
  return c.json({ success: true });
});

// Get posts by tag (only public posts for unauthenticated users)
tagsRouter.get('/:name/posts', optionalAuthMiddleware, async (c) => {
  const db = c.env.DB;
  const name = c.req.param('name');
  const isAuthenticated = c.get('userId') !== undefined;

  try {
    const visibilityFilter = isAuthenticated ? '' : "AND p.visibility = 'public'";
    const posts = await db.prepare(`
      SELECT p.*
      FROM posts p
      JOIN post_tags pt ON p.id = pt.post_id
      JOIN tags t ON pt.tag_id = t.id
      WHERE t.name = ? ${visibilityFilter}
      ORDER BY p.created_at DESC
    `).bind(name).all();

    return c.json({ success: true, data: { posts: posts.results } });
  } catch (error) {
    console.error('Get posts by tag error:', error);
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch posts' } }, 500);
  }
});

// Get dates with posts (for calendar)
tagsRouter.get('/calendar/dates', optionalAuthMiddleware, async (c) => {
  const db = c.env.DB;
  const { year, month } = c.req.query();
  const isAuthenticated = c.get('userId') !== undefined;
  const includePrivate = shouldIncludePrivate(c.req.query('includePrivate'), isAuthenticated);

  let query = `
    SELECT DISTINCT
      DATE(datetime(created_at, '+8 hours')) as date,
      COUNT(*) as count
    FROM posts
    WHERE 1 = 1
  `;
  const params: (string | number)[] = [];

  if (!includePrivate) query += ` AND visibility = 'public'`;
  if (year) {
    query += ` AND strftime("%Y", datetime(created_at, '+8 hours')) = ?`;
    params.push(year);
  }
  if (month) {
    query += ` AND strftime("%m", datetime(created_at, '+8 hours')) = ?`;
    params.push(month.padStart(2, '0'));
  }
  query += ` GROUP BY DATE(datetime(created_at, '+8 hours')) ORDER BY date DESC`;

  try {
    const dates = await db.prepare(query).bind(...params).all();
    return c.json({ success: true, data: { dates: dates.results } });
  } catch (error) {
    console.error('Get calendar dates error:', error);
    return c.json({ success: false, error: { code: 'FETCH_FAILED', message: 'Failed to fetch dates' } }, 500);
  }
});
