# Wish: GitLab SDLC connector on typed connector ingress

| Field | Value |
|-------|-------|
| **Status** | APPROVED |
| **Slug** | `gitlab-sdlc-connector` |
| **Date** | 2026-11-01 |
| **Author** | Felipe Rosa |
| **Appetite** | large |
| **Branch** | `wish/gitlab-sdlc-connector` |
| **Repos touched** | omni (`packages/core`, `packages/connector-sdk`, `packages/db`, `packages/api`, `packages/cli`, `packages/sdk`, `scripts`; slice 2 adds `packages/connector-gitlab`) |
| **Design** | [DESIGN.md](../../brainstorms/gitlab-sdlc-connector/DESIGN.md) |

## Summary

Slice 1 gives every connector one ingress URL that turns a provider's multiplexed hook into typed
`connector.{provider}.*` events, journaled once per delivery, published on a stream that holds `connector.>`, and
able to fire only the automations a subscription names. It closes the three gaps that make that unsafe today: the
target-less fan-out to every tenant, the missing stream subject, and the ability of any publisher to forge a
`connector.*` row. Slice 2 (an events-only `gitlab` connector) and slice 4 (measurement on `khal/brain`) are planned
here and start only after slice 1 merges and the paired-agent delivery gate (Settled R5-1) passes live.

## Scope

### IN

- **Slice 1, groups 1 to 5, now.** DESIGN.md IN rows 1 to 7: per-connector ingress, typed names and glob
  subscriptions with an optional target, the no-target guard and the D7 gate over every `connector.*` type, the
  `connector.>` stream subject, one publisher (`publishConnector`) with dead-letter and replay provenance,
  unmatched-delivery counters shown by `omni doctor`, the sealed connector-level hook secret, and the SDK rule for
  events-only, hook-secret-only connectors. Design decisions #1 to #7 and #16 to #25 bind it (A29 to A32 are #23,
  #24, #17/#18 and #25). Group 1 also hardens the disposable-Postgres gate (t1m ruling).
- **Slice 2, group 6, planned and gated.** DESIGN.md IN row 8: the `gitlab` connector package, events only.
- **Slice 4, group 7, planned and gated.** DESIGN.md IN row 9: the 7-day before/after measurement and the
  zero-event proof.

### OUT

- Slice 3 (captain delivery, agent-owned consumers, the C2 grant, the C8 envelope): built in
  `.genie/brainstorms/paired-agents/`.
- Slice 5, the signed webhook source migration, and the historical DESIGN row 13: OUT, their own brainstorm later
  (`signed-webhook-source-migration` in `.genie/INDEX.md`).
- Typed GitLab actions, any GitLab API token stored in Omni, and any merge or approve action.
- A Mac dispatcher or any interim bridge with unowned consumers.
- Journal rows or payloads for unmatched deliveries; glob triggers on automations; moving ClickUp subscriptions off
  the per-subscription route; agent manifests admitting `connector.*`; a schema gate over `connector.*`.
- A signature-bypassing test delivery for `'connector'` subscriptions (the existing test endpoint refuses them).
- Editing the paired-agents DRAFT; repairing `make check`/`make test` (`_sync-db` runs `drizzle-kit push --force`
  against `.env`); agents never run those targets (see the safe gate).
