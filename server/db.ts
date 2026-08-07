import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';
import { loadConfig } from './config';

const config = loadConfig();
const dbPath = config.DATABASE_PATH;
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');

export function migrate() {
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
  scan_findings TEXT,
  quarantine_key TEXT,
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
CREATE INDEX IF NOT EXISTS idx_assets_product_version ON product_assets(product_id,version,status);
  `);

  const cols = db.prepare('PRAGMA table_info(orders)').all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  const add = (name: string, sql: string) => { if (!names.has(name)) db.exec(sql); };
  add('product_title', 'ALTER TABLE orders ADD COLUMN product_title TEXT');
  add('product_version', 'ALTER TABLE orders ADD COLUMN product_version TEXT');
  add('license_name', 'ALTER TABLE orders ADD COLUMN license_name TEXT');
  add('currency', "ALTER TABLE orders ADD COLUMN currency TEXT NOT NULL DEFAULT 'XTR'");
  add('fulfilled_at', 'ALTER TABLE orders ADD COLUMN fulfilled_at TEXT');
  add('refunded_at', 'ALTER TABLE orders ADD COLUMN refunded_at TEXT');
  add('refund_reason', 'ALTER TABLE orders ADD COLUMN refund_reason TEXT');

  const assetCols = db.prepare('PRAGMA table_info(product_assets)').all() as Array<{ name: string }>;
  const assetNames = new Set(assetCols.map((c) => c.name));
  if (!assetNames.has('status')) db.exec("ALTER TABLE product_assets ADD COLUMN status TEXT NOT NULL DEFAULT 'published'");
  if (!assetNames.has('scan_findings')) db.exec('ALTER TABLE product_assets ADD COLUMN scan_findings TEXT');
  if (!assetNames.has('quarantine_key')) db.exec('ALTER TABLE product_assets ADD COLUMN quarantine_key TEXT');

  const deliveryCols = db.prepare('PRAGMA table_info(delivery_events)').all() as Array<{ name: string }>;
  const deliveryNames = new Set(deliveryCols.map((c) => c.name));
  if (deliveryNames.has('token') && !deliveryNames.has('token_hash')) db.exec('ALTER TABLE delivery_events ADD COLUMN token_hash TEXT');
  if (!deliveryNames.has('asset_id')) db.exec('ALTER TABLE delivery_events ADD COLUMN asset_id TEXT');
  if (!deliveryNames.has('status')) db.exec("ALTER TABLE delivery_events ADD COLUMN status TEXT NOT NULL DEFAULT 'issued'");
}

export function closeDb() { db.close(); }
