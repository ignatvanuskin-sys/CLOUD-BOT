import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const SQLITE_TABLES = [
  'users', 'products', 'license_plans', 'orders', 'entitlements', 'product_assets',
  'delivery_events', 'analytics', 'support_requests', 'admin_users', 'audit_log',
  'webhook_updates', 'user_favorites',
];

describe('SQLite/PostgreSQL schema parity', () => {
  it('every table exists in both SQLite DDL and PostgreSQL migrations', async () => {
    const dbSource = await readFile(new URL('../server/db.ts', import.meta.url), 'utf8');
    const sqliteDdl = dbSource.match(/await db\.exec\(`([\s\S]*?)`\)/)?.[1] ?? '';
    let pgSql = '';
    for (const file of ['001_initial.sql', '004_user_favorites.sql']) {
      pgSql += await readFile(new URL(`../server/db/postgres-migrations/${file}`, import.meta.url), 'utf8');
    }
    for (const table of SQLITE_TABLES) {
      expect(sqliteDdl, `SQLite DDL must define table ${table}`).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
      expect(pgSql.toLowerCase(), `PostgreSQL migrations must define table ${table}`).toContain(`create table if not exists ${table.toLowerCase()}`);
    }
  });

  it('critical unique constraints exist in both dialects', async () => {
    const dbSource = await readFile(new URL('../server/db.ts', import.meta.url), 'utf8');
    let pgSql = '';
    for (const file of ['001_initial.sql', '004_user_favorites.sql']) {
      pgSql += await readFile(new URL(`../server/db/postgres-migrations/${file}`, import.meta.url), 'utf8');
    }
    const sqlitePatterns = [
      /payload\s+text\s+unique/i,
      /orders[\s\S]*user_id[\s\S]*idempotency_key/i,
      /unique\s*\(\s*user_id\s*,\s*product_id\s*\)/i,
      /token_hash\s+text\s+unique/i,
    ];
    const postgresPatterns = [
      /payload\s+text\s+unique/i,
      /idx_orders_user_idempotency[\s\S]*orders\s*\(\s*user_id\s*,\s*idempotency_key\s*\)/i,
      /unique\s*\(\s*user_id\s*,\s*product_id\s*\)/i,
      /token_hash\s+text\s+unique/i,
    ];
    for (const pattern of sqlitePatterns) {
      expect(dbSource, `SQLite must match ${pattern}`).toMatch(pattern);
    }
    for (const pattern of postgresPatterns) {
      expect(pgSql, `PostgreSQL must match ${pattern}`).toMatch(pattern);
    }
  });
});
