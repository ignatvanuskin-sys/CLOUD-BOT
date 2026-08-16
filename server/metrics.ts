type MetricsState = { requests: number; errors: number; rateLimited: number; latencyMs: number; startedAt: string };
const state: MetricsState = { requests: 0, errors: 0, rateLimited: 0, latencyMs: 0, startedAt: new Date().toISOString() };
export function recordRequest(status: number, durationMs: number) { state.requests += 1; state.latencyMs += durationMs; if (status >= 500) state.errors += 1; if (status === 429) state.rateLimited += 1; }
export function metricsSnapshot() { return { ...state, averageLatencyMs: state.requests ? Number((state.latencyMs / state.requests).toFixed(2)) : 0 }; }
