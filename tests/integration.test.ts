import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

let app: Express;

describe('integration smoke', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ALLOW_DEV_LOGIN = 'true';
    process.env.DB_DRIVER = 'sqlite';
    process.env.STORAGE_DRIVER = 'local';
    process.env.DATABASE_PATH = './data/integration-test.sqlite';
    process.env.WEBHOOK_SECRET = 'test-secret-token-123';
    const { migrate } = await import('../server/db');
    await migrate();
    app = (await import('../server/app')).createApp();
  });

  afterAll(async () => {
    const { closeRuntimeResources } = await import('../server/app');
    const { closeDb } = await import('../server/db');
    await closeRuntimeResources();
    await closeDb();
  });

  it('health endpoints are up without internal Telegram details', async () => {
    const live = await request(app).get('/health/live').expect(200);
    expect(live.body).toEqual({ ok: true });
    const ready = await request(app).get('/health/ready').expect(200);
    expect(ready.body).toHaveProperty('ok');
    expect(ready.body).not.toHaveProperty('telegramError');
  });

  it('enforces the bearer session and logout contract', async () => {
    const login = await request(app).post('/api/auth/telegram').send({ devTelegramId: 77 }).expect(200);
    expect(login.body.token).toEqual(expect.any(String));
    expect(login.body.expiresIn).toEqual(expect.any(Number));
    expect(login.headers['set-cookie']?.[0]).toMatch(/cloud_bot_session=.*HttpOnly; SameSite=Lax/);
    const token = login.body.token;

    await request(app).get('/api/me').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app).get('/api/me').expect(401);
    await request(app).get('/api/me').set('Authorization', 'Bearer invalid-token').expect(401);

    await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`).expect(200, { ok: true });
    await request(app).get('/api/me').set('Authorization', `Bearer ${token}`).expect(401);

    const secondLogin = await request(app).post('/api/auth/telegram').send({ devTelegramId: 77 }).expect(200);
    const secondToken = secondLogin.body.token;
    await request(app).post('/api/auth/logout').expect(401);
    await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${secondToken}`).expect(200, { ok: true });
    await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${secondToken}`).expect(401);
  });
});
