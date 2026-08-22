import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import fs from 'node:fs';
import path from 'node:path';

const WEBHOOK_SECRET = 'test-secret-token-123';
const ADMIN_IDS = '7';
const DB_PATH = './data/stars-gate-test.sqlite';
const STORAGE_ROOT = './storage/test-stars-gate';

function webhook(headers: Record<string, string> = {}) {
  return { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET, ...headers };
}

function preCheckoutUpdate(updateId: number, payload: string, overrides: { fromId?: number; amount?: number; currency?: string } = {}) {
  return {
    update_id: updateId,
    pre_checkout_query: {
      id: `pcq-${updateId}`,
      from: { id: overrides.fromId ?? 7 },
      currency: overrides.currency ?? 'XTR',
      total_amount: overrides.amount ?? 100,
      invoice_payload: payload,
    },
  };
}

function paymentUpdate(updateId: number, payload: string, chargeId = 'ch-gate', fromId = 7) {
  return {
    update_id: updateId,
    message: {
      from: { id: fromId },
      successful_payment: {
        invoice_payload: payload,
        currency: 'XTR',
        total_amount: 100,
        telegram_payment_charge_id: chargeId,
      },
    },
  };
}

async function login(app: Express, id = 7) {
  const auth = await request(app).post('/api/auth/telegram').send({ devTelegramId: id }).expect(200);
  return auth.body.token as string;
}

