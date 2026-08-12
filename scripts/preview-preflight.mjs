#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPLATE_RATE_LIMIT_IDS = new Set(['900000001', '900000002']);
const PLACEHOLDER_PATTERN = /(?:replace[-_ ]with|example\.invalid|placeholder|your[-_]|00000000-0000-0000-0000-000000000000)/i;

function parseScalar(raw) {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"')) return JSON.parse(value);
  if (/^-?\d+$/.test(value)) return Number(value);
  if (value === 'true' || value === 'false') return value === 'true';
  if (value.startsWith('{') && value.endsWith('}')) {
    const result = {};
    for (const pair of value.slice(1, -1).split(',')) {
      const index = pair.indexOf('=');
      if (index === -1) throw new Error('unsupported inline TOML object');
      result[pair.slice(0, index).trim()] = parseScalar(pair.slice(index + 1));
    }
    return result;
  }
  if (value.startsWith('[') && value.endsWith(']')) {
    return value.slice(1, -1).split(',').filter(Boolean).map((item) => parseScalar(item));
  }
  throw new Error('unsupported TOML value');
}

function parseToml(file) {
  const root = {};
  let current = root;
  for (const originalLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = originalLine.trim();
    if (!line || line.startsWith('#')) continue;
    const arrayMatch = line.match(/^\[\[([A-Za-z0-9_]+)\]\]$/);
    if (arrayMatch) {
      root[arrayMatch[1]] ??= [];
      current = {};
      root[arrayMatch[1]].push(current);
      continue;
    }
    const sectionMatch = line.match(/^\[([A-Za-z0-9_]+)\]$/);
    if (sectionMatch) {
      root[sectionMatch[1]] ??= {};
      current = root[sectionMatch[1]];
      continue;
    }
    const assignment = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!assignment) throw new Error('unsupported TOML syntax');
    current[assignment[1]] = parseScalar(assignment[2]);
  }
  return root;
}

function parseKeyValues(file) {
  const result = {};
  for (const originalLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = originalLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match) throw new Error('unsupported local key/value syntax');
    if (Object.hasOwn(result, match[1])) throw new Error(`duplicate field: ${match[1]}`);
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[match[1]] = value;
  }
  return result;
}

function exactHttpsOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && !url.username
      && !url.password
      && url.pathname === '/'
      && !url.search
      && !url.hash
      && url.origin === value;
  } catch {
    return false;
  }
}

function tracked(repoRoot, file) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', path.relative(repoRoot, file)], {
      cwd: repoRoot,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function requireFields(failures, object, fields, group) {
  for (const field of fields) {
    if (!object[field]) failures.push(`${group}: missing ${field}`);
  }
}

