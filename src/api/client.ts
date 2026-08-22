import type {ApiErrorPayload} from '../types/api';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public requestId?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

let authToken: string | null = null;
export const session = {
  get: () => authToken,
  set: (token: string) => { authToken = token; },
  clear: () => { authToken = null; },
};

type RefreshHandler = () => Promise<string | null>;
let refreshHandler: RefreshHandler | null = null;
let refreshPromise: Promise<string | null> | null = null;
export function setAuthRefreshHandler(handler: RefreshHandler | null) { refreshHandler = handler; }

async function request<T>(path: string, options: RequestInit, allowRefresh: boolean): Promise<T> {
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(options.body && !isFormData ? { 'Content-Type': 'application/json' } : {}),
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...(options.headers as Record<string, string> | undefined),
  };
  const response = await fetch(`/api${path}`, { credentials: 'include', ...options, headers });
  if (response.ok) return response.json() as Promise<T>;
  const body = await response.json().catch(() => ({})) as ApiErrorPayload;
  const detail = typeof body.error === 'string' ? { message: body.error } : body.error || {};
  if (response.status === 401) {
    session.clear();
    if (allowRefresh && refreshHandler && path !== '/auth/telegram') {
      refreshPromise ||= refreshHandler().finally(() => { refreshPromise = null; });
      const nextToken = await refreshPromise;
      if (nextToken) { session.set(nextToken); return request<T>(path, options, false); }
    }
  }
  throw new ApiError(response.status, detail.code || 'request_failed', detail.message || response.statusText, detail.requestId);
}

export function api<T>(path: string, options: RequestInit = {}) { return request<T>(path, options, true); }
