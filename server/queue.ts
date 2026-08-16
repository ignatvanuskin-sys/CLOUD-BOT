import { nanoid } from 'nanoid';
import Redis from 'ioredis';
import type { AppConfig } from './config';
import { safeErrorMeta } from './logging';

export type QueueJob = { id: string; type: string; payload: unknown; attempts: number; createdAt: number; claimedAt?: number };
export type JobHandler = (job: QueueJob) => Promise<void>;

export interface DurableQueue { enqueue(type: string, payload: unknown): Promise<string>; start(handler: JobHandler): void; close(): Promise<void>; healthy(): Promise<boolean>; }

class Queue implements DurableQueue {
  private redis?: Redis;
  private running = false;
  private worker?: Promise<void>;
  private timer?: NodeJS.Timeout;
  private memory: QueueJob[] = [];
  private readonly prefix: string;
  private readonly maxAttempts: number;
  private readonly visibilityMs: number;
  constructor(private readonly config: AppConfig) {
    this.prefix = `${config.REDIS_KEY_PREFIX}jobs:`;
    this.maxAttempts = 5;
    this.visibilityMs = 5 * 60 * 1000;
    if (config.NODE_ENV !== 'test' && config.REDIS_URL) { this.redis = new Redis(config.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 2, connectTimeout: 3000, tls: config.REDIS_TLS === 'true' ? {} : undefined }); this.redis.on('error', (error) => console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'queue_redis_error', ...safeErrorMeta(error, config.isProduction) }))); }
  }
  private key(name: string) { return `${this.prefix}${name}`; }
  async enqueue(type: string, payload: unknown) { const job: QueueJob = { id: nanoid(16), type, payload, attempts: 0, createdAt: Date.now() }; if (this.redis) await this.redis.lpush(this.key('ready'), JSON.stringify(job)); else this.memory.push(job); return job.id; }
  start(handler: JobHandler) { if (this.running) return; this.running = true; if (this.redis) { this.worker = this.redisWorker(handler); this.timer = setInterval(() => void this.promoteDelayed(), 1000); this.timer.unref(); } else { this.worker = this.memoryWorker(handler); } }
  private async redisWorker(handler: JobHandler) { while (this.running && this.redis) { const raw = await this.redis.brpoplpush(this.key('ready'), this.key('processing'), 5).catch(() => null); if (!raw) { await this.recoverStale(); continue; } const job = JSON.parse(raw) as QueueJob; job.claimedAt = Date.now(); try { await handler(job); await this.redis.lrem(this.key('processing'), 1, raw); } catch (error) { await this.redis.lrem(this.key('processing'), 1, raw); job.attempts += 1; if (job.attempts >= this.maxAttempts) await this.redis.lpush(this.key('dead'), JSON.stringify({ ...job, error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) })); else await this.redis.zadd(this.key('delayed'), Date.now() + Math.min(60_000, 1000 * 2 ** job.attempts), JSON.stringify(job)); console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'queue_job_failed', jobId: job.id, jobType: job.type, attempts: job.attempts, ...safeErrorMeta(error, this.config.isProduction) })); } } }
  private async promoteDelayed() { if (!this.redis) return; const now = Date.now(); const jobs = await this.redis.zrangebyscore(this.key('delayed'), 0, now); for (const raw of jobs) { if (await this.redis.zrem(this.key('delayed'), raw)) await this.redis.lpush(this.key('ready'), raw); } }
  private async recoverStale() { if (!this.redis) return; const rawJobs = await this.redis.lrange(this.key('processing'), 0, -1); for (const raw of rawJobs) { try { const job = JSON.parse(raw) as QueueJob; if (job.claimedAt && Date.now() - job.claimedAt > this.visibilityMs) { await this.redis.lrem(this.key('processing'), 1, raw); await this.redis.lpush(this.key('ready'), JSON.stringify({ ...job, claimedAt: undefined })); } } catch { await this.redis.lrem(this.key('processing'), 1, raw); } } }
  private async memoryWorker(handler: JobHandler) { while (this.running) { const job = this.memory.shift(); if (!job) { await new Promise((resolve) => { const timer = setTimeout(resolve, 250); timer.unref(); }); continue; } try { await handler(job); } catch (error) { job.attempts += 1; if (job.attempts < this.maxAttempts) { await new Promise((resolve) => { const timer = setTimeout(resolve, Math.min(60_000, 1000 * 2 ** job.attempts)); timer.unref(); }); this.memory.push(job); } else console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'queue_job_dead_lettered', jobId: job.id, jobType: job.type, ...safeErrorMeta(error, this.config.isProduction) })); } } }
  async healthy() { if (!this.redis) return !this.config.isProduction; try { return (await this.redis.ping()) === 'PONG'; } catch { return false; } }
  async close() { this.running = false; if (this.timer) clearInterval(this.timer); if (this.redis) await this.redis.quit().catch(() => this.redis?.disconnect()); }
}

export function createDurableQueue(config: AppConfig) { return new Queue(config); }