export function validatePreview({ repoRoot, configPath, workerSecretsPath, pagesPath, productionRefsPath }) {
  const failures = [];
  const inputs = [configPath, workerSecretsPath, pagesPath, productionRefsPath];
  for (const file of inputs) {
    if (!fs.existsSync(file)) failures.push(`missing local input: ${path.basename(file)}`);
    else if (tracked(repoRoot, file)) failures.push(`private Preview input is tracked: ${path.basename(file)}`);
  }
  if (failures.length) return failures;

  let config;
  let worker;
  let pages;
  let production;
  try {
    config = parseToml(configPath);
    worker = parseKeyValues(workerSecretsPath);
    pages = parseKeyValues(pagesPath);
    production = parseKeyValues(productionRefsPath);
  } catch (error) {
    return [`input parse failed: ${error.message}`];
  }

  requireFields(failures, config, ['name', 'main', 'compatibility_date'], 'Worker config');
  requireFields(failures, config.vars ?? {}, ['ENVIRONMENT', 'ALLOW_ADMIN_BOOTSTRAP', 'ALLOWED_ORIGINS', 'SESSION_SAME_SITE'], 'Worker vars');
  requireFields(failures, worker, ['SESSION_SECRET', 'PROXY_SHARED_SECRET'], 'Worker secrets');
  requireFields(failures, pages, ['PAGES_PREVIEW_ORIGIN', 'NEXT_PUBLIC_SITE_URL', 'MICROBLOG_API_ORIGIN', 'PROXY_SHARED_SECRET'], 'Pages Preview');
  requireFields(failures, production, [
    'PRODUCTION_WORKER_NAME',
    'PRODUCTION_D1_DATABASE_ID',
    'PRODUCTION_R2_BUCKET_NAME',
    'PRODUCTION_ANALYTICS_RATE_LIMIT_NAMESPACE_ID',
    'PRODUCTION_LOGIN_RATE_LIMIT_NAMESPACE_ID',
    'PRODUCTION_PAGES_ORIGIN',
    'PRODUCTION_API_ORIGIN',
  ], 'Production comparison refs');

  const allValues = [
    config.name,
    config.vars?.ALLOWED_ORIGINS,
    ...(config.d1_databases ?? []).flatMap((item) => [item.database_name, item.database_id]),
    ...(config.r2_buckets ?? []).map((item) => item.bucket_name),
    ...(config.ratelimits ?? []).map((item) => item.namespace_id),
    ...Object.values(worker),
    ...Object.values(pages),
    ...Object.values(production),
  ].filter((value) => typeof value === 'string');
  if (allValues.some((value) => PLACEHOLDER_PATTERN.test(value))) failures.push('one or more template placeholders remain');

  if (config.vars?.ENVIRONMENT !== 'preview') failures.push('Worker vars: ENVIRONMENT must be preview');
  if (config.vars?.ALLOW_ADMIN_BOOTSTRAP !== 'false') failures.push('Worker vars: ALLOW_ADMIN_BOOTSTRAP must be false');
  if (config.vars?.SESSION_SAME_SITE !== 'lax') failures.push('Worker vars: SESSION_SAME_SITE must be lax');
  for (const key of Object.keys(config.vars ?? {})) {
    if (/(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY)/.test(key) || ['QWEATHER_KEY_ID', 'QWEATHER_PROJECT_ID'].includes(key)) {
      failures.push(`Worker vars: ${key} must be injected as a secret, not an ordinary variable`);
    }
  }
  if (config.route || config.routes) failures.push('Worker config: routes/custom domains are forbidden for Preview');
  if (/prod(?:uction)?/i.test(config.name ?? '')) failures.push('Worker name has an obvious production marker');
  if (config.name && config.name === production.PRODUCTION_WORKER_NAME) failures.push('Preview Worker matches Production Worker');

  const d1 = config.d1_databases ?? [];
  if (d1.length !== 1 || d1[0]?.binding !== 'DB') failures.push('D1: exactly one DB binding is required');
  if (!d1[0]?.database_name || !d1[0]?.database_id) failures.push('D1: database_name and database_id are required');
  if (/prod(?:uction)?/i.test(d1[0]?.database_name ?? '')) failures.push('D1: name has an obvious production marker');
  if (d1[0]?.database_id && d1[0].database_id === production.PRODUCTION_D1_DATABASE_ID) failures.push('Preview D1 matches Production D1');

  const r2 = config.r2_buckets ?? [];
  if (r2.length !== 1 || r2[0]?.binding !== 'MEDIA_BUCKET') failures.push('R2: exactly one MEDIA_BUCKET binding is required');
  if (!r2[0]?.bucket_name) failures.push('R2: bucket_name is required');
  if (/prod(?:uction)?/i.test(r2[0]?.bucket_name ?? '')) failures.push('R2: name has an obvious production marker');
  if (r2[0]?.bucket_name && r2[0].bucket_name === production.PRODUCTION_R2_BUCKET_NAME) failures.push('Preview R2 matches Production R2');

  const expectedLimits = new Map([
    ['ANALYTICS_RATE_LIMITER', { limit: 6, period: 60 }],
    ['LOGIN_RATE_LIMITER', { limit: 5, period: 60 }],
  ]);
  const rateLimits = config.ratelimits ?? [];
  if (rateLimits.length !== 2) failures.push('Rate Limit: exactly two bindings are required');
  for (const [name, expected] of expectedLimits) {
    const item = rateLimits.find((candidate) => candidate.name === name);
    if (!item) {
      failures.push(`Rate Limit: missing ${name}`);
      continue;
    }
    if (!/^\d+$/.test(item.namespace_id ?? '') || TEMPLATE_RATE_LIMIT_IDS.has(item.namespace_id)) failures.push(`Rate Limit: ${name} namespace is invalid or a template value`);
    if (item.simple?.limit !== expected.limit || item.simple?.period !== expected.period) failures.push(`Rate Limit: ${name} limit/period is incorrect`);
  }
  const previewRateIds = rateLimits.map((item) => item.namespace_id).filter(Boolean);
  if (previewRateIds.length === 2 && previewRateIds[0] === previewRateIds[1]) failures.push('Preview Rate Limit namespaces are identical');
  const productionRateIds = new Set([
    production.PRODUCTION_ANALYTICS_RATE_LIMIT_NAMESPACE_ID,
    production.PRODUCTION_LOGIN_RATE_LIMIT_NAMESPACE_ID,
  ]);
  if (previewRateIds.some((id) => productionRateIds.has(id))) failures.push('a Preview Rate Limit namespace matches Production');

  for (const [field, value] of [
    ['PAGES_PREVIEW_ORIGIN', pages.PAGES_PREVIEW_ORIGIN],
    ['NEXT_PUBLIC_SITE_URL', pages.NEXT_PUBLIC_SITE_URL],
    ['MICROBLOG_API_ORIGIN', pages.MICROBLOG_API_ORIGIN],
  ]) {
    if (value && !exactHttpsOrigin(value)) failures.push(`Pages Preview: ${field} must be an exact HTTPS origin`);
  }
  if ((config.vars?.ALLOWED_ORIGINS ?? '').includes('*')) failures.push('Worker vars: wildcard Origin is forbidden');
  if (config.vars?.ALLOWED_ORIGINS && config.vars.ALLOWED_ORIGINS !== pages.PAGES_PREVIEW_ORIGIN) failures.push('Worker ALLOWED_ORIGINS must exactly match PAGES_PREVIEW_ORIGIN');
  if (pages.NEXT_PUBLIC_SITE_URL && pages.NEXT_PUBLIC_SITE_URL !== pages.PAGES_PREVIEW_ORIGIN) failures.push('NEXT_PUBLIC_SITE_URL must exactly match PAGES_PREVIEW_ORIGIN');
  if (pages.PAGES_PREVIEW_ORIGIN && pages.PAGES_PREVIEW_ORIGIN === production.PRODUCTION_PAGES_ORIGIN) failures.push('Preview Pages Origin matches Production');
  if (pages.MICROBLOG_API_ORIGIN && pages.MICROBLOG_API_ORIGIN === production.PRODUCTION_API_ORIGIN) failures.push('Preview API Origin matches Production');

  if (worker.SESSION_SECRET && worker.SESSION_SECRET.length < 32) failures.push('Worker secret: SESSION_SECRET length is below 32');
  if (worker.PROXY_SHARED_SECRET && worker.PROXY_SHARED_SECRET.length < 32) failures.push('Worker secret: PROXY_SHARED_SECRET length is below 32');
  if (pages.PROXY_SHARED_SECRET && pages.PROXY_SHARED_SECRET.length < 32) failures.push('Pages secret: PROXY_SHARED_SECRET length is below 32');
  if (worker.PROXY_SHARED_SECRET && pages.PROXY_SHARED_SECRET && worker.PROXY_SHARED_SECRET !== pages.PROXY_SHARED_SECRET) failures.push('PROXY_SHARED_SECRET does not match between Worker and Pages');

  return [...new Set(failures)];
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || !value) throw new Error('expected --name value arguments');
    result[key.slice(2)] = value;
  }
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, '..');
  try {
    const args = parseArgs(process.argv.slice(2));
    const failures = validatePreview({
      repoRoot,
      configPath: path.resolve(repoRoot, args.config ?? 'api/wrangler.preview.toml'),
      workerSecretsPath: path.resolve(repoRoot, args['worker-secrets'] ?? 'api/.preview-worker-secrets.local'),
      pagesPath: path.resolve(repoRoot, args.pages ?? 'frontend/.preview-pages.local'),
      productionRefsPath: path.resolve(repoRoot, args['production-refs'] ?? 'api/.preview-production-refs.local'),
    });
    if (failures.length) {
      console.error('Preview preflight failed:');
      for (const failure of failures) console.error(` - ${failure}`);
      process.exitCode = 1;
    } else {
      console.log('Preview preflight passed.');
      console.log('Secrets: required values exist, meet minimum length, and the shared values match.');
      console.log('Isolation: local Preview values differ from the supplied Production comparison refs.');
      console.log('Pending: confirm both Rate Limit namespace IDs are unique across the Cloudflare account.');
    }
  } catch (error) {
    console.error(`Preview preflight failed: ${error.message}`);
    process.exitCode = 1;
  }
}
