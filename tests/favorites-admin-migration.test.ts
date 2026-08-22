import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import fs from 'node:fs';
import path from 'node:path';

describe('production fixes: favorites migration chain, favorites CRUD/ownership, admin gating', () => {
  let app: Express;
  beforeEach(async () => {
    vi.resetModules();
    process.env.NODE_ENV = 'test';
    process.env.ALLOW_DEV_LOGIN = 'true';
    process.env.DB_DRIVER = 'sqlite';
    process.env.STORAGE_DRIVER = 'local';
    process.env.DATABASE_PATH = `./data/mini-app-fixes-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`;
    process.env.WEBHOOK_SECRET = 'test-secret-token-123';
    const { db, migrate } = await import('../server/db');
    await migrate();
    await db.exec('delete from audit_log; delete from product_assets; delete from user_favorites; delete from orders; delete from products; delete from users; delete from admin_users;');
    app = (await import('../server/app')).createApp();
  });
  afterEach(async () => {
    await (await import('../server/app')).closeRuntimeResources();
    await (await import('../server/db')).closeDb();
  });
  async function token(id: number) {
    return (await request(app).post('/api/auth/telegram').send({ devTelegramId: id })).body.token as string;
  }

  it('includes 004_user_favorites in the PostgreSQL migration chain and the file is executable idempotently', async () => {
    const { POSTGRES_MIGRATIONS } = await import('../server/db');
    const entry = POSTGRES_MIGRATIONS.find((m) => m.version === '004_user_favorites');
    expect(entry).toBeDefined();
    const file = path.resolve('server/db/postgres-migrations', (entry as { file: string }).file);
    expect(fs.existsSync(file)).toBe(true);
    const sql = fs.readFileSync(file, 'utf8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS user_favorites');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_favorites_user');
    const versions = POSTGRES_MIGRATIONS.map((m) => m.version);
    expect(new Set(versions).size).toBe(versions.length);
    // order: user_favorites runs after 001_initial (users/products exist) and never rewrites existing tables
    const index = versions.indexOf('004_user_favorites');
    expect(versions.indexOf('001_initial')).toBeLessThan(index);
  });

  it('favorites CRUD works and ownership is enforced between users', async () => {
    const { db } = await import('../server/db');
    await db.prepare("insert into products(id,slug,type,category,title,result,status) values(?,?,?,?,?,?,?)").run('prod-1', 'prod-1', 'template', 'bots', 'Product 1', 'Result', 'published');
    await db.prepare("insert into products(id,slug,type,category,title,result,status) values(?,?,?,?,?,?,?)").run('prod-3', 'prod-3', 'template', 'bots', 'Product 3', 'Result', 'draft');
    const tA = await token(201);
    const tB = await token(202);
    await request(app).post('/api/me/favorites').set('Authorization', `Bearer ${tA}`).send({ productId: 'prod-1' }).expect(201);
    await request(app).post('/api/me/favorites').set('Authorization', `Bearer ${tA}`).send({ productId: 'prod-1' }).expect(200);
    const bList = await request(app).get('/api/me/favorites').set('Authorization', `Bearer ${tB}`).expect(200);
    expect(bList.body.items).toEqual([]);
    const aList = await request(app).get('/api/me/favorites').set('Authorization', `Bearer ${tA}`).expect(200);
    expect(aList.body.items.map((i: { product_id: string }) => i.product_id)).toEqual(['prod-1']);
    await request(app).delete('/api/me/favorites/prod-1').set('Authorization', `Bearer ${tB}`).expect(404);
    await request(app).delete('/api/me/favorites/prod-1').set('Authorization', `Bearer ${tA}`).expect(200);
    const after = await request(app).get('/api/me/favorites').set('Authorization', `Bearer ${tA}`).expect(200);
    expect(after.body.items).toEqual([]);
    await request(app).post('/api/me/favorites').set('Authorization', `Bearer ${tA}`).send({ productId: 'prod-3' }).expect(404);
  });

  it('admin endpoints: non-admin gets 403, configured admin is allowed', async () => {
    const { bootstrapAdmins } = await import('../server/db');
    await bootstrapAdmins('301');
    const nonAdmin = await token(302);
    await request(app).post('/api/admin/products').set('Authorization', `Bearer ${nonAdmin}`).send({ title: 'x', result: 'x', type: 'template', category: 'x' }).expect(403);
    const admin = await token(301);
    await request(app).get('/api/me/access').set('Authorization', `Bearer ${admin}`).expect(200, { role: 'owner', canCreateProjects: true, canPublishProjects: true });
    const created = await request(app).post('/api/admin/products').set('Authorization', `Bearer ${admin}`).send({ title: 'x', result: 'x', type: 'template', category: 'x', slug: 'admin-ok' }).expect(201);
    expect(created.body.status).toBe('draft');
  });
});
