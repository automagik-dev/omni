---
title: "wish-observability-hub"
type: playbook
tags: [wish, plan, observability, infrastructure, sre]
note: "This is the user-authored seed draft as received on 2026-04-19. Preserved verbatim for reference. Refinement continues in DRAFT.md."
---

# Wish: ObservabilityHub — End-to-end Tracing, Metrics & Error Visibility for Eugênia

| Field | Value |
|-------|-------|
| **Status** | DRAFT |
| **Slug** | `observability-hub` |
| **Date** | 2026-04-19 |
| **Trigger incident** | Omni follow-up silent death — 10h gap, 2026-04-18 |
| **Upstream fix merged** | automagik-dev/omni#445 closed via PR #446 in release `v2.260418.1` |

## 1. Summary

Build a push-based consolidated observability layer for the Eugênia production stack (Omni + Agno + NATS + Gupshup integration) covering:

1. End-to-end distributed tracing — every message traced from Gupshup inbound (T0) through NATS → Omni → Agno → LLM/tools → NATS → Gupshup outbound (T11) under a single `trace_id`.
2. Cross-system correlation — Omni spans + existing Agno OpenInference spans joined in the same trace graph.
3. System-level resource observability — CPU, RAM, disk, network, Postgres queries/locks, NATS consumer lag, PM2 process health.
4. Error visibility & alerting — uncaught exceptions, stack traces, new-error detection, with push notifications.
5. Silent-failure detection — synthetic checks + anomaly alerts for the class of bug that caused incident #445.

**Principle:** all data flows push-only — no external service queries the production API.

## 2. Motivation

On 2026-04-18, follow-up automations stopped firing at 04:05 BRT and nobody noticed until 14:19 BRT — a 10-hour silent gap. Root cause: NATS ephemeral consumer GC'd after 5s idle, the subscription's `for await` iterator exited silently without logs or reconnect.

Systemic gap remains even after PR #446: we cannot detect silent drops in event flow.

Compliance: Hapvida is regulated B2C healthcare-adjacent. Traces contain chat_id, session_id, agent tool arguments (may include PII). Constrains toward **self-hosted** observability.

## 3. Current State Inventory (2026-04-19)

### Host
- Linux 6.8.12-16-pve, 48 cores, 64 GB RAM (4.9 used), 100 GB disk (35% used)
- No exporters installed

### PM2 Processes
- `omni-api` — uptime 25h, 253 MB, 15 restarts, logs at `~/.omni/logs/omni-api-{out,error}.log`
- `omni-nats` — uptime 48h, 10 MB, 0 restarts
- `agno-api-eugenia` — uptime 44h, 24 MB, 7 restarts, logs at `~/prod/eugenia-seller/apps/agno-api/logs/`

### Omni
- Version running: `2.260410.1`; latest upstream `v2.260418.1` with PR #446 fix for #445
- Source: `/home/genie/research/omni-src/`
- Installed build: `~/.bun/install/global/node_modules/@automagik/omni/dist/server/index.js`
- Config: `~/.omni/config.json`
- NATS JetStream dir: `~/.omni/data/nats/jetstream/$G/streams/`
- Embedded Postgres: `localhost:8432/omni`
- API port: 8882

### JourneyTracker (embedded, underutilized)
- Source: `packages/core/src/tracing/journey-tracker.ts`
- All 11 stages active in prod: T0 platformReceivedAt → T11 platformDeliveredAt
- Storage: in-memory `Map<correlationId, Journey>`, 24h TTL, 50k LRU cap
- Exposure: **zero** — no endpoint, no export, data lost on restart
- Correlation key: `EventMetadata.correlationId` at `packages/core/src/events/types.ts:163`; `traceId` field exists too (line 168)

### OpenTelemetry status in Omni
- `@opentelemetry/*` libs in bundle (~30 packages, transitive only)
- Zero SDK initialization: 0 `new NodeSDK(`, 0 `OTLPTraceExporter`, 0 `OTLPMetricExporter`
- 29 `registerInstrumentations` calls without provider → no-op
- Only OTel env var set in PM2: `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=delta`

### Omni logs (pino JSON)
Already include `traceId`, `instanceId`, `chatId`, `module`, `durationMs`. Missing `correlationId`.

### Agno (biggest asset)
- Source: `/home/genie/prod/eugenia-seller/apps/agno-api/`
- `agno[os]>=2.5,<3.0` + `openinference-instrumentation-agno`
- Traces DB: `postgresql+psycopg://nmtsx_dev:***@10.114.1.135:5432/agno_eugenia_traces`
- `AgentOS(db=traces_db, tracing=True, telemetry=True)`
- Tables: `agno_traces`, `agno_spans` (with indexed created_at, start_time, trace_id, parent_span_id)
- Volume: 404 traces / 24h, single trace name `eugenia_seller.arun`, avg 10196ms, spans all `INTERNAL` avg 5839ms
- Gap: no consumer reads, no UI, no cross-service join

### NATS JetStream
- Streams: ACCESS, AGENT, CUSTOM, IDENTITY, INSTANCE, MEDIA, MESSAGE, REACTION, SESSION, SYSTEM
- #445 root cause: ephemeral consumers with `inactive_threshold: 5s` get GC'd silently
- No Prometheus exporter installed

### Postgres
- Embedded omni `localhost:8432/omni` — no exporter
- External Agno `10.114.1.135:5432/agno_eugenia_traces` + sessions — no exporter

### Gupshup (blackbox)
External SaaS; only observable via our webhook ingest (T0) + outbound HTTP result (T11).

## 4. Gap Analysis

