#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePreview } from './preview-preflight.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'microblog-preview-preflight-'));

const base = {
  config: `name = "microblog-preview-worker"
main = "src/index.ts"
compatibility_date = "2026-04-12"
[vars]
ENVIRONMENT = "preview"
ALLOW_ADMIN_BOOTSTRAP = "false"
ALLOWED_ORIGINS = "https://pages-preview.test"
SESSION_SAME_SITE = "lax"
[triggers]
crons = ["17 3 * * *"]
[[d1_databases]]
binding = "DB"
database_name = "microblog-preview-db"
database_id = "preview-d1-test-id"
[[r2_buckets]]
binding = "MEDIA_BUCKET"
bucket_name = "microblog-preview-media"
[[ratelimits]]
name = "ANALYTICS_RATE_LIMITER"
namespace_id = "710001"
simple = { limit = 6, period = 60 }
[[ratelimits]]
name = "LOGIN_RATE_LIMITER"
namespace_id = "710002"
simple = { limit = 5, period = 60 }
`,
  worker: `SESSION_SECRET=test-example-session-secret-value-over-32-characters
PROXY_SHARED_SECRET=test-example-shared-secret-value-over-32-characters
`,
  pages: `PAGES_PREVIEW_ORIGIN=https://pages-preview.test
NEXT_PUBLIC_SITE_URL=https://pages-preview.test
MICROBLOG_API_ORIGIN=https://api-preview.test
PROXY_SHARED_SECRET=test-example-shared-secret-value-over-32-characters
`,
  production: `PRODUCTION_WORKER_NAME=microblog-live-worker
PRODUCTION_D1_DATABASE_ID=production-d1-test-id
PRODUCTION_R2_BUCKET_NAME=microblog-live-media
PRODUCTION_ANALYTICS_RATE_LIMIT_NAMESPACE_ID=720001
PRODUCTION_LOGIN_RATE_LIMIT_NAMESPACE_ID=720002
PRODUCTION_PAGES_ORIGIN=https://pages-live.test
PRODUCTION_API_ORIGIN=https://api-live.test
`,
};

function runCase(name, mutate = (value) => value) {
  const dir = path.join(tempRoot, name);
  fs.mkdirSync(dir);
  const values = mutate({ ...base });
  const paths = {
    repoRoot,
    configPath: path.join(dir, 'wrangler.preview.toml'),
    workerSecretsPath: path.join(dir, '.preview-worker-secrets.local'),
    pagesPath: path.join(dir, '.preview-pages.local'),
    productionRefsPath: path.join(dir, '.preview-production-refs.local'),
  };
  fs.writeFileSync(paths.configPath, values.config);
  fs.writeFileSync(paths.workerSecretsPath, values.worker);
  fs.writeFileSync(paths.pagesPath, values.pages);
  fs.writeFileSync(paths.productionRefsPath, values.production);
  return validatePreview(paths);
}

try {
  assert.deepEqual(runCase('success'), []);
  assert(runCase('placeholder', (value) => ({ ...value, config: value.config.replace('microblog-preview-worker', 'replace-with-preview-worker-name') })).some((failure) => failure.includes('placeholder')));
  assert(runCase('same-preview-rate', (value) => ({ ...value, config: value.config.replace('namespace_id = "710002"', 'namespace_id = "710001"') })).some((failure) => failure.includes('identical')));
  assert(runCase('production-rate', (value) => ({ ...value, production: value.production.replace('720001', '710001') })).some((failure) => failure.includes('matches Production')));
  assert(runCase('production-d1', (value) => ({ ...value, production: value.production.replace('production-d1-test-id', 'preview-d1-test-id') })).some((failure) => failure.includes('Preview D1')));
  assert(runCase('production-r2', (value) => ({ ...value, production: value.production.replace('microblog-live-media', 'microblog-preview-media') })).some((failure) => failure.includes('Preview R2')));
  assert(runCase('http-origin', (value) => ({ ...value, pages: value.pages.replaceAll('https://pages-preview.test', 'http://pages-preview.test'), config: value.config.replace('https://pages-preview.test', 'http://pages-preview.test') })).some((failure) => failure.includes('HTTPS')));
  assert(runCase('missing-field', (value) => ({ ...value, worker: value.worker.replace(/^SESSION_SECRET=.*\n/m, '') })).some((failure) => failure.includes('missing SESSION_SECRET')));
  console.log('Preview preflight tests passed: success plus 7 required failure cases.');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
