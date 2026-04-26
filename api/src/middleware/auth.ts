import { MiddlewareHandler } from 'hono';
import { getIronSession, SessionOptions } from 'iron-session';
import { Env, SessionData } from '../types';

function sessionSameSite(env: Env): 'lax' | 'strict' | 'none' {
  return env.SESSION_SAME_SITE || (env.ENVIRONMENT === 'production' ? 'none' : 'lax');
}

export const getSessionOptions = (env: Env): SessionOptions => ({
  password: env.SESSION_SECRET,
  cookieName: 'microblog_session',
  cookieOptions: {
    secure: env.ENVIRONMENT === 'production',
    sameSite: sessionSameSite(env),
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 7, // 7 days
  },
});

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

  // Attach user info to context for use in route handlers
  c.set('userId', session.userId);
  c.set('username', session.username);

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
    c.set('userId', session.userId);
    c.set('username', session.username);
  }

  await next();
};
