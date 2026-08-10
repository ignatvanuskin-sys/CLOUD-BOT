import js from '@eslint/js';
import tseslint from 'typescript-eslint';
export default [
  { ignores: ['dist/**','node_modules/**','data/**','storage/**','coverage/**','trace-inspect/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['src/**/*.{ts,tsx}'], languageOptions: { globals: { window: 'readonly', document: 'readonly', localStorage: 'readonly', fetch: 'readonly', location: 'readonly', URLSearchParams: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', FormData: 'readonly' } } },
  { files: ['server/**/*.ts','scripts/**/*.mjs','tests/**/*.ts'], languageOptions: { globals: { console: 'readonly', process: 'readonly', Buffer: 'readonly', fetch: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly' } } },
  { files: ['tests/e2e/**/*.ts'], languageOptions: { globals: { window: 'readonly', document: 'readonly' } } },
  { rules: { '@typescript-eslint/no-explicit-any': 'off', 'no-control-regex': 'off', 'no-unused-vars': 'off', '@typescript-eslint/no-unused-vars': ['warn'] } }
];
