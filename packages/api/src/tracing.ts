/**
 * OpenTelemetry SDK bootstrap for @omni/api.
 *
 * Initializes a NodeSDK with an OTLP/HTTP trace exporter when the operator
 * has configured the standard OpenTelemetry env vars:
 *
 *   OTEL_EXPORTER_OTLP_ENDPOINT  — e.g. http://collector.internal:4318
 *   OTEL_SERVICE_NAME             — defaults to "omni-api"
 *   OTEL_RESOURCE_ATTRIBUTES      — e.g. deployment.environment=production
 *   OTEL_EXPORTER_OTLP_HEADERS    — optional auth header(s)
 *
 * When OTEL_EXPORTER_OTLP_ENDPOINT is unset the bootstrap is a no-op and
 * the service runs without OTLP export. The pre-existing Sentry init
 * (`./instrument`) is unaffected — both can run in parallel; they target
 * different sinks.
 *
 * **Backend-neutral by design.** No vendor SDK is referenced here. The
 * runtime endpoint is supplied by the host at deploy time. Anyone running
 * Omni points it at any OTLP-compliant backend (Jaeger, Honeycomb, Datadog,
 * self-hosted SigNoz, Grafana Tempo, ...) without code changes.
 *
 * MUST be imported BEFORE most other modules so HTTP auto-instrumentation
 * can monkey-patch the `http`/`https` globals — see index.ts.
 *
 * Refs: observability integration design notes
 */

import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { Resource } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

let sdk: NodeSDK | null = null;

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

if (endpoint) {
  // Endpoint format: base URL only. Append /v1/traces — operators only need
  // to set the base via the env var.
  const tracesUrl = `${endpoint.replace(/\/+$/, '')}/v1/traces`;

  sdk = new NodeSDK({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'omni-api',
    }),
    traceExporter: new OTLPTraceExporter({ url: tracesUrl }),
    instrumentations: [
      new HttpInstrumentation({
        // Don't instrument the OTLP exporter itself (would create loops).
        ignoreOutgoingRequestHook: (req) => {
          const url = `${req.protocol}//${req.host}${req.path}`;
          return url.includes('/v1/traces') || url.includes('/v1/metrics');
        },
      }),
    ],
  });

  try {
    sdk.start();
  } catch (_err) {
    sdk = null;
  }

  // Graceful shutdown so spans flush on SIGTERM/SIGINT.
  const shutdown = async () => {
    if (!sdk) return;
    try {
      await sdk.shutdown();
    } catch {
      // best-effort
    }
    sdk = null;
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
