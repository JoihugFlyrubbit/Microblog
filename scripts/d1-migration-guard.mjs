#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_TABLES = [
  'users',
  'posts',
  'appends',
  'media',
  'media_deletion_queue',
  'tags',
  'post_tags',
  'login_logs',
];

const EXPECTED_MIGRATIONS = [
  '0000_initial_schema.sql',
  '0001_tag_categories_and_page_views.sql',
  '0002_category_collapsed_limit.sql',
  '0003_session_version.sql',
];

const SCHEMA_SQL = `
SELECT 'table' AS kind, name AS owner, name AS value
FROM sqlite_master
WHERE type = 'table';
SELECT 'index' AS kind, tbl_name AS owner, name AS value
FROM sqlite_master
WHERE type = 'index';
SELECT 'users_column' AS kind, 'users' AS owner, name AS value
FROM pragma_table_info('users');
SELECT 'tags_column' AS kind, 'tags' AS owner, name AS value
FROM pragma_table_info('tags');
SELECT 'tag_categories_column' AS kind, 'tag_categories' AS owner, name AS value
FROM pragma_table_info('tag_categories');
SELECT id, collapsed_limit
FROM tag_display_settings
WHERE id = 1;
WITH expected(owner) AS (VALUES
  ('users'), ('posts'), ('appends'), ('media'), ('media_deletion_queue'),
  ('tags'), ('post_tags'), ('login_logs'), ('tag_categories'),
  ('tag_display_settings'), ('page_view_daily')
)
SELECT expected.owner, info.cid, info.name
FROM expected, pragma_table_info(expected.owner) AS info
ORDER BY expected.owner, info.cid;
SELECT m.name, ii.seqno, ii.name AS column_name
FROM sqlite_master AS m
JOIN pragma_index_info(m.name) AS ii
WHERE m.type = 'index' AND m.name NOT LIKE 'sqlite_autoindex_%'
ORDER BY m.name, ii.seqno;
WITH expected(owner) AS (VALUES
  ('users'), ('posts'), ('appends'), ('media'), ('media_deletion_queue'),
  ('tags'), ('post_tags'), ('login_logs'), ('tag_categories'),
  ('tag_display_settings'), ('page_view_daily')
)
SELECT expected.owner, fk.\"table\" AS target, fk.\"from\", fk.\"to\", fk.on_delete
FROM expected, pragma_foreign_key_list(expected.owner) AS fk
ORDER BY expected.owner, fk.\"from\", fk.\"table\";
`;

function parseWranglerJson(stdout) {
  const trimmed = stdout.trim();
  const start = trimmed.indexOf('[');
  if (start === -1) throw new Error('Wrangler did not return JSON results');
  return JSON.parse(trimmed.slice(start));
}

function executeJson({ wranglerPath, cwd, binding, wranglerArgs, sql }) {
  const result = spawnSync(wranglerPath, [
    'd1',
    'execute',
    binding,
    ...wranglerArgs,
    '--command',
    sql,
    '--json',
  ], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      WRANGLER_LOG_PATH: process.env.WRANGLER_LOG_PATH || path.join('/private/tmp', 'microblog-d1-migration-guard.log'),
      WRANGLER_LOG_SANITIZE: 'true',
    },
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    throw new Error(`read-only D1 inspection failed${detail ? `: ${detail}` : ''}`);
  }
  return parseWranglerJson(result.stdout);
}

function rows(result, index) {
  return result[index]?.results ?? [];
}