### What we DON'T have
- Distributed tracing omni→agno→gupshup
- Error aggregation (scattered in pm2 logs)
- Resource metrics exported
- Postgres query/lock/connection metrics
- NATS consumer lag / msg rate metrics — the #445 blind spot
- PM2 process restart alerts
- Latency SLO dashboards
- Heartbeat / synthetic checks
- Cross-service log correlation
- Uncaught exception alerting

### What we DO have (underused)
- Omni JourneyTracker T0→T11 (in memory, unexported)
- Omni pino logs with traceId
- Agno OpenInference spans in Postgres
- correlationId on every event (in memory)
- PM2 structured metadata
- NATS native metrics endpoint
- Postgres `pg_stat_*` views

## 5. Target Architecture

### Component shape
- Omni (Bun): JourneyTracker → OTel SDK → Tempo; pino → Promtail → Loki; Sentry SDK → Sentry
- Agno (Python): OpenInference spans + OTLP dual-export → Tempo; Sentry SDK → Sentry
- System exporters: node_exporter, postgres_exporter × 2, nats_exporter, pm2 scrape → Mimir
- Grafana LGTM stack (Tempo + Loki + Mimir + Grafana UI + Alertmanager)
- Alertmanager → Discord primary, WhatsApp-via-Eugenia secondary

### Why this combination
1. OTLP = universal standard; Agno speaks it; Omni has libs bundled
2. Grafana LGTM self-hosted = single pane, data on our infra, free, ~2-4 GB RAM
3. Sentry/GlitchTip for errors = different problem class, complements traces
4. Alertmanager multi-channel fan-out = Discord (reliable, independent), WhatsApp (dogfood)

### Correlation model
Single universal key: `trace_id` (W3C traceparent).
- Omni generates at T0 (Gupshup webhook)
- Propagated in NATS headers
- Propagated in HTTP to Agno
- Agno spans become children of Omni trace

### System-level metrics with alert thresholds
CPU >85% 5min; RAM >90% 5min; disk >80%; disk I/O saturation >70%; PG connections >80% max; PG p95 query >1s; NATS pending >1000; NATS ack lag >30s; PM2 restart +1 in 5min; process uptime drop → alert.

### Application-level metrics (derived from traces)
p50/p95/p99 end-to-end latency per instance; Agno round trip; per-tool latency; error rate by module; follow-up fire rate; uncaught exception rate.

### Silent-failure detection (what would catch #445)
1. Synthetic heartbeat: cron hits /health every 60s
2. Business heartbeat: every 15min check `automation_logs` has success rows during 09:00–21:00 BRT
3. NATS consumer count monitor: alert when `SYSTEM` stream active consumers drops below baseline for >2min

## 6. Phased Plan

- **Phase 0** (2-3d): Sentry SDK in Omni + Agno, Alertmanager-compatible webhooks
- **Phase 1** (1d): Agno OTLP dual-export (env-gated, default off)
- **Phase 2** (2d): LGTM stack up via docker-compose, persistent volumes, auth, Promtail, first "Agno Activity" dashboard
- **Phase 3** (1d): node/postgres/nats/pm2 exporters, Host/PG/NATS/PM2 dashboards, silent-failure alerts
- **Phase 4** (1-2w upstream): Omni OTel SDK — upstream PR adding @opentelemetry/sdk-node direct dep, bootstrap, JourneyTracker→spans, NATS header propagation, Agno HTTP traceparent. Local fork-build bridge.
- **Phase 5** (3-5d): Gupshup T0/T11 instrumentation in plugin
- **Phase 6** (ongoing): SLOs, dashboards (Eugenia End-to-End, Follow-up Health, Agno Performance, Infrastructure), alert rules

## 7. Open Decisions

1. Self-hosted LGTM vs Grafana Cloud free tier (rec: self-hosted for Hapvida compliance)
2. Sentry SaaS free (5k errors/mo) vs GlitchTip self-hosted (rec: Sentry SaaS to start)
3. Omni upstream PR vs permanent fork (rec: upstream + fork-build bridge)
4. Observability host: same Eugênia box (64/48/100) vs dedicated (rec: same for MVP)
5. Alert primary channel: Discord vs Slack vs WhatsApp group (rec: Discord primary, WhatsApp secondary)

## 8. Success Criteria (MVP DoD)
- Sentry shows zero uncaught exceptions from Omni or Agno 24h window
- A test message produces a single trace in Tempo spanning Omni T0→NATS→Agno→Omni T11, queryable by chat_id/trace_id
- CPU/RAM/disk dashboards populated, 30-day retention
- PG dashboards: connections + slow queries for both DBs
- NATS: consumer count, ack lag, pending msgs
- Alert "NATS consumer missing in SYSTEM" fires <2min after removal in test
- Alert "automation fires zero in business hours" fires <16min
- First real production alert reaches Discord
- Follow-up health dashboard matches production
- Runbook in brain/

## 9. Non-goals
Log retention >30 days; replay/backfill; SIEM; cost/billing dashboards; mobile paging.

## 10. Handoff
When approved:
1. Confirm §7 decisions
2. Draft `wish-observability-hub-phase-0-sentry.md`
3. Execute Phase 0 on feature branch, PR-reviewed
4. Repeat per phase

Owner: TBD (engineer + PM pair). MVP (Phases 0-3) ~1 week. Full MVP incl. upstream (Phases 0-5) ~3 weeks.

---

## User refinement directive (2026-04-19)

> "Não só focando em AGNO → OMNI mas idealmente OMNI - ANY AGENT PROVIDER — focando primeiramente em AGNO e GENIE/CLAUDE CODE. Então temos que refinar, entender o que já TEMOS, e seguir mais sobre o processo."

Scope expansion: provider-agnostic observability, with **AGNO** and **GENIE/CLAUDE CODE** as priority providers. Requires refinement in DRAFT.md.
