---
title: "brainstorm-observability-hub"
type: brainstorm
tags: [brainstorm, observability, infrastructure, sre, multi-provider, signoz, otel, khal-os]
status: DRAFT
slug: observability-hub
date: 2026-04-19
wrs: 95/100
---

# Brainstorm: ObservabilityHub (multi-provider, SigNoz-backed, khal-os-forward-compat)

## 1. Problem (reframed after audit)

Inicialmente o wish assumia que estávamos no zero em instrumentação. **Auditoria provou o contrário.** O que temos hoje:

- **Agno**: pipeline OpenInference completo rodando — 404 traces/24h em `agno_eugenia_traces` PG, dados populados, sem consumidor.
- **Genie**: 43 tabelas PG, 158 MB de dados, **56 908 runtime events com coluna `trace_id`**, eventos OTel (api/tool/metric/decision/prompt), Claude Code cost/token streams, metrics snapshots time-series, executors com `claude_session_id`. CLI completa (`genie events`, `genie metrics`, `genie log`, `genie events timeline <trace_id>`).
- **Omni**: `JourneyTracker` T0–T11 em memória, pino logs com `traceId`, **`NatsOutboundMessage.traceId` já no payload** (`packages/core/src/providers/nats-genie-provider.ts:49`), `@opentelemetry/*` (~30 libs) transitivamente no bundle mas SDK nunca inicializado.
- **khal-os**: SDK já traz `o11y-streams` (3 JetStream streams), `trace` (headers `x-trace-id`/`x-span-id`/`x-parent-span-id`), `app-tracking`, `logger`, `runtime` auto-republish. CLI (`os-cli events/logs/traces`). WorkOS RBAC done (Phase 1). Platform/FGA não prontos.
- **SigNoz**: v0.119.0 **já deployado** em `10.114.1.173` (CT 173). UI em `:8080`. OTLP em `:4317` (gRPC) e `:4318` (HTTP). Admin `cezar@namastex.ai` criado.

### Os 3 gaps reais

1. **Trace propagation quebra nos handoffs.**
   - Omni → Genie via NATS: `traceId` vai no payload, mas o consumer do mailbox salva `genie_runtime_events.trace_id = NULL`.
   - Omni → Agno via HTTP: sem W3C `traceparent` header.
   - Gupshup → Omni T0: JourneyTracker é in-memory, não vira span.

2. **Sinais siloed em 3 Postgres.** Omni `:8432`, Agno `10.114.1.135:5432`, Genie `:19642`. Zero query federada.

3. **Zero layer de alerta/dashboard/erro unificado** em cima do que já existe.

## 2. Escopo — 3 fases, umbrella = family-of-wishes

Este brainstorm gera uma **DESIGN.md umbrella** que spawneia 3 wishes-filhas, sequenciadas por dependência.

### P1 — SigNoz pronto para ingestão (quase done)

Estado atual: SigNoz v0.119.0 rodando, admin criado, endpoints expostos, access LAN-only.

**Trabalho restante (<1h):**
- 1c: smoke test OTLP (`curl -X POST http://10.114.1.173:4318/v1/traces -d @test-span.json` → visible na UI)
- 1d: criar channel Discord primário via `POST /api/v1/channels` + webhook
- 1e: criar 1 rule de smoke test + forçar trigger → mensagem no Discord
- 1f: gerar PAT admin via `POST /api/v1/pats`, salvar em vault/.env
- 1g: **DEFERRED** — WorkOS OIDC reverse-proxy (LAN-only é aceitável até khal-os Platform ficar pronto)

### P2 — Instrumentar produtores (o grosso do trabalho)

**Trabalho em 7 frentes, paralelizáveis onde não há dependência:**