export function validateMigrationState({ schemaResult, migrationNames }) {
  const failures = [];
  const tables = new Set(rows(schemaResult, 0).map((row) => row.value));
  const indexes = new Set(rows(schemaResult, 1).map((row) => row.value));
  const usersColumns = new Set(rows(schemaResult, 2).map((row) => row.value));
  const tagsColumns = new Set(rows(schemaResult, 3).map((row) => row.value));
  const categoryColumns = new Set(rows(schemaResult, 4).map((row) => row.value));
  const settingsRows = rows(schemaResult, 5);
  const allColumns = rows(schemaResult, 6);
  const allIndexColumns = rows(schemaResult, 7);
  const allForeignKeys = rows(schemaResult, 8);
  const history = new Set(migrationNames);

  const baseCount = BASE_TABLES.filter((table) => tables.has(table)).length;
  if (baseCount !== 0 && baseCount !== BASE_TABLES.length) {
    failures.push('base schema is incomplete; refusing to infer or rebuild missing application tables');
  }

  const phase1Parts = [
    tables.has('tag_categories'),
    tables.has('tag_display_settings'),
    tables.has('page_view_daily'),
    tagsColumns.has('category_id'),
    indexes.has('idx_tag_categories_sort_order'),
    indexes.has('idx_tags_category_id'),
    settingsRows.length === 1
      && settingsRows[0].id === 1
      && settingsRows[0].collapsed_limit >= 4
      && settingsRows[0].collapsed_limit <= 20,
  ];
  const phase1Count = phase1Parts.filter(Boolean).length;
  const phase1Present = phase1Count === phase1Parts.length;
  const phase2Present = categoryColumns.has('collapsed_limit');
  const phase3Present = usersColumns.has('session_version');
  const phases = [
    {
      name: '0001_tag_categories_and_page_views.sql',
      present: phase1Present,
      partial: phase1Count > 0 && phase1Count < phase1Parts.length,
    },
    {
      name: '0002_category_collapsed_limit.sql',
      present: phase2Present,
      partial: false,
    },
    {
      name: '0003_session_version.sql',
      present: phase3Present,
      partial: false,
    },
  ];

  if (phase1Count > 0 && baseCount !== BASE_TABLES.length) {
    failures.push('incremental schema exists without the complete base schema');
  }

  if (baseCount === BASE_TABLES.length) {
    const expectedColumns = {
      users: ['id', 'username', 'password_hash', 'nickname', 'bio', 'email', 'wechat', 'avatar_url', 'header_url', 'created_at', 'updated_at', ...(phase3Present ? ['session_version'] : [])],
      posts: ['id', 'content', 'visibility', 'pinned', 'created_at', 'updated_at'],
      appends: ['id', 'post_id', 'content', 'created_at'],
      media: ['id', 'post_id', 'type', 'url', 'size', 'width', 'height', 'duration', 'created_at'],
      media_deletion_queue: ['r2_key', 'queued_at', 'deleted_at'],
      tags: ['id', 'name', 'created_at', ...(phase1Present ? ['category_id'] : [])],
      post_tags: ['post_id', 'tag_id', 'created_at'],
      login_logs: ['id', 'ip', 'user_agent', 'success', 'created_at'],
    };
    if (phase1Present) {
      expectedColumns.tag_categories = ['id', 'name', 'sort_order', 'created_at', 'updated_at', ...(phase2Present ? ['collapsed_limit'] : [])];
      expectedColumns.tag_display_settings = ['id', 'collapsed_limit', 'updated_at'];
      expectedColumns.page_view_daily = ['view_date', 'views', 'updated_at'];
    }
    for (const [table, expected] of Object.entries(expectedColumns)) {
      const actual = allColumns.filter((row) => row.owner === table).map((row) => row.name);
      if (actual.join(',') !== expected.join(',')) failures.push(`${table} columns do not match a reviewed migration state`);
    }

    const expectedIndexes = {
      idx_appends_post_id: ['post_id'],
      idx_appends_created_at: ['created_at'],
      idx_media_post_id: ['post_id'],
      idx_tags_name: ['name'],
      idx_post_tags_tag_id: ['tag_id'],
      idx_post_tags_post_id: ['post_id'],
      idx_login_logs_created_at: ['created_at'],
      idx_posts_created_at_visibility: ['created_at', 'visibility'],
      idx_posts_visibility_created_at: ['visibility', 'created_at'],
      idx_posts_pinned_visibility_created_at: ['pinned', 'visibility', 'created_at'],
      ...(phase1Present ? {
        idx_tag_categories_sort_order: ['sort_order'],
        idx_tags_category_id: ['category_id'],
      } : {}),
    };
    for (const [name, expected] of Object.entries(expectedIndexes)) {
      const actual = allIndexColumns.filter((row) => row.name === name).map((row) => row.column_name);
      if (actual.join(',') !== expected.join(',')) failures.push(`${name} does not match the reviewed migration state`);
    }

    const actualForeignKeys = allForeignKeys.map((row) => `${row.owner}.${row.from}->${row.target}.${row.to}:${row.on_delete}`).sort();
    const expectedForeignKeys = [
      'appends.post_id->posts.id:CASCADE',
      'media.post_id->posts.id:CASCADE',
      'post_tags.post_id->posts.id:CASCADE',
      'post_tags.tag_id->tags.id:CASCADE',
      ...(phase1Present ? ['tags.category_id->tag_categories.id:SET NULL'] : []),
    ].sort();
    if (actualForeignKeys.join(',') !== expectedForeignKeys.join(',')) {
      failures.push('foreign keys do not match a reviewed migration state');
    }
  }
  for (const phase of phases) {
    if (phase.partial) failures.push(`${phase.name} schema is only partially present`);
    if (phase.present && !history.has(phase.name)) {
      failures.push(`${phase.name} structure exists but its migration record is missing`);
    }
    if (!phase.present && history.has(phase.name)) {
      failures.push(`${phase.name} is recorded but its required structure is missing`);
    }
  }

  const unknown = migrationNames.filter((name) => !EXPECTED_MIGRATIONS.includes(name));
  if (unknown.length) failures.push('migration history contains names not present in the reviewed migration chain');
  if (history.has('0000_initial_schema.sql') && baseCount !== BASE_TABLES.length) {
    failures.push('0000_initial_schema.sql is recorded but the base schema is incomplete');
  }

  return [...new Set(failures)];
}

