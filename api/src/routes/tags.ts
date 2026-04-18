import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { optionalAuthMiddleware } from '../middleware/auth';
import { Env } from '../types';

export const tagsRouter = new Hono<{ Bindings: Env }>();

const shouldIncludePrivate = (includePrivate: string | undefined, isAuthenticated: boolean) =>
  isAuthenticated && includePrivate === 'true';

// Get all tags with post count (only counts public posts for unauthenticated users)
tagsRouter.get('/', optionalAuthMiddleware, async (c) => {
  const db = c.env.DB;
  const isAuthenticated = c.get('userId') !== undefined;
  const includePrivate = shouldIncludePrivate(c.req.query('includePrivate'), isAuthenticated);

  try {
    const visibilityFilter = includePrivate ? '' : "AND p.visibility = 'public'";

    const tags = await db.prepare(`
      SELECT
        t.id,
        t.name,
        t.created_at,
        COUNT(DISTINCT p.id) as post_count
      FROM tags t
      LEFT JOIN post_tags pt ON t.id = pt.tag_id
      LEFT JOIN posts p ON pt.post_id = p.id ${visibilityFilter}
      GROUP BY t.id
      HAVING post_count > 0
      ORDER BY post_count DESC, t.name ASC
    `).all();

    return c.json({
      success: true,
      data: { tags: tags.results },
    });
  } catch (error) {
    console.error('Get tags error:', error);
    return c.json({
      success: false,
      error: { code: 'FETCH_FAILED', message: 'Failed to fetch tags' },
    }, 500);
  }
});

// Get posts by tag (only public posts for unauthenticated users)
tagsRouter.get('/:name/posts', optionalAuthMiddleware, async (c) => {
  const db = c.env.DB;
  const name = c.req.param('name');
  const isAuthenticated = c.get('userId') !== undefined;

  try {
    // Only show public posts for unauthenticated users
    const visibilityFilter = isAuthenticated ? '' : "AND p.visibility = 'public'";

    const posts = await db.prepare(`
      SELECT p.*
      FROM posts p
      JOIN post_tags pt ON p.id = pt.post_id
      JOIN tags t ON pt.tag_id = t.id
      WHERE t.name = ? ${visibilityFilter}
      ORDER BY p.created_at DESC
    `).bind(name).all();

    return c.json({
      success: true,
      data: { posts: posts.results },
    });
  } catch (error) {
    console.error('Get posts by tag error:', error);
    return c.json({
      success: false,
      error: { code: 'FETCH_FAILED', message: 'Failed to fetch posts' },
    }, 500);
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
      DATE(created_at) as date,
      COUNT(*) as count
    FROM posts
    WHERE 1 = 1
  `;
  const params: (string | number)[] = [];

  if (!includePrivate) {
    query += ` AND visibility = 'public'`;
  }

  if (year) {
    query += ' AND strftime("%Y", created_at) = ?';
    params.push(year);
  }

  if (month) {
    query += ' AND strftime("%m", created_at) = ?';
    params.push(month.padStart(2, '0'));
  }

  query += ' GROUP BY DATE(created_at) ORDER BY date DESC';

  try {
    const dates = await db.prepare(query).bind(...params).all();

    return c.json({
      success: true,
      data: { dates: dates.results },
    });
  } catch (error) {
    console.error('Get calendar dates error:', error);
    return c.json({
      success: false,
      error: { code: 'FETCH_FAILED', message: 'Failed to fetch dates' },
    }, 500);
  }
});
