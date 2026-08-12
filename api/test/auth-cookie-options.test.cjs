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

const authModule = loadTypeScriptModule(
  path.join(__dirname, '..', 'src', 'middleware', 'auth.ts')
);
const { getSessionOptions, shouldUseSecureSessionCookie } = authModule;

const SESSION_SECRET = '<test-only-placeholder>';
const THIRTY_DAYS = 60 * 60 * 24 * 30;

test('session cookie Secure fails safe outside explicit development', () => {
  const cases = [
    ['development', false],
    ['preview', true],
    ['production', true],
    [undefined, true],
    ['staging-typo', true],
  ];

  for (const [environment, expected] of cases) {
    assert.equal(shouldUseSecureSessionCookie(environment), expected);
    assert.equal(
      getSessionOptions({ SESSION_SECRET, ENVIRONMENT: environment }).cookieOptions.secure,
      expected
    );
  }

  assert.equal(getSessionOptions({ SESSION_SECRET }).cookieOptions.secure, true);
});

test('session cookie security attributes and lifetime remain unchanged', () => {
  const options = getSessionOptions({
    SESSION_SECRET,
    ENVIRONMENT: 'production',
  });

  assert.equal(options.cookieName, 'microblog_session');
  assert.equal(options.ttl, THIRTY_DAYS);
  assert.deepEqual(options.cookieOptions, {
    secure: true,
    sameSite: 'lax',
    httpOnly: true,
    path: '/',
    maxAge: THIRTY_DAYS - 60,
  });
});

test('supported SameSite settings are preserved', () => {
  for (const sameSite of ['lax', 'strict', 'none']) {
    const options = getSessionOptions({
      SESSION_SECRET,
      ENVIRONMENT: 'preview',
      SESSION_SAME_SITE: sameSite,
    });

    assert.equal(options.cookieOptions.sameSite, sameSite);
  }
});

test('SameSite=None stays Secure in every non-development environment', () => {
  for (const environment of ['preview', 'production', undefined, 'future-environment']) {
    const options = getSessionOptions({
      SESSION_SECRET,
      ENVIRONMENT: environment,
      SESSION_SAME_SITE: 'none',
    });

    assert.equal(options.cookieOptions.sameSite, 'none');
    assert.equal(options.cookieOptions.secure, true);
  }
});
