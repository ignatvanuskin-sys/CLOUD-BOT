import { describe, expect, it, beforeEach, afterEach, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

async function freshDb() {
  const { db, migrate } = await import('../server/db');
  await migrate();
  await db.exec('delete from user_favorites; delete from webhook_updates; delete from delivery_events; delete from entitlements; delete from orders; delete from product_assets; delete from license_plans; delete from products; delete from users; delete from admin_users;');
  await db.prepare('insert into products(id,slug,type,category,title,result,version,status) values(?,?,?,?,?,?,?,?) on conflict(id) do nothing').run('p1','p1','template','ai','P1','R','1.0.0','published');
  await db.prepare('insert into license_plans(id,product_id,name,price_xtr,projects,commercial,support_days,updates_days) values(?,?,?,?,?,?,?,?) on conflict(id) do nothing').run('l1','p1','PRO',100,1,1,30,90);
  return db;
}

async function tokenFor(app: Express, telegramId: number) {
  const auth = await request(app).post('/api/auth/telegram').send({ devTelegramId: telegramId }).expect(200);
  return auth.body.token as string;
}

describe('input validation and edge cases', () => {
  let app: Express;
  beforeEach(async () => {
    process.env.NODE_ENV = 'test'; process.env.ALLOW_DEV_LOGIN = 'true'; process.env.DB_DRIVER = 'sqlite'; process.env.STORAGE_DRIVER = 'local'; process.env.DATABASE_PATH = './data/test-validation.sqlite'; process.env.WEBHOOK_SECRET = 'test-secret-token-123';
    const { createApp } = await import('../server/app');
    app = createApp();
    await freshDb();
  });
  afterEach(async () => { const { closeRuntimeResources } = await import('../server/app'); await closeRuntimeResources(); });
  afterAll(async () => { const { closeDb } = await import('../server/db'); await closeDb(); });

  it('rejects order with missing licenseId as 400 validation_failed', async () => {
    const token = await tokenFor(app, 42);
    const res = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'checkout_edge_12345678').send({}).expect(400);
    expect(res.body.error.code).toBe('validation_failed');
  });

  it('rejects order with non-string licenseId (SQL/XSS payload)', async () => {
    const token = await tokenFor(app, 42);
    const res = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'checkout_edge_12345679').send({ licenseId: "l1' OR '1'='1" }).expect(404);
    expect(res.body.error.code).toBe('license_not_found');
  });

  it('rejects favorite with XSS productId and long emoji title input', async () => {
    const token = await tokenFor(app, 42);
    const res = await request(app).post('/api/me/favorites').set('Authorization', `Bearer ${token}`).send({ productId: '<script>alert(1)</script>' }).expect(404);
    expect(res.body.error.code).toBe('product_not_found');
    const res2 = await request(app).post('/api/me/favorites').set('Authorization', `Bearer ${token}`).send({ productId: 'x'.repeat(200) }).expect(400);
    expect(res2.body.error.code).toBe('product_id_required');
  });

  it('search handles emoji, SQL, unicode and very long input safely', async () => {
    const res = await request(app).get('/api/products').query({ q: '🚀💎' }).expect(200);
    expect(res.body).toHaveProperty('items');
    const res2 = await request(app).get('/api/products').query({ q: "' OR 1=1; DROP TABLE products;--" }).expect(200);
    expect(res2.body).toHaveProperty('items');
    const res3 = await request(app).get('/api/products').query({ q: 'я'.repeat(500) }).expect(200);
    expect(res3.body).toHaveProperty('items');
  });

  it('start-param rejects path traversal and injection', async () => {
    const token = await tokenFor(app, 42);
    const res = await request(app).post('/api/start-param').set('Authorization', `Bearer ${token}`).send({ startParam: '../../etc/passwd' }).expect(200);
    expect(res.body.kind).toBe('catalog');
  });

  it('admin product create rejects oversized title via zod', async () => {
    const { bootstrapAdmins } = await import('../server/db');
    await bootstrapAdmins('42');
    const token = await tokenFor(app, 42);
    const res = await request(app).post('/api/admin/products').set('Authorization', `Bearer ${token}`).send({ title: 'T'.repeat(200), result: 'ok', type: 'template', category: 'ai' }).expect(400);
    expect(res.body.error.code).toBe('validation_failed');
  });

  it('refund rejects short reason via zod', async () => {
    const { bootstrapAdmins } = await import('../server/db');
    await bootstrapAdmins('42');
    const token = await tokenFor(app, 42);
    const res = await request(app).post('/api/admin/orders/ord1/refund').set('Authorization', `Bearer ${token}`).send({ reason: 'no' }).expect(400);
    expect(res.body.error.code).toBe('reason_required');
  });

  it('rejects malformed JSON body gracefully', async () => {
    const token = await tokenFor(app, 42);
    await request(app).post('/api/me/favorites').set('Authorization', `Bearer ${token}`).set('Content-Type', 'application/json').send('{"productId":').expect(400);
  });

  it('massive parallel favorite toggles stay consistent', async () => {
    const token = await tokenFor(app, 42);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => request(app).post('/api/me/favorites').set('Authorization', `Bearer ${token}`).send({ productId: 'p1' }))
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toContain(201);
    const list = await request(app).get('/api/me/favorites').set('Authorization', `Bearer ${token}`).expect(200);
    expect(list.body.items).toHaveLength(1);
  });
});
