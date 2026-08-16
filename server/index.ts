import 'dotenv/config';
import { createServer } from 'node:http';
import { closeRuntimeResources, createApp } from './app';
import { bootstrapAdmins, closeDb, migrate } from './db';
import { loadConfig } from './config';
import { safeErrorMeta } from './logging';
import { stopTelemetry } from './telemetry';

const config = loadConfig();
let shuttingDown = false;

async function start() {
  const startedAt = Date.now();
  await migrate();
  await bootstrapAdmins();
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', event: 'database_migrations_ready', durationMs: Date.now() - startedAt }));
  const server = createServer(createApp());
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
  console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'fatal', event: 'startup_failed', ...safeErrorMeta(error, config.isProduction) }));
  process.exit(1);
});
