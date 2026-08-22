import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/test-results/**',
      '**/generated/**',
      '**/artifacts/**',
      '**/.tmp-security/**',
      '**/2026-08-18/**',
      'tests/e2e/**',
    ],
  },
});
