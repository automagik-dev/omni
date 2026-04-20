---
title: "design-observability-hub"
type: design
tags: [design, observability, otel, khal-os, multi-provider, vendor-neutral, umbrella]
status: READY
slug: observability-hub
date: 2026-04-20
wrs: 100/100
spawns:
  - observability-hub-p1-signoz-residual
  - observability-hub-p2-producers
  - observability-hub-p3-pack-observability
---

# Design: ObservabilityHub — End-to-end observability for Omni ↔ any agent provider

| Field | Value |
|-------|-------|
| **Slug** | `observability-hub` |
| **Date** | 2026-04-20 |
| **WRS** | 100/100 |
| **Shape** | Umbrella design → 3-wish family |
| **Trigger incident** | Omni follow-up 10h silent gap, 2026-04-18 (automagik-dev/omni#445 closed via PR #446) |

## Problem

A stack Omni + Agno + Genie + NATS + Gupshup tem instrumentação profunda mas siloed: Omni tem `JourneyTracker` T0-T11 in-memory, Agno emite OpenInference spans para PG dedicado, Genie tem 56 908 runtime events com trace_id (NULL pro source=mailbox), Claude Code cost/token events, machine snapshots — tudo em 3 Postgres separados (Omni `:8432` / Agno `10.114.1.135` / Genie `:19642`). **Trace propagation quebra nos handoffs** (Omni→Genie via NATS carrega `traceId` mas o consumer dropa; Omni→Agno via HTTP sem `traceparent`; Gupshup T0 não é span). **Zero camada de alerta/dashboard/erro unificado** — incident #445 durou 10h sem detecção, estado que nenhum instrumento atual pega.

## Scope

### Architectural principle — vendor-neutral at the producer layer

**Omni, Agno, and Genie code MUST NOT reference any specific OTel backend vendor** (SigNoz, Jaeger, Honeycomb, Datadog, Grafana Cloud, etc.). Every producer exports via vanilla OTLP using standard env vars: `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES`, optional `OTEL_EXPORTER_OTLP_HEADERS` for auth. Anyone forking Omni plugs in their own collector/backend with zero source changes.

**Vendor-specific configuration is confined to the infrastructure layer**:

| Zone | Content | Vendor-aware? | Home |
|------|---------|:---:|---|
| **Producer code** | Omni, Agno, Genie OTel SDK bootstrap + spans + propagation | ❌ no | Upstream repos (`automagik-dev/omni`, `eugenia-seller`, Genie) |
| **Infra/operator** | OTel Collector config, alert rules, dashboards, retention | ✅ yes | `infra-observability/` (our repo — evolves with the backend) |
| **UI app** (`pack-observability`) | Reads observability data | Abstracted via data-source interface | `namastexlabs/pack-observability` (future khal-os home) |

**Our current deployment target is SigNoz Community EE v0.119.0** on CT 173. This is an **operational choice**, not an architectural dependency. Swapping SigNoz for LGTM/Jaeger+ClickHouse/whatever-OTLP-compliant touches only the infra config layer.

### IN

- **P1 — Deploy an OTLP-compliant backend** (our pick: SigNoz Community EE v0.119.0 self-hosted at `10.114.1.173`, OTLP `:4317`/`:4318`, already running)
- **P2 — Instrument producers with vanilla OTel SDK** + dual-header trace context (W3C `traceparent` + khal-os `x-trace-id/x-span-id/x-parent-span-id`) for forward-compat. **All upstream changes are vendor-neutral.**
  - **Omni** (upstream): OTel SDK bootstrap reading `OTEL_EXPORTER_OTLP_ENDPOINT`, `JourneyTracker.recordCheckpoint` emits standard OTel spans, NATS publisher injects both header sets, HTTP client to agent providers injects `traceparent`. Zero backend references.
  - **Agno** (upstream): add `opentelemetry-exporter-otlp` to `pyproject.toml`, FastAPI middleware reads incoming `traceparent`, dual-export keeps `agno_spans` PG while shipping OTLP outward. Zero backend references.
  - **Genie** (upstream): mailbox consumer stamps `genie_runtime_events.trace_id` from NATS header, PG events → OTLP tailer. Zero backend references.
  - **`IAgentProvider`** (Omni upstream): optional `observability: { propagateTrace, exporter, heartbeat }` contract. Backend-agnostic.
  - **System exporters** (our infra): `node_exporter`, `postgres_exporter ×3`, `nats-prometheus-exporter`, `pm2-prometheus-exporter` scraped by our OTel Collector.
  - **OTel Collector config** (our infra): OTLP receivers, PII scrub processor, vendor exporter(s). Today: SigNoz exporter. Tomorrow: add `otlphttp/khalos` alongside — collector is the abstraction boundary, not the code.
  - **Silent-failure rules** (our infra/operator): expressed in the chosen backend's native rule language — today SigNoz `POST /api/v1/rules`, tomorrow migrates with the backend.
- **P3 — `pack-observability`** — Next.js thin app in `namastexlabs/pack-observability`, data-source abstraction (`signoz-api` impl today, `khalos-nats` stub), **GitHub App** (auto-issue on new error fingerprint + CODEOWNERS assignee + release markers + trace deep-link), alert routing UI. Lives OUTSIDE Omni/Agno/Genie, so backend-specific data-source impls are fine.
- **Forward-compat contract**: producer code is OTLP vendor-neutral; Collector config has `otlphttp/khalos` exporter block staged (commented); resource attributes follow OTel semantic conventions (`service.name`, `deployment.environment`, `service.version`) plus our namespace (`user.id`, `org.id`, `project.id`); pack-observability data-source is abstract.

### OUT

- Browser source maps (não precisa hoje)
- Session replay (não precisa hoje)
- PR preview tenants (depende de khal-os FGA)
- Mobile paging (Discord/WhatsApp é suficiente)
- Per-tenant backend isolation (Enterprise ou FGA)
- Long-term retention > 30 dias em P1
- Migração do Sentry `@sentry/nextjs` que já roda em khal-os Next.js (fica como escopo separado — OTel bridge depois)
- **Baking any backend choice into Omni/Agno/Genie source code** — producer code stays vendor-neutral

## Approach

**Two-layer architecture with clean vendor boundaries:**

1. **Producer layer (upstream code)** — Omni, Agno, Genie use vanilla OTel SDK with standard `OTEL_*` env vars. No backend vendor names in source. A fork can point at their own endpoint.
2. **Infrastructure layer (our operational choice)** — deploy SigNoz Community EE v0.119.0 as today's OTLP target. The OTel Collector in between is the swappable boundary — change one config block, swap the backend, producer code never moves.

**Why SigNoz as our current operational pick** (backend choice alternatives considered):

- Grafana LGTM stack: 3 stores (Tempo+Loki+Mimir), 3 query languages, UX humano-first, thin MCP/API — rejeitada pela complexidade + desalinhamento com 2026 "AI-native" consumption
- Apache SkyWalking: MAL baseline anomaly detection atraente, mas Elasticsearch backend + OTel secondary — rejeitada pelo peso operacional
- HyperDX: mais AI-native por design, mas community menor e menos maturo — rejeitada por risco
- DIY ClickHouse + OTel Collector + Grafana: flexibilidade máxima, mas exige building UI/alertas do zero — rejeitada por tempo até first-value
- Fork SigNoz: rejeitada por "upstream treadmill tax" (~100 commits/mês) — em vez disso, `pack-observability` wrapper faz o mesmo trabalho sem fork

SigNoz wins as our deployment choice because: (a) ClickHouse-backed (matches likely khal-os future choice), (b) OTel-native end-to-end, (c) ships today com UI+alertas+exceptions, (d) Apache 2.0, (e) REST API completa + `clickhouse-client` for agents, (f) já deployado e ingestindo. **Crucially, this choice is reversible without touching producer code** — anyone (us tomorrow, or an Omni fork operator) can swap SigNoz for anything OTLP-compliant by editing the Collector config.

**Forward-compat to khal-os** works the same way: when `@khal-os/o11y-store` + `pack-observability` ship, the Collector gets a new exporter block (`otlphttp/khalos`) added alongside SigNoz's, producers keep running unchanged, the `pack-observability` UI data-source abstraction picks up a new backend impl.

**Agent consumption is CLI + HTTP API first** (no MCP dependency): agents query via `curl`/`jq` against whichever backend API is configured, or `clickhouse-client` when ClickHouse is the store. The CLI/API abstraction lives in `pack-observability`'s data-source interface — agents call THAT, which routes to the configured backend.

**Error tracking is OTel exception span events** (`exception.type`/`exception.message`/`exception.stacktrace` attributes). No separate Sentry product on producer side. The existing `@sentry/nextjs` in khal-os Next.js stays (out of scope migration).

**User granularity** uses network perimeter (LAN `10.114.1.0/24`) + backend's built-in roles + OTel resource attributes (`user.id`, `org.id`, `project.id`) as filter dimensions. Forward path: when khal-os Phase 4 FGA ships, the same attributes become FGA claims, auth UI migrates to WorkOS via reverse-proxy, `pack-observability` inherits — **no producer changes required**.

## Decisions

### Architectural (vendor-neutral, ships upstream)

| Decision | Rationale |
|----------|-----------|
| Producer code uses vanilla OTel SDK + `OTEL_*` env vars only — no backend vendor names in source | Zero lock-in; any operator (us, a fork, a future khal-os) plugs in their own endpoint |
| Dual-emit trace headers (W3C `traceparent` + khal-os `x-trace-id`/`x-span-id`/`x-parent-span-id`) | Forward-compat khal-os sem quebrar OpenInference/Agno |
| Error tracking via OTel exception span events (no dedicated Sentry SDK in producers) | Backend-agnostic; any OTel-compliant backend surfaces exceptions natively |
| `IAgentProvider` gains optional `observability: { propagateTrace, exporter, heartbeat }` contract | Backend-agnostic; providers without impl fallback to noop |
| `pack-observability` has abstract data-source interface (`signoz-api` impl today, `khalos-nats` stub) | Swappable backend access; natural move to khal-os later |
| OTel Collector is THE vendor abstraction boundary — backend-specific exporter config lives there, not in producer code | Producers ship upstream clean; we evolve infra independently |
| Umbrella DESIGN + 3 wishes-filhas | P1 operator work / P2 upstream producer code / P3 our UI app — distinct natures, distinct repos |
| CLI/HTTP API consumption (no MCP dependency) | Simpler, more debuggable, `curl`+`jq` are agent-native without middleware |

### Deployment choice (our current operational pick — reversible without code changes)

| Decision | Rationale |
|----------|-----------|
| SigNoz Community EE v0.119.0 self-hosted as today's OTLP target | Ready today, ClickHouse-backed (matches likely khal-os future), OTel-native, Apache 2.0, já deployado |
| Não forkar SigNoz — wrap com thin app (P3) | Zero upstream treadmill; pack-observability é o wrapper e a futura home khal-os |
| Retention defaults (7d traces / 15d logs / 30d metrics) for MVP | Suficiente pra volume atual (404 traces Agno/24h); evoluir se necessário |
| Same infra (CT 173) | 64/48/100 tem folga, zero nova infra |
| Community = sem ingestion keys | Isolamento via perímetro LAN + OTel resource attrs |
| Service Account Keys (EE v0.119 aboliu PATs); header `SIGNOZ-API-KEY` para automação | Current SigNoz reality |
| Auth UI LAN-only hoje | WorkOS reverse-proxy fica pra quando khal-os Platform estabilizar |
| GitHub integration dentro do pack-observability (P3), não fork SigNoz | Mantém producer + backend limpos; integração vive onde temos controle |

## Architecture

```
╔══ VENDOR-NEUTRAL (upstream code — producers) ═════════════════════╗
║  Omni (Bun)     ──OTLP──┐                                         ║
║  Agno (Python)  ──OTLP──┤  OTEL_EXPORTER_OTLP_ENDPOINT            ║
║  Genie (TS)     ──OTLP──┤  OTEL_SERVICE_NAME                      ║
║                         │  OTEL_RESOURCE_ATTRIBUTES               ║
║  dual-header trace ctx: │  OTEL_EXPORTER_OTLP_HEADERS              ║
║    W3C traceparent      │                                         ║
║    + khal-os x-trace-id │  ← zero backend references in source   ║
║  System exp.    ──Prom──┤                                         ║
║  (node/pg×3/nats/pm2)   │                                         ║
╚═════════════════════════╪═════════════════════════════════════════╝
                          ▼
╔══ VENDOR BOUNDARY (our infra — swappable) ═════════════════════════╗
║              ┌─────────────────────────┐                          ║
║              │  OTel Collector         │ ← PII scrub, sampling    ║
║              │  (our CT 173)           │ ← receivers: OTLP, Prom  ║
║              │                         │ ← exporters:             ║
║              │                         │    [today] SigNoz         ║
║              │                         │    [stubbed] otlphttp/khalos ║
║              └─────────────────────────┘                          ║
╚═════════════════════════╪═════════════════════════════════════════╝
                          ▼
╔══ DEPLOYMENT TARGET (current: SigNoz — replaceable) ═══════════════╗
║            ┌─────────────────────────────┐   ┌─────────────────┐  ║
║            │  SigNoz v0.119.0 EE         │──▶│  Alertmanager    │  ║
║            │  (ClickHouse backend)       │   │  → Discord (1°)  │  ║
║            │  :4317 gRPC / :4318 HTTP    │   │  → WA-Eugenia(2°)│  ║
║            │  :8080 UI + /api/v1/*       │   └─────────────────┘  ║
║            └─────────────────────────────┘                        ║
╚═════════════════════════╪═════════════════════════════════════════╝
               ▲          ▲
               │          │
    ┌──────────┘          └──────────┐
    │                                 │
┌──────────────────┐              ┌───────────────────────────────┐
│  SigNoz UI       │              │  pack-observability (P3)      │
│  LAN-only today  │              │  Next.js, GitHub App          │
│  SIGNOZ-API-KEY  │              │  abstract data-source:        │
└──────────────────┘              │    impl: signoz-api (today)   │
                                  │    impl: khalos-nats (stub)   │
                                  │  auth: basic → WorkOS → FGA   │
                                  └───────────────────────────────┘

Invariant: swapping SigNoz for any OTLP-compatible backend touches
only the Collector exporter config. Producer code never moves.

P1 ✅ done (except Discord/alerts deferred)
P2 ⏳ 7 groups, paralelizáveis
P3 ⏳ scaffold from khal-os/pack-template
```

## Risks & Assumptions

| Risk | Severity | Mitigation |
|------|----------|------------|
| Upstream PR review latency em `automagik-dev/omni` (grupos 2.1/2.2/2.4) | Medium | Local fork-build bridge até merge — padrão já usado no workspace para outras mudanças Omni |
| UUID vs hex traceId conversion mismatch | Low | Conversão canônica: UUID sem hífens = 32 hex chars = W3C trace-id format |
| PII em trace attributes (compliance Hapvida) | **High** | OTel Collector config com processor `attributes/scrub` ANTES de qualquer export; lista explícita de campos a redactar (tool args, chat content); security review do config antes de habilitar producers em prod |
| SigNoz Community sem multi-tenant nativo | Low | P3 filtra por `service.name`/`project.id` attrs; enterprise ou FGA resolve depois |
| Ring-buffer khal-os (20/10/5 MB) se acoplarmos | Low | Forward-compat é NATS topology, não storage — `@khal-os/o11y-store` persiste separado |
| LAN-only auth expõe se CT acessado externamente | Medium | Firewall `10.114.1.0/24` documentado no runbook; upgrade para WorkOS reverse-proxy quando khal-os Platform ship |
| SigNoz v0.119.0 → v0.12x upgrade breakage | Low | Release notes read antes de upgrade; schema ClickHouse é versioned; PATs já virou Service Accounts (EE v0.119 precedente) |
| Three PGs = three backup/retention policies | Low | Out of scope umbrella — cada repo tem sua política |
| Discord webhook deferral | Low | 1d/1e movem para P1 wish-filha; não bloqueia P2/P3 |
| Genie `trace_id` NULL em source=mailbox (`genie_runtime_events`) | **High** | Core do grupo 2.4 — mailbox consumer deve ler NATS header `x-trace-id` e stampar, resolve exatamente esse gap |
| Contract-change `IAgentProvider` breaks other providers | Medium | Upstream PR começa com discussion issue; `observability` key é opcional durante transição; providers sem suporte fallback para noop |

## Success Criteria

### Umbrella (this DESIGN → 3 wishes)

- [x] SigNoz v0.119.0 EE rodando em `10.114.1.173`, admin key validado, OTLP smoke test passou (span `0d437778cdea850794c90132d0126482` queryable)
- [x] Service Account Keys decisão documentada (EE substitui PATs)
- [x] Admin key armazenado em `/home/genie/.omni/signoz-keys.env` (perms 600)
- [x] DESIGN.md cobre P1+P2+P3, forward-compat com khal-os documentado, 3 wishes-filhas nomeadas

### P1 (`observability-hub-p1-signoz-residual`)

- [x] 1a SigNoz reachable `http://10.114.1.173:8080`, v0.119.0 EE
- [x] 1b Admin logado (`cezar@namastex.ai`, isRoot:true, orgId `019da7b2-...`)
- [x] 1c OTLP smoke queryable (service `observability-hub-smoke`, query_range retorna value:1)
- [x] 1f Admin key salvo + validado contra `/api/v1/{channels,rules,user}`
- [ ] 1d Discord channel criado via `POST /api/v1/channels` (precisa webhook URL)
- [ ] 1e Alerta teste dispara → Discord em <2min

### P2 (`observability-hub-p2-producers`)

- [ ] a One real message traça Gupshup → Omni → NATS → Agno → NATS → Omni → Gupshup com single `trace_id`, queryable por `chat_id`
- [ ] b One Genie session vira trace com tool calls + cost attrs + link pro `claude_session_id`
- [ ] c Dashboards Host/PG×3/NATS/PM2 populados com 7 dias de dados
- [ ] d Alerta "NATS SYSTEM consumer drop" dispara <2min em teste (prevenção incident #445)
- [ ] e Alerta "automation_logs zero success in business hours" dispara <16min
- [ ] f OTel Collector config tem `otlphttp/khalos` stubbed (forward-compat proof)
- [ ] g Producer PRs (Omni, Agno, Genie) contain ZERO references to SigNoz/any specific backend in source (grep check: `grep -ri signoz src/` returns nothing in producer code)

### P3 (`observability-hub-p3-pack-observability`)

- [ ] a Deploy autenticado (WorkOS ou basic auth)
- [ ] b UI lista traces/errors/alerts lidos via data-source (today: SigNoz API impl)
- [ ] c Erro forçado → GitHub Issue criada <60s com CODEOWNERS assignee + trace deep-link
- [ ] d Release marker GitHub→backend quando tag sai, visível no timeline
- [ ] e Data-source abstraction valida (build passa com stub `khalos-nats` — proves swappability)

## Phase Groups (execution sequencing)

### P1 — Backend bootstrap residual (~30min)

Operator work on our chosen SigNoz deployment: Discord webhook → `POST /api/v1/channels` + create test rule → force trigger → verify Discord message. Pode rodar isolado; não bloqueia P2/P3.

### P2 — Producers (grosso do trabalho, paralelizável)

| Group | Depende de | Layer | Local | Vendor-aware? |
|-------|:---:|---|---|:---:|
| 2.1 `IAgentProvider` observability contract | P1 | Producer code | Upstream `automagik-dev/omni` ou fork | ❌ |
| 2.2 Omni OTel SDK + JourneyTracker→spans + NATS dual-header | 2.1 | Producer code | Upstream Omni | ❌ |
| 2.3 Agno OTLP export + FastAPI traceparent middleware | 2.1 | Producer code | `~/prod/eugenia-seller/apps/agno-api` | ❌ |
| 2.4 Genie mailbox trace_id stamping + PG→OTLP tailer | 2.1 | Producer code | Genie bridge | ❌ |
| 2.5 System exporters (node/pg×3/nats/pm2) → Collector | P1 | Our infra | CT 173 | ❌ (Prom/OTLP standard) |
| 2.6 Collector config with backend exporter(s) + `otlphttp/khalos` stub | 2.5 | Our infra | `infra-observability/` | ✅ |
| 2.7 Silent-failure alert rules | 2.3, 2.5 | Operator | Backend-specific (today: SigNoz `POST /api/v1/rules`) | ✅ |

**Invariant check in 2.1–2.4**: if a reviewer sees "SigNoz" anywhere in the producer PR source, flag as blocker. Vendor names live only in 2.5–2.7.

### P3 — pack-observability (pode começar em paralelo com P2)

Scaffold de `namastexlabs/pack-observability` a partir de `khal-os/pack-template`, data-source abstraction (`signoz-api` impl + `khalos-nats` stub), GitHub App, views básicas. Quando khal-os Platform ship FGA → mirror para `khal-os/pack-observability`. Backend-specific code lives ONLY in data-source impls.

## Non-goals (explicit)

- Migração do `@sentry/nextjs` khal-os — escopo separado
- Browser source maps
- Session replay
- PR preview environments (depende FGA)
- Mobile paging
- Per-tenant backend isolation (depende Enterprise/FGA — aplicável a qualquer backend escolhido)
- Long-term retention > 30 dias
- Forking the chosen backend (SigNoz or otherwise) — we wrap, not fork
- Baking any backend vendor name into Omni/Agno/Genie producer source code

## References

- Trigger incident: `automagik-dev/omni#445` (closed via PR #446, release `v2.260418.1`)
- Seed wish (verbatim user draft): `.genie/brainstorms/observability-hub/seed-wish.md`
- DRAFT (refinement log): `.genie/brainstorms/observability-hub/DRAFT.md`
- khal-os WorkOS RBAC Phase 1 (done): `/home/genie/dev/khal-os/.genie/wishes/workos-prod-rbac/WISH.md`
- khal-os SDK observability primitives: `/home/genie/dev/khal-os/packages/os-sdk/src/service/{o11y-streams,trace,app-tracking,logger}.ts`
- khal-os pack pattern: `github.com/khal-os/pack-template`
- SigNoz admin key + endpoints: `/home/genie/.omni/signoz-keys.env` (perms 600)

## Handoff to implementation

On approval of this DESIGN:

1. `/review` auto-invoke on this file
2. If SHIP → spawn 3 child wishes via `/wish`:
   - `wish-observability-hub-p1-signoz-residual.md` (Discord channel + test alert)
   - `wish-observability-hub-p2-producers.md` (7 execution groups, largest scope)
   - `wish-observability-hub-p3-pack-observability.md` (Next.js app + GitHub App)
3. Each child wish independently reviewed and executed
4. Jar updates: `observability-hub` → Poured, linking all 3 wishes
