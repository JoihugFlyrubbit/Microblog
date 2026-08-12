type PagesEnv = {
  MICROBLOG_API_ORIGIN?: string;
  PROXY_SHARED_SECRET?: string;
};

type PagesContext = {
  request: Request;
  env: PagesEnv;
};

const PROTECTED_POST_PATHS = new Set(['/analytics/page-view', '/auth/login']);
const API_SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=86400',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
} as const;

function isSensitiveRequest(request: Request, upstreamPath: string) {
  const method = request.method.toUpperCase();
  return !['GET', 'HEAD', 'OPTIONS'].includes(method)
    || upstreamPath.startsWith('/auth/')
    || upstreamPath === '/tags/manage'
    || upstreamPath.startsWith('/upload/')
    || upstreamPath.startsWith('/export/')
    || upstreamPath === '/analytics/summary'
    || (request.headers.get('Cookie')?.includes('microblog_session=') ?? false);
}

function secureResponse(response: Response, request?: Request, upstreamPath = '/') {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  const isMediaResponse = upstreamPath.startsWith('/media/');
  const hasExplicitMediaCachePolicy = isMediaResponse && headers.has('Cache-Control');
  if (response.status === 401
    || response.status === 403
    || (isMediaResponse && response.status >= 400)
    || (!hasExplicitMediaCachePolicy && (headers.has('Set-Cookie') || (request && isSensitiveRequest(request, upstreamPath))))) {
    headers.set('Cache-Control', 'no-store');
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function bytesToHex(value: ArrayBuffer) {
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function signProxySource(secret: string, method: string, path: string, origin: string, source: string, timestamp: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const message = ['v1', method.toUpperCase(), path, origin, source, timestamp].join('\n');
  return bytesToHex(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

function unavailableResponse(request: Request, upstreamPath: string) {
  return secureResponse(Response.json({
    success: false,
    error: { code: 'SERVICE_UNAVAILABLE', message: 'Service is temporarily unavailable' },
  }, { status: 503 }), request, upstreamPath);
}

export async function onRequest(context: PagesContext) {
  const url = new URL(context.request.url);
  const upstreamPath = url.pathname.replace(/^\/api/, '') || '/';
  const apiOrigin = context.env.MICROBLOG_API_ORIGIN?.replace(/\/$/, '');
  if (!apiOrigin) {
    return secureResponse(Response.json({
      success: false,
      error: { code: 'API_ORIGIN_NOT_CONFIGURED', message: 'API origin is not configured' },
    }, { status: 500 }), context.request, upstreamPath);
  }

  const upstreamUrl = new URL(`${apiOrigin}${upstreamPath}`);
  upstreamUrl.search = url.search;

  const headers = new Headers(context.request.headers);
  headers.delete('X-Microblog-Source-IP');
  headers.delete('X-Microblog-Proxy-Time');
  headers.delete('X-Microblog-Proxy-Signature');
  headers.set('Origin', url.origin);
  headers.set('X-Forwarded-Host', url.host);
  headers.set('X-Forwarded-Proto', url.protocol.replace(':', ''));
  headers.delete('Host');

  if (context.request.method.toUpperCase() === 'POST' && PROTECTED_POST_PATHS.has(upstreamPath)) {
    const secret = context.env.PROXY_SHARED_SECRET;
    const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    const source = context.request.headers.get('CF-Connecting-IP') || (isLocal ? '127.0.0.1' : '');
    if (!secret || secret.length < 32 || !source) {
      return unavailableResponse(context.request, upstreamPath);
    }

    const timestamp = String(Date.now());
    const signature = await signProxySource(
      secret,
      context.request.method,
      upstreamPath,
      url.origin,
      source,
      timestamp
    );
    headers.set('X-Microblog-Source-IP', source);
    headers.set('X-Microblog-Proxy-Time', timestamp);
    headers.set('X-Microblog-Proxy-Signature', signature);
  }

  const response = await fetch(upstreamUrl.toString(), {
    method: context.request.method,
    headers,
    body: ['GET', 'HEAD'].includes(context.request.method.toUpperCase())
      ? undefined
      : context.request.body,
    redirect: 'manual',
  });

  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete('Access-Control-Allow-Origin');
  responseHeaders.delete('Access-Control-Allow-Credentials');
  responseHeaders.delete('Access-Control-Allow-Headers');
  responseHeaders.delete('Access-Control-Allow-Methods');

  return secureResponse(new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  }), context.request, upstreamPath);
}
