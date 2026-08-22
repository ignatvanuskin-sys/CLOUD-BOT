import { afterEach, describe, expect, it, vi } from 'vitest';

describe('Telegram CloudStorage fallback', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window;
    vi.resetModules();
  });

  it('resolves safely when no Telegram environment is present', async () => {
    const { cloudGet, cloudSet } = await import('../src/services/telegram');
    await expect(cloudGet('k')).resolves.toBe('');
    await expect(cloudSet('k', 'v')).resolves.toBeUndefined();
  });

  it('does not reject when the SDK throws (WebAppMethodUnsupported simulation)', async () => {
    const storage = {
      getItem: () => { throw new Error('WebAppMethodUnsupported'); },
      setItem: () => { throw new Error('WebAppMethodUnsupported'); },
    };
    (globalThis as Record<string, unknown>).window = { Telegram: { WebApp: { CloudStorage: storage, version: '6.0' } } };
    vi.resetModules();
    const { cloudGet, cloudSet } = await import('../src/services/telegram');
    await expect(cloudGet('k')).resolves.toBe('');
    await expect(cloudSet('k', 'v')).resolves.toBeUndefined();
  });

  it('reads and writes through a supported CloudStorage implementation', async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string, cb: (e: string, v: string) => void) => cb('', values.get(key) || ''),
      setItem: (key: string, value: string, cb: (e: string) => void) => { values.set(key, value); cb(''); },
    };
    (globalThis as Record<string, unknown>).window = { Telegram: { WebApp: { CloudStorage: storage, version: '10.0' } } };
    vi.resetModules();
    const { cloudGet, cloudSet } = await import('../src/services/telegram');
    await cloudSet('k', 'v1');
    await expect(cloudGet('k')).resolves.toBe('v1');
  });
});
