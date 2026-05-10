# Wish: observability-hub P2 Omni OTel — IAgentProvider contract + Omni OTel SDK + JourneyTracker spans

| Field | Value |
|-------|-------|
| **Status** | DRAFT |
| **Slug** | `observability-hub-p2-omni-otel` |
| **Date** | 2026-04-27 |
| **Parent design** | `namastexlabs/genie-omni` at `.genie/brainstorms/observability-hub/DESIGN.md` |
| **Parent umbrella** | `namastexlabs/genie-omni` at `.genie/wishes/observability-hub-p2-producers/WISH.md` (groups 2.1 + 2.2 — this wish executes them) |
| **Repo** | `automagik-dev/omni` (this checkout) |
| **Branch base** | `dev` |
| **PR target** | `automagik-dev/omni` ← `feat/observability-otel` |
| **Sibling teams** | `obs-agno` working group 2.3 in parallel; `obs-infra` already shipped via `khal-os/o11y` |
| **Backend live** | SigNoz Community EE v0.119.0 @ `http://10.114.1.173:8080`; OTLP `:4317` (gRPC) / `:4318` (HTTP) reachable from this host |

## Architectural invariant — read this first

**Producer code MUST NOT reference any specific OTel backend vendor.** No `signoz`, `jaeger`, `honeycomb`, `datadog`, `grafana`, `tempo`, `otel-collector` (ours or theirs) in any `.ts`, `.js`, `package.json`, or test file. Use only standard OTel env vars:

- `OTEL_EXPORTER_OTLP_ENDPOINT`
- `OTEL_SERVICE_NAME`
- `OTEL_RESOURCE_ATTRIBUTES`
- `OTEL_EXPORTER_OTLP_HEADERS` (optional, for auth)

**Review tripwire:** the PR review will run `grep -ri 'signoz\|jaeger\|honeycomb\|datadog\|tempo' src/ packages/ apps/` — must return zero hits in producer source. Any infra-side vendor reference goes to `khal-os/o11y` (separate repo, already shipped).

## Summary

Add OpenTelemetry tracing to Omni so a single customer message produces a distributed trace that begins at Gupshup webhook ingest (T0), flows through NATS, the Omni API, the agent provider HTTP call, and the outbound Gupshup send (T11), all under one `trace_id`. Achieves this via:

1. **`IAgentProvider` observability contract** — optional shape on the provider interface so Omni can ask any provider to participate in trace propagation. Default no-op for providers that don't implement.
2. **OTel SDK bootstrap** — initialize `@opentelemetry/sdk-node` reading `OTEL_*` env vars at API startup. Adds zero overhead when env is unset.
3. **`JourneyTracker` → spans** — the existing in-memory T0–T11 lifecycle tracker emits OTel spans alongside its current behavior. Producers send spans to whatever the operator configured.
4. **NATS publisher dual-header** — every outbound NATS message carries both W3C `traceparent` (industry standard) and khal-os custom headers (`x-trace-id`, `x-span-id`, `x-parent-span-id`) for forward-compat.
5. **NATS subscriber extraction** — incoming messages hydrate the span context so cross-process traces stitch.
6. **HTTP `traceparent` injection** — the agent provider HTTP client injects W3C trace context on outgoing requests so Agno (or any HTTP-based provider) can attach its spans as children.

## Scope

### IN — Group 2.1: `IAgentProvider` observability contract

Add an **optional** `observability` field to the provider interface at `packages/core/src/providers/types.ts`:

```ts
export interface TraceContext {
  /** W3C trace-id — 32 hex chars (16 bytes). */
  traceId: string;
  /** W3C span-id of the current span — 16 hex chars (8 bytes). */
  spanId: string;
  /** Optional parent span-id for nested propagation. */
  parentSpanId?: string;
  /** W3C trace flags (1 = sampled, 0 = not). Default 1 when unset. */
  traceFlags?: number;
}

export interface IAgentProvider {
  // ... existing fields ...

  /**
   * Optional observability hooks. Providers that don't implement this fall
   * back to no-op behavior. Backend-neutral — emitted spans flow through
   * whatever OTel SDK the host configured via `OTEL_*` env vars; no vendor
   * SDK is coupled in the producer source.
   */
  observability?: {
    /** Called when an inbound trace context is available; the provider should propagate it to its outbound calls. */
    propagateTrace(ctx: TraceContext): void;

    /** Health probe — returns whether the provider is processing inbound work. */
    heartbeat(): Promise<{ healthy: boolean; lastProcessedAt?: Date; backlog?: number }>;
  };
}
```

