import fs from 'node:fs';
import crypto from 'node:crypto';
import { Client } from 'pg';

const migrations = [
  ['001_initial', '001_initial.sql'],
  ['002_delivery_refund_state_machines', '002_delivery_refund_state_machines.sql'],
  ['003_catalog_trigram_search', '003_catalog_trigram_search.sql'],
];

const cmd = process.argv[2];
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL required');
  process.exit(1);
}

function sslConfig() {
  if (process.env.DATABASE_SSL !== 'true') return undefined;
  // Certificate validation is secure by default. Development environments using a
  // self-signed chain may explicitly opt out with DATABASE_SSL_REJECT_UNAUTHORIZED=false.
  return { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' };
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
  try {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(42424242)');
    await client.query('create table if not exists schema_migrations(version text primary key, checksum text, applied_at timestamptz not null default now())');
    await client.query('alter table schema_migrations add column if not exists checksum text');
    const appliedNow = [];
    for (const [version, file] of migrations) {
      const sql = fs.readFileSync(`server/db/postgres-migrations/${file}`, 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      const applied = await client.query('select checksum from schema_migrations where version=$1', [version]);
      if (applied.rowCount) {
        const existing = applied.rows[0].checksum;
        if (existing && existing !== checksum) throw new Error(`migration_checksum_mismatch:${version}`);
        if (!existing) await client.query('update schema_migrations set checksum=$1 where version=$2 and checksum is null', [checksum, version]);
        continue;
      }
      await client.query(sql);
      await client.query('insert into schema_migrations(version,checksum) values($1,$2)', [version, checksum]);
      appliedNow.push(version);
    }
    await client.query('commit');
    const count = await client.query('select count(*)::int as n from schema_migrations');
    console.log(JSON.stringify({ ok: true, applied: appliedNow, migrationCount: count.rows[0].n }, null, 2));
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    console.error('migration_failed', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
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

  else if (cmd === 'verify-import') await verifyImport();
  else {
    console.error('usage: node scripts/db.mjs status|migrate|rollback|backup|verify-import');
    process.exit(1);
  }
} finally {
  await client.end().catch(() => undefined);
}
