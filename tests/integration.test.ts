import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';

describe('integration smoke', () => {
  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.ALLOW_DEV_LOGIN = 'true';
    process.env.DB_DRIVER = 'sqlite';
    process.env.STORAGE_DRIVER = 'local';
    process.env.DATABASE_PATH = './data/test.sqlite';
    process.env.WEBHOOK_SECRET = 'test-secret-token-123';
  });
  it('health endpoints are up', async () => {
    const { createApp } = await import('../server/app');
    const app = createApp();
    const live = await request(app).get('/health/live').expect(200);
    expect(live.body).toEqual({ ok: true });
    const ready = await request(app).get('/health/ready').expect(200);
    expect(ready.body).toHaveProperty('ok');
  });
  it('rejects unauthenticated protected routes', async () => {
    const { createApp } = await import('../server/app');
    const app = createApp();
    await request(app).get('/api/me').expect(401);
    await request(app).post('/api/orders').send({}).expect(401);
  });
});
