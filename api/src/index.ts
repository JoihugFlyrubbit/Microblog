import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { Env } from './types';

// Import routes
import { authRouter } from './routes/auth';
import { postsRouter } from './routes/posts';
import { tagsRouter } from './routes/tags';
import { settingsRouter } from './routes/settings';
import { uploadRouter } from './routes/upload';
import { exportRouter } from './routes/export';
import { environmentRouter } from './routes/environment';
import { mediaRouter } from './routes/media';
import { analyticsRouter } from './routes/analytics';
import { normalizeOrigin, parseAllowedOrigins } from './lib/request-security';

const app = new Hono<{ Bindings: Env }>();

// Middleware
app.use(logger());
app.use('/*', cors({
  origin: (origin, c) => {
    const normalized = normalizeOrigin(origin);
    return parseAllowedOrigins(c.env).has(normalized) ? normalized : '';
  },
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));
app.use('/*', async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    await next();
    return;
  }

  const origin = normalizeOrigin(c.req.header('Origin'));
  if (origin && !parseAllowedOrigins(c.env).has(origin)) {
    return c.json({
      success: false,
      error: { code: 'INVALID_ORIGIN', message: 'Origin is not allowed' },
    }, 403);
  }

  await next();
});

// Health check
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: c.env.ENVIRONMENT || 'development',
  });
});

// Mount routes
app.route('/auth', authRouter);
app.route('/posts', postsRouter);
app.route('/tags', tagsRouter);
app.route('/settings', settingsRouter);
app.route('/upload', uploadRouter);
app.route('/export', exportRouter);
app.route('/environment', environmentRouter);
app.route('/media', mediaRouter);
app.route('/analytics', analyticsRouter);

// 404 handler
app.notFound((c) => {
  return c.json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'Endpoint not found',
    },
  }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('API Error:', err);
  return c.json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: c.env.ENVIRONMENT === 'production'
        ? 'Internal server error'
        : err.message,
    },
  }, 500);
});

export default app;
