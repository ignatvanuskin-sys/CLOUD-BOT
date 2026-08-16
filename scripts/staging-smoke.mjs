const baseUrl = String(process.env.STAGING_BASE_URL || '').replace(/\/$/, '');
if (!/^https:\/\//i.test(baseUrl)) { console.error('STAGING_BASE_URL must be an HTTPS URL'); process.exit(1); }
const metricsToken = process.env.STAGING_METRICS_TOKEN;
async function check(path, expected = 200, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, { headers, signal: globalThis.AbortSignal.timeout(15_000) });
  const body = await response.json().catch(() => ({}));
  if (response.status !== expected) throw new Error(`${path}: expected ${expected}, got ${response.status}`);
  return { path, status: response.status, ok: body.ok ?? true, requestId: response.headers.get('x-request-id') };
}
const live = await check('/health/live');
const ready = await check('/health/ready');
if (ready.ok !== true) throw new Error('/health/ready did not report ok=true');
const metrics = metricsToken ? await check('/health/metrics', 200, { 'x-metrics-token': metricsToken }) : null;
console.log(JSON.stringify({ ok: true, baseUrl, checks: [live, ready, ...(metrics ? [metrics] : [])] }));
