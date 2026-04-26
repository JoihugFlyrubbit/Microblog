import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { getIronSession } from 'iron-session';
import { Env, SessionData } from '../types';
import { authMiddleware, getSessionOptions } from '../middleware/auth';

const loginSchema = z.object({
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

const isAdminBootstrapAllowed = (env: Env) => env.ALLOW_ADMIN_BOOTSTRAP === 'true';

export const authRouter = new Hono<{ Bindings: Env }>();

function clientKey(c: { req: { header: (name: string) => string | undefined } }) {
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const ua = c.req.header('user-agent') || '';
  return { ip, ua };
}

async function ensureLoginLogs(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS login_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT NOT NULL,
      user_agent TEXT,
      success BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_login_logs_created_at ON login_logs(created_at)').run();
}

async function isLoginRateLimited(db: D1Database, ip: string) {
  await ensureLoginLogs(db);
  const local = await db.prepare(`
    SELECT COUNT(*) AS count
    FROM login_logs
    WHERE ip = ?
      AND success = 0
      AND created_at > datetime('now', '-15 minutes')
  `).bind(ip).first<{ count: number }>();
  const global = await db.prepare(`
    SELECT COUNT(*) AS count
    FROM login_logs
    WHERE success = 0
      AND created_at > datetime('now', '-15 minutes')
  `).first<{ count: number }>();
  return Number(local?.count || 0) >= 8 || Number(global?.count || 0) >= 100;
}

async function logLoginAttempt(db: D1Database, ip: string, userAgent: string, success: boolean) {
  await ensureLoginLogs(db);
  await db.prepare(
    'INSERT INTO login_logs (ip, user_agent, success) VALUES (?, ?, ?)'
  ).bind(ip, userAgent, success ? 1 : 0).run();
}

// Login
authRouter.post('/login', zValidator('json', loginSchema), async (c) => {
  const { password } = c.req.valid('json');
  const db = c.env.DB;
  const client = clientKey(c);

  if (await isLoginRateLimited(db, client.ip)) {
    return c.json({
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Try again later.' },
    }, 429, { 'Retry-After': '900' });
  }

  // Get user (single user system)
  let user = await db.prepare(
    'SELECT * FROM users WHERE username = ?'
  ).bind('admin').first() as { id: number; username: string; password_hash: string; nickname: string; avatar_url: string } | null;

  // Allow explicit bootstrap in local development only.
  if (!user) {
    if (!isAdminBootstrapAllowed(c.env)) {
      return c.json({
        success: false,
        error: {
          code: 'SETUP_REQUIRED',
          message: 'Admin account has not been initialized',
        },
      }, 503);
    }

    // Hash the provided password and create admin user
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await db.prepare(
      'INSERT INTO users (username, password_hash, nickname, bio, email, wechat, avatar_url, header_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, username, nickname, avatar_url'
    ).bind('admin', passwordHash, '管理员', '', '', '', '', '').first() as { id: number; username: string; nickname: string; avatar_url: string };

    // Log the auto-creation
    await logLoginAttempt(db, client.ip, client.ua, true);

    // Create session for the new user
    const session = await getIronSession<SessionData>(
      c.req.raw,
      c.res,
      getSessionOptions(c.env)
    );

    session.userId = result.id;
    session.username = result.username;
    session.isLoggedIn = true;
    await session.save();

    return c.json({
      success: true,
      data: {
        user: {
          id: result.id,
          username: result.username,
          nickname: result.nickname,
          avatar_url: result.avatar_url,
        },
      },
    });
  }

  // Verify password for existing user
  const valid = await bcrypt.compare(password, user.password_hash);

  // Log attempt
  await logLoginAttempt(db, client.ip, client.ua, valid);

  if (!valid) {
    return c.json({
      success: false,
      error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' },
    }, 401);
  }

  // Create session
  const session = await getIronSession<SessionData>(
    c.req.raw,
    c.res,
    getSessionOptions(c.env)
  );

  session.userId = user.id;
  session.username = user.username;
  session.isLoggedIn = true;
  await session.save();

  return c.json({
    success: true,
    data: {
      user: {
        id: user.id,
        username: user.username,
        nickname: user.nickname,
        avatar_url: user.avatar_url,
      },
    },
  });
});

// Logout
authRouter.post('/logout', async (c) => {
  const session = await getIronSession<SessionData>(
    c.req.raw,
    c.res,
    getSessionOptions(c.env)
  );

  session.destroy();

  return c.json({ success: true });
});

// Get current session
authRouter.get('/session', async (c) => {
  const session = await getIronSession<SessionData>(
    c.req.raw,
    c.res,
    getSessionOptions(c.env)
  );

  if (!session.isLoggedIn) {
    return c.json({
      success: true,
      data: { isLoggedIn: false },
    });
  }

  // Get user details
  const db = c.env.DB;
  const user = await db.prepare(
    'SELECT id, username, nickname, avatar_url FROM users WHERE id = ?'
  ).bind(session.userId).first();

  if (!user) {
    session.destroy();
    return c.json({
      success: true,
      data: { isLoggedIn: false },
    });
  }

  return c.json({
    success: true,
    data: {
      isLoggedIn: true,
      user,
    },
  });
});

// Change password (requires auth)
authRouter.post('/change-password', authMiddleware, zValidator('json', changePasswordSchema), async (c) => {
  const { oldPassword, newPassword } = c.req.valid('json');
  const db = c.env.DB;
  const userId = c.get('userId');

  // Get user
  const user = await db.prepare(
    'SELECT * FROM users WHERE id = ?'
  ).bind(userId).first() as { id: number; password_hash: string } | null;

  if (!user) {
    return c.json({
      success: false,
      error: { code: 'USER_NOT_FOUND', message: 'User not found' },
    }, 404);
  }

  // Verify old password
  const valid = await bcrypt.compare(oldPassword, user.password_hash);
  if (!valid) {
    return c.json({
      success: false,
      error: { code: 'INVALID_PASSWORD', message: 'Current password is incorrect' },
    }, 400);
  }

  // Hash new password
  const newHash = await bcrypt.hash(newPassword, 10);

  // Update password
  await db.prepare(
    'UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(newHash, userId).run();

  return c.json({ success: true });
});
