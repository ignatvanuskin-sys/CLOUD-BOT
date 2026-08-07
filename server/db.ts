import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';
import { createRequire } from 'node:module';
import { loadConfig } from './config';

const config = loadConfig();
const require = createRequire(import.meta.url);

export type DbAdapter = {
  prepare(sql: string): { get(...args: any[]): any; all(...args: any[]): any[]; run(...args: any[]): { changes: number } };
  exec(sql: string): void;
  transaction<T extends (...args: any[]) => any>(fn: T): T;
  close(): void;
};

let sqlite: Database.Database;

function createSqliteDb(): DbAdapter {
  const dbPath = config.DATABASE_PATH;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');
  return sqlite as unknown as DbAdapter;
}

function inlineSql(sql: string, args: any[]) {
  let i = 0;
  return sql
    .replace(/CURRENT_TIMESTAMP/gi, 'now()')
    .replace(/INTEGER PRIMARY KEY/gi, 'bigserial primary key')
    .replace(/AUTOINCREMENT/gi, '')
    .replace(/insert or ignore/gi, 'insert')
    .replace(/insert or replace/gi, 'insert')
    .replace(/\?/g, () => {
      const v = args[i++];
      if (v === null || v === undefined) return 'null';
      if (typeof v === 'number') return String(v);
      if (typeof v === 'boolean') return v ? 'true' : 'false';
      return `'${String(v).replace(/'/g, "''")}'`;
    });
}

class PgStatement {
  constructor(private sql: any, private text: string) {}
  private query(args: any[]) { return this.sql.unsafe(inlineSql(this.text, args)); }
  get(...args: any[]) { return this.query(args)[0]; }
  all(...args: any[]) { return [...this.query(args)]; }
  run(...args: any[]) { const rows = this.query(args); return { changes: Array.isArray(rows) ? rows.length : 0 }; }
}

function createPostgresDb(): DbAdapter {
  if (!config.DATABASE_URL) throw new Error('DATABASE_URL required');
  const postgres = require('postgres');
  const sql = postgres(config.DATABASE_URL, { ssl: config.DATABASE_SSL === 'true' ? 'require' : false, max: config.DATABASE_POOL_MAX });
  return {
    prepare(text: string) { return new PgStatement(sql, text); },
    exec(text: string) { sql.unsafe(text); },
    transaction<T extends (...args: any[]) => any>(fn: T): T { return ((...args: any[]) => sql.begin(() => [fn(...args)])) as T; },
    close() { sql.end({ timeout: 1 }); },
  };
}

export const db: DbAdapter = config.DB_DRIVER === 'postgres' ? createPostgresDb() : createSqliteDb();

export function migrate() {
  if (config.DB_DRIVER === 'postgres') return;
  db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY,
  telegram_id TEXT UNIQUE NOT NULL,
  name TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS products(
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('template','ready_bot','module','service')),
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  result TEXT NOT NULL,
  description TEXT,
  stack TEXT,
  demo_url TEXT,
  preview TEXT,
  version TEXT NOT NULL DEFAULT '1.0.0',
  changelog TEXT,
  status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('draft','published','archived')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS license_plans(
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  name TEXT NOT NULL,
  price_xtr INTEGER NOT NULL CHECK(price_xtr > 0),
  projects INTEGER NOT NULL DEFAULT 1,
  commercial INTEGER NOT NULL DEFAULT 0,
  support_days INTEGER NOT NULL DEFAULT 0,
  updates_days INTEGER NOT NULL DEFAULT 0,
  terms TEXT
);
CREATE TABLE IF NOT EXISTS orders(
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  license_id TEXT NOT NULL REFERENCES license_plans(id),
  product_title TEXT,
  product_version TEXT,
  license_name TEXT,
  amount_xtr INTEGER NOT NULL CHECK(amount_xtr > 0),
  currency TEXT NOT NULL DEFAULT 'XTR',
  status TEXT NOT NULL CHECK(status IN ('pending','paid','fulfilled','expired','cancelled','delivery_failed','refund_pending','refunded')),
  invoice_link TEXT,
  payload TEXT UNIQUE NOT NULL,
  telegram_charge_id TEXT UNIQUE,
  refund_reason TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  paid_at TEXT,
  fulfilled_at TEXT,
  refunded_at TEXT
);
CREATE TABLE IF NOT EXISTS entitlements(
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  license_id TEXT NOT NULL REFERENCES license_plans(id),
  order_id TEXT UNIQUE NOT NULL REFERENCES orders(id),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS product_assets(
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  version TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/zip',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  checksum_sha256 TEXT,
  status TEXT NOT NULL DEFAULT 'published',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS delivery_events(
  id TEXT PRIMARY KEY,
  entitlement_id TEXT NOT NULL REFERENCES entitlements(id),
  asset_id TEXT REFERENCES product_assets(id),
  token_hash TEXT UNIQUE NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at TEXT,
  status TEXT NOT NULL DEFAULT 'issued',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
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
}

export function closeDb() { db.close(); }
