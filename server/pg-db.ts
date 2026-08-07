import { Pool } from 'pg';
import type { AppConfig } from './config';

export type DbStatement = {
  get(...args: unknown[]): Promise<any>;
  all(...args: unknown[]): Promise<any[]>;
  run(...args: unknown[]): Promise<{ changes: number }>;
};

export type DbClient = {
  prepare(sql: string): DbStatement;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

function toPg(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function translateSql(sql: string): string {
  if (/CREATE TABLE/i.test(sql)) return sql;

  // INSERT OR IGNORE → INSERT ... ON CONFLICT DO NOTHING
  if (/INSERT\s+OR\s+IGNORE/i.test(sql)) {
    const base = sql.replace(/INSERT\s+OR\s+IGNORE/i, 'INSERT');
    if (/\breturning\b/i.test(base)) {
      return base.replace(/(\s+returning\b)/i, ' ON CONFLICT DO NOTHING$1');
    }
    return base + ' ON CONFLICT DO NOTHING';
  }

  // INSERT OR REPLACE → INSERT (caller must already have ON CONFLICT clause)
  if (/INSERT\s+OR\s+REPLACE/i.test(sql)) {
    return sql.replace(/INSERT\s+OR\s+REPLACE/i, 'INSERT');
  }

  return sql;
}

export function createPgDb(config: AppConfig): DbClient {
  if (!config.DATABASE_URL) throw new Error('DATABASE_URL required');
  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    ssl: config.DATABASE_SSL === 'true' ? { rejectUnauthorized: config.DATABASE_SSL_REJECT_UNAUTHORIZED === 'true' } : false,
    max: config.DATABASE_POOL_MAX,
    idleTimeoutMillis: 20000,
    connectionTimeoutMillis: 10000,
  });

  let txClient: any = null;
  const executor = () => txClient || pool;

  return {
    prepare(text: string) {
      return {
        async get(...args: unknown[]) {
          const t = translateSql(text);
          const r = await executor().query(toPg(t), args);
          return r.rows[0];
        },
        async all(...args: unknown[]) {
          const t = translateSql(text);
          const r = await executor().query(toPg(t), args);
          return r.rows;
        },
        async run(...args: unknown[]) {
          const t = translateSql(text);
          const r = await executor().query(toPg(t), args);
          return { changes: r.rowCount ?? (Array.isArray(r.rows) ? r.rows.length : 0) };
        },
      };
    },
    async exec(text: string) { const client = executor(); await client.query(toPg(translateSql(text))); },
    async transaction<T>(fn: () => Promise<T>) {
      const client = await pool.connect();
      const prev = txClient;
      txClient = client;
      try {
        await client.query('BEGIN');
        const result = await fn();
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* ignore */ }
        throw error;
      } finally {
        client.release();
        txClient = prev;
      }
    },
    async close() { await pool.end(); },
  };
}

