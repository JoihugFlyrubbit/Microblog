#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiRoot = path.join(repoRoot, 'api');
const wranglerPath = path.join(apiRoot, 'node_modules', '.bin', 'wrangler');
const guardPath = path.join(repoRoot, 'scripts', 'd1-migration-guard.mjs');
const migrationsDir = path.join(apiRoot, 'migrations');
const finalSchemaPath = path.join(apiRoot, 'src', 'db', 'schema.sql');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'microblog-d1-migrations-'));
const diagnostics = [];

function commandResult(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? apiRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      WRANGLER_LOG_PATH: path.join(tempRoot, 'wrangler.log'),
      WRANGLER_LOG_SANITIZE: 'true',
    },
  });
  diagnostics.push({ command: path.basename(command), args, status: result.status, stdout: result.stdout, stderr: result.stderr });
  return result;
}

function requireSuccess(result, label) {
  assert.equal(result.status, 0, `${label} failed:\n${result.stderr || result.stdout}`);
  return result;
}

function parseJson(result, label) {
  requireSuccess(result, label);
  const start = result.stdout.indexOf('[');
  assert.notEqual(start, -1, `${label} returned no JSON`);
  return JSON.parse(result.stdout.slice(start));
}

function writeConfig(caseDir, migrations) {
  const configPath = path.join(caseDir, 'wrangler.toml');
  fs.writeFileSync(configPath, `name = "microblog-migration-local-test"
main = "worker.js"
compatibility_date = "2026-08-05"

[[d1_databases]]
binding = "DB"
database_name = "microblog-migration-local-test"
database_id = "local-test-database-id"
migrations_dir = ${JSON.stringify(migrations)}
`);
  fs.writeFileSync(path.join(caseDir, 'worker.js'), 'export default {};\n');
  return configPath;
}

function createCase(name, migrations = migrationsDir) {
  const caseDir = path.join(tempRoot, name);
  fs.mkdirSync(caseDir);
  return {
    name,
    caseDir,
    stateDir: path.join(caseDir, 'state'),
    configPath: writeConfig(caseDir, migrations),
  };
}

function wranglerArgs(testCase) {
  return ['--local', '--persist-to', testCase.stateDir, '--config', testCase.configPath];
}

function execute(testCase, sql, expectSuccess = true) {
  const result = commandResult(wranglerPath, [
    'd1', 'execute', 'DB', ...wranglerArgs(testCase), '--command', sql, '--json',
  ]);
  if (expectSuccess) return parseJson(result, `${testCase.name}: SQL`);
  assert.notEqual(result.status, 0, `${testCase.name}: SQL unexpectedly succeeded`);
  return result;
}

function executeFile(testCase, file) {
  return requireSuccess(commandResult(wranglerPath, [
    'd1', 'execute', 'DB', ...wranglerArgs(testCase), '--file', file,
  ]), `${testCase.name}: execute ${path.basename(file)}`);
}

function applyMigrations(testCase) {
  return requireSuccess(commandResult(wranglerPath, [
    'd1', 'migrations', 'apply', 'DB', ...wranglerArgs(testCase),
  ]), `${testCase.name}: migrations apply`);
}

function runGuard(testCase, expectSuccess = true) {
  const result = commandResult(process.execPath, [guardPath, 'DB', ...wranglerArgs(testCase)], { cwd: repoRoot });
  if (expectSuccess) requireSuccess(result, `${testCase.name}: migration guard`);
  else assert.notEqual(result.status, 0, `${testCase.name}: migration guard unexpectedly passed`);
  return result;
}

function resultRows(result, index = 0) {
  return result[index]?.results ?? [];
}

function scalar(testCase, sql, field = 'value') {
  const result = execute(testCase, sql);
  return resultRows(result)[0]?.[field];
}

function migrationNames(testCase) {
  return resultRows(execute(testCase, 'SELECT name FROM d1_migrations ORDER BY id;')).map((row) => row.name);
}

function assertNoPending(testCase) {
  const result = applyMigrations(testCase);
  assert.match(`${result.stdout}\n${result.stderr}`, /No migrations to apply/);
}

function historicalSchema() {
  const result = requireSuccess(commandResult('git', ['show', '1c8e153^:api/src/db/schema.sql'], { cwd: repoRoot }), 'read historical schema');
  const file = path.join(tempRoot, 'historical-schema.sql');
  fs.writeFileSync(file, result.stdout);
  return file;
}

const fixtureSql = `
INSERT INTO users (username, password_hash) VALUES ('fixture-user', 'fake-password-hash');
INSERT INTO posts (content, visibility) VALUES ('fixture-public', 'public');
INSERT INTO posts (content, visibility) VALUES ('fixture-private', 'private');
INSERT INTO media (post_id, type, url, size) VALUES (1, 'image', 'fixture-media-key', 123);
INSERT INTO tags (name) VALUES ('fixture-tag');
INSERT INTO post_tags (post_id, tag_id) VALUES (1, 1);
INSERT INTO login_logs (ip, user_agent, success) VALUES ('192.0.2.1', 'fixture-agent', 1);
`;

