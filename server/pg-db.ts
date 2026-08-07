import postgres from 'postgres';
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

function escapeValue(value: unknown) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function translateSql(sql: string, args: unknown[]) {
  let index = 0;
  return sql
    .replace(/CURRENT_TIMESTAMP/gi, 'now()')
    .replace(/insert or ignore/gi, 'insert')
    .replace(/insert or replace/gi, 'insert')
    .replace(/\?/g, () => escapeValue(args[index++]));
}

export function createPgDb(config: AppConfig): DbClient {
  if (!config.DATABASE_URL) throw new Error('DATABASE_URL required');
  const sql = postgres(config.DATABASE_URL, {
    ssl: config.DATABASE_SSL === 'true' ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'true' } : false,
    max: config.DATABASE_POOL_MAX,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return {
    prepare(text: string) {
      return {
        async get(...args: unknown[]) { return (await sql.unsafe(translateSql(text, args)))[0]; },
        async all(...args: unknown[]) { return [...await sql.unsafe(translateSql(text, args))]; },
        async run(...args: unknown[]) {
          const rows = await sql.unsafe(translateSql(text, args));
          return { changes: Array.isArray(rows) ? rows.count || rows.length : 0 };
        },
      };
    },
    async exec(text: string) { await sql.unsafe(text); },
    async transaction<T>(fn: () => Promise<T>) { const rows = await sql.begin(async () => [await fn()]); return rows[0] as T; },
    async close() { await sql.end({ timeout: 2 }); },
  };
}
