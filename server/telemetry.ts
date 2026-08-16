import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { loadConfig } from './config';

let sdk: NodeSDK | null = null;

export function startTelemetry() {
  const config = loadConfig();
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.replace(/\/$/, '');
  if (!endpoint) return;
  const headers = process.env.OTEL_EXPORTER_OTLP_HEADERS?.split(',').reduce<Record<string, string>>((out, pair) => { const [key, value] = pair.split('='); if (key && value) out[key.trim()] = value.trim(); return out; }, {});
  sdk = new NodeSDK({
    resource: resourceFromAttributes({ 'service.name': process.env.OTEL_SERVICE_NAME || 'cloud-bot', 'service.version': process.env.npm_package_version || '1.0.0', 'deployment.environment.name': config.NODE_ENV }),
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces`, headers }),
    metricReader: new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics`, headers }), exportIntervalMillis: Number(process.env.OTEL_METRIC_EXPORT_INTERVAL_MS || 30_000) }),
    instrumentations: [getNodeAutoInstrumentations({ '@opentelemetry/instrumentation-fs': { enabled: false } })],
  });
  sdk.start();
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', event: 'telemetry_started', endpoint, service: process.env.OTEL_SERVICE_NAME || 'cloud-bot' }));
}

export async function stopTelemetry() { if (sdk) await sdk.shutdown().catch(() => undefined); sdk = null; }
