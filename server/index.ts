import 'dotenv/config';
import { createServer } from 'node:http';
import { closeRuntimeResources, createApp } from './app';
import { bootstrapAdmins, closeDb, migrate } from './db';
import { seedDevelopmentFixtures } from './seed';
import { loadConfig } from './config';
import { safeErrorMeta } from './logging';
import { stopTelemetry } from './telemetry';

const config = loadConfig();
let shuttingDown = false;

async function start() {
  const startedAt = Date.now();
  const log = (event: string, meta: Record<string, unknown> = {}) => console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', event, ...meta }));
  log('startup_begin', { node: process.version, pid: process.pid, port: config.PORT, nodeEnv: config.NODE_ENV, dbDriver: config.DB_DRIVER, botConfigured: Boolean(config.BOT_TOKEN) });
  log('migrate_started');
  await migrate();
  log('migrate_done', { durationMs: Date.now() - startedAt });
  if (!config.isProduction && config.NODE_ENV === 'development' && process.env.SEED_DEV_DATA !== 'false') await seedDevelopmentFixtures({ migrateFirst: false });
  else await bootstrapAdmins();
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', event: 'database_migrations_ready', durationMs: Date.now() - startedAt }));
  const server = createServer(createApp());
  log('create_app_done');
  server.on('error', (error) => {
    console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'http_server_error', ...safeErrorMeta(error, config.isProduction) }));
  });
  server.listen(config.PORT, () => console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', event: 'server_started', port: config.PORT })));

  async function shutdown(signal: string, exitCode = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', event: 'shutdown_started', signal }));
    const forced = setTimeout(() => {
      console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'shutdown_forced', signal }));
      process.exit(1);
    }, 10_000);
    forced.unref();
    server.close(async () => {
      await closeRuntimeResources();
      await closeDb();
      await stopTelemetry();
      clearTimeout(forced);
      console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', event: 'shutdown_completed', signal }));
      process.exit(exitCode);
    });
  }

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('uncaughtException', (error) => {
    console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'fatal', event: 'uncaught_exception', ...safeErrorMeta(error, config.isProduction) }));
    void shutdown('uncaughtException', 1);
  });
  process.on('unhandledRejection', (reason) => {
    console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'fatal', event: 'unhandled_rejection', ...safeErrorMeta(reason, config.isProduction) }));
    void shutdown('unhandledRejection', 1);
  });
}

start().catch((error) => {
  // Startup failures are ops-critical: always surface message/stack even in production,
  // so a broken deploy is diagnosable from Railway logs. Per-request error handling keeps its redaction.
  const value = error instanceof Error ? error : new Error(String(error));
  console.error(JSON.stringify({
    ts: new Date().toISOString(),
    level: 'fatal',
    event: 'startup_failed',
    ...safeErrorMeta(error, config.isProduction),
    message: value.message,
    stack: value.stack,
    sql: (value as Error & { sql?: string }).sql,
    cause: value.cause instanceof Error ? value.cause.message : value.cause == null ? undefined : String(value.cause),
  }));
  process.exit(1);
});
