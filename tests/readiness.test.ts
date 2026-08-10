import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

const WEBHOOK_SECRET = 'test-secret-token-123';

function setTestEnv() {
  process.env.NODE_ENV = 'test';
  process.env.ALLOW_DEV_LOGIN = 'true';
  process.env.DB_DRIVER = 'sqlite';
  process.env.STORAGE_DRIVER = 'local';
  process.env.DATABASE_PATH = './data/readiness-test.sqlite';
  process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.ADMIN_TELEGRAM_IDS = '7';
  process.env.STORAGE_LOCAL_ROOT = './storage/readiness-test';
}

function setProductionEnv(overrides: Record<string, string> = {}) {
  process.env.NODE_ENV = 'production';
  process.env.DB_DRIVER = 'postgres';
  process.env.STORAGE_DRIVER = 's3';
  process.env.DATABASE_URL = overrides.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:1/cloud_bot';
    process.env.DATABASE_SSL = 'false';
  process.env.REDIS_URL = overrides.REDIS_URL || 'rediss://127.0.0.1:1';
  process.env.REDIS_TLS = 'true';
  process.env.REDIS_KEY_PREFIX = 'cloud-bot:test:';
  process.env.S3_ENDPOINT = overrides.S3_ENDPOINT || 'http://127.0.0.1:1';
  process.env.S3_REGION = 'us-east-1';
  process.env.S3_BUCKET = 'test-bucket';
  process.env.S3_ACCESS_KEY_ID = 'test';
  process.env.S3_SECRET_ACCESS_KEY = 'test';
  process.env.S3_FORCE_PATH_STYLE = 'true';
  process.env.BOT_TOKEN = overrides.BOT_TOKEN || 'TEST_TOKEN';
  process.env.BOT_USERNAME = 'test_bot';
  process.env.WEBAPP_URL = 'https://test.example.com';
  process.env.CORS_ORIGIN = 'https://test.example.com';
  process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.ALLOW_DEV_LOGIN = 'false';
  process.env.PORT = '65535';
}

async function cleanupApp() {
  const { closeRuntimeResources } = await import('../server/app');
  const { closeDb } = await import('../server/db');
  await closeRuntimeResources();
  await closeDb();
}

describe('Health and readiness endpoints', () => {
  afterAll(async () => {
    vi.resetModules();
    delete process.env.NODE_ENV;
    delete process.env.REDIS_URL;
    delete process.env.DATABASE_URL;
    delete process.env.S3_ENDPOINT;
    delete process.env.S3_BUCKET;
  });

  describe('when all dependencies are healthy (test mode)', () => {
    let app: Express;

    beforeEach(async () => {
      vi.resetModules();
      setTestEnv();
      const { db, migrate } = await import('../server/db');
      await migrate();
      app = (await import('../server/app')).createApp();
    });

    afterEach(async () => {
      await cleanupApp();
      vi.resetModules();
    });

    it('GET /health/live returns 200 with { ok: true }', async () => {
      const res = await request(app).get('/health/live').expect(200);
      expect(res.body).toEqual({ ok: true });
    });

        it('GET /health/ready returns 200 when DB, store, storage are all ok', async () => {
      const res = await request(app).get('/health/ready').expect(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.db).toBe('ok');
      expect(res.body.store).toBe('ok');
      expect(res.body.storage).toBe('ok');
    });
  });

  describe('when Redis is unreachable (test mode with REDIS_URL set)', () => {
    let app: Express;

    beforeEach(async () => {
      vi.resetModules();
      setTestEnv();
      process.env.REDIS_URL = 'redis://127.0.0.1:1';
      process.env.REDIS_TLS = 'false';
      process.env.REDIS_KEY_PREFIX = 'cloud-bot:redis-test:';
      const { db, migrate } = await import('../server/db');
      await migrate();
      app = (await import('../server/app')).createApp();
    });

    afterEach(async () => {
      await cleanupApp();
      vi.resetModules();
      delete process.env.REDIS_URL;
    });

    it('GET /health/ready returns 503 with store unavailable', async () => {
      const res = await request(app).get('/health/ready').expect(503);
      expect(res.body.ok).toBe(false);
      expect(res.body.db).toBe('ok');
      expect(res.body.store).toBe('unavailable');
    });

    it('GET /health/live still returns 200 even when Redis is down', async () => {
      const res = await request(app).get('/health/live').expect(200);
      expect(res.body).toEqual({ ok: true });
    });
  });

  describe('when storage (S3) is unreachable (test mode with s3 driver)', () => {
    let app: Express;

    beforeEach(async () => {
      vi.resetModules();
      setTestEnv();
      process.env.STORAGE_DRIVER = 's3';
      process.env.S3_ENDPOINT = 'http://127.0.0.1:1';
      process.env.S3_BUCKET = 'unreachable-bucket';
      process.env.S3_ACCESS_KEY_ID = 'test';
      process.env.S3_SECRET_ACCESS_KEY = 'test';
      process.env.S3_FORCE_PATH_STYLE = 'true';
      const { db, migrate } = await import('../server/db');
      await migrate();
      app = (await import('../server/app')).createApp();
    });

    afterEach(async () => {
      await cleanupApp();
      vi.resetModules();
    });

    it('GET /health/ready returns 503 with storage unavailable', async () => {
      const res = await request(app).get('/health/ready').expect(503);
      expect(res.body.ok).toBe(false);
      expect(res.body.storage).toBe('unavailable');
    });
  });

  describe('when PostgreSQL is unreachable (production mode)', () => {
    let app: Express;

    beforeEach(async () => {
      vi.resetModules();
      setProductionEnv();
      const { db, migrate } = await import('../server/db');
      try { await migrate(); } catch { /* expected: DB unreachable */ }
      app = (await import('../server/app')).createApp();
    });

    afterEach(async () => {
      await cleanupApp();
      vi.resetModules();
    });

    it('GET /health/ready returns 503 with db unavailable', async () => {
      const res = await request(app).get('/health/ready').expect(503);
      expect(res.body.ok).toBe(false);
      expect(res.body.db).toBe('unavailable');
    });

    it('GET /health/live still returns 200 when PostgreSQL is down', async () => {
      const res = await request(app).get('/health/live').expect(200);
      expect(res.body).toEqual({ ok: true });
    });
  });

  describe('when Telegram is unavailable (production mode with TEST_TOKEN)', () => {
    let app: Express;

    beforeEach(async () => {
      vi.resetModules();
      setProductionEnv({ BOT_TOKEN: 'TEST_TOKEN' });
      const { db, migrate } = await import('../server/db');
      try { await migrate(); } catch { /* expected: DB unreachable in this test env */ }
      app = (await import('../server/app')).createApp();
    });

    afterEach(async () => {
      await cleanupApp();
      vi.resetModules();
    });

    it('GET /health/ready returns 503 and reports telegram non-ok', async () => {
      const res = await request(app).get('/health/ready').expect(503);
      expect(res.body.ok).toBe(false);
      expect(res.body.telegram).not.toBe('ok');
    });

    it('does not leak the bot token or webhook secret in readiness response', async () => {
      const res = await request(app).get('/health/ready').expect(503);
      expect(JSON.stringify(res.body)).not.toContain('TEST_TOKEN');
      expect(JSON.stringify(res.body)).not.toContain(WEBHOOK_SECRET);
      expect(JSON.stringify(res.body)).not.toHaveProperty('telegramError');
    });
  });
});

