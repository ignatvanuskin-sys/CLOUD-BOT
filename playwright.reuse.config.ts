import { defineConfig } from '@playwright/test';

const testEnv = { ...process.env, NODE_ENV: 'development', ALLOW_DEV_LOGIN: 'true', SEED_DEV_DATA: 'true', DB_DRIVER: 'sqlite', STORAGE_DRIVER: 'local', DATABASE_PATH: './data/e2e.sqlite', STORAGE_LOCAL_ROOT: './storage/e2e', ADMIN_TELEGRAM_IDS: '777' };

export default defineConfig({
  testDir: './tests/e2e',
  webServer: [
    { command: 'npm run dev', port: 5173, reuseExistingServer: true, env: testEnv },
    { command: 'npm run server', port: 8787, reuseExistingServer: true, env: testEnv },
  ],
  use: { baseURL: 'http://127.0.0.1:5173', viewport: { width: 390, height: 844 } },
});
