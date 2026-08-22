import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

describe('license plan sales flow', () => {
  let app: Express;
  beforeEach(async () => {
    vi.resetModules();
    process.env.NODE_ENV = 'test';
    process.env.ALLOW_DEV_LOGIN = 'true';
    process.env.DB_DRIVER = 'sqlite';
    process.env.STORAGE_DRIVER = 'local';
    process.env.DATABASE_PATH = `./data/license-plan-flow-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`;
    process.env.WEBHOOK_SECRET = 'test-secret-token-123';
    const { db, migrate } = await import('../server/db');
    await migrate();
    await db.exec('delete from audit_log; delete from product_assets; delete from user_favorites; delete from orders; delete from license_plans; delete from products; delete from users; delete from admin_users;');
    app = (await import('../server/app')).createApp();
  });
  afterEach(async () => {
    await (await import('../server/app')).closeRuntimeResources();
    await (await import('../server/db')).closeDb();
  });
  async function token(id: number) {
    return (await request(app).post('/api/auth/telegram').send({ devTelegramId: id })).body.token as string;
  }
  async function adminSetup(id = 301) {
    const { bootstrapAdmins } = await import('../server/db');
    await bootstrapAdmins(String(id));
    return token(id);
  }
  async function createDraft(t: string, slug: string) {
    const r = await request(app).post('/api/admin/products').set('Authorization', `Bearer ${t}`).send({ title: 'Товар', slug, type: 'module', category: 'Тест', result: 'Результат' });
    expect(r.status).toBe(201);
    return r.body.id as string;
  }
  function planPayload(overrides: Record<string, unknown> = {}) {
    return { name: 'Стандарт', price_xtr: 100, projects: 1, commercial: 0, support_days: 30, updates_days: 365, terms: '', ...overrides };
  }

  it('1. admin creates product and license plan', async () => {
    const t = await adminSetup();
    const id = await createDraft(t, 'lp-1');
    const r = await request(app).post(`/api/admin/products/${id}/plans`).set('Authorization', `Bearer ${t}`).send(planPayload());
    expect(r.status).toBe(201);
    expect(r.body.plan).toMatchObject({ product_id: id, name: 'Стандарт', price_xtr: 100, projects: 1, commercial: 0, support_days: 30, updates_days: 365, terms: '' });
    const list = await request(app).get(`/api/admin/products/${id}/plans`).set('Authorization', `Bearer ${t}`).expect(200);
    expect(list.body.items).toHaveLength(1);
  });

  it('2. normal user cannot create a license plan (403)', async () => {
    const tAdmin = await adminSetup();
    const id = await createDraft(tAdmin, 'lp-2');
    const tUser = await token(402);
    await request(app).post(`/api/admin/products/${id}/plans`).set('Authorization', `Bearer ${tUser}`).send(planPayload()).expect(403);
  });

  it('3. admin cannot create a plan for a nonexistent product (404)', async () => {
    const t = await adminSetup();
    await request(app).post('/api/admin/products/nope/plans').set('Authorization', `Bearer ${t}`).send(planPayload()).expect(404);
  });

  it('4. editor allowed, support role denied', async () => {
    const { db } = await import('../server/db');
    await db.prepare('insert into admin_users(telegram_id,role) values(?,?)').run('501', 'editor');
    await db.prepare('insert into admin_users(telegram_id,role) values(?,?)').run('502', 'support');
    const tEditor = await token(501);
    const tSupport = await token(502);
    const tOwner = await adminSetup();
    const id = await createDraft(tOwner, 'lp-4');
    await request(app).post(`/api/admin/products/${id}/plans`).set('Authorization', `Bearer ${tEditor}`).send(planPayload()).expect(201);
    await request(app).post(`/api/admin/products/${id}/plans`).set('Authorization', `Bearer ${tSupport}`).send(planPayload()).expect(403);
  });

  it('5. invalid price rejected (0, negative, fractional, over 2500)', async () => {
    const t = await adminSetup();
    const id = await createDraft(t, 'lp-5');
    for (const price of [0, -1, 1.5, 2501]) {
      const r = await request(app).post(`/api/admin/products/${id}/plans`).set('Authorization', `Bearer ${t}`).send(planPayload({ price_xtr: price }));
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('validation_failed');
    }
  });

  it('6. invalid name rejected', async () => {
    const t = await adminSetup();
    const id = await createDraft(t, 'lp-6');
    const r = await request(app).post(`/api/admin/products/${id}/plans`).set('Authorization', `Bearer ${t}`).send(planPayload({ name: '' }));
    expect(r.status).toBe(400);
  });

  it('7+8. published product with plan appears in catalog with price; checkout with valid licenseId succeeds', async () => {
    const t = await adminSetup();
    const id = await createDraft(t, 'lp-7');
    await request(app).post(`/api/admin/products/${id}/plans`).set('Authorization', `Bearer ${t}`).send(planPayload({ price_xtr: 250 })).expect(201);
    const upload = await request(app).post('/api/admin/assets/upload').set('Authorization', `Bearer ${t}`).field('productId', id).field('version', '1.0.0').attach('file', Buffer.from('описание товара без секретов'), 'readme.txt');
    expect(upload.status).toBe(201);
    expect(upload.body.status).toBe('approved');
    await request(app).post(`/api/admin/assets/${upload.body.id}/publish`).set('Authorization', `Bearer ${t}`).expect(200);
    const detail = await request(app).get('/api/products/lp-7').expect(200);
    expect(detail.body.plans).toHaveLength(1);
    expect(detail.body.plans[0].price_xtr).toBe(250);
    const list = await request(app).get('/api/products?sort=new&limit=8').expect(200);
    expect(list.body.items[0].slug).toBe('lp-7');
    expect(list.body.items[0].price_from).toBe(250);
    const buyer = await token(403);
    const order = await request(app).post('/api/orders').set('Authorization', `Bearer ${buyer}`).set('Idempotency-Key', 'idem-key-0000000000000001').send({ licenseId: detail.body.plans[0].id });
    expect(order.status).toBe(201);
    expect(order.body.order).toMatchObject({ product_id: id, license_id: detail.body.plans[0].id, amount_xtr: 250, currency: 'XTR', status: 'pending' });
  });

  it('9. invalid licenseId rejected (404 license_not_found)', async () => {
    const buyer = await token(404);
    const r = await request(app).post('/api/orders').set('Authorization', `Bearer ${buyer}`).set('Idempotency-Key', 'idem-key-0000000000000002').send({ licenseId: 'missing-plan' });
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('license_not_found');
  });

  it('10. license of an unpublished product rejected (404 product_not_found)', async () => {
    const t = await adminSetup();
    const id = await createDraft(t, 'lp-10');
    const plan = await request(app).post(`/api/admin/products/${id}/plans`).set('Authorization', `Bearer ${t}`).send(planPayload()).expect(201);
    const buyer = await token(405);
    const r = await request(app).post('/api/orders').set('Authorization', `Bearer ${buyer}`).set('Idempotency-Key', 'idem-key-0000000000000003').send({ licenseId: plan.body.plan.id });
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('product_not_found');
  });

  it('11. unauthenticated checkout rejected (401)', async () => {
    await request(app).post('/api/orders').send({ licenseId: 'x' }).expect(401);
  });
});
