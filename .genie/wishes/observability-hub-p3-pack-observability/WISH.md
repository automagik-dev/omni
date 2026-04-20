# Wish: observability-hub P3 — pack-observability (thin app with GitHub integration)

| Field | Value |
|-------|-------|
| **Status** | DRAFT |
| **Slug** | `observability-hub-p3-pack-observability` |
| **Date** | 2026-04-20 |
| **Parent design** | [observability-hub DESIGN.md](../../brainstorms/observability-hub/DESIGN.md) |
| **Repo** | `namastexlabs/pack-observability` (new, to create) — future home: `khal-os/pack-observability` |
| **Depends on** | P1 (live backend), partial P2 (needs real trace data to build against — but UI scaffolding can start earlier) |
| **Blocks** | — |

## Summary

Build `pack-observability`, a Next.js thin app that gives humans a branded observability UI with GitHub integration — **without forking SigNoz**. Follows khal-os `pack-template` pattern so that when khal-os Platform matures, this app moves/mirrors into `khal-os/pack-observability` with minimal changes: data-source swaps from `signoz-api` to `khalos-nats` stub, auth swaps from basic/WorkOS-direct to FGA-aware, GitHub App stays.

This pack is the **wrapper pattern alternative to forking SigNoz**. Zero upstream treadmill tax on the SigNoz side; the value-add features (GitHub integration, branded UI, alert routing) live in code we control.

## Scope

### IN

- **3.1 Scaffold** from `github.com/khal-os/pack-template` into `namastexlabs/pack-observability`
  - Next.js 16 (match khal-os stack)
  - `@khal-os/sdk` + `@khal-os/ui` + `@khal-os/types` deps (public packages)
  - pnpm workspace, biome, husky, same conventions as khal-os monorepo
- **3.2 Data-source abstraction** `src/data-sources/`:
  - Interface: `ObservabilityDataSource { getTraces(filters), getTrace(id), getErrors(filters), getAlerts(filters), createAlert(rule), getDashboards() }`
  - Impl 1: `SigNozApiDataSource` — HTTP calls to `http://10.114.1.173:8080/api/v1/*` + `/api/v3/*` with `SIGNOZ-API-KEY` header
  - Impl 2: `KhalOsNatsDataSource` (stub) — throws `NotImplementedError` but satisfies the interface contract; forward-compat proof
  - Selection via `OBSERVABILITY_DATA_SOURCE` env var
- **3.3 GitHub App**:
  - OAuth install flow at `/api/auth/github/install`
  - Webhook receiver at `/api/webhooks/github` for release events
  - Issue auto-creation on new error fingerprint: `POST /api/error-fingerprint` triggered by SigNoz alert webhook → GitHub Issue with title, stack trace, trace deep-link, CODEOWNERS assignee
  - CODEOWNERS parsing: walk source repo's `.github/CODEOWNERS`, map file → assignee
  - Release markers: on GitHub release → write `service.version` marker via data-source (so SigNoz timeline shows "deployed X at this timestamp")
  - Trace deep-link format: `https://<pack-observability-domain>/trace/<trace_id>`
- **3.4 UI views** (basic, shipping-grade):
  - `/traces` — list with filters (service, time range, error only), click → detail
  - `/traces/[id]` — timeline, spans tree, attributes, related logs
  - `/exceptions` — grouped error list (fingerprint + count + first/last seen + trace sample)
  - `/alerts` — active alerts, history, routing config
  - `/dashboards` — embed/link into backend's native dashboards (no custom viz layer initially)
- **3.5 Alert routing UI**:
  - Configure destinations: Discord, Slack, WhatsApp-via-Eugenia (pluggable)
  - Per-alert override: "this alert goes to #team-X channel"
  - Webhook-based routing (backend fires → our app routes → target system)
- **3.6 Auth**:
  - MVP: basic auth via env vars (`PACK_OBS_USERS=user:bcrypt-hash`)
  - Optional: WorkOS direct (same tenant as khal-os)
  - Documented forward path: when khal-os FGA ships, swap to WorkOS session + FGA policy checks

### OUT

