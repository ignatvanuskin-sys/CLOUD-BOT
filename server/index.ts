import 'dotenv/config';
import { createServer } from 'node:http';
import { createApp } from './app';
import { closeDb } from './db';
import { loadConfig } from './config';

const config = loadConfig();
const server = createServer(createApp());

server.listen(config.PORT, () => console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', event: 'server_started', port: config.PORT })));

function shutdown(signal: string) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', event: 'shutdown', signal }));
  server.close(() => { closeDb(); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
