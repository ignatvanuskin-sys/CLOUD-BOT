import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig } from './config';
import type { DbClient } from './pg-db';

export function createSqliteDb(config: AppConfig): DbClient {
  const dbPath = config.DATABASE_PATH;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  return {
    prepare(sql: string) { return db.prepare(sql) as unknown as ReturnType<DbClient['prepare']>; },
    async exec(sql: string) { db.exec(sql); },
    async transaction<T>(fn: () => Promise<T>) {
      db.exec('begin immediate');
      try {
        const result = await fn();
        db.exec('commit');
        return result;
      } catch (error) {
        db.exec('rollback');
        throw error;
      }
    },
    async close() { db.close(); },
  };
}
