import { Pool, type PoolClient, type QueryResult } from 'pg';
import type { AppConfig } from './config';

export type DbRunResult = { changes: number };
export type DbStatement = {
  get(...args: unknown[]): Promise<any>;
  all(...args: unknown[]): Promise<any[]>;
  run(...args: unknown[]): Promise<DbRunResult>;
};

export type DbClient = {
  prepare(sql: string): DbStatement;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

function toPg(sql: string): string {
  let index = 0;
  let quote: "'" | '"' | null = null;
  let output = '';
  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    if (quote) {
      output += char;
      if (char === quote) {
        if (sql[i + 1] === quote) output += sql[++i];
        else quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      output += char;
    } else if (char === '?') {
      output += `$${++index}`;
    } else {
      output += char;
    }
  }
  return output;
}

function withSqlContext(error: unknown, sql: string): never {
  const wrapped = error instanceof Error ? error : new Error(String(error));
  Object.defineProperty(wrapped, 'sql', { value: sql, enumerable: false, configurable: true });
  throw wrapped;
}

function clientFor(executor: Pool | PoolClient, close: () => Promise<void>): DbClient {
  async function query(text: string, args: unknown[] = []): Promise<QueryResult> {
    const sql = toPg(text);
    try {
      return await executor.query(sql, args);
    } catch (error) {
      return withSqlContext(error, sql);
    }
  }

  return {
    prepare(text: string) {
      return {
        async get(...args: unknown[]) { return (await query(text, args)).rows[0]; },
        async all(...args: unknown[]) { return (await query(text, args)).rows; },
        async run(...args: unknown[]) {
          const result = await query(text, args);
          return { changes: result.rowCount ?? 0 };
        },
      };
    },
    async exec(text: string) { await query(text); },
    async transaction<T>(fn: (tx: DbClient) => Promise<T>) {
      if (!('connect' in executor)) throw new Error('nested_transaction_not_supported');
      const connection: PoolClient = await (executor as Pool).connect();
      const tx = clientFor(connection, async () => undefined);
      try {
        await connection.query('BEGIN');
        const result = await fn(tx);
        await connection.query('COMMIT');
        return result;
      } catch (error) {
        try { await connection.query('ROLLBACK'); } catch { /* original error wins */ }
        throw error;
      } finally {
        connection.release();
      }
    },
    close,
  };
}

export function createPgDb(config: AppConfig): DbClient {
  if (!config.DATABASE_URL) throw new Error('DATABASE_URL required');
  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    ssl: config.DATABASE_SSL === 'true' ? { rejectUnauthorized: config.DATABASE_SSL_REJECT_UNAUTHORIZED === 'true' } : false,
    max: config.DATABASE_POOL_MAX,
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on('error', (error) => {
    console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'postgres_pool_error', errorType: error.name, message: error.message, stack: error.stack }));
  });
  return clientFor(pool, () => pool.end());
}
