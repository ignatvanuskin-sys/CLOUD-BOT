import crypto from 'node:crypto';
import fs from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
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

export function hashToken(token: string) { return crypto.createHash('sha256').update(token).digest('hex'); }
export function createAssetKey(productId: string, version: string, assetId: string, fileName: string, quarantine = false) {
  const ext = path.extname(fileName).toLowerCase() || '.bin';
  for (const part of [productId, version, assetId]) if (!/^[a-zA-Z0-9_.-]{1,80}$/.test(part)) throw new Error('bad_asset_key');
  return `${quarantine ? 'quarantine' : 'products'}/${productId}/${version}/${assetId}${ext}`;
}
export function safeStoragePath(storageKey: string) {
  const c = loadConfig();
  const root = path.resolve(c.STORAGE_LOCAL_ROOT);
  if (!/^[a-zA-Z0-9/_.,-]{1,240}$/.test(storageKey) || storageKey.includes('..')) throw new Error('bad_storage_key');
  const resolved = path.resolve(root, storageKey);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) throw new Error('bad_storage_key');
  return resolved;
}
function checksum(data: Buffer) { return crypto.createHash('sha256').update(data).digest('hex'); }
function checksumBase64(data: Buffer) { return crypto.createHash('sha256').update(data).digest('base64'); }
async function bodyToBuffer(body: PutObjectInput['body']): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return Buffer.from(body);
  if (typeof body === 'string') return Buffer.from(body);
  if (body instanceof Uint8Array) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

class LocalStorageAdapter implements StorageAdapter {
  private root: string;
  constructor() { const c = loadConfig(); this.root = path.resolve(c.STORAGE_LOCAL_ROOT); fs.mkdirSync(this.root, { recursive: true }); }
  async putObject(input: PutObjectInput) { const file = safeStoragePath(input.key); await mkdir(path.dirname(file), { recursive: true }); const buffer = await bodyToBuffer(input.body); await writeFile(file, buffer); return { key: input.key, size: buffer.length, checksum: checksum(buffer), contentType: input.contentType }; }
  async getObject(key: string) { const file = safeStoragePath(key); try { await stat(file); } catch { throw new Error('storage_not_found'); } return fs.createReadStream(file); }
  async headObject(key: string) { const file = safeStoragePath(key); const info = await stat(file); return { size: info.size }; }
  async createDownloadUrl(key: string) { return `/api/storage/local/${encodeURIComponent(key)}`; }
  async deleteObject(key: string) { const file = safeStoragePath(key); try { await unlink(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
  async healthy() { try { return (await stat(this.root)).isDirectory(); } catch { return false; } }
}

class S3StorageAdapter implements StorageAdapter {
  private s3: S3Client;
  constructor() { const c = loadConfig(); this.s3 = new S3Client({ region: c.S3_REGION, endpoint: c.S3_ENDPOINT, forcePathStyle: c.S3_FORCE_PATH_STYLE === 'true', credentials: { accessKeyId: c.S3_ACCESS_KEY_ID || '', secretAccessKey: c.S3_SECRET_ACCESS_KEY || '' } }); }
  async putObject(input: PutObjectInput) { const body = input.body; const buffer = Buffer.isBuffer(body) ? body : typeof body === 'string' ? Buffer.from(body) : undefined; const c = loadConfig(); await this.s3.send(new PutObjectCommand({ Bucket: c.S3_BUCKET, Key: input.key, Body: body, ContentType: input.contentType, ChecksumSHA256: buffer ? checksumBase64(buffer) : undefined })); const head = await this.headObject(input.key); return { key: input.key, size: head.size, checksum: buffer ? checksum(buffer) : head.checksum || '', contentType: input.contentType }; }
  async getObject(key: string) { const c = loadConfig(); const out = await this.s3.send(new GetObjectCommand({ Bucket: c.S3_BUCKET, Key: key })); return out.Body as Readable; }
  async headObject(key: string) { const c = loadConfig(); const out = await this.s3.send(new HeadObjectCommand({ Bucket: c.S3_BUCKET, Key: key })); return { size: Number(out.ContentLength || 0), checksum: out.ChecksumSHA256, contentType: out.ContentType }; }
  async createDownloadUrl(key: string, ttlSeconds: number, fileName: string) { const c = loadConfig(); return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: c.S3_BUCKET, Key: key, ResponseContentDisposition: `attachment; filename="${fileName.replace(/"/g, '')}"` }), { expiresIn: ttlSeconds }); }
  async deleteObject(key: string) { const c = loadConfig(); await this.s3.send(new DeleteObjectCommand({ Bucket: c.S3_BUCKET, Key: key })); }
  async healthy() { try { const c = loadConfig(); if (!c.S3_BUCKET) return false; await this.s3.send(new HeadBucketCommand({ Bucket: c.S3_BUCKET })); return true; } catch { return false; } }
}

export function createStorageAdapter(): StorageAdapter { const c = loadConfig(); return c.STORAGE_DRIVER === 's3' ? new S3StorageAdapter() : new LocalStorageAdapter(); }
export const storage = createStorageAdapter();

export async function ensureDemoAsset(productId: string, version: string) {
  const key = createAssetKey(productId, version, 'demo-package', 'demo-package.txt');
  const body = 'DEMO PACKAGE\n01_START_HERE/\n02_SOURCE/\n03_CONFIG_EXAMPLE/\n04_DOCS/\n05_LICENSE/\n06_CHANGELOG/\n';
  return storage.putObject({ key, body, contentType: 'text/plain', fileName: 'demo-package.txt' });
}
export async function readAsset(storageKey: string) { return storage.getObject(storageKey); }