function assertFixturePreserved(testCase) {
  const rows = resultRows(execute(testCase, `
SELECT
  (SELECT count(*) FROM users) AS users,
  (SELECT count(*) FROM posts) AS posts,
  (SELECT count(*) FROM media) AS media,
  (SELECT count(*) FROM tags) AS tags,
  (SELECT count(*) FROM post_tags) AS post_tags,
  (SELECT count(*) FROM login_logs) AS login_logs,
  (SELECT session_version FROM users WHERE username = 'fixture-user') AS session_version,
  (SELECT category_id FROM tags WHERE name = 'fixture-tag') AS category_id,
  (SELECT collapsed_limit FROM tag_categories WHERE id = 1) AS category_limit,
  (SELECT collapsed_limit FROM tag_display_settings WHERE id = 1) AS display_limit;
`));
  assert.deepEqual(rows[0], {
    users: 1,
    posts: 2,
    media: 1,
    tags: 1,
    post_tags: 1,
    login_logs: 1,
    session_version: 0,
    category_id: null,
    category_limit: null,
    display_limit: 8,
  });
  assert.deepEqual(resultRows(execute(testCase, 'PRAGMA foreign_key_check;')), []);
}

function schemaMetadata(testCase) {
  const expectedTables = [
    'appends', 'login_logs', 'media', 'media_deletion_queue', 'page_view_daily',
    'post_tags', 'posts', 'tag_categories', 'tag_display_settings', 'tags', 'users',
  ];
  const tableValues = expectedTables.map((table) => `(${JSON.stringify(table)})`).join(', ');
  const queryResult = execute(testCase, `
SELECT name FROM sqlite_master
WHERE type = 'table'
  AND name NOT LIKE 'sqlite_%'
  AND name NOT IN ('_cf_METADATA', 'd1_migrations')
ORDER BY name;
WITH expected(owner) AS (VALUES ${tableValues})
SELECT expected.owner, info.cid, info.name, info.type, info.\"notnull\", info.dflt_value, info.pk
FROM expected, pragma_table_info(expected.owner) AS info
ORDER BY expected.owner, info.cid;
WITH expected(owner) AS (VALUES ${tableValues})
SELECT expected.owner, fk.\"table\" AS target, fk.\"from\", fk.\"to\", fk.on_update, fk.on_delete, fk.match
FROM expected, pragma_foreign_key_list(expected.owner) AS fk
ORDER BY expected.owner, fk.\"from\";
SELECT m.tbl_name AS owner, m.name, il.\"unique\", il.partial, ii.seqno, ii.name AS column_name
FROM sqlite_master AS m
JOIN pragma_index_list(m.tbl_name) AS il ON il.name = m.name
JOIN pragma_index_info(m.name) AS ii
WHERE m.type = 'index' AND m.name NOT LIKE 'sqlite_autoindex_%'
ORDER BY owner, m.name, ii.seqno;
`);
  const tables = resultRows(queryResult, 0).map((row) => row.name);
  const result = { tables, columns: {}, foreignKeys: {}, indexes: {} };
  for (const table of tables) {
    result.columns[table] = resultRows(queryResult, 1).filter((row) => row.owner === table)
      .map(({ cid, name, type, notnull, dflt_value, pk }) => ({ cid, name, type, notnull, dflt_value, pk }));
    result.foreignKeys[table] = resultRows(queryResult, 2).filter((row) => row.owner === table)
      .map(({ target, from, to, on_update, on_delete, match }) => ({ target, from, to, on_update, on_delete, match }));
    result.indexes[table] = [];
    const indexRows = resultRows(queryResult, 3).filter((row) => row.owner === table);
    for (const indexName of [...new Set(indexRows.map((row) => row.name))]) {
      const rowsForIndex = indexRows.filter((row) => row.name === indexName);
      result.indexes[table].push({
        name: indexName,
        unique: rowsForIndex[0].unique,
        partial: rowsForIndex[0].partial,
        columns: rowsForIndex.map((row) => row.column_name),
      });
    }
    result.indexes[table].sort((a, b) => a.name.localeCompare(b.name));
  }
  return result;
}

function assertSchemaBehavior(testCase) {
  assert.equal(scalar(testCase, 'SELECT collapsed_limit AS value FROM tag_display_settings WHERE id = 1;'), 8);
  execute(testCase, "INSERT INTO posts (content, visibility) VALUES ('invalid', 'secret');", false);
  execute(testCase, "INSERT INTO media (type, url) VALUES ('audio', 'invalid');", false);
  execute(testCase, "INSERT INTO tag_categories (name, collapsed_limit) VALUES ('invalid', 3);", false);
  execute(testCase, 'INSERT INTO tag_display_settings (id) VALUES (2);', false);
  assert.deepEqual(resultRows(execute(testCase, 'PRAGMA foreign_key_check;')), []);
}

