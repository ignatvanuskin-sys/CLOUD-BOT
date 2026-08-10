import { loadConfig } from './config';
import { createPgDb, type DbClient } from './pg-db';
import { createSqliteDb } from './sqlite-db';

const config = loadConfig();
export const db: DbClient = config.DB_DRIVER === 'postgres' ? createPgDb(config) : createSqliteDb(config);

export const POSTGRES_MIGRATIONS = [
  { version: '001_initial', file: '001_initial.sql' },
  { version: '002_delivery_refund_state_machines', file: '002_delivery_refund_state_machines.sql' },
  { version: '003_catalog_trigram_search', file: '003_catalog_trigram_search.sql' },
] as const;

export async function migrate() {
  if (config.DB_DRIVER === 'postgres') {
    const { createHash } = await import('node:crypto');
    const { readFile } = await import('node:fs/promises');
    await db.transaction(async (tx) => {
      await tx.exec('select pg_advisory_xact_lock(42424242)');
      await tx.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version text primary key, checksum text, applied_at timestamptz not null default now())');
      await tx.exec('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text');
      for (const migration of POSTGRES_MIGRATIONS) {
        const sql = await readFile(new URL(`./db/postgres-migrations/${migration.file}`, import.meta.url), 'utf8');
        const checksum = createHash('sha256').update(sql).digest('hex');
        const applied = await tx.prepare('select checksum from schema_migrations where version=?').get(migration.version) as { checksum?: string | null } | undefined;
        if (applied) {
          if (applied.checksum && applied.checksum !== checksum) throw new Error(`migration_checksum_mismatch:${migration.version}`);
          if (!applied.checksum) await tx.prepare('update schema_migrations set checksum=? where version=? and checksum is null').run(checksum, migration.version);
          continue;
        }
        await tx.exec(sql);
        await tx.prepare('insert into schema_migrations(version,checksum) values(?,?)').run(migration.version, checksum);
      }
    });
    return;
  }
  await db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, telegram_id TEXT UNIQUE NOT NULL, name TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, type TEXT NOT NULL CHECK(type IN ('template','ready_bot','module','service')), category TEXT NOT NULL, title TEXT NOT NULL, result TEXT NOT NULL, description TEXT, stack TEXT, demo_url TEXT, preview TEXT, version TEXT NOT NULL DEFAULT '1.0.0', changelog TEXT, status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('draft','published','archived')), created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS license_plans(id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), name TEXT NOT NULL, price_xtr INTEGER NOT NULL CHECK(price_xtr > 0), projects INTEGER NOT NULL DEFAULT 1, commercial INTEGER NOT NULL DEFAULT 0, support_days INTEGER NOT NULL DEFAULT 0, updates_days INTEGER NOT NULL DEFAULT 0, terms TEXT);
CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), product_id TEXT NOT NULL REFERENCES products(id), license_id TEXT NOT NULL REFERENCES license_plans(id), product_title TEXT, product_version TEXT, license_name TEXT, amount_xtr INTEGER NOT NULL CHECK(amount_xtr > 0), currency TEXT NOT NULL DEFAULT 'XTR', status TEXT NOT NULL CHECK(status IN ('pending','paid','fulfilled','expired','cancelled','delivery_failed','refund_pending','refund_requested','refund_manual_review','refunded')), invoice_link TEXT, payload TEXT UNIQUE NOT NULL, idempotency_key TEXT, telegram_charge_id TEXT UNIQUE, refund_reason TEXT, refund_requested_at TEXT, refund_attempted_at TEXT, refund_external_confirmed_at TEXT, refund_last_error TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, paid_at TEXT, fulfilled_at TEXT, refunded_at TEXT);
CREATE TABLE IF NOT EXISTS entitlements(id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), product_id TEXT NOT NULL REFERENCES products(id), license_id TEXT NOT NULL REFERENCES license_plans(id), order_id TEXT UNIQUE NOT NULL REFERENCES orders(id), active INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP, revoked_at TEXT);
CREATE TABLE IF NOT EXISTS product_assets(id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), version TEXT NOT NULL, storage_key TEXT NOT NULL, file_name TEXT NOT NULL, mime_type TEXT NOT NULL DEFAULT 'application/zip', size_bytes INTEGER NOT NULL DEFAULT 0, checksum_sha256 TEXT, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','scanning','approved','rejected','published','deleted')), scan_findings TEXT, quarantine_key TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS delivery_events(id TEXT PRIMARY KEY, entitlement_id TEXT NOT NULL REFERENCES entitlements(id), asset_id TEXT REFERENCES product_assets(id), token_hash TEXT UNIQUE NOT NULL, expires_at INTEGER NOT NULL, used_at TEXT, status TEXT NOT NULL DEFAULT 'issued', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS analytics(id INTEGER PRIMARY KEY, user_id INTEGER, event TEXT, product_id TEXT, meta TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS support_requests(id TEXT PRIMARY KEY, user_id INTEGER, message TEXT, status TEXT DEFAULT 'open', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS admin_users(telegram_id TEXT PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('owner','editor','support')));
CREATE TABLE IF NOT EXISTS audit_log(id TEXT PRIMARY KEY, actor_user_id INTEGER, action TEXT NOT NULL, object_type TEXT, object_id TEXT, result TEXT, meta TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS webhook_updates(update_id TEXT PRIMARY KEY, processed_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_orders_user_status ON orders(user_id,status);
CREATE INDEX IF NOT EXISTS idx_orders_payload ON orders(payload);
CREATE INDEX IF NOT EXISTS idx_entitlements_owner ON entitlements(user_id,active);
CREATE INDEX IF NOT EXISTS idx_assets_product_version ON product_assets(product_id,version);
`);
  const orderColumns = await db.prepare('pragma table_info(orders)').all() as Array<{ name: string }>;
  const deliveryColumns = await db.prepare('pragma table_info(delivery_events)').all() as Array<{ name: string }>;
  const addColumn = async (table: string, columns: Array<{ name: string }>, name: string, definition: string) => {
    if (!columns.some((column) => column.name === name)) await db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  };
  await addColumn('orders', orderColumns, 'idempotency_key', 'TEXT');
  await addColumn('orders', orderColumns, 'refund_requested_at', 'TEXT');
  await addColumn('orders', orderColumns, 'refund_attempted_at', 'TEXT');
  await addColumn('orders', orderColumns, 'refund_external_confirmed_at', 'TEXT');
  await addColumn('orders', orderColumns, 'refund_last_error', 'TEXT');
  await addColumn('delivery_events', deliveryColumns, 'claimed_at', 'TEXT');
  await addColumn('delivery_events', deliveryColumns, 'last_error', 'TEXT');
  await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_user_idempotency ON orders(user_id,idempotency_key) WHERE idempotency_key IS NOT NULL');
}

export async function bootstrapAdmins(rawIds = config.ADMIN_TELEGRAM_IDS) {
  const ids = [...new Set(rawIds.split(',').map((id) => id.trim()).filter((id) => /^\d+$/.test(id)))];
  for (const id of ids) await db.prepare('insert into admin_users(telegram_id,role) values(?,?) on conflict(telegram_id) do nothing').run(id, 'owner');
}

export async function closeDb() { await db.close(); }
