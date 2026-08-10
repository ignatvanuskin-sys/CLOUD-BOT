import { describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';

const enabled = process.env.RUN_PRODUCTION_ADAPTER_CONTRACTS === 'true';
const suite = enabled ? describe : describe.skip;

suite('production adapter contracts', () => {
  it('runs PostgreSQL migration and query/transaction contracts', async () => {
    expect(process.env.DB_DRIVER).toBe('postgres');
    const { db, migrate } = await import('../server/db');
    await migrate();
    expect(await db.prepare("select version from schema_migrations where version=?").get('002_delivery_refund_state_machines')).toBeTruthy();
    await db.transaction(async (tx) => { expect(await tx.prepare('select 1 as ok').get()).toMatchObject({ ok: 1 }); });
  });

  it('runs Redis TTL and atomic increment contracts', async () => {
    const { loadConfig } = await import('../server/config');
    const { createTtlStore } = await import('../server/state');
    const store = createTtlStore(loadConfig());
    const key = `contract:${Date.now()}`;
    await store.set(key, 'value', 60);
    expect(await store.get(key)).toBe('value');
    expect(await store.incrWithTtl(`${key}:counter`, 60)).toBe(1);
    expect(await store.incrWithTtl(`${key}:counter`, 60)).toBe(2);
    await store.del(key);
    expect(await store.get(key)).toBeNull();
    await store.close();
  });

  it('runs S3 put/head/get contracts', async () => {
    expect(process.env.STORAGE_DRIVER).toBe('s3');
    const { createStorageAdapter } = await import('../server/storage');
    const adapter = createStorageAdapter();
    const key = `contracts/${Date.now()}.txt`;
    const body = Buffer.from('adapter-contract');
    const stored = await adapter.putObject({ key, body, contentType: 'text/plain' });
    expect(stored.size).toBe(body.length);
    expect((await adapter.headObject(key)).size).toBe(body.length);
    const stream = await adapter.getObject(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream as Readable) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(body);
  });
});
