# Wish: observability-hub P2 — Instrument producers (vendor-neutral OTel)

| Field | Value |
|-------|-------|
| **Status** | DRAFT |
| **Slug** | `observability-hub-p2-producers` |
| **Date** | 2026-04-20 |
| **Parent design** | [observability-hub DESIGN.md](../../brainstorms/observability-hub/DESIGN.md) |
| **Branch** | Multiple (upstream PRs per producer + one local for infra) |
| **Depends on** | P1 (a live OTLP endpoint to point at) |
| **Blocks** | P3 (`pack-observability` UI needs real trace data to build against) |

## Summary

Instrument Omni, Agno, and Genie with vanilla OpenTelemetry SDKs so one customer message produces a single end-to-end distributed trace (Gupshup → Omni → NATS → Agno → NATS → Omni → Gupshup), and system metrics (host/PG/NATS/PM2) flow into the same backend. Silent-failure alert rules land on top of this data to prevent incident-#445-class regressions.

**The invariant of this wish is vendor neutrality at the producer layer.** Omni, Agno, and Genie PRs MUST NOT reference any specific observability backend in source. All vendor-specific configuration lives in the OTel Collector config (our infra) or in operator-level alert rules (SigNoz-specific today, migratable to any OTLP-compliant backend tomorrow). Producer PRs are reviewed with a grep-check: `grep -ri signoz src/ && exit 1`.

## Scope

### IN

**Scope note (2026-04-20):** this wish now covers **Omni + Agno + infra only**. Genie (grupo 2.4 originally) is deferred to `observability-hub-p2-genie` wish pending repo-state resolution (local `repos/genie` is 3616 behind / 2962 ahead of origin/dev; fresh clone needed + audit already done, see that wish). pack-observability is deferred to `observability-hub-p3-pack-observability`.

6 execution groups (originally 7; 2.4 → own wish):

| Group | Layer | Vendor-aware? | Target |
|-------|-------|:---:|--------|
| **2.1** `IAgentProvider` observability contract | Producer code | ❌ | Upstream `automagik-dev/omni` (or fork-bridge) |
| **2.2** Omni OTel SDK bootstrap + `JourneyTracker → spans` + dual-header NATS | Producer code | ❌ | Upstream Omni |
| **2.3** Agno OTLP export + FastAPI `traceparent` middleware + dual-export | Producer code | ❌ | `namastexlabs/genie-hv-eugenia` (branch `dev`, path `apps/agno-api/`) — deployed via `~/prod/eugenia-seller/` |
| ~~**2.4**~~ ~~Genie mailbox~~ | ~~deferred~~ | — | Moved to `observability-hub-p2-genie` |
| **2.5** System exporters (`node_exporter`, `postgres_exporter ×3`, `nats-prometheus-exporter`, `pm2-prometheus-exporter`) scraped by Collector | Our infra | ❌ (Prom/OTLP std) | CT 173 |
| **2.6** OTel Collector config: OTLP receivers, PII scrub processor, backend exporter(s), `otlphttp/khalos` stub | Our infra | ✅ | `infra-observability/` (new repo or subdir) |
| **2.7** Silent-failure alert rules (consumer count, business-hours zero, PM2 restart, NATS pending) | Operator | ✅ | Backend API (today SigNoz `POST /api/v1/rules` — **note: v5 schema**) |

Details:

- **2.1 `IAgentProvider` observability contract**: add optional `observability?: { propagateTrace(traceId, ctx): void; readonly exporter: OTLPSpanExporter | null; heartbeat(): Promise<{ healthy: boolean; lastProcessedAt?: Date; backlog?: number }> }` to `packages/core/src/providers/types.ts`. Providers without impl fallback to no-op.
- **2.2 Omni**:
  - Promote `@opentelemetry/sdk-node` from transitive to direct dep
  - Bootstrap in `apps/api/src/bootstrap/otel.ts` reading `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES` — zero backend vendor references
  - Refactor `JourneyTracker.recordCheckpoint(T)` to call `tracer.startSpan()` / `span.end()` per T-stage, preserving existing in-memory cache as fallback for restart survivability
  - NATS publisher (`packages/core/src/events/publisher.ts`): inject both W3C `traceparent` and khal-os custom headers on outbound
  - NATS subscriber: extract both, prefer W3C when present, stamp span context
  - Agno provider HTTP client (grupo 2.3's partner): inject `traceparent` on outgoing requests
- **2.3 Agno**:
  - Add `opentelemetry-api`, `opentelemetry-sdk`, `opentelemetry-exporter-otlp`, `opentelemetry-instrumentation-fastapi` to `pyproject.toml`
  - Initialize `TracerProvider` + `BatchSpanProcessor` + `OTLPSpanExporter` reading `OTEL_EXPORTER_OTLP_ENDPOINT` — zero backend vendor references
  - Dual-export: existing `agno_spans` PG storage continues as-is (backwards compat, authoritative audit), OTLP fans out in parallel
  - FastAPI middleware reads incoming `traceparent` header, attaches context so OpenInference spans become children
- **2.4 Genie** → **deferred**: see `observability-hub-p2-genie` wish. Audit completed 2026-04-20: schema already landed in origin/dev (column `trace_id` present in `src/lib/runtime-events.ts` INSERT), gap is only `src/services/omni-bridge.ts:726` not extracting `msg.headers`. Fix is ~15–30 lines. Wish separate because `repos/genie` local is 3616/2962 diverged from origin/dev — needs fresh clone workflow.
- **2.5 System exporters**:
  - Deploy binaries on CT 173 (same box as SigNoz + OTel Collector)
  - `postgres_exporter` ×3: omni `:8432`, agno `10.114.1.135:5432`, genie `:19642`
  - Config scraped by Prometheus-format receiver in Collector
- **2.6 OTel Collector config** in `infra-observability/otel-collector.yaml`:
  - Receivers: `otlp` (grpc + http), `prometheus` (for system exporters)
  - Processors: `attributes/scrub` (PII redactor — explicit allowlist), `batch`, `resource` (tag `deployment.environment`)
  - Exporters: `otlphttp/signoz` (live), `otlphttp/khalos` (stubbed, commented with placeholder URL + header)
  - Pipelines: traces/metrics/logs each fan to live exporter(s)
- **2.7 Alert rules** via backend API (SigNoz today — uses **`version:v5`** rule schema in v0.119 EE; P1 attempts with v4 format returned `bad_data`. First step of 2.7 is to capture canonical v5 JSON via UI network-tab inspection, then parameterize):
  - `nats_system_consumer_count < 5 for 2min` → incident-#445 class guard
  - `sum(automation_logs success) == 0 during 09:00–21:00 BRT for 16min` → business heartbeat
  - `rate(pm2_restart) > 0 for 5min` → process instability
  - `nats_pending_messages > 1000 for 5min` → backpressure
  - All rules parameterized, exported as JSON in `infra-observability/rules/*.json`

### OUT

- Backfill of historical traces (producers start fresh from deploy)
- Session replay
- Browser instrumentation (server-side only)
- Long-term storage beyond backend defaults (7d traces / 15d logs / 30d metrics in SigNoz)
- Per-tenant isolation at query time (Community EE = resource attrs + operator policy only)
- GitHub integration (lives in P3)

## Decisions

| Decision | Rationale |
|----------|-----------|
| Each producer PR ships upstream vendor-neutral | Anyone (us, a fork, future khal-os) plugs in their own endpoint; zero lock-in |
| Dual-emit W3C `traceparent` + khal-os `x-trace-id`/`x-span-id`/`x-parent-span-id` | Forward-compat with khal-os when platform ships; W3C is the long-term standard |
| Dual-export at Agno (keep `agno_spans` PG + OTLP out) | Backwards compat; PG is authoritative audit, OTLP is unified query |
| Silent-failure rules live in `infra-observability/rules/*.json` | Migratable: when backend changes, rules are ported not lost |
| 2.5 system exporters on same box as SigNoz+Collector | Simplest MVP; relocate later if needed |
| Collector is the vendor abstraction boundary | Changing backend = edit one YAML block; producers never move |
| Grep tripwire in review (`grep -ri signoz src/`) | Human-readable invariant, bot-automatable |

## Success Criteria

- [ ] **a** One real production message traces Gupshup → Omni → HTTP/`traceparent` → Agno → response → Omni → Gupshup with a single `trace_id`, visible in the backend UI, queryable by `chat_id` (NATS leg to Genie intentionally not traced in this wish — Genie deferred)
- [ ] **c** Dashboards for Host / PG×3 / NATS / PM2 populated with 7 days of data
- [ ] **d** Alert "NATS SYSTEM consumer drop" fires <2min in test (prevention for incident #445 class)
- [ ] **e** Alert "automation_logs zero success in business hours" fires <16min
- [ ] **f** Collector config has `otlphttp/khalos` exporter stub (commented, valid YAML) — forward-compat proof
- [ ] **g** Grep check in Omni & Agno PRs: `grep -ri signoz packages/ src/ apps/` returns nothing in producer source (only in infra/operator-level artifacts)
- [ ] **i** Canonical v5 rule JSON schema captured from UI network tab, committed to `infra-observability/rules/_schema-reference.json` — unblocks programmatic rule creation

(DoD `b` and `h` moved to `observability-hub-p2-genie` wish.)

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Upstream PR review latency on omni | Medium | Fork-build bridge per workspace convention; open discussion issue first |
| PII in trace attributes (Hapvida compliance) | **High** | 2.6 `attributes/scrub` processor is mandatory blocker before 2.2/2.3 deploy; security review of config |
| `IAgentProvider` contract breaks other providers | Medium | `observability` key is optional; providers without impl fallback noop |
| Agno OTLP export increases latency | Low | `BatchSpanProcessor` is async; monitored via 2.5 metrics |
| Alert rule storm during cutover | Medium | Initial thresholds conservative; tune after 7 days of baseline data |
| SigNoz v0.119 EE `version:v5` rule schema undocumented in v4 references | Medium | 2.7 first step = capture canonical JSON from UI network tab; falls-back to manual rule creation if API friction persists |

## Execution Groups dependency graph

```
P1 (backend live) ✅
 └─▶ 2.1 IAgentProvider contract
      ├─▶ 2.2 Omni SDK + JourneyTracker
      └─▶ 2.3 Agno OTLP
 └─▶ 2.5 System exporters ─▶ 2.6 Collector config ─▶ 2.7 Alert rules (v5 schema capture)

(2.4 Genie → separate wish `observability-hub-p2-genie`)
```

2.1 gates 2.2/2.3 (contract must exist first). 2.5/2.6 can run in parallel with 2.2-2.3. 2.7 depends on real signals flowing from 2.3 + 2.5.

## References

- Parent DESIGN: [`.genie/brainstorms/observability-hub/DESIGN.md`](../../brainstorms/observability-hub/DESIGN.md)
- Omni source: `~/dev/omni` (remote `automagik-dev/omni`)
- Agno repo: `github.com/namastexlabs/genie-hv-eugenia` (branch `dev`, path `apps/agno-api/`); deployed checkout at `~/prod/eugenia-seller/apps/agno-api/`
- Omni upstream JourneyTracker: `packages/core/src/tracing/journey-tracker.ts`
- Omni upstream EventMetadata (correlationId, traceId): `packages/core/src/events/types.ts:163,168`
- Omni upstream NatsOutboundMessage (traceId): `packages/core/src/providers/nats-genie-provider.ts:49`
- khal-os trace header convention: `/home/genie/dev/khal-os/packages/os-sdk/src/service/trace.ts`
- Genie NULL trace_id evidence: `SELECT count(*) FROM genie_runtime_events WHERE source='mailbox' AND trace_id IS NULL`
- Incident #445: `automagik-dev/omni#445` (closed via PR #446, `v2.260418.1`)
