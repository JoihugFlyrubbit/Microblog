import { Env } from '../types';

const PROXY_SOURCE_HEADER = 'x-microblog-source-ip';
const PROXY_TIME_HEADER = 'x-microblog-proxy-time';
const PROXY_SIGNATURE_HEADER = 'x-microblog-proxy-signature';
const CROSS_ZONE_WORKER_IP = '2a06:98c0:3600::103';
const MAX_PROXY_AGE_MS = 120_000;

export function parseAllowedOrigins(env: Env) {
  const configured = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  const origins = new Set(configured);
  if (env.ENVIRONMENT !== 'production') {
    origins.add('http://localhost:3000');
    origins.add('http://127.0.0.1:3000');
  }
  return origins;
}

export function normalizeOrigin(origin: string | undefined) {
  if (!origin) return '';
  try {
    return new URL(origin).origin;
  } catch {
    return '';
  }
}

export function hasAllowedRequestOrigin(request: Request, env: Env) {
  const suppliedOrigin = request.headers.get('origin') || undefined;
  const origin = normalizeOrigin(suppliedOrigin);
  if (!suppliedOrigin || !origin || !parseAllowedOrigins(env).has(origin)) {
    return false;
  }

  const fetchSite = request.headers.get('sec-fetch-site')?.toLowerCase();
  return fetchSite !== 'cross-site';
}

function proxyMessage(request: Request, source: string, timestamp: string) {
  const url = new URL(request.url);
  return [
    'v1',
    request.method.toUpperCase(),
    url.pathname,
    request.headers.get('origin') || '',
    source,
    timestamp,
  ].join('\n');
}

function hexToBytes(value: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

async function verifyProxySource(request: Request, env: Env, source: string, timestamp: string, signature: string) {
  if (!env.PROXY_SHARED_SECRET || env.PROXY_SHARED_SECRET.length < 32) return false;
  if (!source || source.length > 128 || source.includes('\n')) return false;

  const timestampMs = Number(timestamp);
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > MAX_PROXY_AGE_MS) {
    return false;
  }

  const signatureBytes = hexToBytes(signature);
  if (!signatureBytes) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(env.PROXY_SHARED_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  return crypto.subtle.verify(
    'HMAC',
    key,
    signatureBytes,
    encoder.encode(proxyMessage(request, source, timestamp))
  );
}

export type RequestSource = {
  rateLimitKey: string;
  logIp: string;
};

export async function resolveRequestSource(request: Request, env: Env): Promise<RequestSource | null> {
  const source = request.headers.get(PROXY_SOURCE_HEADER);
  const timestamp = request.headers.get(PROXY_TIME_HEADER);
  const signature = request.headers.get(PROXY_SIGNATURE_HEADER);
  const hasAnyProxyHeader = Boolean(source || timestamp || signature);

  if (hasAnyProxyHeader) {
    if (!source || !timestamp || !signature) return null;
    if (!await verifyProxySource(request, env, source, timestamp, signature)) return null;
    return { rateLimitKey: source, logIp: source };
  }

  const connectingIp = request.headers.get('cf-connecting-ip');
  if (!connectingIp || connectingIp === CROSS_ZONE_WORKER_IP) return null;
  return { rateLimitKey: connectingIp, logIp: connectingIp };
}

export async function checkRateLimit(rateLimiter: RateLimit | undefined, key: string) {
  if (!rateLimiter) return 'unavailable' as const;
  try {
    const result = await rateLimiter.limit({ key });
    return result.success ? 'allowed' as const : 'limited' as const;
  } catch (error) {
    console.error('Rate limiter unavailable:', error);
    return 'unavailable' as const;
  }
}
