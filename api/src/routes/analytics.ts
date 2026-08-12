import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { Env } from '../types';
import { checkRateLimit, hasAllowedRequestOrigin, resolveRequestSource } from '../lib/request-security';

export const analyticsRouter = new Hono<{ Bindings: Env }>();

// Count one public-home mount as one page view. This stores aggregate daily PV only.
analyticsRouter.post('/page-view', async (c) => {
  if (!hasAllowedRequestOrigin(c.req.raw, c.env)) {
    return c.json({
      success: false,
      error: { code: 'INVALID_ORIGIN', message: 'Origin is not allowed' },
    }, 403);
  }

  const source = await resolveRequestSource(c.req.raw, c.env);
  if (!source) {
    return c.json({
      success: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: 'Page-view counting is unavailable' },
    }, 503);
  }

  const rateLimit = await checkRateLimit(c.env.ANALYTICS_RATE_LIMITER, source.rateLimitKey);
  if (rateLimit === 'limited') {
    return c.json({
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.' },
    }, 429, { 'Retry-After': '60' });
  }
  if (rateLimit === 'unavailable') {
    return c.json({
      success: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: 'Page-view counting is unavailable' },
    }, 503);
  }

  await c.env.DB.prepare(`
    INSERT INTO page_view_daily (view_date, views, updated_at)
    VALUES (DATE(datetime('now', '+8 hours')), 1, CURRENT_TIMESTAMP)
    ON CONFLICT(view_date) DO UPDATE SET
      views = views + 1,
      updated_at = CURRENT_TIMESTAMP
  `).run();

  return c.json({ success: true });
});

analyticsRouter.get('/summary', authMiddleware, async (c) => {
  const summary = await c.env.DB.prepare(`
    SELECT
      COALESCE(SUM(views), 0) AS total_views,
      COALESCE(SUM(CASE
        WHEN view_date = DATE(datetime('now', '+8 hours')) THEN views ELSE 0
      END), 0) AS today_views,
      COALESCE(SUM(CASE
        WHEN view_date >= DATE(datetime('now', '+8 hours'), '-6 days') THEN views ELSE 0
      END), 0) AS last_7_days_views
    FROM page_view_daily
  `).first<{ total_views: number; today_views: number; last_7_days_views: number }>();

  return c.json({
    success: true,
    data: {
      totalViews: Number(summary?.total_views || 0),
      todayViews: Number(summary?.today_views || 0),
      last7DaysViews: Number(summary?.last_7_days_views || 0),
    },
  });
});
