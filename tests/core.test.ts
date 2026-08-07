import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import request from 'supertest';
import { parseStartParam, validateTelegramInitData } from '../server/schema';
import { safeStoragePath, createAssetKey } from '../server/storage';
import { scanTextForSecrets, validateMagicBytes } from '../server/scanner';

function signed(botToken: string, user: any, authDate: number) {
  const p = new URLSearchParams({ user: JSON.stringify(user), auth_date: String(authDate), query_id: 'q' });
  const data = [...p.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  p.set('hash', crypto.createHmac('sha256', secret).update(data).digest('hex'));
  return p.toString();
}

describe('telegram mini app core', () => {
  it('parses allowlisted startapp params', () => {
    expect(parseStartParam('product_tg-shop-starter')).toEqual({ kind: 'product', id: 'tg-shop-starter' });
    expect(parseStartParam('../bad')).toEqual({ kind: 'catalog' });
    expect(parseStartParam('category_ai')).toEqual({ kind: 'category', slug: 'ai' });
    expect(parseStartParam('ref_ab12')).toEqual({ kind: 'ref', code: 'ab12' });
  });
  it('validates signed initData and rejects tamper/hash length', () => {
    const raw = signed('123:ABC', { id: 42, first_name: 'Ann' }, Math.floor(Date.now() / 1000));
    expect(validateTelegramInitData(raw, '123:ABC').telegramId).toBe('42');
    expect(() => validateTelegramInitData(raw.replace('Ann', 'Eve'), '123:ABC')).toThrow();
    expect(() => validateTelegramInitData(raw.replace(/hash=[^&]+/, 'hash=abc'), '123:ABC')).toThrow();
  });
  it('rejects expired/future/empty/bad user initData', () => {
    expect(() => validateTelegramInitData('', '123:ABC')).toThrow('missing initData');
    expect(() => validateTelegramInitData(signed('123:ABC', { id: 42 }, 1), '123:ABC', 10)).toThrow('expired');
    expect(() => validateTelegramInitData(signed('123:ABC', { id: 42 }, Math.floor(Date.now() / 1000) + 999), '123:ABC')).toThrow('expired');
    const bad = signed('123:ABC', { id: 42 }, Math.floor(Date.now() / 1000)).replace(encodeURIComponent('{"id":42}'), '%7Bbad');
    expect(() => validateTelegramInitData(bad, '123:ABC')).toThrow();
  });
  it('validates object keys and scanner rules', () => {
    expect(() => safeStoragePath('../x')).toThrow();
    expect(createAssetKey('p1','1.0.0','a1','source.zip')).toContain('products/p1/1.0.0/a1.zip');
    expect(scanTextForSecrets('bot123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ').ok).toBe(false);
    expect(validateMagicBytes(Buffer.from('not zip'), 'bad.zip', 'application/zip').ok).toBe(false);
  });
});

describe('api hardening smoke', () => {
  beforeEach(async () => {
    process.env.NODE_ENV = 'test'; process.env.ALLOW_DEV_LOGIN = 'true'; process.env.DB_DRIVER = 'sqlite'; process.env.STORAGE_DRIVER = 'local'; process.env.DATABASE_PATH = './data/test.sqlite'; process.env.WEBHOOK_SECRET = 'test-secret-token-123';
    const { db, migrate } = await import('../server/db'); await migrate(); await await db.exec('delete from webhook_updates; delete from delivery_events; delete from entitlements; delete from orders; delete from product_assets; delete from license_plans; delete from products; delete from users; delete from admin_users;');
    await db.prepare('insert into products(id,slug,type,category,title,result,version,status) values(?,?,?,?,?,?,?,?)').run('p1','p1','template','ai','P1','R','1.0.0','published');
    await db.prepare('insert into license_plans(id,product_id,name,price_xtr,projects,commercial,support_days,updates_days) values(?,?,?,?,?,?,?,?)').run('l1','p1','PRO',100,1,1,30,90);
  });
  afterEach(async () => { const { db } = await import('../server/db'); await db.exec('delete from webhook_updates; delete from delivery_events; delete from entitlements; delete from orders; delete from product_assets; delete from license_plans; delete from products; delete from users; delete from admin_users;'); });
  it('auth dev-login, order snapshot, payment idempotency and protected download', async () => {
    const { createApp } = await import('../server/app'); const app = createApp();
    const auth = await request(app).post('/api/auth/telegram').send({ devTelegramId: 7 }).expect(200); const token = auth.body.token;
    const order = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`).send({ licenseId: 'l1', amount_xtr: 1 }).expect(200);
    expect(order.body.order.amount_xtr).toBe(100);
    const id = order.body.order.id;
    await request(app).post('/api/webhooks/telegram').send({ update_id: 1, pre_checkout_query: { id: 'pc1', invoice_payload: 'bad', currency: 'XTR', total_amount: 100 } }).expect(403);
    await request(app).post('/api/webhooks/telegram').set('x-telegram-bot-api-secret-token','test-secret-token-123').send({ update_id: 2, pre_checkout_query: { id: 'pc2', invoice_payload: `order_${id}_nope`, currency: 'USD', total_amount: 100 } }).expect(200);
    const row = await (await import('../server/db')).db.prepare('select payload from orders where id=?').get(id) as any;
    await request(app).post('/api/webhooks/telegram').set('x-telegram-bot-api-secret-token','test-secret-token-123').send({ update_id: 3, message: { successful_payment: { invoice_payload: row.payload, currency: 'XTR', total_amount: 100, telegram_payment_charge_id: 'ch1' } } }).expect(200);
    await request(app).post('/api/webhooks/telegram').set('x-telegram-bot-api-secret-token','test-secret-token-123').send({ update_id: 3, message: { successful_payment: { invoice_payload: row.payload, currency: 'XTR', total_amount: 100, telegram_payment_charge_id: 'ch1' } } }).expect(200);
    const db = (await import('../server/db')).db; expect(((await db.prepare('select count(*) n from entitlements').get()) as any).n).toBe(1);
    const ent = await db.prepare('select id from entitlements').get() as any;
    await request(app).post('/api/purchases/not-mine/download').set('Authorization', `Bearer ${token}`).expect(404);
    await request(app).post(`/api/purchases/${ent.id}/download`).set('Authorization', `Bearer ${token}`).expect(200);
  });
  it('health endpoints do not expose secrets', async () => { const { createApp } = await import('../server/app'); const res = await request(createApp()).get('/health/ready').expect(200); expect(JSON.stringify(res.body)).not.toContain('test-secret'); });
});
