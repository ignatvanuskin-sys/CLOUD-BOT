import { describe, expect, it } from 'vitest';
import { createDurableQueue } from '../server/queue';
import type { AppConfig } from '../server/config';

const config = { NODE_ENV: 'test', REDIS_KEY_PREFIX: 'queue-test:', REDIS_URL: undefined, REDIS_TLS: 'false', isProduction: false } as unknown as AppConfig;

describe('durable queue contract', () => {
  it('retries a failed job and eventually completes it', async () => {
    const queue = createDurableQueue(config); let attempts = 0; let completed = false;
    await queue.enqueue('test', { value: 42 });
    queue.start(async (job) => { expect(job.type).toBe('test'); attempts += 1; if (attempts < 2) throw new Error('transient'); completed = true; });
    for (let i = 0; i < 20 && !completed; i += 1) await new Promise((resolve) => setTimeout(resolve, 250));
    await queue.close();
    expect(completed).toBe(true); expect(attempts).toBe(2);
  }, 10_000);
});