| Group | Escopo | Local da mudança | Depende de |
|-------|--------|------------------|------------|
| **2.1** | `IAgentProvider` ganha contrato de observability: `propagateTrace(traceId, ctx)`, `readonly exporter`, `heartbeat()` | Upstream PR em `automagik-dev/omni` ou local fork-build | P1 |
| **2.2** | Omni OTel SDK bootstrap: `@opentelemetry/sdk-node` promovido a direct dep, `OTEL_EXPORTER_OTLP_ENDPOINT` env, `JourneyTracker.recordCheckpoint` emite spans T0–T11, NATS publisher injeta dual-headers (W3C `traceparent` + khal-os `x-trace-id`) | Upstream omni ou fork | 2.1 |
| **2.3** | Agno: `opentelemetry-exporter-otlp` em `pyproject.toml`, `BatchSpanProcessor` com `OTLPSpanExporter`, FastAPI middleware lê incoming `traceparent` + emite dual-header em outbound | `~/prod/eugenia-seller/apps/agno-api` | 2.1 |
| **2.4** | Genie: bridge — mailbox consumer lê NATS header `x-trace-id` → stampa `genie_runtime_events.trace_id`; tailer PG→OTLP pra Genie runtime events virarem spans em SigNoz | Genie bridge code | 2.1 |
| **2.5** | System exporters: `node_exporter`, `postgres_exporter` × 3 (omni/agno/genie), `nats-prometheus-exporter`, `pm2-prometheus-exporter` → OTel Collector (scrape) → SigNoz metrics | Host CT 173 (same box do SigNoz) | P1 |
| **2.6** | OTel Collector config com `otlphttp/khalos` exporter comentado (forward-compat khal-os) | `infra-observability/otel-collector.yaml` | P1 |
| **2.7** | Silent-failure alert rules via `POST /api/v1/rules`: consumer-count < baseline, business-hours zero automation fires, PM2 restart delta, NATS pending > threshold | SigNoz rules (via API) | P1, 2.5 |

