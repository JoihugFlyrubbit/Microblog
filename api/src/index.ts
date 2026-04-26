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

const app = new Hono<{ Bindings: Env }>();

// Middleware
app.use(logger());
app.use('/*', cors({
  origin: (origin) => {
    // Allow localhost for development
    if (false) {
      return origin;
    }
    // Allow local network access for phone testing
    if (/^https?:\/\/(192\.0\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(origin || '')) {
      return origin as string;
    }
    // Allow production domain
    if (false) {
      return origin;
    }
    return '';
  },
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

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
