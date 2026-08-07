import 'dotenv/config';
import { createServer } from 'node:http';
import { closeRuntimeResources, createApp } from './app';
import { closeDb, migrate } from './db';
import { loadConfig } from './config';

const config = loadConfig();
let shuttingDown = false;

async function start() {
  const startedAt = Date.now();
  await migrate();
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', event: 'database_migrations_ready', durationMs: Date.now() - startedAt }));
  const server = createServer(createApp());
  server.on('error', (error) => {
    console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'http_server_error', errorType: error.name, message: error.message, stack: error.stack }));
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
      clearTimeout(forced);
      console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', event: 'shutdown_completed', signal }));
      process.exit(exitCode);
    });
  }

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('uncaughtException', (error) => {
    console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'fatal', event: 'uncaught_exception', errorType: error.name, message: error.message, stack: error.stack }));
    void shutdown('uncaughtException', 1);
  });
  process.on('unhandledRejection', (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'fatal', event: 'unhandled_rejection', errorType: error.name, message: error.message, stack: error.stack }));
    void shutdown('unhandledRejection', 1);
  });
}

start().catch((error) => {
  console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'fatal', event: 'startup_failed', errorType: error?.name, message: error?.message || String(error), stack: error?.stack, sql: error?.sql }));
  process.exit(1);
});
