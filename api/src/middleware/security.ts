import { MiddlewareHandler } from 'hono';
import { Env } from '../types';

export const API_SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=86400',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
} as const;

function hasSessionCookie(request: Request) {
  return request.headers.get('Cookie')?.split(';').some((part) => (
    part.trim().startsWith('microblog_session=')
  )) ?? false;
}

function isSensitiveRequest(request: Request) {
  const method = request.method.toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) return true;

  const path = new URL(request.url).pathname;
  return path.startsWith('/auth/')
    || path === '/tags/manage'
    || path.startsWith('/upload/')
    || path.startsWith('/export/')
    || path === '/analytics/summary'
    || hasSessionCookie(request);
}

export function applyApiSecurityHeaders(response: Response, request?: Request) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
    headers.set(name, value);
  }

  const isMediaResponse = request && new URL(request.url).pathname.startsWith('/media/');
  const hasExplicitMediaCachePolicy = Boolean(isMediaResponse && headers.has('Cache-Control'));
  if (response.status === 401
    || response.status === 403
    || (isMediaResponse && response.status >= 400)
    || (!hasExplicitMediaCachePolicy && (headers.has('Set-Cookie') || (request && isSensitiveRequest(request))))) {
    headers.set('Cache-Control', 'no-store');
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export const apiSecurityHeadersMiddleware: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  await next();
  c.res = applyApiSecurityHeaders(c.res, c.req.raw);
};
