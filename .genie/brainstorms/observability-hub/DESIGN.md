---
title: "design-observability-hub"
type: design
tags: [design, observability, signoz, otel, khal-os, multi-provider, umbrella]
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

### IN

- **P1 — SigNoz Community Edition v0.119.0 EE** self-hosted em CT 173 (`10.114.1.173`) como backend unificado de traces+logs+metrics+exceptions
- **P2 — Instrumentar produtores** com OTel SDK + dual-header trace context (W3C `traceparent` + khal-os `x-trace-id/x-span-id/x-parent-span-id`) para forward-compat khal-os:
  - Omni: OTel SDK bootstrap, `JourneyTracker.recordCheckpoint` → spans, NATS publisher inject headers, HTTP a Agno inject `traceparent`
  - Agno: `opentelemetry-exporter-otlp`, FastAPI middleware lê incoming `traceparent`, dual-export (mantém `agno_spans` PG + OTLP out)
  - Genie: mailbox consumer stamps `trace_id`, PG events → OTLP tailer
  - System: `node_exporter`, `postgres_exporter ×3`, `nats-prometheus-exporter`, `pm2-prometheus-exporter` → OTel Collector → SigNoz
  - `IAgentProvider` ganha contrato `observability: { propagateTrace, exporter, heartbeat }`
  - Silent-failure rules via `POST /api/v1/rules` (consumer-count, business-hours-zero, PM2 restart, NATS pending)
- **P3 — `pack-observability`** — Next.js thin app seguindo padrão khal-os `pack-template`, data-source abstraction SigNoz-API-today / khal-os-NATS-later, **GitHub App** (auto-issue on new error fingerprint + CODEOWNERS assignee + release markers + trace deep-link), alert routing UI
- **Forward-compat contract**: OTel Collector config com `otlphttp/khalos` exporter comentado; resource attributes `service.name`, `deployment.environment`, `user.id`, `org.id`, `project.id`, `service.version`; pack-observability data-source é abstract

### OUT

- Browser source maps (não precisa hoje)
- Session replay (não precisa hoje)
- PR preview tenants (depende de khal-os FGA)
- Mobile paging (Discord/WhatsApp é suficiente)
- Per-tenant SigNoz isolation (Enterprise ou FGA)
- Long-term retention > 30 dias em P1
- Migração do Sentry `@sentry/nextjs` que já roda em khal-os Next.js (fica como escopo separado — OTel bridge depois)

## Approach

**Adotar SigNoz Community EE v0.119.0 já deployado como backend "ready-now"**, desenhando a integração para ser forward-compatible com o futuro `@khal-os/o11y-store` + `pack-observability` que virá quando o control plane da khal-os amadurecer.

A escolha foi feita sobre alternativas consideradas:

- Grafana LGTM stack: 3 stores (Tempo+Loki+Mimir), 3 query languages, UX humano-first, thin MCP/API — rejeitada pela complexidade + desalinhamento com 2026 "AI-native" consumption
- Apache SkyWalking: MAL baseline anomaly detection atraente, mas Elasticsearch backend + OTel secondary — rejeitada pelo peso operacional
- HyperDX: mais AI-native por design, mas community menor e menos maturo — rejeitada por risco
- DIY ClickHouse + OTel Collector + Grafana: flexibilidade máxima, mas exige building UI/alertas do zero — rejeitada por tempo até first-value
- Fork SigNoz: rejeitada por "upstream treadmill tax" (~100 commits/mês) — em vez disso, `pack-observability` wrapper faz o mesmo trabalho sem fork

SigNoz vence porque: (a) ClickHouse-backed (matches likely khal-os future choice), (b) OTel-native end-to-end, (c) ship today com UI+alertas+exceptions, (d) Apache 2.0, (e) REST API completa + `clickhouse-client` para agents, (f) já deployado e ingestindo.

O esquema de consumption por agents é **CLI + HTTP API first** (não MCP): agents usam `curl` + `jq` contra SigNoz API, ou `clickhouse-client` direto em ClickHouse. Service Account Keys com header `SIGNOZ-API-KEY` (EE v0.119 aboliu PATs) dão role-scoped access (ADMIN/EDITOR/VIEWER).

Erro tracking **não** usa Sentry como produto separado — OTel exception span events (attributes `exception.type`/`exception.message`/`exception.stacktrace`) vão para o mesmo ClickHouse, SigNoz agrupa nativamente. Um silo a menos. `@sentry/nextjs` que já roda em khal-os Next.js fica como-é (migração OTel depois, escopo separado).

User granularity hoje usa perímetro de rede (LAN `10.114.1.0/24`) + SigNoz built-in roles + resource attributes como dimensões de filtro. Forward path: quando khal-os Phase 4 FGA ship, os mesmos atributos `user.id`/`org.id`/`project.id` viram claims FGA, auth UI migra para WorkOS via reverse-proxy, pack-observability herda tudo isso.

## Decisions

