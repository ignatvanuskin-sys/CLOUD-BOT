import Redis from 'ioredis';
import type { AppConfig } from './config';
import { loadConfig } from './config';
import { safeErrorMeta } from './logging';

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
  async incrWithTtl(key: string, ttlSeconds: number) { const existing = this.values.get(key); const current = Number(await this.get(key) || '0') + 1; this.values.set(key, { value: String(current), expiresAt: existing?.expiresAt && existing.expiresAt > Date.now() ? existing.expiresAt : Date.now() + ttlSeconds * 1000 }); return current; }
  async close() { this.values.clear(); }
  async healthy() { return true; }
}

class RedisStore implements TtlStore {
  private redis: Redis;
  constructor(private prefix: string, url: string, tls: boolean, private isProduction: boolean) {
    this.redis = new Redis(url, { lazyConnect: false, tls: tls ? {} : undefined, maxRetriesPerRequest: 2, connectTimeout: 3000 });
    this.redis.on('error', (error) => console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'redis_error', ...safeErrorMeta(error, this.isProduction) })));
  }
  private k(key: string) { return this.prefix + key; }
  async get(key: string) { return this.redis.get(this.k(key)); }
  async set(key: string, value: string, ttlSeconds: number) { await this.redis.set(this.k(key), value, 'EX', ttlSeconds); }
  async del(key: string) { await this.redis.del(this.k(key)); }
  async incrWithTtl(key: string, ttlSeconds: number) {
    const result = await this.redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; return n", 1, this.k(key), ttlSeconds);
    return Number(result);
  }
  async close() { await this.redis.quit().catch(() => { this.redis.disconnect(); }); }
  async healthy() { try { return (await this.redis.ping()) === 'PONG'; } catch { return false; } }
}

const globalStore = new WeakMap<AppConfig, TtlStore>();
export function createTtlStore(config = loadConfig()): TtlStore {
  const cached = globalStore.get(config);
  if (cached) return cached;
  const store = config.isProduction || config.REDIS_URL ? new RedisStore(config.REDIS_KEY_PREFIX, config.REDIS_URL || '', config.REDIS_TLS === 'true', config.isProduction) : new MemoryStore();
  globalStore.set(config, store);
  return store;
}
