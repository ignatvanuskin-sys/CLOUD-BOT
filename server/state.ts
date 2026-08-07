import Redis from 'ioredis';
import type { AppConfig } from './config';
import { loadConfig } from './config';

export interface TtlStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  incrWithTtl(key: string, ttlSeconds: number): Promise<number>;
  close(): Promise<void>;
  healthy(): Promise<boolean>;
}

class MemoryStore implements TtlStore {
  private values = new Map<string, { value: string; expiresAt: number }>();
  async get(key: string) { const v = this.values.get(key); if (!v || v.expiresAt < Date.now()) { this.values.delete(key); return null; } return v.value; }
  async set(key: string, value: string, ttlSeconds: number) { this.values.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 }); }
  async del(key: string) { this.values.delete(key); }
  async incrWithTtl(key: string, ttlSeconds: number) { const current = Number(await this.get(key) || '0') + 1; await this.set(key, String(current), ttlSeconds); return current; }
  async close() { this.values.clear(); }
  async healthy() { return true; }
}

class RedisStore implements TtlStore {
  private redis: Redis;
  constructor(private prefix: string, url: string, tls: boolean) { this.redis = new Redis(url, { lazyConnect: false, tls: tls ? {} : undefined, maxRetriesPerRequest: 2, connectTimeout: 3000 }); }
  private k(key: string) { return this.prefix + key; }
  async get(key: string) { return this.redis.get(this.k(key)); }
  async set(key: string, value: string, ttlSeconds: number) { await this.redis.set(this.k(key), value, 'EX', ttlSeconds); }
  async del(key: string) { await this.redis.del(this.k(key)); }
  async incrWithTtl(key: string, ttlSeconds: number) { const multi = this.redis.multi(); multi.incr(this.k(key)); multi.expire(this.k(key), ttlSeconds); const result = await multi.exec(); return Number(result?.[0]?.[1] || 0); }
  async close() { this.redis.disconnect(); }
  async healthy() { try { return (await this.redis.ping()) === 'PONG'; } catch { return false; } }
}

const globalStore = new WeakMap<AppConfig, TtlStore>();
export function createTtlStore(config = loadConfig()): TtlStore {
  const cached = globalStore.get(config);
  if (cached) return cached;
  const store = config.isProduction || config.REDIS_URL ? new RedisStore(config.REDIS_KEY_PREFIX, config.REDIS_URL || '', config.REDIS_TLS === 'true') : new MemoryStore();
  globalStore.set(config, store);
  return store;
}