| Decision | Rationale |
|----------|-----------|
| SigNoz Community EE v0.119.0 self-hosted | Ready today, ClickHouse matches khal-os future, OTel-native, Apache 2.0, já deployado |
| Não forkar SigNoz — wrap com thin app P3 | Zero upstream treadmill; pack-observability é o wrapper e a futura home khal-os |
| Sem Sentry como produto separado | SigNoz cobre errors via OTel exception events; um silo a menos |
| Dual-emit trace headers (W3C `traceparent` + khal-os `x-trace-id`) | Forward-compat khal-os sem quebrar OpenInference/Agno |
| Retention defaults SigNoz (7d traces / 15d logs / 30d metrics) | Suficiente pra volume atual (404 traces Agno/24h); evoluir só se necessário |
| Same infra (CT 173) | 64/48/100 tem folga, zero nova infra |
| Community = sem ingestion keys | Isolamento via perímetro LAN + OTel resource attrs |
| Service Account Keys (não PATs) | EE v0.119 aboliu PATs; header `SIGNOZ-API-KEY` |
| Auth UI LAN-only hoje | WorkOS reverse-proxy fica pra quando khal-os Platform estabilizar |
| Umbrella DESIGN + 3 wishes-filhas | P1 ops / P2 upstream-heavy / P3 product — naturezas distintas |
| GitHub integration dentro do pack-observability (P3) | Mantém SigNoz limpo; integração vive onde temos controle |
| CLI/HTTP API consumption (sem MCP) | Simpler, mais debuggable, `curl`+`jq` são agent-native sem middleware |

## Architecture

```
┌── Producers ──────────────────────────────────────────────┐
│  Omni (Bun)     ──OTLP──┐                                 │
│  Agno (Python)  ──OTLP──┤  dual-header: W3C traceparent    │
│  Genie (TS)     ──OTLP──┤  + khal-os x-trace-id            │
│  System exp.    ──Prom──┤                                  │
│  (node/pg×3/nats/pm2)   │                                  │
└─────────────────────────┼──────────────────────────────────┘
                          ▼
              ┌─────────────────────────┐
              │  OTel Collector         │ ← PII scrub, sampling
              │  (CT 173)               │ ← future: otlphttp/khalos
              └─────────────────────────┘
                          │
                          ▼
            ┌─────────────────────────────┐   ┌─────────────────────┐
            │  SigNoz v0.119.0 EE         │──▶│  Alertmanager        │
            │  (ClickHouse backend)       │   │  → Discord primary   │
            │  :4317 gRPC / :4318 HTTP    │   │  → WA-via-Eugenia 2° │
            │  :8080 UI + /api/v1/*       │   └─────────────────────┘
            └─────────────────────────────┘
               ▲                   ▲
               │                   │
    ┌──────────┘                   └──────────┐
    │                                          │
┌──────────────────┐              ┌───────────────────────────────┐
│  SigNoz UI       │              │  pack-observability (P3)      │
│  LAN-only today  │              │  Next.js, GitHub App          │
│  SIGNOZ-API-KEY  │              │  data-source abstract         │
└──────────────────┘              │    impl: signoz-api (today)   │
                                  │    impl: khalos-nats (stub)   │
                                  │  auth: basic → WorkOS → FGA   │
                                  └───────────────────────────────┘

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
- [ ] f OTel Collector config tem `otlphttp/khalos` comentado (forward-compat proof)

### P3 (`observability-hub-p3-pack-observability`)

- [ ] a Deploy autenticado (WorkOS ou basic auth)
- [ ] b UI lista traces/errors/alerts lidos via SigNoz API
- [ ] c Erro forçado → GitHub Issue criada <60s com CODEOWNERS assignee + trace deep-link
- [ ] d Release marker GitHub→SigNoz quando tag sai, visível no timeline
- [ ] e Data-source abstraction valida (build passa com stub khalos-nats)

## Phase Groups (execution sequencing)

### P1 — Residual SigNoz bootstrap (~30min)

Trivial: crie Discord webhook → `POST /api/v1/channels` + create test rule → force trigger → verify Discord message. Pode rodar isolado a qualquer momento; não bloqueia P2/P3.

### P2 — Producers (grosso do trabalho, paralelizável)

| Group | Depende de | Local |
|-------|:---:|---|
| 2.1 `IAgentProvider` observability contract | P1 | Upstream `automagik-dev/omni` ou fork |
| 2.2 Omni OTel SDK + JourneyTracker→spans + NATS dual-header | 2.1 | Omni |
| 2.3 Agno OTLP export + FastAPI traceparent middleware | 2.1 | `~/prod/eugenia-seller/apps/agno-api` |
| 2.4 Genie mailbox trace_id stamping + PG→OTLP tailer | 2.1 | Genie bridge |
| 2.5 System exporters (node/pg×3/nats/pm2) → Collector | P1 | CT 173 |
| 2.6 Collector config com `otlphttp/khalos` comentado | 2.5 | `infra-observability/` |
| 2.7 Silent-failure rules via API | 2.3, 2.5 | SigNoz rules |

### P3 — pack-observability (pode começar em paralelo com P2)

Scaffold de `namastexlabs/pack-observability` a partir de `khal-os/pack-template`, data-source abstraction, GitHub App, views básicas. Quando khal-os Platform ship FGA → mirror para `khal-os/pack-observability`.

## Non-goals (explicit)

- Migração do `@sentry/nextjs` khal-os — escopo separado
- Browser source maps
- Session replay
- PR preview environments (depende FGA)
- Mobile paging
- Per-tenant SigNoz (depende Enterprise/FGA)
- Long-term retention > 30 dias
- Modificar SigNoz upstream

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
