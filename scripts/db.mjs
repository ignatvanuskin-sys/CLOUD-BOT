import fs from 'node:fs';
import { Client } from 'pg';

const cmd = process.argv[2];
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL required');
  process.exit(1);
}

function sslConfig() {
  if (process.env.DATABASE_SSL !== 'true') return undefined;
  // Railway internal Postgres often uses a self-signed chain. Production external DBs
  // should set DATABASE_SSL_REJECT_UNAUTHORIZED=true.
  return { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'true' };
}

const client = new Client({ connectionString: url, ssl: sslConfig() });

async function tableExists(name) {
  const r = await client.query('select to_regclass($1) as name', [name]);
  return Boolean(r.rows[0]?.name);
}

async function status() {
  const migrationsTable = await tableExists('schema_migrations');
  const migrations = migrationsTable
    ? (await client.query('select version, applied_at from schema_migrations order by version')).rows
    : [];
  const tables = (await client.query(`
    select table_name from information_schema.tables
    where table_schema = 'public'
    order by table_name
  `)).rows.map((r) => r.table_name);
  console.log(JSON.stringify({ ok: true, migrationsTable, migrations, tables }, null, 2));
}

async function migrate() {
  await client.query('select pg_advisory_lock(42424242)');
  try {
    const sql = fs.readFileSync('server/db/postgres-schema.sql', 'utf8');
    await client.query('begin');
    await client.query(sql);
    await client.query("insert into schema_migrations(version) values('001_initial') on conflict do nothing");
    await client.query('commit');
    const count = await client.query('select count(*)::int as n from schema_migrations');
    console.log(JSON.stringify({ ok: true, migrated: '001_initial', migrationCount: count.rows[0].n }, null, 2));
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    console.error('migration_failed', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await client.query('select pg_advisory_unlock(42424242)').catch(() => undefined);
  }
}

async function verifyImport() {
  const required = ['users', 'products', 'license_plans', 'orders', 'entitlements', 'product_assets', 'audit_log', 'webhook_updates'];
  const counts = {};
  for (const table of required) {
    if (!(await tableExists(table))) throw new Error(`missing table ${table}`);
    counts[table] = Number((await client.query(`select count(*)::int as n from ${table}`)).rows[0].n);
  }
  const duplicateCharges = await client.query(`
    select telegram_charge_id, count(*)::int as n from orders
    where telegram_charge_id is not null
    group by telegram_charge_id having count(*) > 1
  `);
  if (duplicateCharges.rows.length) throw new Error('duplicate telegram_charge_id found');
  console.log(JSON.stringify({ ok: true, counts }, null, 2));
}

try {
  await client.connect();
  if (cmd === 'status') await status();
  else if (cmd === 'migrate') await migrate();
  else if (cmd === 'rollback') console.log('No destructive rollback is automated for 001_initial. Restore from backup if needed.');
  else if (cmd === 'backup') console.log('Use provider backup or pg_dump with a secret-managed DATABASE_URL. Do not print credentials.');
  else if (cmd === 'import-sqlite') console.log('Dry-run placeholder: export SQLite tables, verify counts, import through COPY inside transaction. See docs/runbooks/db-migration.md');
  else if (cmd === 'verify-import') await verifyImport();
  else {
    console.error('usage: node scripts/db.mjs status|migrate|rollback|backup|import-sqlite|verify-import');
    process.exit(1);
  }
} finally {
  await client.end().catch(() => undefined);
}