- Any production, shared-database, GitLab or <internal-host> access by agents: every live read, capture, probe, proof
  object and token is operator-held (see Dependencies).

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | The design's 25 decisions bind unchanged; this wish only cuts them into groups and pins interfaces the design leaves open. | DESIGN.md is SHIP (review 4, digest `c367154a…`). |
| 2 | Group 1 (core safety) lands before anything makes a target optional (group 2) or widens the registry (group 4). | DESIGN Approach, Risks #2 and #4. |
| 3 | Group 1 moves ClickUp's publish (`connectors.ts:1030`), dead-letter retry (`dead-letters.ts:284`), auto-retry (`:407`) and replay (`event-ops.ts:487`) to `publishConnector` in the same PR that makes `publishGeneric` refuse `connector.*`. | Otherwise ClickUp ingress and every `connector.event` retry break the moment the refusal lands. |
| 4 | `publishConnector` lives on a separate `ConnectorEventPublisher` interface implemented by the NATS bus and the in-memory test bus; only services that publish connector events (`ConnectorService`, `DeadLetterService`, `EventOpsService`) require `EventBus & ConnectorEventPublisher`, and group 1 carries that type through the whole bootstrap chain, keeping the bus nullable: `api/src/index.ts` (`connectToNats`), `api/src/app.ts` (`createApp`), `api/src/middleware/context.ts`, `api/src/services/index.ts`. Test fixtures that construct those services or the factory get a real `publishConnector` in their harness (no casts). `publishGeneric`'s refusal is inside every real bus implementation. | Keeps the bus contract mandatory where it is used (no optional method, no casts) without forcing ~21 unrelated test mocks into group 1; plan review finding 5. |
| 5 | The `connector.>` stream subject lands in group 1. | `streams.ts` has no subject for `connector.>` today. |
| 6 | Group 2 owns slice 1's one migration at the next free number on `dev`. #1460 holds `0091_durable_consumers_tenant_scope.sql`; whoever merges second renumbers its own SQL file and journal entry, recomputes `when` from the new predecessor and reruns the gate. | Next-free-number rule plus the no-gap journal check. |
| 7 | The NULL-surviving uniqueness for target-less subscriptions is a new additive unique index (partial on `target_automation_id IS NULL`), chosen as policy; `connector_event_subscriptions_binding_uq` stays. Newly nullable columns use `ALTER COLUMN ... DROP NOT NULL`; the CHECK is added idempotently (guarded by a `pg_constraint` lookup in a `DO` block). | Additive and idempotent per `.claude/CLAUDE.md`; the gate itself only denies DROP TABLE, DROP COLUMN, ALTER COLUMN TYPE and TRUNCATE. |
| 8 | Group 2 owns the minimal nullable-compatibility edits in `services/connectors.ts` and keeps the per-subscription route fail-closed (a `'subscription'` row with a NULL target or secret is treated as unknown). SDK `actions` stays a required `readonly ConnectorActionDefinition[]` that may be `[]`. | A group must build and pass on its own; plan review finding 2. |
| 9 | Pinned surfaces (design leaves them open): delivery route `POST /api/v2/connectors/hooks/:connectorId`, declared in `app.ts` beside the existing public route; hook secret set and rotated by a write-only `hookSecret` field on the existing `POST /api/v2/connectors` and `PATCH /api/v2/connectors/:id` (same auth and scope as today), surfaced only as `hasHookSecret: boolean`; subscription create on the existing `POST /api/v2/connectors/:id/subscriptions` with `ingress: 'connector'`; `ingress` is never in the PATCH schema; the test endpoint `POST /:id/subscriptions/:sid/test` answers 409 `CONNECTOR_INGRESS_TEST_UNSUPPORTED` for a `'connector'` row. | Plan review findings 4 and 6; smallest surface consistent with Decisions #7, #19 and #24. |
| 10 | `ConnectorParsedDelivery` gains optional `eventType?: string`; the per-connector route uses `eventType` when it starts with `connector.{provider}.`, else `connector.{provider}.{eventKey}`. ClickUp's shape and behaviour are unchanged. | Pins the typed-name contract group 6 implements. |
| 11 | Safe gate for every code group, run in the task worktree (never `make check` or `make test`): `test -z "$(find . -name node_modules -prune -o -name '.env*' ! -name '*.example' -print)" && <gate-wrapper> env -i HOME="$HOME" USER="$USER" PATH="$HOME/.autopg/bin/darwin-arm64/bin:<local-bin>:$PATH" TERM="${TERM:-xterm}" LANG="${LANG:-en_US.UTF-8}" bash -c 'bun run check && make marketplace-check && make test-pg-gate'`. | `make test` depends on `_sync-db`, which sources `.env` and runs `drizzle-kit push --force`; a real Postgres listens on 127.0.0.1:5432 on this host. The whole chain runs inside the Mac-wide gate semaphore `brain-v3.worktrees/.tools/gate.sh` (at most 2 heavy runs on this host; t1m rule 2026-11-01; focused single-file runs need no lock) and under `env -i` (only HOME, USER, PATH, TERM, LANG survive; PATH is prefixed with the host's PostgreSQL server binaries (autopg) and the `psql` client (Homebrew libpq), which the disposable cluster and the PostgreSQL suites need; `OMNI_PG_BIN_DIR` stays unset so `psql` is not looked up in the server directory), so no ambient `DATABASE_URL`, `ENABLE_DB_TESTS`, `PG*` or `OMNI_G*_POSTGRES_URL` reaches any test, and no `.env*` file (other than `*.example`) may exist anywhere in the worktree outside `node_modules`, so Bun autoloads nothing. `bun run check` covers typecheck, lint, knip, verify-migrations, verify-versions and turbo tests; only `make test-pg-gate` injects URLs, for its own disposable cluster. Plan review findings 1 and R2-1. |
| 12 | `make test-pg-gate` is accepted only once group 1 deliverable 1 makes it bind 127.0.0.1 only, refuse 5432 and 15432, and destroy the cluster and its temp dirs on every exit. | t1m ruling 2026-11-01. |
| 13 | Real-NATS tests follow `engine-trigger-parallelism-nats.test.ts`: a throwaway `nats-server` (binary from `scripts/ensure-nats.sh`, random loopback port, temp store, removed in `afterAll`), run in a child process, failing (never skipping) when the binary is missing; they run inside `bun run check`'s turbo tests. | Plan review finding 7; other suites mock `nats` process-wide. |
| 14 | One PR to `dev` per group, sequential; the owner merges in order and agents never merge. A dependent group may start on a branch stacked on its dependency and opens its PR after the dependency merges. Groups run by hand with hc agents, not the saved `wish.js` workflow. | t1m 2026-11-01. |
| 15 | Team: Codex (`dev-sol`) authors every group; a Claude Opus reviewer reviews every PR (cross-provider); a DeepSeek break-it pass runs on groups 1 and 4 (the forgery and ingress groups); a Codex reviewer reviewed this plan. | t1m approval 2026-11-01; plan review finding 8. |
| 16 | Journal shape (shared by groups 1, 2 and 4). Legacy `connector.event` rows: unchanged (`connectors.ts:973-987`): `idempotency_key = connector:{subscriptionId}:{id}`, metadata `{ correlationId, source: 'connector', connectorId, subscriptionId, provider, fullEventType: 'connector.event', tenantId?, envelopeVersion? }`, payload with single `subscriptionId`, `targetAutomationId`, `rawPayload`. Typed rows: `idempotency_key = connector:{connectorId}:{providerEventId}`, `event_type` = the typed name, metadata `{ correlationId, source: 'connector', connectorId, provider, fullEventType: <typed name>, subscriptionIds: string[], tenantId?, envelopeVersion? }`, payload `{ ...providerFields, connectorId, subscriptionIds, targetAutomationIds }`. `source` alone is never proof of provenance (DESIGN #22). | Plan review R2-4; one contract the trigger, the retry check and the ingress all read. |

## Simplicity Case

- **Simplest complete design:** DESIGN.md's: one ingress route per connector, typed names in the existing
  `connector.` namespace, counters as columns on the connector row, an events-only GitLab package with no token.
- **Added machinery:** only what DESIGN's Simplicity Case justifies, plus the pg-gate hardening t1m required. The
  separate `ConnectorEventPublisher` interface is a type split, not a new mechanism. The five slice 1 groups exist to
  keep each PR near the admission band (25 files, 2,000 insertions); group 1 runs above the file band by recorded
  captain ruling (adapted API test harnesses), well under the insertion band.
- **Deferred until measured:** automation trigger globs; typed GitLab actions; a `connector.*` schema gate; a typed
  test-delivery endpoint for `'connector'` rows.
- **Complexity removed:** no integration branch; no data migration of existing subscription rows; no new event
  namespace or persistence subscriber; no change to the unrelated channel/core `EventBus` test mocks (only the API fixtures that construct the three
  publishing services or `createApp` are adapted).

## Dependencies

**depends-on:** none
**blocks:** none

Slice 1 depends on nothing. Groups 6 and 7 depend on the paired-agents delivery minimum (brainstorm
`paired-agents`, not yet a wish: C0, C1, C2 with a `connector.gitlab.*` row, C3, C4, C8, one C12 drain) merged and
live on <internal-host> (Settled R5-1). Paired-agents slice 3 consumes the row contract of DESIGN Decision #6
(connector id plus at least one matched subscription id on every `connector.gitlab.*` row).

Operator-held evidence (agents never produce it; t1m or the owner records it in this wish):
- Before any provider hook points at the per-connector route in production: production NATS stream info, or one
  authenticated test delivery, shows a stream holding `connector.>` (DESIGN Risk #1).
- The R5-1 start gate for groups 6 and 7: authenticated probe output from <internal-host>.
- Group 6: hook registration on `khal/brain` and the capture of one real and one test delivery.
- Group 7: the GitLab baseline export, the Omni journal and consumer-ack export for the window, every proof object
  and replay, and the proof token's creation and revocation. Analysts work only from these supplied files.

## Success Criteria

Each criterion is owned by the group in brackets; the group's acceptance criteria name its test.

- [ ] **Real NATS** [G4]. A real-NATS test publishes `connector.event` and `connector.gitlab.merge_request.merged` through an events-only, hook-secret-only fixture connector and reads each back from a durable consumer and the journal.
- [ ] **SDK rule** [G2]. Events and no actions registers; no events refused; a hook-secret-only connector stores a sealed empty credentials object, column NOT NULL.
- [ ] **No-target guard** [G1 engine, G4 ingress]. A `connector.event` and a typed event with no target fire no automation, two tenants.
- [ ] **ClickUp unchanged** [G2 schema, G4 end to end]. Existing row reads `ingress = 'subscription'` with its secret; URL, key, single `subscriptionId`/`targetAutomationId`/`rawPayload` unchanged; target fires once, another `connector.event` automation does not; a body carrying `targetAutomationIds` is journaled unchanged and fires only the bound automation.
- [ ] **Route discriminator** [G2 CHECK and lookup, G4 route]. A `'connector'` id on the per-subscription route journals and fires nothing; CHECK refuses `'connector'` with a secret and `'subscription'` without.
- [ ] **Typed targets** [G1 membership, G3 create/patch refusals, G4 firing]. Exact targeted subscription fires once per delivery; targeted glob or mismatched trigger refused naming both (create and PATCH); two targeted matches give one row listing both and fire each once; an unnamed same-trigger automation does not fire.
- [ ] **Body once** [G4]. Typed row has no `rawPayload`; a body above half of NATS `max_payload` is journaled, published and answered 2xx (real NATS).
- [ ] **Unmatched** [G4 counters, G3 view, G5 doctor]. No row or payload; counters bumped; authenticated doctor read shows them.
- [ ] **One row per delivery** [G4]. One row under `connector:{connectorId}:{providerEventId}` with both subscription ids and the connector id; a retry writes nothing new.
- [ ] **Refusals and secrecy** [G1 trigger regression, G3 manifest regression and secret redaction, G4 journal/event secrecy].
- [ ] **One publisher** [G1 bus, emit_event, replay; G4 ingress minting]. `emit_event` of a `connector.*` type fails with no row, dead letter or firing; `publishGeneric` throws on `connector.*`; ingress still publishes; provider `targetAutomationIds`/`subscriptionIds` on a typed row are replaced by the ingress lists.
- [ ] **Dead-letter and replay provenance** [G1]. Forged `connector.event` dead letter without an ingress journal row: refused on manual retry, skipped on auto-retry, reason stored, nothing fired in two tenants; replay of a `connector.*` event re-derives routing from the journal row under the same event id and refuses one without ingress provenance; a real ingress dead letter retries and fires only its journaled targets.
- [ ] **Production stream** (operator-held) before any production hook cutover.
- [ ] **Slice 2 start gate** (operator-held). Slice 1 merged and the R5-1 probe output recorded here.
- [ ] **Slice 2** [G6]. DESIGN Success Criteria "Slice 2, GitLab connector", "typed-name mapping" and "verifier modes", verbatim.
- [ ] **Slice 4** [G7]. DESIGN Success Criteria "Slice 4, ratio" and "zero-event proof", verbatim.

## Execution Strategy

### Wave 1 (now)

| Group | Agent | Complexity | Model | Description |
|-------|-------|------------|-------|-------------|
| 1 | engineer | High: bus contract and forgery/fan-out safety; up to 32 files by captain ruling (hard stop 34) | codex dev-sol; review Claude Opus; break-it DeepSeek | Pg-gate hardening, D7 gate and no-target guard, `publishConnector` and the `connector.*` refusals, `connector.>` stream, dead-letter and replay provenance |

### Wave 2 (after group 1's branch is green; PR after group 1 merges)

| Group | Agent | Complexity | Model | Description |
|-------|-------|------------|-------|-------------|
| 2 | engineer | High: migration, RLS, SECURITY DEFINER and grants; collides with #1460 | codex dev-sol; review Claude Opus | Schema, migration, connector-keyed tenancy, SDK rule, nullable compatibility |

### Wave 3 (after group 2)

| Group | Agent | Complexity | Model | Description |
|-------|-------|------------|-------|-------------|
| 3 | engineer | Medium: management API over existing routes; secret lifecycle | codex dev-sol; review Claude Opus | Zod schemas, connector `hookSecret` lifecycle, `'connector'` subscription create/patch rules, counters in the view, test-endpoint refusal |

### Wave 4 (after group 3)

| Group | Agent | Complexity | Model | Description |
|-------|-------|------------|-------|-------------|
| 4 | engineer | High: public unauthenticated ingress; verification, journal and publish | codex dev-sol; review Claude Opus; break-it DeepSeek | Per-connector delivery route, typed matching, journal row, minting, unmatched counters, registry widening, real-NATS and Postgres tests |

### Wave 5 (after group 4)

| Group | Agent | Complexity | Model | Description |
|-------|-------|------------|-------|-------------|
| 5 | engineer | Low: CLI and SDK client over pinned routes | codex dev-sol; review Claude Opus | `omni connectors` flags, `omni doctor` unmatched line, handwritten SDK client types, SDK regeneration |

### Wave 6 (gated: slice 1 merged and R5-1 probe recorded)

| Group | Agent | Complexity | Model | Description |
|-------|-------|------------|-------|-------------|
| 6 | engineer | Medium: new package, signature verifier | codex dev-sol; review Claude Opus | `gitlab` connector, events only |

### Wave 7 (gated: group 6 merged and go-live)

| Group | Agent | Complexity | Model | Description |
|-------|-------|------------|-------|-------------|
| 7 | operator + analyst | Medium: operator-held live evidence, 14 days of wall time | analyst codex; review Claude Opus | Measurement report and its checker from operator-supplied evidence |

**Global constraints:**
- One worktree per task under `~/workspace/repos/omni.worktrees`, created from `origin/dev`; never `git stash`, `git checkout` or `git reset` in `~/workspace/repos/omni`.
- Bun only (Bun 1.4.4 is on dev); `make` targets first, except `make check`, `make test`, `make test-sweep` and any target that sources `.env`, which agents never run; the gate is Decision #11.
- No services, real or shared databases, or external messages; disposable Postgres only (autopg binaries, mktemp dir, Unix socket, never ports 5432/15432, stop and delete afterwards); test NATS only via `scripts/ensure-nats.sh`.
- Never `--no-verify`; conventional commits; PRs to `dev` on `automagik-dev/omni`; the owner merges.
- Migrations: hand-written, header comment first, additive and idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, guarded constraints), no `BEGIN`/`COMMIT`, next free number on `dev`, journal `when` = previous `when` + 100000000, schema.ts and migration in the same PR, `make verify-migrations` green; a destructive statement needs a `-- destructive: <justification>` header line (none planned); never `drizzle-kit generate` or `push`.
- Avoid files owned by #1460 (`event-consumers*`, `packages/api/src/services/events.ts`) and #1462 (`instances.ts`, `keys.ts`, `api-keys.ts`, `agent-dispatcher.ts`); the shared `schema.ts`, `tenancy-rls.ts`, journal and `types.generated.ts` are merged, not overwritten.
- Validate every external boundary with Zod; publish events for state changes; no `any`; no casts to evade a type contract.
- Existing behavioural assertions stay unchanged; a test's bus harness may be adapted.
- Independent cross-provider review of every PR before it is reported ready (Decision #15).

## Execution Groups

### Group 1: Core safety — pg gate, D7 gate, one publisher, stream subject, provenance

**Goal:** Make a `connector.*` row impossible to forge or fan out before any later group widens the registry or makes a target optional.

**Deliverables:**
1. FIRST, before this group runs `make test-pg-gate`: `scripts/disposable-pg-cluster.ts` and `scripts/pg-gate.ts` bind 127.0.0.1 only (already true), refuse ports 5432 AND 15432 (today only 5432), and stop the cluster and delete its mktemp dirs on every exit: an `initdb` or start failure (today an `initdb` failure leaks the data dir), a throw between cluster creation and the gate's `try` (today `resolvePgBinaries()` sits outside it), and SIGINT, SIGTERM and SIGHUP (today only the normal `finally`). `--keep` and the warm variant keep their documented behaviour.
2. `connectorTargetMatches` (`packages/core/src/automations/engine.ts:46-52`): applies to every `connector.*` type; a `connector.event` with no `targetAutomationId` fires nothing; a typed row fires an automation only when its id is in `targetAutomationIds[]`, nothing when the list is absent or empty. The exact trigger match (`engine.ts:500-505`) is unchanged.
3. `ConnectorEventPublisher.publishConnector` implemented by the NATS bus (`nats/client.ts`) and the in-memory test bus (`core/src/events/__tests__/memory-bus.ts`); `publishGeneric` throws on every `connector.*` type in both; `isConnectorEventType` exported from `@omni/core`.
4. `emit_event` (`packages/core/src/automations/actions.ts`) refuses a `connector.*` type after templating and before its emission gates: the action fails, nothing is published, no dead letter is written.
5. `connector.>` added to a JetStream stream in `packages/core/src/events/nats/streams.ts`.
6. `ConnectorService`'s per-subscription publish (`connectors.ts:1030`) moves to `publishConnector`, rows unchanged; `ConnectorService`, `DeadLetterService` and `EventOpsService` require `EventBus & ConnectorEventPublisher`, carried through `api/src/index.ts`, `app.ts`, `middleware/context.ts` and `services/index.ts` (Decision #4).
7. `DeadLetterService` manual retry (`:284`) and auto-retry (`:407`), and `EventOpsService` replay (`event-ops.ts:487`), of a `connector.*` event: the service reads the `omni_events` row with the same event id, accepts it only when it matches the ingress journal shape of Decision #16 (row `event_type` equals the dead letter's type, `idempotency_key` starts with `connector:`, the dead letter's tenant is NULL (0041 clears it on insert; `dead_letter_events` is unowned until G6) or equals the row tenant, `metadata.source = 'connector'`, `metadata.connectorId` present, `metadata.fullEventType` equals the row type, and `metadata.subscriptionId` (legacy) or non-empty `metadata.subscriptionIds` (typed)), republishes the journal row's own payload and tenant with `subscriptionId(s)` and `targetAutomationId(s)` from that row (never the dead letter's payload), read through the existing retry handle and scope, and calls `publishConnector` with the same event id; otherwise manual retry is refused, auto-retry skips, the reason is written on the dead-letter row (replay counts it as skipped), and nothing is published.
8. Regression test: `POST /events/trigger` with a `connector.*` type is refused by the unchanged `custom.`-only rule (`webhooks.ts:180-185`).

**Interfaces:**
- Consumes: none.
- Produces (in `packages/core/src/events/`, exported from `@omni/core`): `type ConnectorEventType = \`connector.${string}\``; `isConnectorEventType(type: string): type is ConnectorEventType`; `interface ConnectorEventPublisher { publishConnector(type: ConnectorEventType, payload: Record<string, unknown>, metadata: Partial<OmniEvent['metadata']> & { publishEventId: string }): Promise<PublishResult> }`; typed-row payload keys `subscriptionIds: string[]` and `targetAutomationIds: string[]` read by the gate. The existing `CONNECTOR_EVENT_TYPE` literal stays.

**Acceptance Criteria:**
- [ ] Disposable-cluster test: 5432 and 15432 are never chosen; an `initdb` failure leaves no `omni-g3-pg-*` dir; a gate killed by SIGTERM after cluster start leaves no running postmaster and no temp dir.
- [ ] Engine test (two tenants): `connector.event` without target fires nothing; a typed row fires only listed ids; an unlisted automation with the same trigger does not fire.
- [ ] Bus tests: NATS and memory buses throw on `publishGeneric('connector.event' | 'connector.x.y', …)`; `publishConnector` publishes onto the `connector.>` stream (real-NATS child-process test per Decision #13).
- [ ] Emission test: `emit_event` of `connector.gitlab.merge_request.merged` and of `connector.event` naming another automation fails with no publish and no dead letter.
- [ ] Postgres dead-letter test: forged `connector.event` dead letter with no ingress journal row is refused (manual) and skipped (auto) with the reason stored, firing nothing in two tenants; a real ingress dead letter retries and fires only its journaled target.
- [ ] Postgres replay test: replay of a journaled ingress `connector.event` publishes under the same event id with journal-derived routing; a `connector.*` row without ingress provenance is skipped.
- [ ] Existing ClickUp ingress tests keep their assertions; only their bus harness gains `publishConnector`.
- [ ] `/events/trigger` regression test passes.

**Validation:**
```bash
test -z "$(find . -name node_modules -prune -o -name '.env*' ! -name '*.example' -print)" && <gate-wrapper> env -i HOME="$HOME" USER="$USER" PATH="$HOME/.autopg/bin/darwin-arm64/bin:<local-bin>:$PATH" TERM="${TERM:-xterm}" LANG="${LANG:-en_US.UTF-8}" bash -c 'bun run check && make marketplace-check && make test-pg-gate'
```

**depends-on:** none

---

### Group 2: Schema, migration, connector-keyed tenancy, SDK rule

**Goal:** Give the database and SDK everything the per-connector route needs, with ClickUp rows and the existing route untouched.

**Deliverables:**
1. `packages/db/src/schema.ts` and one hand-written migration at the next free number (`NNNN_connector_ingress.sql`) plus its journal entry: `connector_event_subscriptions.ingress` (`'subscription' | 'connector'`, NOT NULL, default `'subscription'`); `target_automation_id` and `verification_secret` DROP NOT NULL; a guarded CHECK (`'subscription'` holds a secret, `'connector'` holds NULL); a partial unique index on `(connector_id, provider_event_key) WHERE target_automation_id IS NULL`; on `connectors`: `hook_secret` (sealed text, nullable), `total_unmatched` (integer default 0 NOT NULL), `last_unmatched_at` (timestamptz), `last_unmatched_event_type` (varchar(200)).
2. A connector-keyed SECURITY DEFINER tenant lookup function, its RLS policy, the `omni_events` tenant trigger also deriving the tenant from a connector id in metadata (keeping the 0090 subscription derivation), and its privileges: SELECT on `connectors` for the NOLOGIN SECURITY DEFINER owner that today holds SELECT on `connector_event_subscriptions` (`tenancy-roles.ts:154`, `tenancy-rls.ts:415-416`), EXECUTE on the new function for the same runtime caller(s) that execute today's lookup (`tenancy-roles.ts:252-257`), EXECUTE revoked from PUBLIC, no role membership change (`packages/db/src/tenancy-rls.ts`, `tenancy-roles.ts`, `tenancy-ownership.ts`, `tenancy-db-access-guard.ts` and their tests). The trigger derives the tenant from `metadata.connectorId` only when `metadata.source = 'connector'` and `metadata.subscriptionIds` is present (the typed shape in Decision #16); the 0090 `subscriptionId` path stays.
3. `packages/api/src/tenancy/connector-ingress.ts`: add `resolveConnectorTenantByConnectorId`; the existing `resolveConnectorIngressTenant(db, subscriptionId)` keeps its signature and returns null for a `'connector'` row.
4. Nullable compatibility in `packages/api/src/services/connectors.ts` (views at `:90`, `:310`; envelope `:188`, `:965`; secret list `:1049`): the per-subscription route treats a `'subscription'` row with a NULL target or secret, and every `'connector'` row, as unknown; the existing create route keeps requiring target and secret.
5. `packages/connector-sdk/src/registry.ts` and `types.ts`: a manifest needs at least one event; `actions` stays required and may be `[]`; credential fields may all be optional. `packages/api/src/tenancy/sealed-credentials.ts` seals `{}` for a hook-secret-only connector.

**Interfaces:**
- Consumes: group 1's gate (a NULL target fires nothing) on `dev` before this PR merges.
- Produces: Drizzle `connectorEventSubscriptions.ingress: 'subscription' | 'connector'`, nullable `targetAutomationId` and `verificationSecret`; `connectors.hookSecret: string | null`, `totalUnmatched: number`, `lastUnmatchedAt: Date | null`, `lastUnmatchedEventType: string | null`; `resolveConnectorTenantByConnectorId(db: Database, connectorId: string): Promise<string | null>`; unchanged `resolveConnectorIngressTenant(db: Database, subscriptionId: string): Promise<string | null>`.

**Acceptance Criteria:**
- [ ] `make verify-migrations` green; migration header names this wish and the 0043/0044/0052 precedent; rerunning the migration is a no-op.
- [ ] Schema test: CHECK refuses `'connector'` with a secret and `'subscription'` without one.
- [ ] Postgres test: an existing ClickUp row reads `ingress = 'subscription'` with its secret after migration; the subscription-keyed lookup returns null for a `'connector'` id; the connector-keyed lookup derives the right tenant and null for a foreign or unknown id.
- [ ] Registry tests: events and `actions: []` registers; no events refused. Sealed-credentials test: `{}` sealed, column NOT NULL.
- [ ] RLS and db-access-guard tests updated and green; the connector-keyed lookup runs as the actual constrained ingress/runtime roles; PUBLIC cannot execute it; a typed journal row (Decision #16 shape) inserts under enforced RLS with the right tenant; existing ClickUp ingress tests unchanged and green.

**Validation:**
```bash
test -z "$(find . -name node_modules -prune -o -name '.env*' ! -name '*.example' -print)" && <gate-wrapper> env -i HOME="$HOME" USER="$USER" PATH="$HOME/.autopg/bin/darwin-arm64/bin:<local-bin>:$PATH" TERM="${TERM:-xterm}" LANG="${LANG:-en_US.UTF-8}" bash -c 'bun run check && make marketplace-check && make test-pg-gate'
```

**depends-on:** Group 1

---

### Group 3: Connector and subscription management API

**Goal:** Let an authenticated caller set a connector's hook secret and create `'connector'` subscriptions under the design's invariants.

**Deliverables:**
1. `packages/api/src/schemas/connectors.ts` (shared Zod, reused by `schemas/openapi/connectors.ts`): connector create/update accept write-only `hookSecret` (min length, never echoed); connector view adds `hasHookSecret`, `totalUnmatched`, `lastUnmatchedAt`, `lastUnmatchedEventType`; the existing `CreateSubscriptionBodySchema` export becomes a union on `ingress` (omitted or `'subscription'`: today's `eventKey`, `filters?`, required `targetAutomationId`, required `verificationSecret`, unchanged; `'connector'`: `eventKey` (exact typed name or glob under `connector.{provider}.`, max 100), `filters?`, `targetAutomationId?`, no secret); the subscription view adds `ingress` and allows a null target; the PATCH schema never contains `ingress`.
2. `ConnectorService`: hook secret sealed per tenant on create and PATCH, never returned; `createSubscription` and `updateSubscription` enforce Decision #19 (a targeted `'connector'` row names one exact typed name; a glob only target-less) and branch `assertTargetAutomation` on `ingress` (`connector.event` for `'subscription'`, the exact typed name for `'connector'`, refusing with both names); PATCH of a `'connector'` row re-checks these and refuses a secret; `testSubscription` answers 409 `CONNECTOR_INGRESS_TEST_UNSUPPORTED` for a `'connector'` row.
3. OpenAPI docs for every changed body and view.

**Interfaces:**
- Consumes: group 2 columns and SDK rule.
- Produces: `CreateSubscriptionBodySchema` = `{ ingress?: 'subscription', eventKey: string, filters?: Record<string, unknown>, targetAutomationId: string, verificationSecret: string } | { ingress: 'connector', eventKey: string, filters?: Record<string, unknown>, targetAutomationId?: string }` on `POST /api/v2/connectors/:id/subscriptions`; `hookSecret?: string` on `POST /api/v2/connectors` and `PATCH /api/v2/connectors/:id`; view fields `hasHookSecret: boolean`, `totalUnmatched: number`, `lastUnmatchedAt: string | null`, `lastUnmatchedEventType: string | null`, subscription `ingress: 'subscription' | 'connector'` and `targetAutomationId: string | null`.

**Acceptance Criteria:**
- [ ] Route tests: targeted glob refused; target with `connector.event` or another name refused naming both, on create and PATCH; target-less glob accepted; `'subscription'` create unchanged.
- [ ] `hookSecret` never appears in any response, log line or view (sealed-surfaces test); `hasHookSecret` flips on set.
- [ ] Test endpoint on a `'connector'` row returns 409 and journals nothing.
- [ ] Agent manifest naming `connector.*` in `accepts` or `publishes` still refused (regression).

**Validation:**
```bash
test -z "$(find . -name node_modules -prune -o -name '.env*' ! -name '*.example' -print)" && <gate-wrapper> env -i HOME="$HOME" USER="$USER" PATH="$HOME/.autopg/bin/darwin-arm64/bin:<local-bin>:$PATH" TERM="${TERM:-xterm}" LANG="${LANG:-en_US.UTF-8}" bash -c 'bun run check && make marketplace-check && make test-pg-gate'
```

**depends-on:** Group 2

---

### Group 4: Per-connector delivery route

**Goal:** Accept one provider hook per connector, type it, match it, journal it once, and fire only named targets.

**Deliverables:**
1. `POST /api/v2/connectors/hooks/:connectorId` in `packages/api/src/app.ts`, beside and in the same style as `POST /api/v2/connectors/events/:subscriptionId` (rate limit, raw body, declared before the authenticated `/connectors/:id` routes), with OpenAPI docs.
2. `ConnectorService.receiveForConnector(connectorId, rawBody, headers)`: tenant via `resolveConnectorTenantByConnectorId`; verification with the sealed connector hook secret through the provider's verifier (uniform 401 on every refusal, including unknown connector or no hook secret); typed name per Decision #10; match active `'connector'` subscriptions by glob plus exact filters; on a match one journal row keyed `connector:{connectorId}:{providerEventId}` whose payload carries provider fields once (no `rawPayload`) plus reserved `connectorId`, `subscriptionIds[]` (all matches) and `targetAutomationIds[]` (distinct targets), body fields of those names overwritten or deleted; publish via `publishConnector`; claim/release semantics as today; on no match no row, bump `total_unmatched`, `last_unmatched_at`, `last_unmatched_event_type`; answer 2xx.
3. Event registry accepts `connector.{provider}.*` names (`packages/core/src/events/nats/registry.ts`, `types.ts`).
4. `ConnectorParsedDelivery.eventType?: string` in `packages/connector-sdk/src/types.ts`.
5. Tests at fixed paths: fixture connector `packages/api/src/__tests__/fixtures/events-only-connector.ts`; Postgres suite `packages/api/src/__tests__/connector-hooks-postgres.test.ts` (the `-postgres` suffix puts it in `make test-pg-gate`); real-NATS suite `packages/api/src/__tests__/connector-hooks-nats.test.ts` with its child process `packages/api/src/__tests__/fixtures/connector-hooks-nats-run.ts` (Decision #13).

**Interfaces:**
- Consumes: group 1 `publishConnector`, `isConnectorEventType`, gate keys; group 2 columns and `resolveConnectorTenantByConnectorId`; group 3 subscriptions and hook secret.
- Produces: route `POST /api/v2/connectors/hooks/:connectorId`; typed row payload `{ ...providerFields, connectorId: string, subscriptionIds: string[], targetAutomationIds: string[] }`; `ConnectorParsedDelivery.eventType`.

**Acceptance Criteria:**
- [ ] Real NATS: `connector.event` and `connector.gitlab.merge_request.merged` through the fixture connector read back from a durable consumer and the journal; a body above half of `max_payload` is journaled, published and answered 2xx.
- [ ] Postgres: two matches give one row with both subscription ids and the connector id; same provider event id again writes nothing; two targeted matches fire each target once, an unnamed same-trigger automation does not; a target-less typed delivery fires nothing (two tenants); provider-supplied `subscriptionIds`/`targetAutomationIds` are replaced; unmatched delivery writes no row and bumps the counters.
- [ ] Postgres: a `'connector'` subscription id posted to the per-subscription route journals and fires nothing; a ClickUp delivery stays byte-for-byte (single ids, `rawPayload`, provider `targetAutomationIds` passed through, only the bound automation fires).
- [ ] No journaled row or delivered event contains the hook secret; bad signature, unknown connector and missing secret all answer the same 401.

**Validation:**
```bash
test -z "$(find . -name node_modules -prune -o -name '.env*' ! -name '*.example' -print)" && <gate-wrapper> env -i HOME="$HOME" USER="$USER" PATH="$HOME/.autopg/bin/darwin-arm64/bin:<local-bin>:$PATH" TERM="${TERM:-xterm}" LANG="${LANG:-en_US.UTF-8}" bash -c 'bun run check && make marketplace-check && make test-pg-gate'
```

**depends-on:** Group 3

---

### Group 5: CLI and SDK surface

**Goal:** Let an operator create per-connector subscriptions, set the hook secret and see unmatched deliveries.

**Deliverables:**
1. `packages/sdk/src/client.ts`: `CreateConnectorSubscriptionBody` becomes exactly group 3's `CreateSubscriptionBodySchema` union (same names and types); connector create/update types gain `hookSecret?`; view types gain the group 3 fields; then `make sdk-generate` for `types.generated.ts`.
2. `packages/cli/src/commands/connectors.ts`: create a `'connector'` subscription (glob or exact event key, optional target, filters); set or rotate the hook secret from stdin or a prompt, never echoed or accepted as a plain flag value.
3. `packages/cli/src/commands/doctor.ts`: one line per connector with unmatched counts through the authenticated connectors list, never `/api/v2/health`.

**Interfaces:**
- Consumes: group 3 bodies and views; group 4 route path (printed as the hook URL).
- Produces: none.

**Acceptance Criteria:**
- [ ] CLI doctor test shows `total_unmatched`, `last_unmatched_at` and the last typed name from a mocked authenticated read, and makes no health call for it.
- [ ] CLI connectors test covers glob target-less and exact targeted create and secret set from stdin.
- [ ] SDK typecheck covers both subscription body branches.

**Validation:**
```bash
make sdk-generate && test -z "$(find . -name node_modules -prune -o -name '.env*' ! -name '*.example' -print)" && <gate-wrapper> env -i HOME="$HOME" USER="$USER" PATH="$HOME/.autopg/bin/darwin-arm64/bin:<local-bin>:$PATH" TERM="${TERM:-xterm}" LANG="${LANG:-en_US.UTF-8}" bash -c 'bun run check && make marketplace-check'
```

**depends-on:** Group 4

---

### Group 6: `gitlab` connector, events only (slice 2, gated)

**Goal:** Map GitLab's single hook to typed `connector.gitlab.*` names on slice 1's per-connector route.

**Deliverables:**
1. `packages/connector-gitlab/` (package.json, `src/manifest.ts`, `src/index.ts`, `src/__tests__/`), registered in `packages/api/src/services/connector-registry.ts` and `packages/api/package.json`; `actions: []`; one optional hook-secret credential.
2. Verifier per DESIGN Decision #21 (signing-token `whsec_` mode over `webhook-id`, `webhook-timestamp` and the raw body; secret-token mode with `timingSafeEqual` after a length check; the mode fixed by the stored secret).
3. `providerEventId` from `webhook-id`, then `Idempotency-Key`, then SHA-256 of the raw body; `parseDelivery` never throws and sets `eventType` per DESIGN Decision #10.
4. Operator-supplied capture of one real and one test delivery recorded in this wish.

**Interfaces:**
- Consumes: `ConnectorParsedDelivery.eventType`, `actions: []`, optional credential fields, `POST /api/v2/connectors/hooks/:connectorId`.
- Produces: provider id `gitlab`; typed names `connector.gitlab.{kind}[.{verb}]`.

**Acceptance Criteria:**
- [ ] DESIGN Success Criteria "Slice 2, GitLab connector", "Slice 2, typed-name mapping", "Slice 2, verifier modes".

**Validation:**
```bash
test -z "$(find . -name node_modules -prune -o -name '.env*' ! -name '*.example' -print)" && <gate-wrapper> env -i HOME="$HOME" USER="$USER" PATH="$HOME/.autopg/bin/darwin-arm64/bin:<local-bin>:$PATH" TERM="${TERM:-xterm}" LANG="${LANG:-en_US.UTF-8}" bash -c 'bun run check && make marketplace-check'
```

**depends-on:** Group 5, plus the R5-1 gate recorded under Dependencies

---

### Group 7: Measurement and zero-event proof (slice 4, gated)

**Goal:** Show at least 99% of in-scope `khal/brain` events reach the owning agent's consumer, every miss explained.

**Deliverables:**
1. `.genie/wishes/gitlab-sdlc-connector/measurement.md`, built only from operator-supplied evidence files listed in it with their SHA-256: go-live timestamp; per-category baseline (7 days before, GitLab API) and measured journaled-and-acked counts (7 days after); the ratio; a miss list where every miss has exactly one cause from {not sent, refused by Omni, unmatched, journaled but not acked}; a separate proof section (DESIGN Decisions #13, #14) with `job.failed` marked as a replay; operator sign-off line.
2. `.genie/wishes/gitlab-sdlc-connector/check-measurement.ts`: parses the report and exits non-zero unless the windows are 7 days each around go-live, every category has numerator and denominator, the total ratio is at least 0.99, every miss has an allowed cause, proof objects are excluded from the ratio, the replay is labelled, every evidence file hash matches, and the sign-off is present.

**Interfaces:**
- Consumes: group 6 live on the per-connector route; operator evidence files.
- Produces: none.

**Acceptance Criteria:**
- [ ] DESIGN Success Criteria "Slice 4, ratio" and "Slice 4, zero-event proof", checked by the script.

**Validation:**
```bash
bun .genie/wishes/gitlab-sdlc-connector/check-measurement.ts .genie/wishes/gitlab-sdlc-connector/measurement.md
```

**depends-on:** Group 6, go-live

---

## QA Criteria

_What must be verified on dev after merge. The QA agent tests each criterion._

- [ ] A test delivery to a fixture connector's per-connector URL on a disposable stack is journaled once under `connector:{id}:{eventId}` and read back from a durable consumer.
- [ ] A ClickUp delivery on the per-subscription route behaves byte-for-byte as before slice 1.
- [ ] `emit_event`, `/events/trigger`, a forged dead letter and a replay cannot produce a `connector.*` row with a chosen target list.

---

## Assumptions / Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Group 2's migration and #1460's `0091` collide, plus shared edits in `schema.ts`, `tenancy-rls.ts`, journal, `types.generated.ts`. | Medium | Decision #6; merge `origin/dev` (merge commit) before each PR. |
| `make check`/`make test` run `drizzle-kit push --force` against `.env`, and a real Postgres listens on 127.0.0.1:5432 here. | High | Decision #11 safe gate; the worktree has no `.env`; briefs forbid those targets. |
| Group 4's size (public route, verification, journal, real-NATS and Postgres tests over a 1,262-line service). | Medium | Group 3 already took the management API. Estimate before dispatch: ~10 files (app.ts, connectors.ts, openapi, registry, types, SDK types, 4 test/fixture files), ~1,400-1,900 insertions. Acceptance tests always ship with the route; if the real diff passes the band, the captain records a size ruling here rather than deferring any proof. |
| A provider hook pointed at production before the stream exists gets disabled by GitLab after 40 failures. | High | Operator-held production stream check before cutover. |
| The R5-1 delivery gate slips (C0 in progress). | Low | Slice 1 does not depend on it; groups 6 and 7 wait. |
| GitLab header names and signing of test deliveries unconfirmed. | Low | Operator capture in group 6 before cutover. |

---

## Review Results

_The read-only reviewer returns evidence; the invoking orchestrator appends a timestamped block here after plan, execution, and PR reviews._

### Plan review 3 — 2026-11-01, Codex (t1v1), APPROVED

On WISH sha256 `dab5f261…`: all five R2 findings closed; one LOW editorial finding (stale size summaries) fixed in this revision. Report: plan-review-3.md in the orchestrator scratchpad. Plan approval only, not implementation or merge acceptance.

### Plan review 2 — 2026-11-01, Codex (t1v1), FIX-FIRST

On WISH sha256 `6b3c09df…`: 6 findings closed, 4 partly, 5 remaining (3 HIGH, 2 MEDIUM). Dispositions: R2-1 whole gate under `env -i` plus no `.env*` files (Decision #11, every Validation block); R2-2 bootstrap type chain owned by group 1 (Decision #4, group 1 deliverable 6, files) and fixture inventory done by the group 1 dev (five files, captain ruling below); R2-3 `CreateSubscriptionBodySchema` with `eventKey` in both branches (groups 3 and 5); R2-4 SELECT on `connectors` for the SECURITY DEFINER owner, EXECUTE/PUBLIC rules, constrained-role tests, and the journal shape pinned (Decision #16, groups 1 and 2); R2-5 group 4 estimate and fixed test paths, acceptance tests never deferred (Risks, group 4 deliverable 5).

### Group 1 reviews — 2026-11-01

- Break-it (DeepSeek, t1wp): 4 holes of 68 attacks (publish() bypass, pg-gate `--url=` and query-string override); fixed in b1fc4728e. All forgery, fan-out, provenance and manifest attacks blocked.
- PR review (Claude Opus, t1wn) @ b1fc4728e: FIX-FIRST, 2 MEDIUM, 6 LOW, no forgery or bypass. M1 wire the pg-cluster test into gate and CI with a private TMPDIR; M2 prove auto-retry under enforced RLS (scope rule if it fails: DLQ tenant, else the stored event's claimed tenant as RLS scope only, else ambient). Captain: L6 accepted (test-delivery dead letters, key `test:<uuid>`, are not retryable or replayable, consistent with Decision #16); L8 (stale comment in `plugins/event-persistence.ts`) deferred to group 4. M2 result: the enforced-RLS repro fails on the EXISTING `dead_letter_events` scan in `processAutoRetries` (42501, NULL-owned rows under forced RLS, 0041 and 'unowned until G6'), before any group 1 code runs: a pre-existing tenancy gap, reported to t1m, not fixed in group 1. Group 1 asserts it fails closed (nothing published, nothing fired, row intact).

### Group 5 review — 2026-11-01

Claude Opus (t1zb) SHIP @ 01c476211, 4 LOW. `types.generated.ts` is byte-identical to a scratch regeneration; focused CLI and SDK tests 86/0. Captain rulings:
- L1: the terminal sanitiser also strips C1 (0x7F-0x9F) and bidi controls.
- L2: the doctor blames access only on 401/403 or a missing key; any other error prints "Connector counters unavailable: <reason>".
- L3: the doctor warns only when `lastUnmatchedAt` is within 24h, otherwise OK with the counts shown. The counter is cumulative, and Decision #4 makes unsubscribed GitLab categories count as unmatched.
- L4: the hook URL is printed only when `hasHookSecret` is true and is labelled relative to the CLI's API URL. A server-rendered public `hookUrl` is a later API change.
- No TTY prompt: the hook secret comes from stdin only.

### Group 5 delivered, slice 1 complete — 2026-11-01

#1482 merged to dev as b9293268d (Opus SHIP on exactly 5cae024f0, including a delta re-review). Groups 6 and 7 stay gated on the paired-agents delivery minimum (R5-1) and operator-held evidence.

### Group 4 delivered — 2026-11-01

#1477 merged to dev as 588c2c59e.

### #1477 CI — 2026-11-01

CI's PostgreSQL job lacked `nats-server`, so the group 4 PG+NATS suite failed in `beforeAll`. `pg-gate.ts` dropped the failure summary on exit (issue #1479). Fixed in `ci.yml` by copying the quality job's NATS cache and `ensure-nats.sh` steps (4bb16819c, CI green). The owner ordered a follow-up PR from dev for #1479, with a test that a `beforeAll` failure names its suite.

### Captain rulings — 2026-11-01, group 4

- One type-only line in `packages/db/src/schema.ts` (the `eventType` union widened to `connector.${string}`), marked `// no-migration-needed`; no SQL change.
- The per-connector route matches subscriptions in status `active` and `error` (never `paused`), like the legacy route, and recovers an `error` row to `active` on success, so real provider events are never counted unmatched because of an earlier failure.

### Group 4 review — 2026-11-01

Claude Opus (t1yq) SHIP, 3 LOW: L1 timing difference between unknown and known connector ids, accepted as parity with the legacy per-subscription route (UUIDv4 ids); L2 claim-release failure must still record the failure (fixed); L3 `plugins/event-persistence.ts` comment is the group 1 L8 deferral assigned to group 4 (file added to group 4 scope). The Postgres suite ran in the dev's pg-gate (`connector-hooks-postgres.test.ts` listed, 544 assertions, 0 skipped).

### Group 4 break-it — 2026-11-01

DeepSeek (t1yr): 4 holes of 24 attacks, all answering 500 (which counts toward GitLab disabling the hook): concurrent duplicate deliveries hitting the tenant idempotency index, typed names over 255 chars, registry-invalid typed names, and unmatched names over the 200-char counter column. Captain rule: the hooks route never answers 5xx for provider input; duplicates on either idempotency index are duplicates; invalid or over-long names take the unmatched path with the stored name truncated. Further rulings: a verified body the provider parser cannot parse is an unmatched delivery named `connector.{provider}.unparsed` (202, no row, no publish); a payload above NATS capacity answers 413 (an honest failure, design Risk #3); only genuine database or transport outages answer 500. Authentication, cross-tenant, routing forgery, filters, ClickUp, unmatched-no-storage, secret scan and real-JetStream size attacks all held.

### Group 3 delivered — 2026-11-01

PR #1472 merged to dev at 21:53Z by the shared account (head `ff2f9ae26`), CI 14 pass / 3 skipped by design, Claude Opus SHIP with 2 LOW fixed.

### Group 2 delivered — 2026-11-01

PR #1468 merged to dev as `562a335f` (head `490bb3dbe`, migration 0092): merged-tree gate green (pg-gate 531 assertions / 52 suites / 0 skipped), CI 13 pass / 3 skipped by design, Claude Opus review SHIP (one LOW carried into group 3: nullable subscription target in the response schema).

### Group 1 delivered — 2026-11-01

PR #1465 merged to dev as `8885c362` (head `c5ba82fd3`): merged-tree gate green (check 31/31, marketplace 66 tests, pg-gate 507 assertions / 49 suites / 0 skipped), CI 14 pass / 3 skipped by design. Follow-up issue #1467 (dead-letter tenancy gap) is owned by t1q0 and takes migration 0093 after group 2's 0092.

### Captain ruling — 2026-11-01, group 1 size

Group 1 may reach 27-29 files (stop at 30) with insertions well under 2,000: five existing test files that build `DeadLetterService` or the service factory with `EventBus`-only mocks gain `publishConnector` in their harness (assertions unchanged), and the API middleware/context carries the concrete bus type. No `EventBus` change, no optional method, no cast. Amended the same day: two `createApp` harnesses (`webhook-clickup-source-postgres`, `webhook-github-source-postgres`) also gain `publishConnector`, so group 1 may reach 32 files (hard stop 34); harnesses use explicit complete stubs, because importing core's memory bus across packages breaks the API `rootDir`. Amended again: one `knip.json` entry for the new pg-cluster test and one `packages/db/src/tenancy-db-access-guard.ts` registration for the new provenance reader (it reads `omni_events` under the dead letter's tenant scope) bring group 1 to the hard stop of 34 files; #1460 edits only that guard's test file. Superseded: the guard also pins each tenant-boundary file in its test allowlist, so the provenance reader moved into `services/connectors.ts` (already registered for `omni_events`), the guard entry was dropped, and group 1 is back to 32 files.

### Plan review 1 — 2026-11-01, Codex (t1v1, gpt-6-astra), FIX-FIRST

Ten findings (5 HIGH, 4 MEDIUM, 1 LOW) on WISH sha256 `f653b915…`. Dispositions in this revision: 1 safe gate (Decision #11, Global constraints); 2 nullable compatibility and required `actions` (Decision #8, group 2 deliverable 4); 3 distinct resolver name and an existing metadata type for `publishConnector` (group 1 and 2 interfaces); 4 shared Zod schemas to group 3, handwritten SDK client to group 5, pinned routes and `eventType` (Decisions #9, #10); 5 separate `ConnectorEventPublisher` interface so unrelated mocks stay untouched (Decision #4); 6 per-criterion owners, replay test, immutable `ingress`, PATCH invariants, test-endpoint disposition (Success Criteria, groups 1 and 3); 7 group 3 split into management (3) and delivery (4), real-NATS pattern pinned (Decision #13); 8 one team assignment (Decision #15); 9 operator-owned evidence and a checker script (Dependencies, group 7); 10 migration wording and guarded CHECK (Decision #7).

---

## Files to Create/Modify

```
# Group 1
scripts/disposable-pg-cluster.ts
scripts/pg-gate.ts
packages/core/src/automations/engine.ts
packages/core/src/automations/actions.ts
packages/core/src/events/bus.ts
packages/core/src/events/types.ts
packages/core/src/events/index.ts                  # export barrel, if needed
packages/core/src/events/nats/client.ts
packages/core/src/events/nats/streams.ts
packages/core/src/events/__tests__/memory-bus.ts
packages/api/src/services/connectors.ts            # publish call site and bus type only
packages/api/src/services/dead-letters.ts
packages/api/src/services/event-ops.ts
packages/api/src/services/index.ts                 # bus type chain
packages/api/src/index.ts                          # bus type chain
packages/api/src/app.ts                            # bus type chain only (group 4 adds the route)
packages/api/src/middleware/context.ts             # bus type chain
tests: disposable-cluster, engine gate, bus (real NATS), emit_event, dead-letter and replay Postgres, trigger regression, ClickUp ingress harnesses

# Group 2
packages/db/src/schema.ts
packages/db/drizzle/NNNN_connector_ingress.sql      # next free number on dev
packages/db/drizzle/meta/_journal.json
packages/db/src/tenancy-rls.ts
packages/db/src/tenancy-roles.ts
packages/db/src/tenancy-ownership.ts
packages/db/src/tenancy-db-access-guard.ts
packages/api/src/tenancy/connector-ingress.ts
packages/api/src/tenancy/sealed-credentials.ts
packages/api/src/services/connectors.ts            # nullable compatibility only
packages/connector-sdk/src/registry.ts
packages/connector-sdk/src/types.ts
tests: schema CHECK, tenancy lookups, RLS/guard, registry, sealed credentials

# Group 3
packages/api/src/schemas/connectors.ts
packages/api/src/schemas/openapi/connectors.ts
packages/api/src/routes/v2/connectors.ts
packages/api/src/services/connectors.ts
tests: management routes, sealed surfaces, manifest regression

# Group 4
packages/api/src/app.ts
packages/api/src/services/connectors.ts
packages/api/src/schemas/openapi/connectors.ts
packages/core/src/events/nats/registry.ts
packages/core/src/events/types.ts
packages/connector-sdk/src/types.ts
tests: real-NATS (child process), Postgres ingress, fixture connector

# Group 5
packages/sdk/src/client.ts
packages/sdk/src/types.generated.ts
packages/cli/src/commands/connectors.ts
packages/cli/src/commands/doctor.ts
tests: CLI doctor, CLI connectors

# Group 6 (gated)
packages/connector-gitlab/**
packages/api/src/services/connector-registry.ts
packages/api/package.json

# Group 7 (gated)
.genie/wishes/gitlab-sdlc-connector/measurement.md
.genie/wishes/gitlab-sdlc-connector/check-measurement.ts
```