export function inspectMigrationState({ wranglerPath, cwd, binding, wranglerArgs }) {
  const locationFlags = wranglerArgs.filter((arg) => arg === '--local' || arg === '--remote');
  if (locationFlags.length !== 1) throw new Error('exactly one of --local or --remote is required');

  const initial = executeJson({
    wranglerPath,
    cwd,
    binding,
    wranglerArgs,
    sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tag_display_settings';",
  });
  const hasSettings = rows(initial, 0).length === 1;
  const schemaSql = hasSettings
    ? SCHEMA_SQL
    : SCHEMA_SQL.replace("SELECT id, collapsed_limit\nFROM tag_display_settings\nWHERE id = 1;", "SELECT NULL AS id, NULL AS collapsed_limit WHERE 0;");
  const schemaResult = executeJson({ wranglerPath, cwd, binding, wranglerArgs, sql: schemaSql });
  const tables = new Set(rows(schemaResult, 0).map((row) => row.value));
  let migrationNames = [];
  if (tables.has('d1_migrations')) {
    const historyResult = executeJson({
      wranglerPath,
      cwd,
      binding,
      wranglerArgs,
      sql: 'SELECT name FROM d1_migrations ORDER BY id;',
    });
    migrationNames = rows(historyResult, 0).map((row) => row.name);
  }
  return {
    failures: validateMigrationState({ schemaResult, migrationNames }),
    migrationNames,
  };
}

function parseArgs(argv) {
  if (!argv.length || argv[0].startsWith('-')) {
    throw new Error('usage: d1-migration-guard.mjs <binding> (--local|--remote) [Wrangler options]');
  }
  return { binding: argv[0], wranglerArgs: argv.slice(1) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const apiRoot = path.join(repoRoot, 'api');
  const wranglerPath = path.join(apiRoot, 'node_modules', '.bin', 'wrangler');
  try {
    const { binding, wranglerArgs } = parseArgs(process.argv.slice(2));
    const result = inspectMigrationState({ wranglerPath, cwd: apiRoot, binding, wranglerArgs });
    if (result.failures.length) {
      console.error('D1 migration guard refused to continue:');
      for (const failure of result.failures) console.error(` - ${failure}`);
      console.error('Stop and use the documented, reviewed migration-history adoption procedure.');
      process.exitCode = 1;
    } else {
      console.log(`D1 migration guard passed (${result.migrationNames.length} recorded migration(s)).`);
    }
  } catch (error) {
    console.error(`D1 migration guard failed: ${error.message}`);
    process.exitCode = 1;
  }
}
