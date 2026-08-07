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

const postgresKeywords = [
  'CREATE TABLE',
  'CREATE INDEX',
  'INSERT INTO schema_migrations',
  'BEGIN',
  'COMMIT',
  'ROLLBACK',
  'SELECT to_regclass',
  'SELECT pg_advisory_lock',
];

function looksLikeNonParameterized(sql: string) {
  const upper = sql.trim().toUpperCase();
  return !postgresKeywords.some((k) => upper.startsWith(k)) && !/\?/.test(sql);
}

function translateSql(sql: string) {
  let result = sql;
  if (!/CREATE TABLE/i.test(result)) {
    result = result.replace(/INSERT OR IGNORE/i, 'INSERT');
    result = result.replace(/INSERT OR REPLACE/i, 'INSERT');
    result = result.replace(/\)\s*values\s*\(/i, ') ON CONFLICT DO NOTHING VALUES (');
  }
  result = result.replace(/CURRENT_TIMESTAMP/gi, 'CURRENT_TIMESTAMP');
  return result;
}

export function createPgDb(config: AppConfig): DbClient {
  if (!config.DATABASE_URL) throw new Error('DATABASE_URL required');
  const sql = postgres(config.DATABASE_URL, {
    ssl: config.DATABASE_SSL === 'true' ? { rejectUnauthorized: config.DATABASE_SSL_REJECT_UNAUTHORIZED === 'true' } : false,
    max: config.DATABASE_POOL_MAX,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return {
    prepare(text: string) {
      return {
        async get(...args: unknown[]) {
          const t = translateSql(text);
          if (!looksLikeNonParameterized(t)) return (await (sql as any)(t, ...args))[0];
          throw new Error('pg-db: prepare() requires parameterized SQL for runtime queries');
        },
        async all(...args: unknown[]) {
          const t = translateSql(text);
          if (!looksLikeNonParameterized(t)) return [...(await (sql as any)(t, ...args))];
          throw new Error('pg-db: prepare() requires parameterized SQL for runtime queries');
        },
        async run(...args: unknown[]) {
          const t = translateSql(text);
          if (!looksLikeNonParameterized(t)) {
            const rows = await (sql as any)(t, ...args);
            return { changes: typeof rows.count === 'number' ? rows.count : (Array.isArray(rows) ? rows.length : 0) };
          }
          throw new Error('pg-db: prepare() requires parameterized SQL for runtime queries');
        },
      };
    },
    async exec(text: string) { await (sql as any)(translateSql(text)); },
    async transaction<T>(fn: () => Promise<T>) { return sql.begin(async () => await fn()) as any as Promise<T>; },
    async close() { await sql.end({ timeout: 2 }); },
  };
}
