import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const databasePath = path.resolve('data/legacy-migration.test.sqlite');

afterEach(async () => {
  vi.resetModules();
  delete process.env.DATABASE_PATH;
  for (const suffix of ['', '-shm', '-wal']) {
    let retries = 5;
    while (retries > 0) {
      try {
        fs.rmSync(`${databasePath}${suffix}`, { force: true });
        break;
      } catch (e: any) {
                if (e.code === 'EBUSY' && retries > 1) {
          retries -= 1;
          await new Promise((r) => setTimeout(r, 100));
        } else {
          break;
        }
      }
    }
  }
});

describe('SQLite migrations', () => {
  it('migrates a legacy orders schema idempotently without losing data', async () => {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    const legacy = new Database(databasePath);
    legacy.exec(`
      CREATE TABLE users(id INTEGER PRIMARY KEY, telegram_id TEXT UNIQUE NOT NULL);
      CREATE TABLE products(id TEXT PRIMARY KEY);
      CREATE TABLE license_plans(id TEXT PRIMARY KEY);
      CREATE TABLE orders(
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        product_id TEXT NOT NULL,
        license_id TEXT NOT NULL,
        amount_xtr INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'XTR',
        status TEXT NOT NULL,
        payload TEXT UNIQUE NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO users(id, telegram_id) VALUES(1, '42');
      INSERT INTO products(id) VALUES('product-1');
      INSERT INTO license_plans(id) VALUES('license-1');
      INSERT INTO orders(id, user_id, product_id, license_id, amount_xtr, status, payload)
      VALUES('order-1', 1, 'product-1', 'license-1', 100, 'paid', 'legacy-payload');
    `);
    legacy.close();

    process.env.NODE_ENV = 'test';
    process.env.DB_DRIVER = 'sqlite';
    process.env.DATABASE_PATH = databasePath;
    const { db, migrate } = await import('../server/db');

    await migrate();
    await migrate();

    const columns = await db.prepare('pragma table_info(orders)').all() as Array<{ name: string }>;
    const indexes = await db.prepare("pragma index_list('orders')").all() as Array<{ name: string; unique: number }>;
    const row = await db.prepare('select id, payload, amount_xtr from orders where id=?').get('order-1') as Record<string, unknown>;

    expect(columns.some(({ name }) => name === 'idempotency_key')).toBe(true);
    expect(indexes).toContainEqual(expect.objectContaining({ name: 'idx_orders_user_idempotency', unique: 1 }));
    expect(row).toEqual({ id: 'order-1', payload: 'legacy-payload', amount_xtr: 100 });
    await db.close();
  });
});