function createReference() {
  const reference = createCase('schema-reference');
  executeFile(reference, finalSchemaPath);
  assertSchemaBehavior(reference);
  return schemaMetadata(reference);
}

function pathA(referenceMetadata) {
  const testCase = createCase('path-a-empty');
  runGuard(testCase);
  applyMigrations(testCase);
  assert.deepEqual(migrationNames(testCase), [
    '0000_initial_schema.sql',
    '0001_tag_categories_and_page_views.sql',
    '0002_category_collapsed_limit.sql',
    '0003_session_version.sql',
  ]);
  assertNoPending(testCase);
  assert.deepEqual(schemaMetadata(testCase), referenceMetadata);
  assertSchemaBehavior(testCase);
}

function pathB(historicalSchemaPath) {
  const testCase = createCase('path-b-legacy');
  executeFile(testCase, historicalSchemaPath);
  execute(testCase, fixtureSql);
  runGuard(testCase);
  applyMigrations(testCase);
  assertFixturePreserved(testCase);
  assertNoPending(testCase);
}

function pathC(historicalSchemaPath) {
  const testCase = createCase('path-c-partial');
  const partialDir = path.join(testCase.caseDir, 'partial-migrations');
  fs.mkdirSync(partialDir);
  for (const name of ['0001_tag_categories_and_page_views.sql', '0002_category_collapsed_limit.sql']) {
    fs.copyFileSync(path.join(migrationsDir, name), path.join(partialDir, name));
  }
  testCase.configPath = writeConfig(testCase.caseDir, partialDir);
  executeFile(testCase, historicalSchemaPath);
  execute(testCase, fixtureSql);
  applyMigrations(testCase);
  assert.deepEqual(migrationNames(testCase), [
    '0001_tag_categories_and_page_views.sql',
    '0002_category_collapsed_limit.sql',
  ]);

  testCase.configPath = writeConfig(testCase.caseDir, migrationsDir);
  runGuard(testCase);
  applyMigrations(testCase);
  assert.deepEqual(migrationNames(testCase), [
    '0001_tag_categories_and_page_views.sql',
    '0002_category_collapsed_limit.sql',
    '0000_initial_schema.sql',
    '0003_session_version.sql',
  ]);
  assertFixturePreserved(testCase);
  assertNoPending(testCase);
}

function pathD() {
  const testCase = createCase('path-d-complete');
  applyMigrations(testCase);
  execute(testCase, fixtureSql);
  execute(testCase, 'UPDATE tag_display_settings SET collapsed_limit = 10 WHERE id = 1;');
  runGuard(testCase);
  const before = {
    metadata: schemaMetadata(testCase),
    counts: resultRows(execute(testCase, 'SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM posts) AS posts, (SELECT count(*) FROM media) AS media;')),
    migrations: migrationNames(testCase),
  };
  assertNoPending(testCase);
  const after = {
    metadata: schemaMetadata(testCase),
    counts: resultRows(execute(testCase, 'SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM posts) AS posts, (SELECT count(*) FROM media) AS media;')),
    migrations: migrationNames(testCase),
  };
  assert.deepEqual(after, before);
}

function pathE() {
  const testCase = createCase('path-e-final-without-history');
  executeFile(testCase, finalSchemaPath);
  execute(testCase, fixtureSql);
  const result = runGuard(testCase, false);
  assert.match(result.stderr, /structure exists but its migration record is missing/);
  assert.equal(scalar(testCase, "SELECT count(*) AS value FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations';"), 0);
  assert.equal(scalar(testCase, 'SELECT count(*) AS value FROM posts;'), 2);
}

function malformedLegacyRefusal(historicalSchemaPath) {
  const testCase = createCase('malformed-legacy-refusal');
  executeFile(testCase, historicalSchemaPath);
  execute(testCase, 'DROP INDEX idx_media_post_id;');
  const result = runGuard(testCase, false);
  assert.match(result.stderr, /idx_media_post_id does not match/);
  assert.equal(scalar(testCase, "SELECT count(*) AS value FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations';"), 0);
}

let failed = false;
try {
  const history = historicalSchema();
  const referenceMetadata = createReference();
  pathA(referenceMetadata);
  pathB(history);
  pathC(history);
  pathD();
  pathE();
  malformedLegacyRefusal(history);
  console.log('D1 migration tests passed: paths A-D plus path E safe refusal.');
  console.log('Schema metadata, CHECK constraints, defaults, foreign keys, indexes, data preservation, and idempotence passed.');
} catch (error) {
  failed = true;
  console.error(error.stack || error.message);
  const last = diagnostics.at(-1);
  if (last) {
    console.error(`Last command: ${last.command} ${last.args.join(' ')}`);
    if (last.stdout.trim()) console.error(last.stdout.trim());
    if (last.stderr.trim()) console.error(last.stderr.trim());
  }
  process.exitCode = 1;
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  if (failed) console.error('Isolated D1 state was cleaned after emitting non-sensitive diagnostics.');
}
