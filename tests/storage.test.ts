import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

let root = '';

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'cloud-bot-storage-'));
  process.env.NODE_ENV = 'test';
  process.env.STORAGE_DRIVER = 'local';
  process.env.STORAGE_LOCAL_ROOT = root;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('local storage body contract', () => {
  it.each([
    ['Buffer', () => Buffer.from([0, 1, 2, 255])],
    ['Uint8Array', () => new Uint8Array([0, 1, 2, 255])],
    ['Readable', () => Readable.from([Buffer.from([0, 1]), new Uint8Array([2, 255])])],
  ])('stores %s bytes without mutation or corruption', async (_name, makeBody) => {
    const { createStorageAdapter } = await import('../server/storage');
    const adapter = createStorageAdapter();
    const body = makeBody();
    const original = body instanceof Uint8Array ? Buffer.from(body) : null;
    const stored = await adapter.putObject({ key: 'contracts/body.bin', body, contentType: 'application/octet-stream' });
    expect(await readFile(path.join(root, 'contracts', 'body.bin'))).toEqual(Buffer.from([0, 1, 2, 255]));
    expect(stored.size).toBe(4);
    if (original) expect(Buffer.from(body as Uint8Array)).toEqual(original);
  });
});