Existing providers without an `observability` impl continue to work unchanged. The contract is consumed by group 2.2 (Omni OTel bootstrap calls `propagateTrace` when dispatching to a provider).

### IN — Group 2.2: Omni OTel SDK + JourneyTracker → spans + NATS dual-header + HTTP traceparent

#### 2.2.a — Promote `@opentelemetry/sdk-node` to direct dependency

Currently it's transitive. Add to `packages/core/package.json` (or wherever the SDK boot lives):

- `@opentelemetry/sdk-node` (latest stable)
- `@opentelemetry/api` (already transitive — make explicit)
- `@opentelemetry/exporter-trace-otlp-http` (for OTLP/HTTP)
- `@opentelemetry/instrumentation-http` (HTTP client auto-context)

Verify with `grep -r '"@opentelemetry/sdk-node"' packages/*/package.json`.

#### 2.2.b — Bootstrap

Create `apps/api/src/bootstrap/otel.ts`:

```ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';

export function bootstrapOtel(): NodeSDK | null {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return null; // no-op when unset

  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME || 'omni-api',
    traceExporter: new OTLPTraceExporter({
      url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`,
    }),
    instrumentations: [new HttpInstrumentation()],
  });
  sdk.start();
  return sdk;
}
```

Call from `apps/api/src/index.ts` BEFORE any other imports that may emit spans. Graceful shutdown on SIGTERM.

**Zero references to backend vendor names.** Endpoint is supplied via env at deploy time.

#### 2.2.c — `JourneyTracker.recordCheckpoint(T)` → spans

`packages/core/src/tracing/journey-tracker.ts` already records 11 lifecycle stages. Refactor `recordCheckpoint(T, journey)` to ALSO emit OTel spans. Each T-stage becomes a span event on the parent trace span (or a child span for stages with measurable duration).

Preserve the in-memory cache behavior for restart survivability (don't replace, augment).

Per the agent run (T0–T11 across multiple processes), the trace_id flows via:
- T0–T1: Gupshup webhook handler creates the root span, sets `service.name=omni-api`
- T2–T3: NATS publish/consume — propagated via headers (see 2.2.d)
- T5–T7: HTTP call to agent provider — propagated via `traceparent` (see 2.2.f)
- T9–T11: NATS publish/consume back, plugin send

#### 2.2.d — NATS publisher dual-header injection

`packages/core/src/events/publisher.ts`. On every outbound NATS message:

```ts
const ctx = trace.getActiveSpan()?.spanContext();
const headers = msg.headers ?? new MsgHdrs();
if (ctx) {
  // W3C traceparent
  const traceparent = `00-${ctx.traceId}-${ctx.spanId}-0${ctx.traceFlags.toString(16)}`;
  headers.set('traceparent', traceparent);
  // khal-os custom (forward-compat with khal-os o11y native consumer)
  headers.set('x-trace-id', ctx.traceId);
  headers.set('x-span-id', ctx.spanId);
}
```

#### 2.2.e — NATS subscriber extraction

Counterpart in subscriber: read headers, prefer `traceparent` (W3C standard), fallback to `x-trace-id`. Set the active span context so downstream code emits child spans correctly.

#### 2.2.f — HTTP client `traceparent` on agent provider calls

Whichever HTTP client the agent dispatcher uses to call providers (Agno, etc.). With `HttpInstrumentation` from 2.2.a auto-injecting, this might be free. Verify by inspecting actual outbound headers in test.

### OUT (out of scope)

- Backend deployment (lives in `khal-os/o11y` — already shipped)
- Alert rules (also `khal-os/o11y`)
- System exporters (also `khal-os/o11y`)
- Genie mailbox trace_id stamping (separate wish `observability-hub-p2-genie`, deferred)
- pack-observability UI (P3 deferred)
- Agno-side OTLP export (sibling team `obs-agno`, group 2.3)
- Logs pipeline (out of scope — only traces in this wish)
- Metrics from Omni code (host metrics handled by khal-os/o11y Collector)

## Decisions

| Decision | Rationale |
|----------|-----------|
| `observability` field on `IAgentProvider` is OPTIONAL | Backwards compat — existing providers unchanged |
| Bootstrap returns `null` if `OTEL_EXPORTER_OTLP_ENDPOINT` is unset | Zero overhead when observability is off |
| Dual-emit W3C `traceparent` + khal-os `x-trace-id` headers | W3C is industry standard; khal-os custom is for forward-compat when khal-os Platform's native o11y consumer ships |
| `JourneyTracker.recordCheckpoint` augmented (not replaced) | Restart survivability + don't break existing in-memory consumers |
| Use `OTLPTraceExporter` from `exporter-trace-otlp-http` (not gRPC) | HTTP works through more network paths; simpler debugging; gRPC variant available if needed later |

## Success Criteria

- [ ] **2.1.a** `IAgentProvider` interface in `packages/core/src/providers/types.ts` has optional `observability` field with 2 methods (`propagateTrace`, `heartbeat`) and a `TraceContext` interface that includes `traceFlags`
- [ ] **2.1.b** Type definition compiles; existing providers (NatsGenieProvider, AgnoHttpProvider, etc.) unchanged and still pass typecheck
- [ ] **2.1.c** Unit test: provider without `observability` field → consuming code calls fallback noop without throwing
- [ ] **2.2.a** `@opentelemetry/sdk-node` is a direct dep in the right package.json
- [ ] **2.2.b** `bootstrapOtel()` returns `null` when env unset; returns SDK instance when set
- [ ] **2.2.c** `JourneyTracker.recordCheckpoint(T)` emits a span event per T-stage when SDK is initialized; existing in-memory tracking unaffected
- [ ] **2.2.d** Outbound NATS messages from `events/publisher.ts` carry both `traceparent` AND `x-trace-id`/`x-span-id` headers when in active trace context
- [ ] **2.2.e** Inbound NATS messages with `traceparent` hydrate the span context for downstream code
- [ ] **2.2.f** HTTP requests to agent providers carry `traceparent` header
- [ ] **DoD-grep**: `grep -ri 'signoz\|jaeger\|honeycomb\|datadog\|tempo\|grafana cloud' packages/ apps/ src/` returns nothing in producer source
- [ ] **DoD-e2e** (manual smoke): with `OTEL_EXPORTER_OTLP_ENDPOINT=http://10.114.1.173:4318` set, send a Gupshup webhook → query backend by chat_id → see a single trace with T0…T11 spans linked

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Upstream PR review latency | Medium | Open as draft early; tag reviewers; bench-test perf claim |
| Span overhead at high throughput | Low | `BatchSpanProcessor` is async; fallback to no-op when env unset |
| Existing pino logs duplicate trace_id | Low | Pino logs already include `traceId` field — keep, harmless duplication |
| Test suite spawns its own NATS/PM2 | Medium | Tests stub OTel SDK or assert on noop path; avoid wall-clock dependence |

## Workflow

1. Read this wish + parent design + parent umbrella
2. Implement group 2.1 first (contract) — small change, easy review
3. Implement group 2.2 (bootstrap → JourneyTracker → NATS publisher → NATS subscriber → HTTP) in that order
4. Per-step: tests + biome lint + typecheck pass before moving on
5. Commit conventionally per group, push to `feat/observability-otel`
6. Open PR to `automagik-dev/omni` base `dev` titled `feat(observability): IAgentProvider contract + OTel SDK + dual-header trace propagation`
7. Notify cross-team via `genie send --to obs-agno` when contract lands so they know the propagation shape
8. Report DoD via `genie send --to omni`

## References

- Parent design: `namastexlabs/genie-omni` at `.genie/brainstorms/observability-hub/DESIGN.md`
- Parent umbrella wish: `namastexlabs/genie-omni` at `.genie/wishes/observability-hub-p2-producers/WISH.md`
- Backend (operational target): `khal-os/o11y` (config + receivers + alert rules already deployed)
- Sibling team: `obs-agno` working group 2.3 in `namastexlabs/genie-hv-eugenia`
- Incident #445 (the silent-death incident this work prevents recurrence of): `automagik-dev/omni#445` (closed via `v2.260418.1`)
