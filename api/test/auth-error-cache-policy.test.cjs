const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadTypeScriptModule(filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  });

  const loadedModule = new Module(filename, module);
  loadedModule.filename = filename;
  loadedModule.paths = Module._nodeModulePaths(path.dirname(filename));
  loadedModule._compile(outputText, filename);
  return loadedModule.exports;
}

const { applyApiSecurityHeaders } = loadTypeScriptModule(
  path.join(__dirname, '..', 'src', 'middleware', 'security.ts')
);
const { onRequest } = loadTypeScriptModule(
  path.join(__dirname, '..', '..', 'frontend', 'functions', 'api', '[[path]].ts')
);

test('API final response marks anonymous 401 and 403 as no-store', async () => {
  const request = new Request('https://api.example.test/posts?visibility=all');
  assert.equal(request.headers.has('Cookie'), false);

  for (const status of [401, 403]) {
    const body = JSON.stringify({ success: false, status });
    const response = applyApiSecurityHeaders(new Response(body, {
      status,
      headers: {
        'Access-Control-Allow-Origin': 'https://pages.example.test',
        'Cache-Control': 'public, max-age=60',
        'Content-Type': 'application/json',
      },
    }), request);

    assert.equal(response.status, status);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://pages.example.test');
    assert.equal(await response.text(), body);
  }
});

test('Pages proxy final response marks upstream 401 and 403 as no-store', async () => {
  const originalFetch = globalThis.fetch;

  try {
    for (const status of [401, 403]) {
      const body = JSON.stringify({ success: false, status });
      globalThis.fetch = async (url, init) => {
        assert.equal(url, 'https://worker.example.test/posts?visibility=all');
        assert.equal(init.method, 'GET');
        return new Response(body, {
          status,
          headers: status === 401
            ? { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' }
            : { 'Cache-Control': 'public, max-age=60', 'Content-Type': 'application/json' },
        });
      };

      const request = new Request('https://pages.example.test/api/posts?visibility=all');
      assert.equal(request.headers.has('Cookie'), false);
      const response = await onRequest({
        request,
        env: { MICROBLOG_API_ORIGIN: 'https://worker.example.test' },
      });

      assert.equal(response.status, status);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      assert.equal(await response.text(), body);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('API final response preserves explicit successful media cache policies', () => {
  const request = new Request('https://api.example.test/media/42');
  const cases = [
    [200, 'public, max-age=31536000, immutable'],
    [206, 'public, max-age=31536000, immutable'],
    [200, 'private, no-store'],
    [206, 'private, no-store'],
  ];

  for (const [status, cacheControl] of cases) {
    const response = applyApiSecurityHeaders(new Response('media', {
      status,
      headers: { 'Cache-Control': cacheControl },
    }), request);

    assert.equal(response.status, status);
    assert.equal(response.headers.get('Cache-Control'), cacheControl);
  }
});

test('Pages proxy final response preserves explicit successful media cache policies', async () => {
  const originalFetch = globalThis.fetch;

  try {
    for (const status of [200, 206]) {
      for (const cacheControl of [
        'public, max-age=31536000, immutable',
        'private, no-store',
      ]) {
        globalThis.fetch = async () => new Response('media', {
          status,
          headers: { 'Cache-Control': cacheControl },
        });

        const response = await onRequest({
          request: new Request('https://pages.example.test/api/media/42'),
          env: { MICROBLOG_API_ORIGIN: 'https://worker.example.test' },
        });

        assert.equal(response.status, status);
        assert.equal(response.headers.get('Cache-Control'), cacheControl);
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
