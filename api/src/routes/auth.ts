import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { getIronSession, SessionOptions } from 'iron-session';
import { Env, SessionData } from '../types';
import { authMiddleware } from '../middleware/auth';

const loginSchema = z.object({
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

const isAdminBootstrapAllowed = (env: Env) => env.ALLOW_ADMIN_BOOTSTRAP === 'true';

// Session options
const getSessionOptions = (env: Env): SessionOptions => ({
  password: env.SESSION_SECRET,
  cookieName: 'microblog_session',
  cookieOptions: {
    secure: env.ENVIRONMENT === 'production',
    sameSite: 'lax',
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 7, // 7 days
  },
});

export const authRouter = new Hono<{ Bindings: Env }>();

// Login
authRouter.post('/login', zValidator('json', loginSchema), async (c) => {
  const { password } = c.req.valid('json');
  const db = c.env.DB;

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
    await db.prepare(
      'INSERT INTO login_logs (ip, user_agent, success) VALUES (?, ?, ?)'
    ).bind(
      c.req.header('cf-connecting-ip') || 'unknown',
      c.req.header('user-agent') || '',
      1
    ).run();

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
  await db.prepare(
    'INSERT INTO login_logs (ip, user_agent, success) VALUES (?, ?, ?)'
  ).bind(
    c.req.header('cf-connecting-ip') || 'unknown',
    c.req.header('user-agent') || '',
    valid ? 1 : 0
  ).run();

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
