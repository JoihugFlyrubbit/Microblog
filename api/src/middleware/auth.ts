import { MiddlewareHandler } from 'hono';
import { getIronSession, SessionOptions } from 'iron-session';
import { Env, SessionData } from '../types';

function sessionSameSite(env: Env): 'lax' | 'strict' | 'none' {
  return env.SESSION_SAME_SITE || 'lax';
}

export function shouldUseSecureSessionCookie(environment?: string): boolean {
  return environment !== 'development';
}

export const getSessionOptions = (env: Env): SessionOptions => ({
  password: env.SESSION_SECRET,
  cookieName: 'microblog_session',
  ttl: 60 * 60 * 24 * 30,
  cookieOptions: {
    secure: shouldUseSecureSessionCookie(env.ENVIRONMENT),
    sameSite: sessionSameSite(env),
    httpOnly: true,
    path: '/',
    maxAge: 60 * 60 * 24 * 30 - 60,
  },
});

type SessionUser = {
  id: number;
  username: string;
  session_version: number;
};

export async function getValidSessionUser(env: Env, session: SessionData) {
  if (!session.isLoggedIn || !Number.isInteger(session.sessionVersion)) return null;

  const user = await env.DB.prepare(
    'SELECT id, username, session_version FROM users WHERE id = ?'
  ).bind(session.userId).first<SessionUser>();

  if (!user || user.username !== session.username || user.session_version !== session.sessionVersion) {
    return null;
  }

  return user;
}

/**
 * Authentication middleware
 * Validates session and attaches user info to context
 */
export const authMiddleware: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const session = await getIronSession<SessionData>(
    c.req.raw,
    c.res,
    getSessionOptions(c.env)
  );

  if (!session.isLoggedIn) {
    return c.json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      },
    }, 401);
  }

  let user: SessionUser | null;
  try {
    user = await getValidSessionUser(c.env, session);
  } catch (error) {
    console.error('Session validation failed:', error);
    return c.json({
      success: false,
      error: {
        code: 'AUTH_UNAVAILABLE',
        message: 'Authentication is temporarily unavailable',
      },
    }, 503);
  }

  if (!user) {
    session.destroy();
    return c.json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      },
    }, 401);
  }

  // Attach user info to context for use in route handlers
  c.set('userId', user.id);
  c.set('username', user.username);

  await next();
};

/**
 * Optional auth middleware
 * Validates session if present, but doesn't require it
 */
export const optionalAuthMiddleware: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const session = await getIronSession<SessionData>(
    c.req.raw,
    c.res,
    getSessionOptions(c.env)
  );

  if (session.isLoggedIn) {
    try {
      const user = await getValidSessionUser(c.env, session);
      if (user) {
        c.set('userId', user.id);
        c.set('username', user.username);
      } else {
        session.destroy();
      }
    } catch (error) {
      // Public reads remain available, but a database failure never grants admin visibility.
      console.error('Optional session validation failed:', error);
    }
  }

  await next();
};
