import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { api, session, setAuthRefreshHandler } from '../src/api/client';

describe('api client authorization', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    session.clear();
    setAuthRefreshHandler(null);
    fetchMock.mockReset();
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  function jsonResponse(status: number, body: unknown) {
    return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as Response;
  }

  it('attaches Authorization Bearer header when a token is stored', async () => {
    session.set('tok-123');
    fetchMock.mockResolvedValue(jsonResponse(200, { user: { id: '1' } }));
    await api<{ user: { id: string } }>('/me');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/me');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
  });

  it('does not attach Authorization without a token', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { items: [] }));
    await api<{ items: unknown[] }>('/products');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('retries once with the refreshed token after a 401 and stores it', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: 'auth_required' } }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    setAuthRefreshHandler(() => Promise.resolve('fresh-token'));
    await api<{ ok: boolean }>('/me/orders');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = fetchMock.mock.calls[1] as [string, RequestInit];
    expect((second[1].headers as Record<string, string>).Authorization).toBe('Bearer fresh-token');
    expect(session.get()).toBe('fresh-token');
  });

  it('does not retry in a loop when refresh returns null', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: { code: 'auth_required' } }));
    setAuthRefreshHandler(() => Promise.resolve(null));
    await expect(api('/me')).rejects.toMatchObject({ status: 401, code: 'auth_required' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(session.get()).toBeNull();
  });

  it('throws ApiError on 401 without refresh handler and clears the session', async () => {
    session.set('stale-token');
    fetchMock.mockResolvedValue(jsonResponse(401, { error: { code: 'auth_required', message: 'Требуется вход через Telegram' } }));
    await expect(api('/me')).rejects.toMatchObject({ status: 401, code: 'auth_required', message: 'Требуется вход через Telegram' });
    expect(session.get()).toBeNull();
  });

  it('logout clears the stored token', async () => {
    session.set('tok-abc');
    expect(session.get()).toBe('tok-abc');
    session.clear();
    expect(session.get()).toBeNull();
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));
    await api<{ ok: boolean }>('/auth/logout', { method: 'POST' });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('does not force JSON content-type for FormData bodies (asset upload)', async () => {
    session.set('tok-form');
    fetchMock.mockResolvedValue(jsonResponse(201, { id: 'a1', status: 'approved' }));
    const form = new FormData();
    form.append('productId', 'p1');
    form.append('version', '1.0.0');
    form.append('file', new Blob(['x'], { type: 'text/plain' }), 'readme.txt');
    await api<{ id: string }>('/admin/assets/upload', { method: 'POST', body: form });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok-form');
    expect(headers['Content-Type']).toBeUndefined();
  });
});