- Source maps / session replay
- Custom chart/viz layer (use backend's native dashboards via embed/iframe for MVP)
- Multi-tenant UI (depends on FGA)
- Mobile paging
- Deep log ingestion UI (backend's log view is sufficient)
- Modifying the backend itself (we wrap, not fork)

## Decisions

| Decision | Rationale |
|----------|-----------|
| Scaffold from `khal-os/pack-template` | Matches khal-os conventions, reduces friction when moving |
| Data-source abstraction with 2 impls (`signoz-api` live, `khalos-nats` stub) | Proves swappability; prevents hard coupling to SigNoz |
| GitHub App over GitHub Action | App = persistent OAuth, better for bi-di (issues + releases); Action is one-way |
| CODEOWNERS parsing server-side, not client-side | Source repos are private; server-side has secrets to clone/read |
| MVP auth = basic + optional WorkOS direct | Full FGA requires khal-os Platform; defer |
| Trace deep-link owned by pack-observability (not backend URL) | Stable URL across backend migrations — trace UX continuity |
| Alert routing is webhook-based, not polling | Backend-agnostic; any backend firing a webhook can be wired |
| Repo lives in `namastexlabs/`, not khal-os from day 1 | khal-os Platform not ready; move/mirror when it is |
| Shipping-grade means "good enough", not "pixel-perfect" | MVP velocity over polish |

## Success Criteria

- [ ] **a** Deploy target: `pack-observability` runs on CT 173 (same box as SigNoz + Collector), authenticated (basic auth or WorkOS), reachable via LAN
- [ ] **b** `/traces` view lists traces from SigNoz data-source, filterable by `service.name` and time range
- [ ] **c** Force error (e.g., throw in a test endpoint) → GitHub Issue created in <60s in the correct repo, with:
  - Title: `[observability-hub] <exception.type>: <exception.message>`
  - Body: stack trace + trace deep-link
  - Assignee: matched from CODEOWNERS
- [ ] **d** GitHub release published (e.g., `v2.260420.1`) → `service.version` marker appears in SigNoz timeline view
- [ ] **e** Data-source abstraction build check: `OBSERVABILITY_DATA_SOURCE=khalos-nats bun run build` succeeds (stub satisfies interface)
- [ ] **f** Alert routing: SigNoz fires test alert → pack-observability webhook receives → routes to Discord in <10s
- [ ] **g** Runbook: how to deploy, update env, rotate keys, add a new data-source impl

## Execution Groups

Five groups, mostly paralelizable:

| Group | Scope | Depends on |
|-------|-------|:---:|
| **3.1** Scaffold repo + `pack-template` + dependencies | — | — |
| **3.2** Data-source abstraction + `SigNozApiDataSource` + `KhalOsNatsDataSource` stub | 3.1 | — |
| **3.3** GitHub App (OAuth + webhooks + issue creation + release markers) | 3.1 | — |
| **3.4** UI views (traces, exceptions, alerts, dashboards) | 3.1, 3.2 | partial P2 data |
| **3.5** Alert routing (webhook in + destinations out) | 3.1 | P1 (backend must fire) |
| **3.6** Auth (basic + optional WorkOS) + runbook | 3.1 | — |

3.1 gates everything. 3.2 and 3.3 are independent. 3.4 needs 3.2. 3.5 benefits from P1 but scaffolding doesn't block. 3.6 runs whenever.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| SigNoz EE API breaks across upgrades | Medium | Pin SigNoz version in deploy; monitor their changelog; data-source abstraction isolates the blast radius (swap impl) |
| GitHub rate limits on issue creation storm | Low | Idempotency: fingerprint-based dedup, only create issue on NEW fingerprint; `if-match` on existing issues |
| CODEOWNERS parsing needs repo access | Medium | GitHub App with `contents:read` scope; document permissions |
| Scaffolding from `pack-template` drifts as khal-os evolves | Low | Periodic rebase from template; small app footprint makes this cheap |
| Multi-tenant queries need per-user filtering not built in yet | Low | MVP is single-tenant; per-user filtering is Phase 4 FGA concern |
| Release marker race: GitHub release → backend write timing | Low | Webhook handler is idempotent; accept duplicate writes |

## References

- Parent DESIGN: [`.genie/brainstorms/observability-hub/DESIGN.md`](../../brainstorms/observability-hub/DESIGN.md)
- Template to scaffold from: `github.com/khal-os/pack-template`
- Sibling packs (pattern reference): `github.com/khal-os/pack-files`, `pack-nats-viewer`, `pack-terminal`
- khal-os SDK: `@khal-os/sdk`, `@khal-os/ui`, `@khal-os/types` (public npm via `npm.pkg.github.com`)
- khal-os WorkOS RBAC: `/home/genie/dev/khal-os/.genie/wishes/workos-prod-rbac/WISH.md`
- Admin key for SigNoz data-source dev: `/home/genie/.omni/signoz-keys.env`
