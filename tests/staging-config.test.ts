import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = resolve(process.cwd(), 'scripts/validate-staging-config.mjs');
const validEnv = {
  RAILWAY_TOKEN: 'token-present',
  RAILWAY_PROJECT_ID: 'project-present',
  RAILWAY_ENVIRONMENT_ID: 'environment-present',
  RAILWAY_SERVICE_ID: 'service-present',
  STAGING_BASE_URL: 'https://staging.example.test',
  STAGING_DATABASE_URL: 'postgres://redacted',
  STAGING_METRICS_TOKEN: 'metrics-present',
};

function run(env: Record<string, string | undefined>) {
  return spawnSync(process.execPath, [script], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

describe('staging configuration preflight', () => {
  it('passes when all required inputs are present', () => {
    const result = run(validEnv);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('staging preflight passed');
    expect(result.stdout).not.toContain(validEnv.RAILWAY_TOKEN);
  });

  it('fails with names only when required inputs are missing', () => {
    const result = run({ ...validEnv, RAILWAY_TOKEN: '', STAGING_BASE_URL: 'http://insecure.example.test' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('RAILWAY_TOKEN');
    expect(result.stderr).toContain('STAGING_BASE_URL must use https://');
    expect(result.stderr).not.toContain('token-present');
  });
});