**DoD P2:** 
- **(a)** uma mensagem real traça Gupshup → Omni → NATS → Agno → NATS → Omni → Gupshup com um único `trace_id` visível em SigNoz, queryable por `chat_id`
- **(b)** uma Genie session aparece como trace com tool calls + cost attributes + link pro `claude_session_id`
- **(c)** dashboards Host/PG/NATS populados
- **(d)** alerta "NATS SYSTEM consumer drop" dispara em <2min no teste (prevenção incidente #445)
- **(e)** alerta "automation_logs zero success in business hours" dispara em <16min

### P3 — Thin app khal-os-forward-compat (`pack-observability`)

Next.js app que **segue o padrão `pack-template`** da khal-os org. Hoje autenticado por basic-auth ou WorkOS direto; futuramente vira `khal-os/pack-observability`.

**Escopo MVP:**
- 3.1 Scaffold de `namastexlabs/pack-observability` a partir do `khal-os/pack-template`
- 3.2 Data-source abstraction: `getTraces(filters)`, `getErrors(filters)` com impl `signoz-api` hoje + stub `khalos-nats` amanhã
- 3.3 GitHub App: auto-issue on new error fingerprint, CODEOWNERS assignee, release markers (GitHub release → `service.version` tag em SigNoz), trace deep-link
- 3.4 Views: traces (lista + detalhe), exceptions (agrupadas), alerts history
- 3.5 Routing de alertas UI (Discord/WhatsApp targets)
- 3.6 Quando `khal-os/platform` ship FGA → move/mirror pra `khal-os/pack-observability`, troca data-source para `@khal-os/o11y-store` + NATS streams, herda WorkOS+FGA auth

**DoD P3:**
- **(a)** app autentica via WorkOS (ou basic auth se WorkOS reverse-proxy não pronto ainda)
- **(b)** lista traces/erros/alerts lidos de SigNoz API
- **(c)** erro forçado → GitHub Issue criada em <60s com CODEOWNERS assignee + trace deep-link
- **(d)** release marker criado quando tag GitHub sai → visível no timeline

### Non-goals (explícitos)

- Browser source maps
- Session replay
- PR preview tenants (Phase 4 FGA requirement)
- Mobile paging
- Per-tenant SigNoz isolation (fica com Enterprise ou khal-os FGA)
- Long-term retention > 30 dias em P1 (defaults do SigNoz são aceitáveis)

## 3. Decisões travadas

| # | Decisão | Opção escolhida | Porquê |
|---|---------|-----------------|--------|
| 1 | Backend de observability | **SigNoz Community self-hosted** (já deployado v0.119.0) | Ready-now, ClickHouse-backed (forward-compat com khal-os future o11y-store), OTel-native, Apache 2.0 |
| 2 | Fork SigNoz ou wrap? | **Wrap com thin app** (P3) — não forkar | Zero fork-tax, futuro khal-os `pack-observability` é natural |
| 3 | Error tracking (Sentry)? | **Não** — SigNoz cobre via OTel exception events | Um silo a menos |
| 4 | Trace context protocol | **Dual-emit**: W3C `traceparent` + khal-os `x-trace-id`/`x-span-id`/`x-parent-span-id` | Forward-compat com khal-os, compat com OpenInference/Agno |
| 5 | Persistência long-term | **Defaults do SigNoz** (7d traces / 15d logs / 30d metrics) | Evoluir só se volume exigir |
| 6 | Hospedagem do SigNoz | **Mesma infra (CT 173)** | Box tem 64/48/100, zero nova infra |
| 7 | Ingestion keys? | **Não — Community não tem** | Isolamento via perímetro de rede + OTel resource attributes (`service.name`, `project.id`, `org.id`) |
| 8 | API access pra agents | **Service Account Keys** (PATs foram substituídos em SigNoz EE v0.119+). Header: `SIGNOZ-API-KEY: <key>`. Gerados via UI (Settings → Service Accounts). | Um key por função: `signoz-admin` (root, já criado), `signoz-omni-ro`, `signoz-agno-ro`, `signoz-genie-ro`, `signoz-ci`. Armazenados em `/home/genie/.omni/signoz-keys.env` (perms 600). |
| 9 | Auth UI hoje | **LAN-only** (`http://10.114.1.173:8080`) | WorkOS reverse-proxy fica pra P3 ou quando khal-os Platform estabilizar |
| 10 | User granularity hoje | **Resource attributes + SigNoz roles (ADMIN/EDITOR/VIEWER)** + perímetro de rede | Forward-path: khal-os Phase 4 FGA substitui — mesmos atributos (`user.id`, `org.id`, `project.id`) viram filtros FGA nativos |
| 11 | Umbrella vs single wish | **Umbrella DESIGN.md + 3 wishes-filhas** (P1, P2, P3) | P1 é ops simples, P2 é upstream-heavy, P3 é product — natureza diferente |
| 12 | GitHub integration | **Dentro do pack-observability (P3), não fork SigNoz** | Zero upstream treadmill |

## 4. Risks & Mitigation

| Risco | Severity | Mitigation |
|-------|----------|------------|
| Upstream PR review latency em `automagik-dev/omni` pra 2.1/2.2 | Medium | Local fork-build bridge até merge — padrão já usado no workspace |
| Genie's `trace_id` é UUID, W3C traceparent é hex 16-byte — formato divergente | Low | Conversão canônica: uuid sem hífens = 32 hex → truncar pros 32-hex do W3C trace-id |
| PII em trace attributes (compliance Hapvida) | **High** | OTel Collector config com processor `attributes/scrub` antes de exportar — lista de campos a redactar (tool arguments, chat content) |
| SigNoz Community sem multi-tenant | Low (por agora) | P3 resolve via queries filtradas. Enterprise ou khal-os FGA resolve depois |
| Ring-buffer sizes do khal-os (20/10/5 MB) se acoplarmos futuro | Low | Forward-compat é NATS topology, não storage — khal-os o11y-store persiste separado |
| Auth LAN-only expõe se CT for acessado externamente | Medium | Documentar no runbook. Firewall 10.114.1.0/24 only. Upgrade quando khal-os Platform ficar pronto |
| 3 PGs = 3 políticas de backup/retenção | Low | Out of scope — cada repo já tem a sua |
| SigNoz v0.119.0 upgrade breakage | Low | Release notes read antes de upgrade; schema ClickHouse é versioned |

## 5. Success Criteria (consolidado)

### P1 (quase done)
- [x] SigNoz reachable `http://10.114.1.173:8080`, v0.119.0 EE, admin logado (`cezar@namastex.ai`, isRoot=true)
- [x] 1c — OTLP smoke test passou: trace_id `0d437778cdea850794c90132d0126482` HTTP 200, `{"partialSuccess":{}}`
- [x] 1f — Admin service account key validado + salvo em `/home/genie/.omni/signoz-keys.env` (perms 600), header `SIGNOZ-API-KEY` confirmed working em `/api/v1/channels` + `/api/v1/rules`
- [ ] 1d — Discord channel criado via `POST /api/v1/channels` (blocker: webhook URL)
- [ ] 1e — Alerta teste dispara → Discord (depende de 1d)

### P2
- [ ] a — Trace end-to-end Gupshup→Omni→Agno→Omni→Gupshup visível, single `trace_id`
- [ ] b — Genie session trace com tool calls + cost + `claude_session_id` link
- [ ] c — Dashboards Host/PG/NATS populados com 7 dias de dados
- [ ] d — NATS SYSTEM consumer-drop alert <2min (incident #445 prevention)
- [ ] e — Zero-automation-fires alert <16min em business hours

### P3
- [ ] a — pack-observability deploy, autenticado
- [ ] b — Lista traces/errors/alerts via SigNoz API
- [ ] c — Erro forçado → GitHub Issue <60s com CODEOWNERS + trace link
- [ ] d — Release marker GitHub→SigNoz quando tag sai

### Forward-compat proof
- [ ] OTel Collector config tem bloco `otlphttp/khalos` comentado
- [ ] Resource attributes em todos produtores seguem `user.id` / `org.id` / `project.id` / `service.name`
- [ ] pack-observability data-source é abstract (SigNoz hoje, khalos-nats stub)

## 6. Arquitetura final

```
┌── Producers ──────────────────────────────────────────────┐
│  Omni (Bun)     ──OTLP──┐                                 │
│  Agno (Python)  ──OTLP──┤                                 │
│  Genie (TS)     ──OTLP──┤  (dual-header: W3C traceparent   │
│  System exp.    ──Prom──┤   + khal-os x-trace-id)          │
│  (node/pg/nats/pm2)     │                                  │
└─────────────────────────┼──────────────────────────────────┘
                          ▼
                ┌─────────────────────┐
                │  OTel Collector     │  ← scrubbers (PII), sampling
                │  (same box CT 173)  │  ← future: otlphttp/khalos
                └─────────────────────┘
                          │
                          ▼
                ┌─────────────────────┐   ┌────────────────────────┐
                │  SigNoz v0.119.0    │──▶│  Alertmanager          │
                │  (ClickHouse)       │   │  → Discord (primary)   │
                │  :4317 gRPC         │   │  → WhatsApp (secondary)│
                │  :4318 HTTP         │   └────────────────────────┘
                │  :8080 UI           │
                └─────────────────────┘
                   ▲          ▲
                   │          │
       ┌───────────┘          └────────────┐
       │                                    │
┌──────────────────┐                 ┌──────────────────┐
│  SigNoz UI       │                 │  pack-observability (P3)    │
│  (humans, PAT)   │                 │  Next.js, GitHub App         │
│  LAN-only HW     │                 │  SigNoz API + CH read-only   │
└──────────────────┘                 │  ──────────────────────────  │
                                     │  future: khal-os o11y-store  │
                                     │  future: WorkOS+FGA auth     │
                                     └──────────────────────────────┘
```

## 7. WRS
```
WRS: █████████▌ 95/100
 Problem ✅ | Scope ✅ | Decisions ✅ | Risks ✅ | Criteria ◐ (pending P1 smoke test)
```

Os 5 pontos que faltam = smoke test do P1 (1c–1f). Assim que passarem, WRS = 100 → crystallize.

## 8. Handoff

Quando aprovado:

1. **Finalizar P1 smoke test** (1c–1f) — ~30min manual
2. **Crystallize DESIGN.md** a partir deste DRAFT
3. **Spawn wishes-filhas:**
   - `wish-observability-hub-p1-signoz-bootstrap.md` — residual work (smoke test + WorkOS deferred)
   - `wish-observability-hub-p2-producers.md` — 7 groups (2.1–2.7), upstream-heavy
   - `wish-observability-hub-p3-pack-observability.md` — Next.js app + GitHub App
4. Cada wish-filha roda `/review` individual, entra em execução independente

---

## Apêndice — Evidence cross-reference

Veja `seed-wish.md` pra draft original do usuário. Audits verificados em 2026-04-19.

| Claim | Fonte |
|-------|-------|
| SigNoz v0.119.0 em `10.114.1.173` | Usuário confirmou + `curl /api/v1/version` |
| Admin `cezar@namastex.ai` criado | Usuário confirmou |
| Community sem ingestion keys | SigNoz docs + verificado |
| NatsOutboundMessage.traceId campo | `packages/core/src/providers/nats-genie-provider.ts:49` |
| Genie: 56908 runtime events | `genie db status` |
| Genie: trace_id NULL em source=mailbox | `SELECT trace_id FROM genie_runtime_events WHERE source='mailbox' ...` |
| Agno 404 traces/24h | `psql agno_eugenia_traces -c "SELECT COUNT(*) ..."` |
| khal-os org tem 17 repos, nenhum observability | `gh api orgs/khal-os/repos` |
| khal-os SDK tem o11y-streams/trace/app-tracking | `/home/genie/dev/khal-os/packages/os-sdk/src/service/*` |
| khal-os WorkOS RBAC Phase 1 done | `/home/genie/dev/khal-os/.genie/wishes/workos-prod-rbac/WISH.md` status DONE |
| Sentry no khal-os Next.js | `/home/genie/dev/khal-os/sentry.*.config.ts` |
