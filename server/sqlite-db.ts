import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig } from './config';
import type { DbClient, DbStatement } from './pg-db';

class Mutex {
  private tail = Promise.resolve();
  async run<T>(fn: () => Promise<T> | T): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await fn(); } finally { release(); }
  }
}

export function createSqliteDb(config: AppConfig): DbClient {
  const require = createRequire(import.meta.url);
  const Database = require('better-sqlite3') as typeof import('better-sqlite3');
  const dbPath = config.DATABASE_PATH;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  const mutex = new Mutex();
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  function statement(sql: string, locked: boolean): DbStatement {
    const prepared = db.prepare(sql);
    const execute = <T>(fn: () => T) => locked ? Promise.resolve(fn()) : mutex.run(fn);
    return {
      get: (...args: unknown[]) => execute(() => prepared.get(...args)),
      all: (...args: unknown[]) => execute(() => prepared.all(...args) as any[]),
      run: (...args: unknown[]) => execute(() => ({ changes: prepared.run(...args).changes })),
    };
  }

  function scoped(locked: boolean): DbClient {
    return {
      prepare: (sql: string) => statement(sql, locked),
      exec: (sql: string) => locked ? Promise.resolve(db.exec(sql)).then(() => undefined) : mutex.run(() => { db.exec(sql); }),
      async transaction<T>(fn: (tx: DbClient) => Promise<T>) {
        if (locked) throw new Error('nested_transaction_not_supported');
        return mutex.run(async () => {
          db.exec('BEGIN IMMEDIATE');
          try {
            const result = await fn(scoped(true));
            db.exec('COMMIT');
            return result;
          } catch (error) {
            db.exec('ROLLBACK');
            throw error;
          }
        });
      },
      close: () => locked ? Promise.resolve() : mutex.run(() => { db.close(); }),
    };
  }

  return scoped(false);
}
