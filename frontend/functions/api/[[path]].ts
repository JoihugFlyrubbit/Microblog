type PagesEnv = {
  MICROBLOG_API_ORIGIN?: string;
};

type PagesContext = {
  request: Request;
  env: PagesEnv;
};

export async function onRequest(context: PagesContext) {
  const apiOrigin = context.env.MICROBLOG_API_ORIGIN?.replace(/\/$/, '');
  if (!apiOrigin) {
    return Response.json({
      success: false,
      error: { code: 'API_ORIGIN_NOT_CONFIGURED', message: 'API origin is not configured' },
    }, { status: 500 });
  }

  const url = new URL(context.request.url);
  const upstreamPath = url.pathname.replace(/^\/api/, '') || '/';
  const upstreamUrl = new URL(`${apiOrigin}${upstreamPath}`);
  upstreamUrl.search = url.search;

  const headers = new Headers(context.request.headers);
  headers.set('Origin', url.origin);
  headers.set('X-Forwarded-Host', url.host);
  headers.set('X-Forwarded-Proto', url.protocol.replace(':', ''));
  headers.delete('Host');

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

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}
