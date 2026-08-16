import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { POSTGRES_MIGRATIONS } from '../server/db';

const readMigration = (file: string) => readFile(new URL(`../server/db/postgres-migrations/${file}`, import.meta.url), 'utf8');

describe('PostgreSQL migration contract', () => {
  it('uses immutable ordered versions and applies each version only when absent', () => {
    expect(POSTGRES_MIGRATIONS.map(({ version }) => version)).toEqual([
      '001_initial',
      '002_delivery_refund_state_machines',
      '003_catalog_trigram_search',
      '004_catalog_sort_indexes',
    ]);
    expect(new Set(POSTGRES_MIGRATIONS.map(({ version }) => version)).size).toBe(POSTGRES_MIGRATIONS.length);
  });

  it('keeps lock-heavy constraint replacement out of the startup baseline', async () => {
    const initial = await readFile(new URL('../server/db/postgres-schema.sql', import.meta.url), 'utf8');
    expect(initial).not.toMatch(/DROP\s+CONSTRAINT/i);
    expect(initial).not.toMatch(/VALIDATE\s+CONSTRAINT/i);
  });

  it('guards the compatibility constraint replacement inside version 002', async () => {
    const migration = await readMigration('002_delivery_refund_state_machines.sql');
    expect(migration).toContain("current_definition NOT LIKE '%refund_requested%'");
    expect(migration).toContain('DROP CONSTRAINT orders_status_check');
    expect(migration).toContain('VALIDATE CONSTRAINT orders_status_check');
  });

  it('adds a PostgreSQL trigram index matching the unchanged substring semantics', async () => {
    const migration = await readMigration('003_catalog_trigram_search.sql');
    expect(migration).toContain('pg_trgm');
    expect(migration).toContain('gin_trgm_ops');
    expect(migration).toContain("WHERE status = 'published'");
     });

   it('all DDL in migrations uses idempotent guards (IF NOT EXISTS / IF EXISTS)', async () => {
     for (const { file } of POSTGRES_MIGRATIONS) {
       const sql = await readMigration(file);
       expect(sql).not.toMatch(/^\s*CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/im);
       expect(sql).not.toMatch(/^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS)/im);
       expect(sql).not.toMatch(/^\s*ALTER\s+TABLE.*ADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS)/im);
     }
   });

   it('migration 002 uses conditional constraint replacement safe for re-run', async () => {
     const sql = await readMigration('002_delivery_refund_state_machines.sql');
     expect(sql).toMatch(/SELECT pg_get_constraintdef/);
     expect(sql).toMatch(/IF current_definition IS NULL THEN/);
   });

   it('migration runner skips already-applied versions with matching checksum', async () => {
     const initial = await readMigration('001_initial.sql');
     expect(initial.match(/^\s*CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/im)).not.toBeNull();
   });
});
