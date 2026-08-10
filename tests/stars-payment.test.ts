import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import fs from 'node:fs';
import path from 'node:path';

const WEBHOOK_SECRET = 'test-secret-token-123';
const ADMIN_IDS = '7';
const DB_PATH = './data/stars-test.sqlite';

function webhook(headers: Record<string, string> = {}) {
  return { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET, ...headers };
}

function paymentUpdate(updateId: number, payload: string, chargeId = 'ch1', fromId = 7) {
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

async function login(app: Express) {
  const auth = await request(app).post('/api/auth/telegram').send({ devTelegramId: 7 }).expect(200);
  return auth.body.token as string;
}

async function createOrder(app: Express, token: string) {
  const key = `stars_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const order = await request(app)
    .post('/api/orders')
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', key)
    .send({ licenseId: 'l1' })
    .expect(201);
  return order.body.order;
}

async function getOrderPayload(orderId: string) {
  const { db } = await import('../server/db');
  return (await db.prepare('select payload from orders where id=?').get(orderId) as any).payload as string;
}

async function fulfillOrder(app: Express, orderId: string, payload: string, updateId = 100) {
  await request(app).post('/api/webhooks/telegram').set(webhook()).send(paymentUpdate(updateId, payload)).expect(200);
}

async function getOrderStatus(orderId: string) {
  const { db } = await import('../server/db');
  return (await db.prepare('select status,telegram_charge_id from orders where id=?').get(orderId) as any);
}

async function countEntitlements() {
  const { db } = await import('../server/db');
  return Number((await db.prepare('select count(*) n from entitlements where active=1').get() as any).n);
}

async function cleanupDbFile() {
  const dbPath = path.resolve(DB_PATH);
  for (const suffix of ['', '-shm', '-wal']) {
    let retries = 5;
    while (retries > 0) {
      try { fs.rmSync(`${dbPath}${suffix}`, { force: true }); break; }
      catch (e: any) {
        if (e.code === 'EBUSY' && retries > 1) {
          retries -= 1;
          const start = Date.now();
          while (Date.now() - start < 100) { /* busy wait */ }
        } else {
          break;
        }
      }
    }
  }
}

describe('Telegram Stars payment lifecycle', () => {
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
    process.env.STORAGE_LOCAL_ROOT = './storage/test-stars';

        const { db, migrate, bootstrapAdmins } = await import('../server/db');
    await migrate();
    await db.exec('delete from webhook_updates; delete from delivery_events; delete from entitlements; delete from orders; delete from product_assets; delete from license_plans; delete from products; delete from users; delete from admin_users;');
    await bootstrapAdmins(ADMIN_IDS);
    await db.prepare('insert into products(id,slug,type,category,title,result,version,status) values(?,?,?,?,?,?,?,?)').run('p1', 'p1', 'template', 'ai', 'Test Product', 'Test Result', '1.0.0', 'published');
        await db.prepare('insert into license_plans(id,product_id,name,price_xtr,projects,commercial,support_days,updates_days) values(?,?,?,?,?,?,?,?)').run('l1', 'p1', 'PRO', 100, 1, 1, 30, 90);
    await db.prepare('insert into product_assets(id,product_id,version,storage_key,file_name,mime_type,size_bytes,checksum_sha256,status) values(?,?,?,?,?,?,?,?,?)').run('a1', 'p1', '1.0.0', 'products/p1/1.0.0/a1.txt', 'demo.txt', 'text/plain', 100, 'abc', 'published');

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
    try { fs.rmSync(path.resolve('./storage/test-stars'), { recursive: true, force: true }); } catch { /* ignore */ }
  });

  // 1. successful payment
  it('processes a valid Stars payment and creates exactly one entitlement', async () => {
    const token = await login(app);
    const order = await createOrder(app, token);
    const payload = await getOrderPayload(order.id);

    const res = await request(app).post('/api/webhooks/telegram').set(webhook()).send(paymentUpdate(1, payload)).expect(200);
    expect(res.body.result).toBe('fulfilled');
    expect(await countEntitlements()).toBe(1);
    expect((await getOrderStatus(order.id)).status).toBe('fulfilled');
  });

  // 2. duplicate successful payment (same update_id)
  it('returns duplicate for a repeated update_id without creating a second entitlement', async () => {
    const token = await login(app);
    const order = await createOrder(app, token);
    const payload = await getOrderPayload(order.id);

    const first = await request(app).post('/api/webhooks/telegram').set(webhook()).send(paymentUpdate(1, payload)).expect(200);
    expect(first.body.result).toBe('fulfilled');
    expect(await countEntitlements()).toBe(1);

    const second = await request(app).post('/api/webhooks/telegram').set(webhook()).send(paymentUpdate(1, payload, 'ch1')).expect(200);
    expect(second.body.result).toBe('duplicate');
    expect(await countEntitlements()).toBe(1);
  });

    // 3. invalid payment (unknown payload)
  it('rejects payment for an unknown payload as invalid', async () => {
    const res = await request(app).post('/api/webhooks/telegram').set(webhook()).send({
      update_id: 2,
      message: {
        from: { id: 7 },
        successful_payment: { invoice_payload: 'nonexistent_payload', currency: 'XTR', total_amount: 100, telegram_payment_charge_id: 'ch-x' },
      },
    }).expect(200);
    expect(res.body.result).toBe('invalid');
    expect(await countEntitlements()).toBe(0);
  });

  // 4. wrong user
  it('rejects payment from a different Telegram user', async () => {
    const token = await login(app);
    const order = await createOrder(app, token);
    const payload = await getOrderPayload(order.id);

    const res = await request(app).post('/api/webhooks/telegram').set(webhook()).send(paymentUpdate(3, payload, 'ch3', 999999)).expect(200);
    expect(res.body.result).toBe('invalid');
    expect(await countEntitlements()).toBe(0);
    expect((await getOrderStatus(order.id)).status).toBe('pending');
  });

  // 5. wrong amount
  it('rejects payment with mismatched total_amount', async () => {
    const token = await login(app);
    const order = await createOrder(app, token);
    const payload = await getOrderPayload(order.id);

    const res = await request(app).post('/api/webhooks/telegram').set(webhook()).send({
      update_id: 4,
      message: {
        from: { id: 7 },
        successful_payment: { invoice_payload: payload, currency: 'XTR', total_amount: 999, telegram_payment_charge_id: 'ch-wrong-amount' },
      },
    }).expect(200);
    expect(res.body.result).toBe('invalid');
    expect(await countEntitlements()).toBe(0);
  });

    // 6. wrong currency
  it('rejects payment with non-XTR currency', async () => {
    const token = await login(app);
    const order = await createOrder(app, token);
    const payload = await getOrderPayload(order.id);

    const res = await request(app).post('/api/webhooks/telegram').set(webhook()).send({
      update_id: 5,
      message: {
        from: { id: 7 },
        successful_payment: { invoice_payload: payload, currency: 'USD', total_amount: 100, telegram_payment_charge_id: 'ch-wrong-currency' },
      },
    }).expect(200);
    expect(res.body.result).toBe('invalid');
    expect(await countEntitlements()).toBe(0);
  });

  // 7. duplicate webhook (same update_id with different charge)
  it('deduplicates webhook by update_id even with different charge_id', async () => {
    const token = await login(app);
    const order = await createOrder(app, token);
    const payload = await getOrderPayload(order.id);

    await request(app).post('/api/webhooks/telegram').set(webhook()).send(paymentUpdate(6, payload, 'ch-original')).expect(200);
    expect(await countEntitlements()).toBe(1);
    expect((await getOrderStatus(order.id)).telegram_charge_id).toBe('ch-original');

    const res = await request(app).post('/api/webhooks/telegram').set(webhook()).send(paymentUpdate(6, payload, 'ch-duplicate')).expect(200);
    expect(res.body.result).toBe('duplicate');
    expect((await getOrderStatus(order.id)).telegram_charge_id).toBe('ch-original');
  });

  // 8. replayed webhook (same completed update_id)
  it('handles replayed webhook without double fulfillment', async () => {
    const token = await login(app);
    const order = await createOrder(app, token);
    const payload = await getOrderPayload(order.id);

    await request(app).post('/api/webhooks/telegram').set(webhook()).send(paymentUpdate(7, payload, 'ch-replay')).expect(200);
    expect(await countEntitlements()).toBe(1);

    const res = await request(app).post('/api/webhooks/telegram').set(webhook()).send(paymentUpdate(7, payload, 'ch-replay-2')).expect(200);
    expect(res.body.result).toBe('duplicate');
    expect(await countEntitlements()).toBe(1);
  });

  // 9. fulfillment failure (order already processed by a prior charge)
  it('returns already_processed when order is fulfilled by a different update', async () => {
    const token = await login(app);
    const order = await createOrder(app, token);
    const payload = await getOrderPayload(order.id);

    await request(app).post('/api/webhooks/telegram').set(webhook()).send(paymentUpdate(8, payload, 'ch-first')).expect(200);
    expect(await countEntitlements()).toBe(1);

    const res = await request(app).post('/api/webhooks/telegram').set(webhook()).send(paymentUpdate(9, payload, 'ch-second')).expect(200);
    expect(res.body.result).toBe('already_processed');
    expect(await countEntitlements()).toBe(1);
    expect((await getOrderStatus(order.id)).telegram_charge_id).toBe('ch-first');
  });

  // 10. refund request (admin initiates refund in test mode)
  it('processes a refund request and revokes the entitlement', async () => {
    const token = await login(app);
    const order = await createOrder(app, token);
    const payload = await getOrderPayload(order.id);
    await fulfillOrder(app, order.id, payload);
    expect(await countEntitlements()).toBe(1);

    const res = await request(app).post(`/api/admin/orders/${order.id}/refund`).set('Authorization', `Bearer ${token}`).send({ reason: 'customer requested refund' }).expect(200);
    expect(res.body.ok).toBe(true);

    expect((await getOrderStatus(order.id)).status).toBe('refunded');
    expect(await countEntitlements()).toBe(0);
  });

    // 11. refund retry on an already-refunded order (idempotent)
  it('returns idempotent=true when refunding an already-refunded order', async () => {
    const token = await login(app);
    const order = await createOrder(app, token);
    const payload = await getOrderPayload(order.id);
    await fulfillOrder(app, order.id, payload);

    await request(app).post(`/api/admin/orders/${order.id}/refund`).set('Authorization', `Bearer ${token}`).send({ reason: 'first refund' }).expect(200);

    const res = await request(app).post(`/api/admin/orders/${order.id}/refund`).set('Authorization', `Bearer ${token}`).send({ reason: 'retry refund' }).expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.idempotent).toBe(true);
  });

  // 12. refund reconciliation — confirm a manual_review order as refunded
  it('reconciles a manual-review order as refunded', async () => {
    const token = await login(app);
    const order = await createOrder(app, token);
    const payload = await getOrderPayload(order.id);
    await fulfillOrder(app, order.id, payload);

    const { db } = await import('../server/db');
    await db.prepare("update orders set status='refund_manual_review',refund_reason='prior_attempt' where id=?").run(order.id);

    const res = await request(app).post(`/api/admin/orders/${order.id}/refund/reconcile`).set('Authorization', `Bearer ${token}`).send({ outcome: 'confirmed', note: 'verified external refund succeeded' }).expect(200);
    expect(res.body.status).toBe('refunded');
    expect(res.body.idempotent).toBe(false);
    expect(await countEntitlements()).toBe(0);
  });

  // 13. refund reconciliation — restore a manual_review order to fulfilled
  it('reconciles a manual-review order as not_refunded (restores to fulfilled)', async () => {
    const token = await login(app);
    const order = await createOrder(app, token);
    const payload = await getOrderPayload(order.id);
    await fulfillOrder(app, order.id, payload);

    const { db } = await import('../server/db');
    await db.prepare("update orders set status='refund_manual_review',refund_reason='inconclusive' where id=?").run(order.id);

    const res = await request(app).post(`/api/admin/orders/${order.id}/refund/reconcile`).set('Authorization', `Bearer ${token}`).send({ outcome: 'not_refunded', note: 'external refund did not process' }).expect(200);
    expect(res.body.status).toBe('fulfilled');
    expect(await countEntitlements()).toBe(1);
  });

  // 14. unknown order (refund for a non-existent order)
  it('rejects refund for unknown order with 409', async () => {
    const token = await login(app);
    const res = await request(app).post('/api/admin/orders/nonexistent-order-id/refund').set('Authorization', `Bearer ${token}`).send({ reason: 'refund test' }).expect(409);
    expect(res.body.error.code).toBe('refund_not_available');
  });
});




