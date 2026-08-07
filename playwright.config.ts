import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/e2e', webServer: [{ command: 'ALLOW_DEV_LOGIN=true npm run dev', port: 5173, reuseExistingServer: true }, { command: 'ALLOW_DEV_LOGIN=true npm run server', port: 8787, reuseExistingServer: true }], use: { baseURL: 'http://127.0.0.1:5173', viewport: { width: 390, height: 844 } } });
