import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { loadConfig } from './config';

export type PutObjectInput = { key: string; body: Buffer | Readable | Uint8Array | string; contentType: string; fileName?: string };
export type StoredObject = { key: string; size: number; checksum: string; contentType?: string };
export interface StorageAdapter {
  putObject(input: PutObjectInput): Promise<StoredObject>;
  getObject(key: string): Promise<Readable>;
  headObject(key: string): Promise<{ size: number; checksum?: string; contentType?: string }>;
  createDownloadUrl(key: string, ttlSeconds: number, fileName: string): Promise<string>;
  deleteObject(key: string): Promise<void>;
  healthy(): Promise<boolean>;
}

let cachedRoot: string | undefined;
function getRoot() {
  if (!cachedRoot) cachedRoot = path.resolve(loadConfig().STORAGE_LOCAL_ROOT);
  return cachedRoot;
}

export function hashToken(token: string) { return crypto.createHash('sha256').update(token).digest('hex'); }
export function createAssetKey(productId: string, version: string, assetId: string, fileName: string, quarantine = false) {
  const ext = path.extname(fileName).toLowerCase() || '.bin';
  for (const part of [productId, version, assetId]) if (!/^[a-zA-Z0-9_.-]{1,80}$/.test(part)) throw new Error('bad_asset_key');
  return `${quarantine ? 'quarantine' : 'products'}/${productId}/${version}/${assetId}${ext}`;
}
export function safeStoragePath(storageKey: string) {
  const root = getRoot();
  if (!/^[a-zA-Z0-9/_.,-]{1,240}$/.test(storageKey) || storageKey.includes('..')) throw new Error('bad_storage_key');
  const resolved = path.resolve(root, storageKey);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) throw new Error('bad_storage_key');
  return resolved;
}
function checksum(data: Buffer) { return crypto.createHash('sha256').update(data).digest('hex'); }

class LocalStorageAdapter implements StorageAdapter {
  async putObject(input: PutObjectInput) { const file = safeStoragePath(input.key); fs.mkdirSync(path.dirname(file), { recursive: true }); const buffer = Buffer.isBuffer(input.body) ? input.body : Buffer.from(String(input.body)); fs.writeFileSync(file, buffer); return { key: input.key, size: buffer.length, checksum: checksum(buffer), contentType: input.contentType }; }
  async getObject(key: string) { const file = safeStoragePath(key); if (!fs.existsSync(file)) throw new Error('storage_not_found'); return fs.createReadStream(file); }
  async headObject(key: string) { const file = safeStoragePath(key); const stat = fs.statSync(file); return { size: stat.size }; }
  async createDownloadUrl(key: string) { return `/api/storage/local/${encodeURIComponent(key)}`; }
  async deleteObject(key: string) { const file = safeStoragePath(key); if (fs.existsSync(file)) fs.unlinkSync(file); }
  async healthy() { return fs.existsSync(getRoot()); }
}

class S3StorageAdapter implements StorageAdapter {
  private s3: S3Client;
  constructor() { const c = loadConfig(); this.s3 = new S3Client({ region: c.S3_REGION, endpoint: c.S3_ENDPOINT, forcePathStyle: c.S3_FORCE_PATH_STYLE === 'true', credentials: { accessKeyId: c.S3_ACCESS_KEY_ID || '', secretAccessKey: c.S3_SECRET_ACCESS_KEY || '' } }); }
  async putObject(input: PutObjectInput) { const body = input.body; const buffer = Buffer.isBuffer(body) ? body : typeof body === 'string' ? Buffer.from(body) : undefined; const c = loadConfig(); await this.s3.send(new PutObjectCommand({ Bucket: c.S3_BUCKET, Key: input.key, Body: body, ContentType: input.contentType, ChecksumSHA256: buffer ? checksum(buffer) : undefined })); const head = await this.headObject(input.key); return { key: input.key, size: head.size, checksum: head.checksum || (buffer ? checksum(buffer) : ''), contentType: input.contentType }; }
  async getObject(key: string) { const c = loadConfig(); const out = await this.s3.send(new GetObjectCommand({ Bucket: c.S3_BUCKET, Key: key })); return out.Body as Readable; }
  async headObject(key: string) { const c = loadConfig(); const out = await this.s3.send(new HeadObjectCommand({ Bucket: c.S3_BUCKET, Key: key })); return { size: Number(out.ContentLength || 0), checksum: out.ChecksumSHA256, contentType: out.ContentType }; }
  async createDownloadUrl(key: string, ttlSeconds: number, fileName: string) { const c = loadConfig(); return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: c.S3_BUCKET, Key: key, ResponseContentDisposition: `attachment; filename="${fileName.replace(/"/g, '')}"` }), { expiresIn: ttlSeconds }); }
  async deleteObject(key: string) { void key; throw new Error('delete_requires_explicit_policy'); }
  async healthy() { try { const c = loadConfig(); if (!c.S3_BUCKET) return false; await this.s3.send(new HeadObjectCommand({ Bucket: c.S3_BUCKET, Key: '.healthcheck' })); return true; } catch { return Boolean(loadConfig().S3_BUCKET); } }
}

export function createStorageAdapter(): StorageAdapter { const c = loadConfig(); return c.STORAGE_DRIVER === 's3' ? new S3StorageAdapter() : new LocalStorageAdapter(); }
export const storage = createStorageAdapter();

export async function ensureDemoAsset(productId: string, version: string) {
  const key = createAssetKey(productId, version, 'demo-package', 'demo-package.txt');
  const body = 'DEMO PACKAGE\n01_START_HERE/\n02_SOURCE/\n03_CONFIG_EXAMPLE/\n04_DOCS/\n05_LICENSE/\n06_CHANGELOG/\n';
  return storage.putObject({ key, body, contentType: 'text/plain', fileName: 'demo-package.txt' });
}
export async function readAsset(storageKey: string) { return storage.getObject(storageKey); }