async function createOrder(app: Express, token: string) {
  const key = `gate_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const order = await request(app)
    .post('/api/orders')
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', key)
    .send({ licenseId: 'l1' })
    .expect(201);
  return order.body.order as { id: string; amount_xtr: number; currency: string; status: string };
}

async function payloadOf(orderId: string) {
  const { db } = await import('../server/db');
  return (await db.prepare('select payload from orders where id=?').get(orderId) as any).payload as string;
}

async function cleanupDbFile() {
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.rmSync(`${path.resolve(DB_PATH)}${suffix}`, { force: true }); } catch { /* ignore */ }
  }
  try { fs.rmSync(path.resolve(STORAGE_ROOT), { recursive: true, force: true }); } catch { /* ignore */ }
}

describe('Telegram Stars payment gate: pre_checkout + fulfillment/download', () => {
  let app: Express;
  beforeEach(async () => {
    vi.resetModules();
    process.env.NODE_ENV = 'test';
    process.env.ALLOW_DEV_LOGIN = 'true';
    process.env.DB_DRIVER = 'sqlite';
    process.env.STORAGE_DRIVER = 'local';
    process.env.DATABASE_PATH = DB_PATH;
    process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.ADMIN_TELEGRAM_IDS = ADMIN_IDS;
    process.env.STORAGE_LOCAL_ROOT = STORAGE_ROOT;
    process.env.DOWNLOAD_TTL_SECONDS = '900';
    const { db, migrate, bootstrapAdmins } = await import('../server/db');
    await migrate();
    await db.exec('delete from webhook_updates; delete from delivery_events; delete from entitlements; delete from orders; delete from product_assets; delete from license_plans; delete from products; delete from users; delete from admin_users;');
    await bootstrapAdmins(ADMIN_IDS);
    await db.prepare('insert into products(id,slug,type,category,title,result,version,status) values(?,?,?,?,?,?,?,?)').run('p1', 'p1', 'ready_bot', 'ai', 'Test Product', 'Test Result', '1.0.0', 'published');
    await db.prepare('insert into license_plans(id,product_id,name,price_xtr,projects,commercial,support_days,updates_days) values(?,?,?,?,?,?,?,?)').run('l1', 'p1', 'PRO', 100, 1, 1, 30, 90);
    await db.prepare('insert into product_assets(id,product_id,version,storage_key,file_name,mime_type,size_bytes,checksum_sha256,status) values(?,?,?,?,?,?,?,?,?)').run('a1', 'p1', '1.0.0', 'products/p1/1.0.0/a1.txt', 'demo.txt', 'text/plain', 13, 'abc', 'published');
    fs.mkdirSync(path.resolve(STORAGE_ROOT, 'products/p1/1.0.0'), { recursive: true });
    fs.writeFileSync(path.resolve(STORAGE_ROOT, 'products/p1/1.0.0/a1.txt'), 'hello product!');
    app = (await import('../server/app')).createApp();
  });
  afterEach(async () => {
    const { db } = await import('../server/db');
    await db.exec('delete from webhook_updates; delete from delivery_events; delete from entitlements; delete from orders; delete from product_assets; delete from license_plans; delete from products; delete from users; delete from admin_users;');
  });
  afterAll(async () => {
    const { closeRuntimeResources } = await import('../server/app');
    const { closeDb } = await import('../server/db');
    await closeRuntimeResources();
    await closeDb();
    cleanupDbFile();
  });

  it('rejects webhook without the correct secret (403)', async () => {
    const res = await request(app).post('/api/webhooks/telegram').set({ 'x-telegram-bot-api-secret-token': 'wrong-secret' }).send(paymentUpdate(901, 'x'));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('bad_webhook_secret');
  });

  it('pre_checkout: accepts a valid pending order', async () => {
    const token = await login(app);
    const order = await createOrder(app, token);
    const payload = await payloadOf(order.id);
    const res = await request(app).post('/api/webhooks/telegram').set(webhook()).send(preCheckoutUpdate(101, payload));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('pre_checkout: rejects wrong payer', async () => {
    const token = await login(app);
    const order = await createOrder(app, token);
    const payload = await payloadOf(order.id);
    const res = await request(app).post('/api/webhooks/telegram').set(webhook()).send(preCheckoutUpdate(102, payload, { fromId: 999999 }));
    expect(res.body.ok).toBe(false);
  });

  it('pre_checkout: rejects wrong amount', async () => {
    const token = await login(app);
    const order = await createOrder(app, token);
    const payload = await payloadOf(order.id);
    const res = await request(app).post('/api/webhooks/telegram').set(webhook()).send(preCheckoutUpdate(103, payload, { amount: 999 }));
    expect(res.body.ok).toBe(false);
  });

  it('pre_checkout: rejects wrong currency', async () => {
    const token = await login(app);
    const order = await createOrder(app, token);
    const payload = await payloadOf(order.id);
    const res = await request(app).post('/api/webhooks/telegram').set(webhook()).send(preCheckoutUpdate(104, payload, { currency: 'USD' }));
    expect(res.body.ok).toBe(false);
  });

  it('pre_checkout: rejects unknown payload and non-pending order', async () => {
    const res1 = await request(app).post('/api/webhooks/telegram').set(webhook()).send(preCheckoutUpdate(105, 'no-such-payload'));
    expect(res1.body.ok).toBe(false);
    const token = await login(app);
    const order = await createOrder(app, token);
    const payload = await payloadOf(order.id);
    // fulfill first, then a pre_checkout for the same order must be rejected
    await request(app).post('/api/webhooks/telegram').set(webhook()).send(paymentUpdate(106, payload, 'ch-pre'));
    const res2 = await request(app).post('/api/webhooks/telegram').set(webhook()).send(preCheckoutUpdate(107, payload));
    expect(res2.body.ok).toBe(false);
  });

  it('full lifecycle: order -> pre_checkout -> successful_payment -> entitlement -> download (one-time)', async () => {
    const token = await login(app);
    const order = await createOrder(app, token);
    const payload = await payloadOf(order.id);
    const pre = await request(app).post('/api/webhooks/telegram').set(webhook()).send(preCheckoutUpdate(201, payload));
    expect(pre.body.ok).toBe(true);
    const pay = await request(app).post('/api/webhooks/telegram').set(webhook()).send(paymentUpdate(202, payload, 'ch-life'));
    expect(pay.body.result).toBe('fulfilled');

    const { db } = await import('../server/db');
    const orderRow = await db.prepare('select status,telegram_charge_id,paid_at,fulfilled_at from orders where id=?').get(order.id) as any;
    expect(orderRow.status).toBe('fulfilled');
    expect(orderRow.telegram_charge_id).toBe('ch-life');
    expect(orderRow.paid_at).toBeTruthy();
    const entitlements = await db.prepare('select id,user_id,product_id,license_id,order_id,active from entitlements where order_id=?').all(order.id) as any[];
    expect(entitlements).toHaveLength(1);
    expect(entitlements[0].active).toBe(1);

    // purchases list exposes the entitlement
    const purchases = await request(app).get('/api/me/purchases').set('Authorization', `Bearer ${token}`).expect(200);
    expect(purchases.body.items).toHaveLength(1);
    expect(purchases.body.items[0].order_id).toBe(order.id);

    // download: token issued
    const dl = await request(app).post(`/api/purchases/${entitlements[0].id}/download`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(dl.body.url).toMatch(/^\/api\/download\/[A-Za-z0-9_-]{40}$/);
    expect(dl.body.expiresIn).toBe(900);
    // fetch the file
    const file = await request(app).get(dl.body.url);
    expect(file.status).toBe(200);
    expect(file.text).toBe('hello product!');
    // second use → 410
    const again = await request(app).get(dl.body.url);
    expect(again.status).toBe(410);
  });

  it('download: rejected for non-owner, unknown entitlement, unpublished asset', async () => {
    const token = await login(app);
    const otherToken = await login(app, 8);
    await request(app).post(`/api/purchases/nonexistent/download`).set('Authorization', `Bearer ${token}`).expect(404);
    // create order+entitlement for user 7, then user 8 must not download it
    const order = await createOrder(app, token);
    const payload = await payloadOf(order.id);
    await request(app).post('/api/webhooks/telegram').set(webhook()).send(paymentUpdate(301, payload, 'ch-owner'));
    const { db } = await import('../server/db');
    const ent = (await db.prepare('select id from entitlements where order_id=?').get(order.id) as any).id;
    await request(app).post(`/api/purchases/${ent}/download`).set('Authorization', `Bearer ${otherToken}`).expect(404);
    // archive the asset -> 404 asset_not_found
    await db.prepare("update product_assets set status='deleted' where id='a1'").run();
    await request(app).post(`/api/purchases/${ent}/download`).set('Authorization', `Bearer ${token}`).expect(404);
  });
});
