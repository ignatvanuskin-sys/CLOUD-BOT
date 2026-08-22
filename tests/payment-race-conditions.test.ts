import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

const WEBHOOK_SECRET = 'test-secret-token-123';
const ADMIN_IDS = '7';
const DB_PATH = './data/race-test.sqlite';

describe('Payment race condition tests', () => {
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

    const { db, migrate, bootstrapAdmins } = await import('../server/db');
    await migrate();
    await db.exec('delete from webhook_updates; delete from delivery_events; delete from entitlements; delete from orders; delete from product_assets; delete from license_plans; delete from products; delete from users; delete from admin_users;');
    await bootstrapAdmins(ADMIN_IDS);
    await db.prepare('insert into products(id,slug,type,category,title,result,version,status) values(?,?,?,?,?,?,?,?)').run('p1', 'p1', 'template', 'ai', 'Test', 'Result', '1.0.0', 'published');
    await db.prepare('insert into license_plans(id,product_id,name,price_xtr,projects,commercial,support_days,updates_days) values(?,?,?,?,?,?,?,?)').run('l1', 'p1', 'PRO', 100, 1, 1, 30, 90);

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
  });

  it('handles concurrent duplicate webhook processing without race condition', async () => {
    // Login and create order
    const auth = await request(app).post('/api/auth/telegram').send({ devTelegramId: 7 }).expect(200);
    const token = auth.body.token;
    const order = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'race-test-key-abc123').send({ licenseId: 'l1' }).expect(201);

    const { db } = await import('../server/db');
    const payload = (await db.prepare('select payload from orders where id=?').get(order.body.order.id) as any).payload;

    // Send same webhook concurrently (same update_id)
    const update = {
      update_id: 999,
      message: {
        from: { id: 7 },
        successful_payment: {
          invoice_payload: payload,
          currency: 'XTR',
          total_amount: 100,
          telegram_payment_charge_id: 'ch-concurrent',
        },
      },
    };

    const headers = { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET };
    const [res1, res2] = await Promise.all([
      request(app).post('/api/webhooks/telegram').set(headers).send(update),
      request(app).post('/api/webhooks/telegram').set(headers).send(update),
    ]);

    // One should be fulfilled, one should be duplicate
    const results = [res1.body.result, res2.body.result].sort();
    expect(results).toEqual(['duplicate', 'fulfilled']);

    // Exactly one entitlement created
    const count = (await db.prepare('select count(*) n from entitlements where active=1').get() as any).n;
    expect(count).toBe(1);

    // Order fulfilled exactly once
    const orderStatus = await db.prepare('select status from orders where id=?').get(order.body.order.id) as any;
    expect(orderStatus.status).toBe('fulfilled');
  });

  it('handles concurrent different webhooks for same order correctly', async () => {
    // Login and create order
    const auth = await request(app).post('/api/auth/telegram').send({ devTelegramId: 7 }).expect(200);
    const token = auth.body.token;
    const order = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'race-test-2-key-xyz789').send({ licenseId: 'l1' }).expect(201);

    const { db } = await import('../server/db');
    const payload = (await db.prepare('select payload from orders where id=?').get(order.body.order.id) as any).payload;

    const headers = { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET };

    // Send two different update_ids for same order concurrently
    const [res1, res2] = await Promise.all([
      request(app).post('/api/webhooks/telegram').set(headers).send({
        update_id: 1001,
        message: {
          from: { id: 7 },
          successful_payment: { invoice_payload: payload, currency: 'XTR', total_amount: 100, telegram_payment_charge_id: 'ch-race-1' },
        },
      }),
      request(app).post('/api/webhooks/telegram').set(headers).send({
        update_id: 1002,
        message: {
          from: { id: 7 },
          successful_payment: { invoice_payload: payload, currency: 'XTR', total_amount: 100, telegram_payment_charge_id: 'ch-race-2' },
        },
      }),
    ]);

    // One fulfilled, one already_processed
    const results = [res1.body.result, res2.body.result].sort();
    expect(results).toEqual(['already_processed', 'fulfilled']);

    // Exactly one entitlement
    const count = (await db.prepare('select count(*) n from entitlements where active=1').get() as any).n;
    expect(count).toBe(1);
  });
});
