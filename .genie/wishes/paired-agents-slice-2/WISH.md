# Wish: Paired agents slice 2 — agent-owned consumers, provenance stamp and the grants table

| Field | Value |
|-------|-------|
| **Status** | SHIPPED |
| **Slug** | `paired-agents-slice-2` |
| **Date** | 2026-11-01 |
| **Author** | Felipe Rosa |
| **Appetite** | large |
| **Branch** | `wish/paired-agents-slice-2` |
| **Repos touched** | omni (`packages/db`, `packages/core`, `packages/api`, `packages/cli`, `packages/sdk`) |
| **Design** | [DESIGN.md](../../brainstorms/paired-agents/DESIGN.md) |

## Summary

Slice 2 of the paired-agents design (IN row 5, bound by rows 17 and 19): a durable consumer can be owned by an Omni
agent and is then reachable only by that agent's keys and admin/owner-tier keys (C1); every journal row produced under
an API key records the producing key and, for an agent's key, the producing agent, and connector and webhook ingress
rows record their source in indexed columns (the provenance stamp); and C2's grants live in a new table whose read
clause admits an instance-less row to an agent-owned consumer only when an active grant of that agent matches the
row's stamp. The slice has no grant writer (slice 6 is the only one), so until then no instance-less row reaches any
agent-owned consumer, and tests seed grant rows directly. Everything ships behind `OMNI_PAIRED_AGENT_CONSUMERS`, which
refuses to turn on under `OMNI_MULTITENANCY_ENABLED`. All code references are at `origin/dev` `61b94710` (identical to
`effb53b09` for every cited file except `api-keys.ts` and `doctor.ts`, which #1483 and #1482 changed).

## Scope

### IN

- **Group 1.** The flag decision function (row 17); one hand-written additive migration (stamp columns on
  `omni_events`, `durable_consumers.agent_id`, the `agent_source_grants` table, composite indexes ending in
  `journal_seq`); the operator-held online preparation for the journal indexes through `packages/db/src/online-ddl.ts`;
  the grants table's tenancy registration (row 5: "registered in `tenancy-rls.ts` as fix 2's column is"); the typed
  fixture fallout of the new select columns.
- **Group 2.** The provenance stamp at journal time: `producing_key_id` from the authenticated key, `agent_id` from
  the key's agent and never from a body, and the source reference for connector (legacy subscription and typed
  per-connector) and webhook ingress.
- **Group 3.** C1: agent-owned durable consumers (create, list, inspect, pull, ack, stream, delete) over a trusted
  three-way key principal; agent keys cannot create unowned consumers; legacy consumers unchanged; fix 1's instance
  rules intact; stored ownership enforced with the flag on and off.
- **Group 4.** C2's read clause and the agent-owned scan: per-branch ordered scans over the composite indexes, the
  grant join, legacy consumers keep `scanPage`.
- **Group 5.** The authenticated flag-status read, `doctor`'s paired-agents OFF line with the reason, the rollback
  proof, and the C12 architecture test over slice 2's files (Decision #13).
- **Group 6.** The design's Success Criterion "Fixes 1 to 3 and follow-ups A and B are active ... with multitenancy
  off and on": one case per merged fix and follow-up A with `OMNI_MULTITENANCY_ENABLED=true`, an enforced fixture for
  the C15 six-verb matrix, verification and recording of follow-up B's case (external prerequisite), the live-role
  suite inventory, and the final aggregate gate after the last group.
- Row 19 binds every group: each new two-tenant PostgreSQL proof asserts its live role in its own PR (Decision #15).

### OUT

- Slices 3 to 7 (DESIGN IN rows 6 to 16 and 18), one later wish each: the agent-bound child key and
  `api_keys.agent_id` (slice 3), emission guards, `causation_depth` and self-drop (slice 4), delivery mode, the
  compile, `paired`, the allowlist envelope and rollback row 18 (slice 5), pairing and the only grant writer (slice 6),
  the benchmark, backlog limit and glob strategy (slice 7).
- Any HTTP route, CLI command or service method that writes `agent_source_grants` (R13-3; slice 6 is the only
  writer). Tests seed grant rows with SQL.
- Stamping the producing agent on channel sends (`messages.ts` keeps `agentId: instance.agentId` at `:2075`, `:2271`,
  `:2344`; the DRAFT defers send stamping to slice 4, DRAFT line 436) and any change to the dispatcher or `call_agent`
  (C7).
- Implementing fixes 1 to 3 or follow-ups A and B (merged or separate PRs), and the follow-up A `doctor` agent read and
  `agent-keys` check (DESIGN row 4, not on dev). Follow-up B's *implementation* stays outside slice 2 (DESIGN groups
  table); its multitenancy-on *proof* is a slice-2 criterion that group 6 verifies and records (Decision #14).
- Multitenant paired agents (R2-2): the flag refuses to turn on under multitenancy.
- A grant clause on `metadata` jsonb, a jsonb index, or SQL push-down of payload filters (R3-3).
- Executing the online index preparation, migrations, restarts or flag enablement on any production or shared
  database: operator-held. Agents run them only on the disposable cluster.
- Repairing `make check`/`make test` (`_sync-db` runs `drizzle-kit push --force` against `.env`); agents never run
  those targets (Decision #17).

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | DESIGN.md binds unchanged (SHIP, review 5, digest `e17098ff…`). This wish covers IN row 5 only, plus rows 17 and 19 where they bind slice 2, design Decisions #24, #32 and #34, and the slice-2 Success Criteria lines (C1/C2 end to end, provenance, fixes with multitenancy on, live role, flag refusal, architecture test). It cuts them into groups and pins what the design leaves open. Base: `origin/dev` `61b94710`. | The design says slices 2 to 7 are one wish each (Size row; Approach groups table). |
| 2 | **Key principal before slice 3.** `api_keys` has no agent column (`schema.ts:614-701`; slice 3 adds it, row 6). One function, `resolveKeyAgent(db, keyId)` in `packages/api/src/lib/key-agent.ts`, classifies a key into three trusted kinds: `none` (not a system agent key: any key whose `created_by` is not `'system:auto-provision'` or whose name does not start with `agent:`, so hand-made `agent:` keys stay ordinary keys, the design's exception, R11-1/R13-1); `agent` (a system agent key proven by fix 3's ownership rule: active, named `agent:<name>` or `agent:<T>:<name>` (`agentKeyNameCandidates`, `lib/agent-key-name.ts:45`), at least one listed instance, every listed instance binds the same active agent through `instances.agent_id` with one common tenant, and `agentKeyBelongsToBinding` (`lib/agent-key-ownership.ts:8-23`) holds); `unresolved` (a system agent key that fails any of those, with its reason). It does one primary-key read of `api_keys` and stops there for `none`; only system agent keys pay the instance and agent reads. Slice 3 replaces the body with the `api_keys.agent_id` read after its backfill (same proof) and keeps the signature. | The only deterministic key-to-agent link on dev; name parsing alone is heuristic (DRAFT lines 343-345). Since #1483 a widened system key (`null` or `[]` instance list) fails authentication (`api-keys.ts:179-185`), but an active system key of an inactive agent, or one whose non-empty binding proof was lost, still authenticates, so it must not be confused with an ordinary key (plan review 1, finding 1). `unresolved` is never admin, whatever the owner-tier ruling. |
| 3 | **Admin/owner tier — owner ruling 2026-11-01 (relayed by t201).** `isAdminTierKey(key) = key.scopes.includes('*') && key.instanceIds === null`. An ordinary device key (`DEFAULT_DEVICE_KEY_SCOPES`, `login/config.ts:32-66`, no `*`) and a wildcard key with an instance list are not admin tier. Group 3 carries the truth table. The owner accepted this exact predicate, always checked after the tenant check. | DESIGN rows 5 and 249 name "admin or owner-tier keys" without defining them; the owner chose this conservative predicate; the existing scope helpers do not prove it, so the truth table does. |
| 4 | **Flag.** `OMNI_PAIRED_AGENT_CONSUMERS`, compared to the exact string `'true'`, decided only by `pairedAgentFlagState('consumers', env)` in `packages/api/src/tenancy/feature-flag.ts`, which reads `isMultitenancyEnabled()` (`feature-flag.ts:15-17`): set and multitenancy off is ON; set and multitenancy on is OFF with reason `multitenancy_enabled` (one start-up `warn`, never a boot stop); unset is OFF with reason `flag_unset`. The flag gates writes and new delivery: creating an agent-owned consumer, refusing an `unresolved` principal's create, every stamp column, and the granted branches of the agent-owned scan. Stored ownership (`durable_consumers.agent_id`) is enforced whatever the flag says. | Row 17 (own flag, exact `'true'`, one decision place, refusal under multitenancy, rollback by unset and restart). Applying design Decision #25's non-widening principle (that decision is literally about slice 5): unsetting the flag never opens a wider state. With the flag off, envelopes and journal rows stay byte-identical to today. |
| 5 | **Stamp model.** The producing key travels on the envelope as `metadata.producingKeyId`, set only by `createOmniEvent` from an ambient resolver (`setEnvelopeProducerResolver`, the `setEnvelopeTenantResolver` pattern at `envelope.ts:152-178`, registered at `api/src/index.ts` beside `:172`) that returns the request's authenticated key id from a request-scoped `AsyncLocalStorage` entered by `authMiddleware` (`middleware/auth.ts:128`). A caller-supplied `producingKeyId` is dropped, and the factory keeps dropping `metadata.agentId` (`factory.ts:63-73`). At journal time the writer stores `producing_key_id` and `agent_id` = the agent of `resolveKeyAgent(producing_key_id)` when its kind is `agent`, else NULL; with the flag on it never reads `metadata.agentId`. Claim sites that insert journal rows directly stamp the same columns themselves. Rows produced without a request (channel ingress, automations, workers) carry no producing key. | Row 5: "the producing agent in `omni_events.agent_id` (from the key, never the body), the producing key in a new `producing_key_id` ... at journal time". `metadata.agentId` is never set by any producer today (read at `event-persistence.ts:276`, `:352`, `:414`, `:468`, `:554`, always null through the factory). |
| 6 | **Source reference, one per row.** `source_kind` and `source_id` (both or neither): the legacy per-subscription claim (`ConnectorService.deliver`, `connectors.ts:1258`, insert `:1316-1328`, `ingress = 'subscription'`) stamps `connector_subscription` and the subscription id; the typed per-connector claim (`receiveForConnector` `:886` → `deliverForConnector` `:1031`, insert `:1062-1074`, `ingress = 'connector'`) stamps `connector` and the connector id; webhook `receive()` (`webhooks.ts:457-467`) stamps `webhook_source` and `webhook_sources.id` (never the `webhookSource` name). Grant kind `agent` matches `omni_events.agent_id`. A `connector_subscription` grant matches only legacy subscription rows; a typed row (one connector-owned row with many `subscriptionIds`) matches only a `connector` grant. | Row 5's "for connector rows it uses #1468's connector-keyed ingress (the connector id, and the `connector_event_subscriptions` row whose `ingress` says which kind)". Per-subscription grants for typed rows would be an owner design change. |
| 7 | **Grants table** `agent_source_grants`: `agent_id` (NOT NULL, FK `agents(id) ON DELETE CASCADE`), `source_kind` (CHECK in the four kinds), `source_id`, `approved_by_key_id` (NOT NULL, no FK), `approved_at` (NOT NULL, default now), `revoked_at` (nullable), `tenant_id` (nullable), `created_at`; unique `(agent_id, source_kind, source_id) WHERE revoked_at IS NULL`. Registered in `APPLICATION_SCOPED_TENANT_TABLES` (`tenancy-rls.ts:197-211`) beside `durable_consumers`, never FORCE RLS; the runtime role already gets DML on every public table (`tenancy-roles.ts:244-247`). No writer in this wish. | Row 5 verbatim columns; R13-3. CASCADE only removes access; `SET NULL` is impossible on a NOT NULL column. |
| 8 | **`durable_consumers.agent_id` has no FK**, like `owner_key_id` (0082). A consumer whose agent is deleted stays agent-owned and becomes reachable only by admin/owner-tier keys (group 3 tests it). | `ON DELETE SET NULL` would turn an agent-owned consumer into an unowned one any `events:write` key may pull. |
| 9 | **Indexes and the large-journal prerequisite.** Journal indexes: `omni_events_instance_type_seq_idx (instance_id, event_type, journal_seq) WHERE instance_id IS NOT NULL`, `omni_events_source_type_seq_idx (source_kind, source_id, event_type, journal_seq) WHERE source_kind IS NOT NULL`, `omni_events_agent_type_seq_idx (agent_id, event_type, journal_seq) WHERE agent_id IS NOT NULL`, `omni_events_producing_key_idx (producing_key_id) WHERE producing_key_id IS NOT NULL`. Every one scans the whole journal to build, partial or not, so all four are high-volume online-DDL indexes: their nullable columns and `CREATE INDEX CONCURRENTLY IF NOT EXISTS` forms join the online phase (`online-ddl.ts`: columns first `:120-124`, invalid/not-ready residue dropped with `DROP INDEX CONCURRENTLY` `:128-138`, then concurrent builds `:140-145`). **The real requirement is operator preparation before the upgrade**, following the runbook `docs/deployment/paired-agent-journal-indexes.md` (group 1): stage the exact candidate source checkout with its dependencies, then from its `packages/db` run `bun run db:online-ddl --url <explicit-ddl-url> --check`, the run, and `--check` again, before replacing the serving binary. **The boot guard is an estimate-based preflight** (`assertOnlineDdlPreflight`, `migrate.ts:44-53`): it refuses to migrate, with a message naming the pending index work and the runbook, when a high-volume table is missing an index, invalid or not ready and its `pg_class.reltuples` estimate is at least `DEFAULT_LARGE_TABLE_ROWS` (1,000,000); a never-analyzed table (`reltuples < 0`) gets the bounded probe (`online-ddl.ts:273-279`). Its limits are disclosed, not fixed: a stale low estimate on a large journal passes and the migration then builds in-band, and `OMNI_ALLOW_BLOCKING_INDEX_BUILD=on` (`migrate.ts:47-49`) skips it; that override is operator-only and never set by automation. No exact-count probe is added. The guard ignores the paired-agent flag: an unprepared large deployment stops serving on upgrade even with the flag unset, recoverable by the runbook. The 0094 migration keeps the same four definitions as ordinary `CREATE INDEX IF NOT EXISTS` (no `CONCURRENTLY`), so a fresh or small database migrates normally and a prepared large one no-ops. `--check` exits 3 when the preflight is blocked (today it exits 0, `packages/db/scripts/online-ddl.ts:65`), 0 when clear, 2 on a usage error. Production execution is operator-held. Glob strategy stays deferred to slice 7. | Row 5: "composite indexes ending in `journal_seq`". The migrator runs in one transaction under a 60 s start-up budget, and `IF NOT EXISTS` alone accepts an invalid index (`online-ddl.ts:7-42`); the 0041 preflight is the repository's guard pattern. A non-zero `--check` makes the runbook's verification mechanical (plan review 1 finding 5; plan review 2 findings 2 and 3). |
| 10 | **Agent-owned scan.** `EventConsumerService` routes every scan through one private `scan()` that calls `scanAgentOwnedPage` when `consumer.agentId` is set and `scanPage` (`event-consumers.ts:961-987`) otherwise, so all five call sites (`withLag` `:554`, `pull` `:672`, `scanForStream` `:799`, `claimShared`'s reclaim `:860`, `scanFresh` `:943`) are covered. Three ordered branches, each `ORDER BY journal_seq LIMIT n` with the consumer's type, exclude, tenant and access predicates: (I) `instance_id IS NOT NULL` rows with the consumer's instance scope and the caller's instance clause (`extra`); (S) `instance_id IS NULL` rows whose `(source_kind, source_id)` matches an active grant of the consumer's agent; (A) `instance_id IS NULL` rows whose `agent_id` matches an active `agent` grant. S and A are authorized by grants alone: the instance-only `extra` and `instanceScopeClause` are never ANDed onto NULL-instance rows. Results merge by `journal_seq`, deduplicated, first `limit` kept, so the scanned cursor never skips an unread matching row. With the flag off only branch I runs. | Row 5 ("one indexed join in the agent-owned scan"; "legacy consumers keep `scanPage`"); Decisions #3 (matched rows only) and #4 (payload filters stay in JS). |
| 11 | **Fix 1 stays intact for agent-owned consumers.** `resolveConsumerScope`, the restricted-key-on-unscoped 403 in `getMutable` (`:537-548`), `narrowToCaller` and the caller's instance clause apply unchanged. C1 adds one check after the tenant check: an agent-owned consumer is visible and mutable only to an internal caller (no caller object), an admin-tier caller, or a caller whose principal is `agent` with the consumer's agent id; for agent-owned scoped consumers that agent check replaces the owner-key identity, so any proven key of the agent may drain it. An `unresolved` principal is never admin and never matches an agent. | Row 2: "`canAccessConsumer` refuses a tenant caller whose tenant differs ..., then applies fix 1's scoped-owner rule; C1 extends it with the agent check". |
| 12 | **`doctor` reads an authenticated flag status.** Local handler `systemRoutes.get('/paired-agents', …)` in `routes/v2/system.ts` (the router is mounted at `/system`, `routes/v2/index.ts:78`, like `systemRoutes.get('/update')` at `system.ts:27`); OpenAPI path `/system/paired-agents`; public path `GET /api/v2/system/paired-agents`; scope `system:read` (`SCOPE_MAP` entry `'GET /system/paired-agents'` beside `'GET /system/update'`, `constants/scopes.ts:419`). Check `paired-agents`: ON is OK; OFF with `flag_unset` is OK with the reason (the default); OFF with `multitenancy_enabled` is WARN; a failed read is WARN; never FAIL. | Row 17 ("`doctor` reports paired agents as OFF with that reason"); DESIGN Risk #9. `/health` is unauthenticated and carries no configuration; the row 4 agent read is not on dev. |
| 13 | **The C12 architecture test lands in slice 2** over slice 2's files (`PAIRED_AGENT_SLICE_FILES`), and slices 3 to 7 append their files. Its denylist is row 17's, exactly; the `paired` case uses a fixture string because `paired` arrives in slice 5. | The design never names the slice that lands it: row 17 says "checked by an architecture test over the slices' files", Success Criterion line 270 names one test, and Approach line 106 binds slices 2 to 7. Landing it first keeps every slice checked. |
| 14 | **Multitenancy-on cases.** Group 6 adds one case each for fix 1 (C0), fix 2 (C15, the enforced six-verb matrix), fix 3 (the enforced start-up repair) and follow-up A (#1475), each with `OMNI_MULTITENANCY_ENABLED='true'` set inside the test and restored, and `OMNI_PAIRED_AGENT_CONSUMERS` deleted. **Follow-up B** is not on dev and has no open PR; it is an external prerequisite of this wish. Group 6 owns verifying and recording B's multitenancy-on case: if B has merged when group 6 runs, group 6 adds the case; otherwise B's PR must carry it and the orchestrator records its proof in Review Results. The "fixes active with multitenancy on" criterion cannot be checked off until B's proof lands; if B is unavailable, slice-2 acceptance is reported incomplete. | DESIGN Success Criterion line 247 requires one case "per fix and per follow-up", B included; the design's groups table does not pull B's implementation into slice 2 (plan review finding 3). |
| 15 | **Live role and RLS.** Every new two-tenant PostgreSQL proof opens its runtime connection with `pgRoleUrl(superUrl, dbName, { name: DEFAULT_ROLE_NAMES.runtime, password })` and calls `assertPgTestRole(db, DEFAULT_ROLE_NAMES.runtime)` before its first query (`pgRoleUrl`, `assertPgTestRole` from `@omni/db/pg-migrated-template`, #1474; `DEFAULT_ROLE_NAMES`, `applyTenancyRoles`, `applyTenantRlsEnforcement` from `@omni/db`), in the same PR as the proof. An enforced proof also asserts the enforcement state: `pg_class.relforcerowsecurity` true on the RLS-managed tables it reads (`omni_events`, `instances`) and false on the application-scoped `durable_consumers` and `agent_source_grants`. No suite defines its own `urlFor`. Group 6 maintains the explicit inventory `TWO_TENANT_PROOFS` in a static test and runs the final aggregate gate after the last group. | Row 19 and design Decision #34. A non-superuser role alone installs no RLS (`tenancy-rls.ts:551-555`); the existing C15 tenant suite at `event-consumers-postgres.test.ts:1115` runs without enforcement and its enforced block (`:1380-1403`) does not cover the six verbs (plan review finding 4). |
| 16 | Group 1 owns the slice's one migration at the next free number on `dev` (expected `0094_paired_agent_consumers.sql`, journal `idx` 94, `when` 1789200000000 = 0093's 1789100000000 + 100000000). Teammates t1q0 and t1pz may add migrations, and old open PRs (#1270, #1249, #916) claim schema files: whoever merges second renumbers its own SQL file and journal entry (`tag`, `idx`), recomputes `when` from the new predecessor and reruns the gate; no number is skipped. | `.claude/CLAUDE.md` parallel-worktree rule; `0093_dead_letter_tenant_scope` is idx 93 at `effb53b09`. |
| 17 | Safe gate for every code group, run in the task worktree (never `make check` or `make test`): `test -z "$(find . -name node_modules -prune -o -name '.env*' ! -name '*.example' -print)" && "$HOST_GATE_SH" env -i HOME="$HOME" USER="$USER" PATH="$HOME/.autopg/bin/darwin-arm64/bin:/opt/homebrew/opt/libpq/bin:$PATH" TERM="${TERM:-xterm}" LANG="${LANG:-en_US.UTF-8}" bash -c 'bun run check && make marketplace-check && make test-pg-gate'`. | `make test` depends on `_sync-db`, which sources `.env` and runs `drizzle-kit push --force`; a real Postgres listens on 127.0.0.1:5432 on this host. The whole chain runs inside the Mac-wide gate semaphore `brain-v3.worktrees/.tools/gate.sh` (at most 2 heavy runs on this host; t1m rule 2026-11-01; focused single-file runs need no lock) and under `env -i` (only HOME, USER, PATH, TERM, LANG survive; PATH is prefixed with the host's PostgreSQL server binaries (autopg) and the `psql` client (Homebrew libpq), which the disposable cluster and the PostgreSQL suites need; `OMNI_PG_BIN_DIR` stays unset so `psql` is not looked up in the server directory), so no ambient `DATABASE_URL`, `ENABLE_DB_TESTS`, `PG*` or `OMNI_G*_POSTGRES_URL` reaches any test, and no `.env*` file (other than `*.example`) may exist anywhere in the worktree outside `node_modules`, so Bun autoloads nothing. `bun run check` covers typecheck, lint, knip, verify-migrations, verify-versions and turbo tests; only `make test-pg-gate` injects URLs, for its own disposable cluster. Copied from the `gitlab-sdlc-connector` wish, Decision #11. |
| 18 | One PR to `dev` per group, in group order 1 to 6; the owner merges in order and agents never merge. A dependent group may start on a branch stacked on its dependency and opens its PR after the dependency merges. | One self-consistent, independently safe PR per group; group 6 last so its inventory and aggregate gate see every suite. |
| 19 | Team: Codex (`dev`) authors each group in its own worktree under `~/workspace/repos/omni.worktrees`, created from `origin/dev`; a Claude Opus reviewer reviews every PR (cross-provider); a DeepSeek break-it pass runs on groups 3 and 4 (consumer access and the grant read clause); the owner merges in order. | Owner's team flow for this wish. |
| 20 | **Journal columns per producer** (shared by groups 2 to 5). `producing_key_id`: the request's key on every row produced in an authenticated request with the flag on, else NULL. `agent_id`: the `agent`-kind result of `resolveKeyAgent(producing_key_id)` with the flag on (NULL for `none` and `unresolved`), unchanged legacy value (`metadata.agentId ?? null`) with it off. `source_kind`/`source_id`: Decision #6, flag on only. Existing metadata shapes (legacy connector, typed connector per the `gitlab-sdlc-connector` wish Decision #16, webhook, manual trigger) are unchanged; `source` in metadata is never read as provenance. | One contract the stamp, the scan and the tests all read. |
| 21 | **Live conflicts, order and revalidation.** Merged and part of the base: #1477 and #1478 (2026-11-01T22:37Z), #1482 (`b9293268d`, 23:00Z; `doctor.ts`, `doctor.test.ts`, `types.generated.ts`, SDK client), #1483 (`61b94710`, 23:01Z; widened system agent keys rejected at authentication). Groups 3 and 5 start from #1482's CLI/SDK state and regenerate types there; groups 2, 3 and 6 use #1483's deterministic 401 for a widened key at the HTTP edge. Open: #1480 (`pg-migrated-template.ts`, `scripts/pg-gate.ts`, `multitenancy-postgres.test.ts`, disposable-cluster tests) changes test-target admission as well as helpers; when it merges, every group open or stacked at that point merges `origin/dev` and reruns the full gate. #1484 (OpenClaw removal; `schema.ts`, SDK types and client, `services/agents.ts`, provider contracts, `knip.json`) is a file and semantic conflict for groups 1, 3 and 5 if it lands first: merge `origin/dev`, rerun `make sdk-generate` and the gate, keep the C12 architecture test binding, and leave any design or provider reconciliation to the owner. | Plan review 1 finding 9; plan review 2 focused checks. |

## Simplicity Case

- **Simplest complete design:** the design's: one nullable `agent_id` on consumers, four stamp columns on the journal
  (one existing), one grants table, one access check, one scan dispatch with three ordered branches, one flag.
- **Added machinery:** the request-scoped producer `AsyncLocalStorage` and envelope resolver (the factory is
  synchronous and has no request; the tenant stamp already uses the same seam); `resolveKeyAgent`'s three-way
  principal (no key-to-agent column until slice 3, and an unresolved system key must not pass as an ordinary key);
  slice-2 entries in the existing online-DDL phase and preflight (the journal is high volume); one authenticated
  status route (the CLI cannot read the server's environment); one static live-role inventory test. The six groups
  keep each PR within the admission band (25 files, 2,000 insertions) and safe alone.
- **Deferred until measured:** the glob strategy for agent-owned consumers and any further index (slice 7, C13); a
  union view over an agent's consumers.
- **Complexity removed:** no grant writer, no `api_keys` change, no backfill, no new event type, no change to
  `scanPage` for legacy consumers, no change to fix 1's instance rules, no `/health` change, no new online-DDL runner.

## Dependencies

**depends-on:** none
**blocks:** none

- Base `origin/dev` `61b94710`: fixes 1 to 3 (#1460 area, `0091`, #1462, #1469), follow-up A (#1475), #1474's role
  helper, the GitLab connector groups 1 to 4 (#1465, #1468, #1472, #1477), #1478, #1482 and #1483 are merged. The typed claim
  group 2 stamps (`receiveForConnector`) is on the base, so no partial-stamp split is needed.
- **External prerequisite: follow-up B** (route-named agents, DESIGN row 3d), not on dev and with no open PR. Only the
  "fixes active with multitenancy on" criterion waits for it (Decision #14).
- **Owner disposition** of the admin/owner-tier predicate (Decision #3): ruled 2026-11-01; no longer a prerequisite.
- Open conflicts #1480 and #1484 with revalidation per Decision #21 (#1482 and #1483 merged).
- **Operator-held, before any upgrade of a large deployment:** the runbook's online preparation (Decision #9).
- Slices 3 to 7 consume this wish's interfaces (Decision #2's swap point, the stamp columns, the grants table, the
  flag function, `PAIRED_AGENT_SLICE_FILES` and `TWO_TENANT_PROOFS`).

## Success Criteria

Each criterion is owned by the group in brackets; the group's acceptance criteria name its test.

- [x] **C1 access** [G3]. An agent-owned consumer is reachable only by its agent's keys and admin or owner keys: another agent's key, a plain unrestricted key and an `unresolved` system agent key get 404 on inspect, pull, ack, stream and delete and do not see it in the list; an agent key's create without `agentId` is owned by its agent, with another agent's id is refused 403, and an `unresolved` system agent key's create is refused with the flag on (never written unowned); stored ownership is enforced with the flag on and off; legacy consumers behave as before. Tests: `packages/api/src/__tests__/paired-agent-consumers-postgres.test.ts`, `packages/api/src/services/__tests__/event-consumers-agent-owned.test.ts`.
- [x] **C2 end to end with a seeded grant** [G4]. With a grant row seeded by the test, a `connector.gitlab.*` row is delivered to the granted agent and refused to any other key, a row from an ungranted source is not delivered, and revoking the grant stops delivery. Test: `packages/api/src/__tests__/paired-agent-grants-postgres.test.ts`.
- [x] **Provenance stamp** [G2]. An emission by an agent's key stamps `omni_events.agent_id` with the key's agent and `producing_key_id` with the key, even when the body supplies a different `agentId`; a connector ingress row (legacy subscription and typed per-connector) and a webhook ingress row stamp their source reference. Test: `packages/api/src/__tests__/provenance-stamp-postgres.test.ts`.
- [x] **The grant filters on the stamp** [G4]. A row stamped with agent A is delivered on an `agent` grant for A and not on one for B. Test: `packages/api/src/__tests__/paired-agent-grants-postgres.test.ts`.
- [x] **Fixes active with multitenancy on** [G6]. Fix 1, fix 2, fix 3, follow-up A and follow-up B each have one case that runs with `OMNI_MULTITENANCY_ENABLED=true` and no paired-agent flag, and passes. Not checkable until follow-up B's proof lands (Decision #14). Tests: `packages/api/src/routes/v2/__tests__/event-consumers-scoped.test.ts`, `packages/api/src/__tests__/event-consumers-tenant-enforced-postgres.test.ts`, `packages/api/src/services/__tests__/agent-key-reconciliation-postgres.test.ts`, `packages/api/src/__tests__/agent-key-repair-startup.test.ts`, and follow-up B's route key test (recorded).
- [x] **Live role** [G6]. Every suite in `TWO_TENANT_PROOFS` imports `assertPgTestRole` and `pgRoleUrl` from `@omni/db/pg-migrated-template` and asserts the runtime role before its first query; the enforced C15 fixture also asserts the enforcement state and fails, inside the disposable gate, when its connection is a superuser. Tests: `packages/api/src/__tests__/paired-agents-live-role-inventory.test.ts`, `packages/api/src/__tests__/event-consumers-tenant-enforced-postgres.test.ts`.
- [x] **Flag refusal decision** [G1]. `pairedAgentFlagState('consumers')` is ON only for the exact string `'true'` with multitenancy off, and OFF with `multitenancy_enabled` when both are `'true'`. Test: `packages/api/src/tenancy/__tests__/feature-flag.test.ts`.
- [x] **Source-reference CHECK and large-journal preparation** [G1]. The CHECK refuses both half-populated forms and an unknown kind and accepts both NULL and every supported kind; the online phase builds and repairs the four journal indexes with the exact expected definitions; the estimate-based preflight blocks at the 1,000,000-row estimate boundary and not below it, with its stale-estimate limit pinned by a test; `--check` exits 3 when blocked; the message names the pending indexes and the runbook. Tests: `packages/db/src/paired-agent-schema-postgres.test.ts`, `packages/db/src/online-ddl.test.ts`; runbook `docs/deployment/paired-agent-journal-indexes.md`.
- [x] **`doctor` OFF line** [G5]. `doctor` reports paired agents OFF with the reason (`flag_unset` OK, `multitenancy_enabled` WARN), ON as OK, and a failed read as WARN. Test: `packages/cli/src/__tests__/doctor.test.ts`.
- [x] **Rollback by unsetting the flag** [G5]. With the flag unset after use: new rows carry no stamp, a create with `agentId` is refused naming the flag, an agent-owned consumer stays unreachable to other keys, granted instance-less rows stop being delivered, legacy consumers are unchanged; setting it again resumes delivery; flag and multitenancy both `'true'` behaves as unset. Test: `packages/api/src/__tests__/paired-agent-rollback-postgres.test.ts`.
- [x] **Architecture test** [G5]. Slice 2's files have no branch on a harness name, an agent client id, Brain, or an external provider member (`claude`, `agno`, `openai`, `gemini`, `custom`, `omni-internal`); a fixture branch on `paired` passes. Test: `packages/api/src/__tests__/paired-agents-architecture.test.ts`.
- [x] **Final aggregate gate** [G6]. The merged tree after the last group passes Decision #17's gate with the C0, C15 and C16 suites and every `TWO_TENANT_PROOFS` suite green and none skipped; the run is recorded in Review Results.

## Execution Strategy

### Wave 1 (now)

| Group | Agent | Complexity | Model | Description |
|-------|-------|------------|-------|-------------|
| 1 | engineer | Medium-high: shared `schema.ts`, journal, `tenancy-rls.ts` and online-DDL plan; a boot-time availability guard and its operator runbook; migration numbering race; ~15 files, ~1,250 insertions | codex dev; review Claude Opus | Flag decision, migration, Drizzle schema, online preparation, estimate-based preflight message, `--check` exit status, runbook, grants registration, fixture fallout |

### Wave 2 (after group 1)

| Group | Agent | Complexity | Model | Description |
|-------|-------|------------|-------|-------------|
| 2 | engineer | High: envelope contract in `@omni/core`, request ALS, every journal insert site, three ingress claims; ~17 files, ~1,500 insertions | codex dev; review Claude Opus | Provenance stamp: producer resolver, `resolveKeyAgent`, journal and claim stamps |

### Wave 3 (after group 2)

| Group | Agent | Complexity | Model | Description |
|-------|-------|------------|-------|-------------|
| 3 | engineer | High: access control on every consumer verb, three-way principal, fallout in three route harnesses; ~10 files, ~1,500 insertions | codex dev; review Claude Opus; break-it DeepSeek | C1: agent-owned consumers, admin tier truth table, unresolved refusal, interim fail-closed scan |

### Wave 4 (after group 3)

| Group | Agent | Complexity | Model | Description |
|-------|-------|------------|-------|-------------|
| 4 | engineer | High: the grant read clause and a new scan behind five call sites; cursor correctness; ~3 files, ~1,300 insertions | codex dev; review Claude Opus; break-it DeepSeek | C2: `scanAgentOwnedPage`, grant clauses, end-to-end grant tests incl. cross-kind and shared reclaim |

### Wave 5 (after group 4)

| Group | Agent | Complexity | Model | Description |
|-------|-------|------------|-------|-------------|
| 5 | engineer | Medium: one route, SDK regeneration, CLI check, rollback and architecture tests; ~9 files, ~900 insertions | codex dev; review Claude Opus | Flag status route, `doctor` OFF line, rollback proof, C12 architecture test |

### Wave 6 (after group 5; follow-up B external)

| Group | Agent | Complexity | Model | Description |
|-------|-------|------------|-------|-------------|
| 6 | engineer | Medium: enforced RLS fixture, four multitenancy-on cases, inventory test, aggregate gate; builds on #1483's merged reconciliation suite; ~5 files, ~800 insertions | codex dev; review Claude Opus | Multitenancy-on cases, enforced C15 matrix, follow-up B record, live-role inventory, final aggregate gate |

**Global constraints:**
- One worktree per task under `~/workspace/repos/omni.worktrees`, created from `origin/dev`; never `git stash`, `git checkout` or `git reset` in `~/workspace/repos/omni`.
- Bun only (Bun 1.4.4 is on dev); `make` targets first, except `make check`, `make test`, `make test-sweep` and any target that sources `.env`, which agents never run; the gate is Decision #17.
- No services, real or shared databases, or external messages; disposable Postgres only (autopg binaries, mktemp dir, Unix socket, never ports 5432/15432, stop and delete afterwards); test NATS only via `scripts/ensure-nats.sh`.
- Never `--no-verify`; conventional commits; PRs to `dev` on `automagik-dev/omni`; the owner merges.
- Migrations: hand-written, header comment first, additive and idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, guarded constraints), no `BEGIN`/`COMMIT`, no `CONCURRENTLY`, next free number on `dev`, journal `when` = previous `when` + 100000000, schema.ts and migration in the same PR, `make verify-migrations` green; a destructive statement needs a `-- destructive: <justification>` header line (none planned); never `drizzle-kit generate` or `push`.
- Shared files are merged, never overwritten: `schema.ts`, `tenancy-rls.ts`, `online-ddl.ts`, the journal and `types.generated.ts`. Open conflicts #1480 and #1484: revalidation per Decision #21.
- `OMNI_ALLOW_BLOCKING_INDEX_BUILD` is operator-only: no test, script, runbook default or CI step sets it outside a disposable database.
- Validate every external boundary with Zod; publish events for state changes; no `any`; no casts to evade a type contract.
- Existing behavioural assertions stay unchanged. Fixture setup may change where a new select column or caller field requires it: group 1 owns `agentId: null` in typed `DurableConsumer` select fixtures (`services/__tests__/event-consumers.test.ts` `consumerRow`, `:161-180`; the `OmniEvent` row fixtures at `effb53b09` are all cast and need nothing, re-audited by typecheck); group 3 owns the caller-shape expectations and key/database handles in all three existing route harnesses that mount `eventConsumersRoutes` (`event-consumers-scoped.test.ts`, `event-consumers-stream.test.ts`, and `event-consumers-postgres.test.ts` `:1126-1142`).
- Every new export has a non-test consumer in the same PR (`bunx knip` runs in `bun run check`); every new `(file, table)` access to an RLS tenant table is registered in `packages/db/src/tenancy-db-access-guard.ts` and its test allowlist.
- PostgreSQL suites end in `-postgres.test.ts` (that is what `make test-pg-gate` runs) and use the gate's injected URL; a skipped suite is not evidence. Two-tenant proofs follow Decision #15 in their own PR.
- Every slice-2 behaviour is gated by `pairedAgentFlagState('consumers')`; stored ownership is enforced whatever the flag says (Decision #4).
- Independent cross-provider review of every PR before it is reported ready (Decision #19).

## Execution Groups

### Group 1: Flag decision, expand schema and large-journal preparation

**Goal:** Land the flag decision and every column, table and index slice 2 needs, with an operator runbook and an estimate-based boot preflight for the journal indexes, no reader or writer yet, and nothing changed for existing rows.

**Deliverables:**
1. `packages/api/src/tenancy/feature-flag.ts`: a module-private `PAIRED_AGENT_FLAG_ENV = { consumers: 'OMNI_PAIRED_AGENT_CONSUMERS' } as const` and the exported `pairedAgentFlagState(slice, env = process.env)` per Decision #4; `packages/api/src/index.ts` logs one start-up `warn` (`api:startup` logger, `index.ts:63`) naming `state.flag` and `OMNI_MULTITENANCY_ENABLED` when the state is OFF with `multitenancy_enabled`. Only `pairedAgentFlagState` is exported in this group.
2. `packages/db/drizzle/NNNN_paired_agent_consumers.sql` (next free number on `dev`, expected 0094) with a header naming this wish, DESIGN row 5, R13-3, the 0043/0044/0052 precedent line, and the large-journal prerequisite (run the online preparation from the candidate checkout per `docs/deployment/paired-agent-journal-indexes.md` before upgrading a large journal; the estimate-based boot preflight backs it up):
   - `omni_events`: `ADD COLUMN IF NOT EXISTS "producing_key_id" uuid`, `"source_kind" varchar(32)`, `"source_id" uuid`; a guarded (`pg_constraint` lookup in a `DO` block) `omni_events_source_ref_ck CHECK ((source_kind IS NULL) = (source_id IS NULL) AND (source_kind IS NULL OR source_kind IN ('connector','connector_subscription','webhook_source'))) NOT VALID`.
   - `durable_consumers`: `ADD COLUMN IF NOT EXISTS "agent_id" uuid` (no FK, Decision #8).
   - `CREATE TABLE IF NOT EXISTS "agent_source_grants"` per Decision #7, with `agent_source_grants_kind_ck CHECK (source_kind IN ('connector','connector_subscription','webhook_source','agent'))`.
   - Indexes (all ordinary `CREATE INDEX IF NOT EXISTS`): the four journal indexes of Decision #9, `durable_consumers_agent_idx (agent_id) WHERE agent_id IS NOT NULL`, unique `agent_source_grants_active_uq (agent_id, source_kind, source_id) WHERE revoked_at IS NULL`.
3. `packages/db/drizzle/meta/_journal.json`: `{"idx": 94, "version": "7", "when": 1789200000000, "tag": "0094_paired_agent_consumers", "breakpoints": true}` (renumbered per Decision #16 if another migration lands first).
4. `packages/db/src/schema.ts`: Drizzle mirrors of every column, constraint (the CHECK expression through drizzle-orm's `check()`, as `connector_event_subscriptions`' ingress CHECK does at `schema.ts:3615`; `NOT VALID` lives in SQL only) and index above; `export type EventSourceKind = 'connector' | 'connector_subscription' | 'webhook_source'`; `export const agentGrantSourceKinds = ['connector', 'connector_subscription', 'webhook_source', 'agent'] as const`; `AgentGrantSourceKind`; `agentSourceGrants`, `AgentSourceGrant`, `NewAgentSourceGrant`.
5. `packages/db/src/paired-agent-online-ddl.ts` (new): the three nullable `omni_events` `ADD COLUMN IF NOT EXISTS` statements and the four journal index specs `{ name, table: 'omni_events', plain, concurrent, volume: 'high' }`, whose `plain` text is byte-identical to the migration's statements; `packages/db/src/online-ddl.ts` concatenates them into its column step, `onlineIndexStatements()` and `highVolumeIndexPlan()`, so `applyOnlineTenantDdl` adds the columns, drops invalid or not-ready residue (`findBrokenIndexes`), builds concurrently, and `checkOnlineDdlPreflight` blocks a journal whose estimate is at or above the threshold while any of the four is missing, invalid or not ready; its header documents slice 2 and the estimate-based semantics (Decision #9).
6. Operator-facing text and exit status:
   - `onlineDdlPreflightMessage` (`online-ddl.ts:287-296`) stops naming only "migration 0041": it says it refuses to run the pending migrations in-band, lists each blocked table with its estimated rows and every pending index by name (0041's and slice 2's), states that the row figure is a planner estimate, names the runbook path and the command to run from the candidate checkout's `packages/db`, and keeps the `OMNI_ALLOW_BLOCKING_INDEX_BUILD=on` sentence marked operator-only (accepts the downtime).
   - `packages/db/scripts/online-ddl.ts`: `--check` exits 3 when the preflight is blocked and 0 when clear (missing `--url` stays 2); the run path is unchanged; the header documents both and points to the runbook.
7. `docs/deployment/paired-agent-journal-indexes.md` (new runbook, the `agent-key-scope-upgrade.md` precedent):
   - Why: four journal indexes, one transaction and a 60 s boot budget; the guard ignores the paired-agent flag, so preparation is required even with the flag unset.
   - Prepare before replacing the serving binary: stage the exact candidate release's source checkout (same commit as the binary) and run `bun install`; from `<candidate-checkout>/packages/db`, with an explicitly chosen DDL-capable URL (never `DATABASE_URL`), run `bun run db:online-ddl --url <explicit-ddl-url> --check` (exit 3 means work is pending), `bun run db:online-ddl --url <explicit-ddl-url>`, then `--check` again (must exit 0); the old checkout cannot build slice 2's indexes.
   - Verify definitions, not names: a `pg_indexes` query listing the four index names with their `indexdef`, compared against the expected definitions printed in the runbook.
   - Recovery when the new binary already refused to start: keep the previous binary available and stop the restart loop; run the staged candidate runner without the API (`--check`, run, `--check`); verify; then start the new binary again; if preparation cannot finish, return to the previous binary (the additive columns are harmless to it).
   - Limits: the guard reads `pg_class.reltuples`, so a stale low estimate lets a large journal through to an in-band build (run `ANALYZE omni_events` before `--check`); `OMNI_ALLOW_BLOCKING_INDEX_BUILD=on` skips the guard and accepts the downtime; both are operator decisions.
8. `packages/db/src/tenancy-rls.ts`: an `APPLICATION_SCOPED_TENANT_TABLES` entry for `agent_source_grants` with a justification over 60 characters; `packages/db/src/tenancy-rls.test.ts:107` expects `['durable_consumers', 'agent_source_grants']`.
9. Fixture fallout: `agentId: null` in `consumerRow` (`packages/api/src/services/__tests__/event-consumers.test.ts:161-180`); any further typed select fixture typecheck reports.
10. Tests: `packages/api/src/tenancy/__tests__/feature-flag.test.ts` (new cases); `packages/db/src/paired-agent-schema-postgres.test.ts` (new); `packages/db/src/online-ddl.test.ts` (new and updated cases).

**Interfaces:**
- Consumes: `isMultitenancyEnabled(env)` (`feature-flag.ts:15`); the online-DDL phase and preflight (`online-ddl.ts`, `migrate.ts:44-54`).
- Produces: `pairedAgentFlagState(slice: 'consumers', env?: NodeJS.ProcessEnv): { slice: 'consumers'; flag: 'OMNI_PAIRED_AGENT_CONSUMERS'; enabled: true; reason: null } | { slice: 'consumers'; flag: 'OMNI_PAIRED_AGENT_CONSUMERS'; enabled: false; reason: 'flag_unset' | 'multitenancy_enabled' }`; Drizzle `omniEvents.producingKeyId: string | null`, `omniEvents.sourceKind: EventSourceKind | null`, `omniEvents.sourceId: string | null`; `durableConsumers.agentId: string | null` (required on selected rows); `agentSourceGrants` with `id`, `agentId`, `sourceKind: AgentGrantSourceKind`, `sourceId`, `approvedByKeyId`, `approvedAt: Date`, `revokedAt: Date | null`, `tenantId: string | null`, `createdAt: Date`; the four journal indexes in the online plan.

**Acceptance Criteria:**
- [ ] `make verify-migrations` green; the header carries the precedent line and the large-journal prerequisite; re-running the migration SQL on a migrated database is a no-op; the migration contains no `CONCURRENTLY`.
- [ ] The runbook exists with every step of deliverable 7, its expected index definitions match the migration's, and its commands match the runner's flags and exit codes.
- [ ] `paired-agent-schema-postgres.test.ts`: `omni_events_source_ref_ck` refuses `(source_kind set, source_id NULL)`, `(source_kind NULL, source_id set)` and an unknown kind, and accepts both NULL and each of `connector`, `connector_subscription`, `webhook_source`; `agent_source_grants_kind_ck` refuses an unknown kind; a second active grant for the same agent, kind and id is refused while a revoked one plus a new active one is accepted; existing `omni_events` rows read NULL in the three new columns.
- [ ] Same suite: with one slice-2 journal index dropped and another marked invalid (`pg_index.indisvalid = false`, superuser, disposable only), `checkOnlineDdlPreflight(db, 0)` reports `omni_events` blocked; `applyOnlineTenantDdl` repairs and rebuilds both valid and ready; the preflight then reports not blocked.
- [ ] Same suite, definitions: after the migration path and again after the online path, `pg_get_indexdef` for each of the four journal indexes equals the expected definition (table, column order, partial predicate), not merely the name.
- [ ] Same suite, estimate boundary and staleness, with the fixture establishing its own statistics (seed rows, `ANALYZE omni_events`, then set `pg_class.reltuples` as the disposable superuser) and one slice-2 index missing: an estimate of 999,999 is not blocked; 1,000,000 is blocked; a stale low estimate (`reltuples = 10` over more seeded rows) is not blocked, pinning the disclosed limit; `reltuples = -1` takes the bounded probe. No exact-count probe is added.
- [ ] Same suite, runner: spawned as a child process against the disposable database from `packages/db`, `bun run scripts/online-ddl.ts --url <disposable-url> --check` exits 3 and prints the blocked table and pending index names while blocked (threshold reached via the statistics fixture), then exits 0 after the run path.
- [ ] `online-ddl.test.ts`: `onlineDdlPreflightMessage` names the pending indexes, says the row figure is an estimate, names `docs/deployment/paired-agent-journal-indexes.md`, and no longer says only "migration 0041"; the plan lists the four journal indexes as high volume with `CONCURRENTLY IF NOT EXISTS` forms; each `plain` statement appears verbatim in the migration file found by its tag suffix (`packages/db/drizzle/*_paired_agent_consumers.sql`, so a renumber per Decision #16 does not break it); existing cases updated only for the larger plan.
- [ ] `feature-flag.test.ts`: ON only for exactly `'true'` with multitenancy off; `'1'`, `'TRUE'`, empty and unset are `flag_unset`; both `'true'` is `multitenancy_enabled`.
- [ ] `tenancy-rls.test.ts` green with the new application-scoped entry; no existing assertion changed except the expected list.

**Validation:**
```bash
test -z "$(find . -name node_modules -prune -o -name '.env*' ! -name '*.example' -print)" && "$HOST_GATE_SH" env -i HOME="$HOME" USER="$USER" PATH="$HOME/.autopg/bin/darwin-arm64/bin:/opt/homebrew/opt/libpq/bin:$PATH" TERM="${TERM:-xterm}" LANG="${LANG:-en_US.UTF-8}" bash -c 'bun run check && make marketplace-check && make test-pg-gate'
```

**depends-on:** none

---

### Group 2: Provenance stamp at journal time

**Goal:** Record, behind the flag, which key and which agent produced each journal row, and which connector or webhook source an ingress row came from, from trusted state only.

**Deliverables:**
1. `packages/core/src/events/types.ts`: `EventMetadata.producingKeyId?: string`, documented as set only by the factory from the ambient producer resolver.
2. `packages/core/src/events/envelope.ts`: `setEnvelopeProducerResolver(resolver: (() => string | null | undefined) | null): void` and `resolveAmbientProducingKeyId(): string | null` (UUID-validated, a throwing resolver yields null), mirroring `setEnvelopeTenantResolver`; exported through the core barrel if not already re-exported.
3. `packages/core/src/events/factory.ts` (`createOmniEvent`, `:32-75`): `...(producingKeyId ? { producingKeyId } : {})` from `resolveAmbientProducingKeyId()`; a caller's `metadata.producingKeyId` is dropped; `metadata.agentId` stays dropped.
4. `packages/api/src/lib/producer-scope.ts` (new): `runWithProducingKey<T>(keyId: string, fn: () => Promise<T>): Promise<T>` and `currentProducingKeyId(): string | null` over one `AsyncLocalStorage`; `packages/api/src/middleware/auth.ts:128` becomes `await runWithProducingKey(keyData.id, () => next())`; `packages/api/src/index.ts` registers `setEnvelopeProducerResolver(() => (pairedAgentFlagState('consumers').enabled ? currentProducingKeyId() : null))` beside `:172`.
5. `packages/api/src/lib/key-agent.ts` (new): `resolveKeyAgent` per Decision #2: one primary-key read of `api_keys` (`name`, `instanceIds`, `createdBy`, `status`); `none` returns with no further query; system agent keys then read their instances and the agent through `scopedHandle`.
6. `packages/api/src/plugins/event-persistence.ts`: each insert site (`:276`, `:352`, `:414`, `:468`, `:554`, the reaction insert near `:598-627`, `journalInternalEvent` `:707-760`) writes `producingKeyId` and `agentId` per Decision #20 through one helper in that file, `journalProducerColumns(db: Database, metadata: EventMetadata): Promise<{ producingKeyId: string | null; agentId: string | null }>`.
7. Claim sites stamp directly when the flag is on: the legacy claim in `ConnectorService.deliver` (`connectors.ts:1316-1328`; `connector_subscription`, subscription id); the typed claim in `deliverForConnector` (`connectors.ts:1062-1074`; `connector`, connector id); `webhooks.ts:457-467` (`webhook_source`, `source.id`); `WebhookService.triggerClaimed` (`webhooks.ts:759`) writes `producingKeyId` and `agentId` from `currentProducingKeyId()` and `resolveKeyAgent`.
8. `packages/db/src/tenancy-db-access-guard.ts` and its test allowlist: `packages/api/src/lib/key-agent.ts` × `instances` and × `agents`, class `tenant-boundary` (callers carry a scope: the request, or `runConsumerInTenantContext` in persistence).
9. Tests: `packages/core/src/events/__tests__/producer-stamping.test.ts` (new); `packages/api/src/lib/__tests__/key-agent.test.ts` (new); `packages/api/src/__tests__/provenance-stamp-postgres.test.ts` (new); stamp cases added to `packages/api/src/__tests__/event-persistence.test.ts`.

**Interfaces:**
- Consumes: group 1's columns and `pairedAgentFlagState`; `agentKeyNameCandidates(agentName: string, tenantId: string | null | undefined): string[]`; `agentKeyBelongsToBinding(key, binding, owners): boolean`.
- Produces: `EventMetadata.producingKeyId?: string`; `setEnvelopeProducerResolver`, `resolveAmbientProducingKeyId` (`@omni/core`); `runWithProducingKey`, `currentProducingKeyId` (`packages/api/src/lib/producer-scope.ts`); `type KeyAgentResolution = { kind: 'none' } | { kind: 'agent'; agentId: string } | { kind: 'unresolved'; reason: 'revoked' | 'widened' | 'no_binding' | 'mixed_binding' | 'inactive_agent' | 'name_mismatch' }` and `resolveKeyAgent(db: Database, keyId: string | null): Promise<KeyAgentResolution>` (`packages/api/src/lib/key-agent.ts`, the slice 3 swap point); journal rows stamped per Decision #20.

**Acceptance Criteria:**
- [ ] `provenance-stamp-postgres.test.ts` (flag on): agent A's system key calls `POST /events/trigger` with `payload.agentId` and a top-level `agentId` naming agent B, on the unkeyed and the keyed (`idempotencyKey`) path; both rows have `agent_id = A` and `producing_key_id` = that key. A plain key's trigger, and an `unresolved` system key's (inactive agent, non-empty instance list), stamp the key and a NULL agent.
- [ ] Same suite: a legacy subscription delivery stamps `connector_subscription` and the subscription id; a typed per-connector delivery stamps `connector` and the connector id; a webhook delivery stamps `webhook_source` and the source's `id`; a channel `message.received` row has a NULL producing key.
- [ ] Same suite (flag unset, and flag plus multitenancy both `'true'`): every new column is NULL and the published envelope has no `producingKeyId`.
- [ ] `key-agent.test.ts`: `none` for a non-`agent:` key and a hand-made `agent:` key, after exactly one key read; `unresolved` with its reason for a revoked key, a `null` or `[]` instance list (`widened`), no bound instance, instances bound to two agents, an inactive agent, a tenant-mismatched bare name; `agent` for a narrow system key under both name shapes.
- [ ] `producer-stamping.test.ts`: a caller-supplied `producingKeyId` or `agentId` never reaches the envelope; with no resolver the envelope is byte-identical to today's.
- [ ] Guard test green with the two new registrations; existing persistence and ingress assertions unchanged.

**Validation:**
```bash
test -z "$(find . -name node_modules -prune -o -name '.env*' ! -name '*.example' -print)" && "$HOST_GATE_SH" env -i HOME="$HOME" USER="$USER" PATH="$HOME/.autopg/bin/darwin-arm64/bin:/opt/homebrew/opt/libpq/bin:$PATH" TERM="${TERM:-xterm}" LANG="${LANG:-en_US.UTF-8}" bash -c 'bun run check && make marketplace-check && make test-pg-gate'
```

**depends-on:** Group 1

---

### Group 3: Agent-owned consumer access (C1)

**Goal:** Let a durable consumer be owned by an agent and reachable only by that agent's proven keys and admin/owner-tier keys, refuse unresolved system agent keys before they can create an unowned consumer, and leave every legacy consumer unchanged.

**Deliverables:**
1. `packages/api/src/lib/key-agent.ts`: `isAdminTierKey(key: Pick<ApiKeyData, 'scopes' | 'instanceIds'>): boolean` (Decision #3, owner ruling).
2. `packages/api/src/services/event-consumers.ts`: `ConsumerCaller` (`:108-115`) gains optional `principal?: KeyAgentResolution` and `admin?: boolean`; `CreateConsumerInput` gains `agentId?: string`.
   - `create` (`:584-631`), flag on: a caller whose principal is `unresolved` is refused 403 (`code: FORBIDDEN`, message naming the reason and "an unresolved agent key cannot create consumers"), before any write and whatever the body; an explicit `agentId` needs `caller.admin` or principal `agent` with that id (else 403) and an existing agent, checked in the route through `services.agents.getById` (`services/agents.ts:105`, already guard-registered; missing is 400), so `event-consumers.ts` gains no `agents` read; without one, an `agent` principal's consumer is owned by its agent; `resolveConsumerScope` is unchanged. Flag off: an explicit `agentId` is a 400 `ValidationError` naming `OMNI_PAIRED_AGENT_CONSUMERS` and, when refused, `OMNI_MULTITENANCY_ENABLED`; other creates behave as today. `system.consumer.created` carries `agentId` when set.
   - `canAccessConsumer` (`:364-371`) and `consumerAccessClause` (`:374-382`) per Decision #11, whatever the flag: tenant check first; an agent-owned consumer needs no caller, `admin` with a principal other than `unresolved`, or principal `agent` with the consumer's id; for a non-admin caller the SQL clause is `(agent_id IS NULL AND <today's clause>) OR (agent_id = :principalAgentId AND <tenant clause>)`, the second branch absent unless the principal is `agent`.
   - Interim fail-closed scan: `scanPage` adds `instance_id IS NOT NULL` for an agent-owned consumer (group 4 replaces it).
3. `packages/api/src/routes/v2/event-consumers.ts` (`consumerCaller`, `:55-62`): becomes async and sets `principal: await resolveKeyAgent(services.db, apiKey.id)` and `admin: principal.kind !== 'unresolved' && isAdminTierKey(apiKey)` when a key is present; every handler awaits it.
4. `packages/api/src/schemas/openapi/event-consumers.ts`: `agentId` (uuid, optional) on `CreateConsumerSchema` and nullable on `DurableConsumerSchema`, described; `packages/sdk/src/types.generated.ts` regenerated with `make sdk-generate` on #1482's merged SDK state (Decision #21).
5. Existing route harnesses that mount `eventConsumersRoutes`, all three (behavioural assertions kept): `packages/api/src/routes/v2/__tests__/event-consumers-scoped.test.ts` (`:48-54` harness gains a `db` stub returning each key's row; the exact caller objects at `:89-111` gain `principal` and `admin`); `packages/api/src/routes/v2/__tests__/event-consumers-stream.test.ts` (`:76-82` partial keys gain `name`, `scopes` and a `db` stub); `packages/api/src/__tests__/event-consumers-postgres.test.ts` (`appFor`, `:1126-1142`: `services` gains `db` — the suite's real handle — and the synthetic key at `:1136` gets a seeded ordinary `api_keys` row (not `system:auto-provision`, so its principal is `none`), keeping every tenant-isolation assertion).
6. Tests: `packages/api/src/services/__tests__/event-consumers-agent-owned.test.ts` (new); `packages/api/src/__tests__/paired-agent-consumers-postgres.test.ts` (new).

**Owner-tier truth table (tenant check first; owner ruling, Decision #3).** For an agent-owned consumer of agent A in tenant scope T:

| Key | Scopes | Instance list | Principal | Result |
|-----|--------|---------------|-----------|--------|
| `__primary__` / `admin` profile | `*` | null | none | allowed (admin) |
| ordinary device key | `DEFAULT_DEVICE_KEY_SCOPES` | null | none | 404 |
| wildcard key with instances | `*` | `[I]` | none | 404 |
| plain unrestricted key | `events:*` | null | none | 404 |
| A's proven system key | agent scopes | `[IA]` | agent A | allowed |
| B's proven system key | agent scopes | `[IB]` | agent B | 404 |
| unresolved system key of A | agent scopes (even `*`) | non-empty | unresolved | 404, never admin; create refused 403 (flag on) |
| widened system key | agent scopes | `null` / `[]` | n/a | 401 at authentication (#1483); service-level create 403 |
| any key of another tenant | any | any | any | 404 (tenant check) |

**Interfaces:**
- Consumes: `resolveKeyAgent`, `KeyAgentResolution` (group 2); `durableConsumers.agentId` and `pairedAgentFlagState` (group 1).
- Produces: `isAdminTierKey`; `ConsumerCaller.principal?: KeyAgentResolution`, `ConsumerCaller.admin?: boolean`; `CreateConsumerInput.agentId?: string`; `POST /api/v2/events/consumers` accepts `agentId?: string` (uuid); every consumer view carries `agentId: string | null`.

**Acceptance Criteria:**
- [ ] `paired-agent-consumers-postgres.test.ts` (flag on, legacy credentials, real HTTP routes): every row of the truth table, each verb (inspect, pull, ack, stream, delete) and the list; agent A's key creates without `agentId` and the consumer is owned by A; with B's id it is refused 403; a restricted agent key still cannot pull an unscoped agent-owned consumer (fix 1's 403).
- [ ] Same suite, route-level unresolved cases with non-empty instance lists: a system key of an inactive agent, one whose listed instances bind no agent, and one whose instances bind two agents each get 403 on create with the flag on and write no row; over real HTTP a widened (`null` or `[]` instance list) system key gets 401 at authentication (#1483) and writes no row; a hand-made `agent:` key creates an unowned consumer as an ordinary key.
- [ ] Same suite, stored ownership: with the flag on and again with it unset, B's key, a plain key and an unresolved key get 404 on every verb of A's consumer and an admin key drains it; after agent A is deleted its consumer stays owned and admin-only.
- [ ] Same suite: no instance-less row reaches an agent-owned consumer, for any key; a legacy consumer's create, list, pull, ack, stream and delete behave as before for the same keys; with the flag unset a create with `agentId` is refused 400 naming the flag.
- [ ] `event-consumers-agent-owned.test.ts`: `canAccessConsumer`, the SQL clause and `create` over every truth-table row and an internal caller with no caller object; a service-level create by an `unresolved` principal with reason `widened` is refused 403 before any write; an `unresolved` principal is never admin in `canAccessConsumer` nor in the rendered SQL clause, even with `*` scope and no instance list (asserted independently of the owner-tier ruling).
- [ ] All three route harnesses (`event-consumers-scoped.test.ts`, `event-consumers-stream.test.ts`, `event-consumers-postgres.test.ts`) and `event-consumers.test.ts` keep every behavioural assertion and pass in this group's own gate.
- [x] The owner-tier disposition is recorded in Review Results (owner ruling 2026-11-01).

**Validation:**
```bash
test -z "$(find . -name node_modules -prune -o -name '.env*' ! -name '*.example' -print)" && "$HOST_GATE_SH" env -i HOME="$HOME" USER="$USER" PATH="$HOME/.autopg/bin/darwin-arm64/bin:/opt/homebrew/opt/libpq/bin:$PATH" TERM="${TERM:-xterm}" LANG="${LANG:-en_US.UTF-8}" bash -c 'bun run check && make marketplace-check && make test-pg-gate'
```

**depends-on:** Group 2

---

### Group 4: Grant read clause and agent-owned scan (C2)

**Goal:** Deliver an instance-less row to an agent-owned consumer only through an active grant of its agent matching the row's stamp, with a scan that reads matched rows in `journal_seq` order.

**Deliverables:**
1. `packages/api/src/services/event-consumers.ts`:
   - `activeGrantSourceClause(agentId: string): SQL` (an `EXISTS` over `agent_source_grants` with `agent_id = :agentId`, `revoked_at IS NULL`, `source_kind = omni_events.source_kind`, `source_id = omni_events.source_id`) and `activeGrantAgentClause(agentId: string): SQL` (`source_kind = 'agent'`, `source_id = omni_events.agent_id`).
   - `private scanAgentOwnedPage(consumer: DurableConsumer, limit: number, after = consumer.cursor, through?: number, extra?: SQL): Promise<OmniEvent[]>`, the exact `scanPage` signature, implementing Decision #10's branches I, S and A, merge and deduplication; `extra` and `instanceScopeClause` apply to branch I only; S and A run only when the flag is on.
   - `private scan(...)` with the same signature dispatches on `consumer.agentId`; the five call sites (`:554`, `:672`, `:799`, `:860`, `:943`) call it; group 3's interim clause is removed.
2. Tests: `packages/api/src/__tests__/paired-agent-grants-postgres.test.ts` (new); `packages/api/src/services/__tests__/event-consumers-agent-scan.test.ts` (new: merge order, deduplication, cursor never past an unread match, `through` on reclaim, `extra` never on S/A).

**Interfaces:**
- Consumes: group 1's `agentSourceGrants` and indexes; group 2's stamp columns and `resolveKeyAgent`; group 3's agent-owned consumers and `ConsumerCaller`.
- Produces: `activeGrantSourceClause`, `activeGrantAgentClause` (module-private); the agent-owned delivery contract slices 4 to 7 build on.

**Acceptance Criteria:**
- [ ] `paired-agent-grants-postgres.test.ts` (flag on): a typed `connector.gitlab.merge_request.merged` row journaled by the real claim path (`receiveForConnector`, with a test connector definition whose provider is `gitlab`; the dev records the fixture seam used) is delivered to agent A's consumer (`eventType` `connector.gitlab.*`) after the test seeds a grant (A, `connector`, C), drained by A's real restricted system agent key (`agent:` name, `system:auto-provision`, instance list `[IA]`); agent B's key and a plain key get 404 on that consumer; a row from an ungranted connector and from an ungranted webhook source is not delivered; after the test sets `revoked_at` a new row from C is not delivered.
- [ ] Same suite, cross-kind and positive kinds: a legacy subscription row is delivered on a (A, `connector_subscription`, S) grant and a webhook row on a (A, `webhook_source`, W) grant; a typed row of C is not delivered on a `connector_subscription` grant naming C or one of its subscriptions, a legacy row of S is not delivered on a `connector` grant naming its connector, and a grant whose `source_id` matches but whose kind differs delivers nothing.
- [ ] Same suite: a row stamped with agent A (A's key on `/events/trigger`) is delivered on an `agent` grant for A and not on one for B.
- [ ] Same suite: pull, shared pull (lease and ack) and `scanForStream` deliver the same granted rows; after a grant is revoked while a shared lease over a granted row is outstanding, the expired lease's reclaim does not redeliver that row; instance rows still respect the consumer's and the caller's instance predicates; a legacy consumer's delivery is unchanged.
- [ ] Same suite: one case opens the runtime role with `pgRoleUrl` and `assertPgTestRole` and drains the granted row, proving the runtime role reads `agent_source_grants`.
- [ ] `event-consumers-agent-scan.test.ts` green; with the flag unset only instance rows are delivered.

**Validation:**
```bash
test -z "$(find . -name node_modules -prune -o -name '.env*' ! -name '*.example' -print)" && "$HOST_GATE_SH" env -i HOME="$HOME" USER="$USER" PATH="$HOME/.autopg/bin/darwin-arm64/bin:/opt/homebrew/opt/libpq/bin:$PATH" TERM="${TERM:-xterm}" LANG="${LANG:-en_US.UTF-8}" bash -c 'bun run check && make marketplace-check && make test-pg-gate'
```

**depends-on:** Group 3

---

### Group 5: Flag status read, `doctor` OFF line, rollback proof and architecture test

**Goal:** Make the flag's state visible to operators, prove that unsetting it rolls slice 2 back without widening anything, and land the C12 architecture test over slice 2's files.

**Deliverables:**
1. `packages/api/src/routes/v2/system.ts`: `systemRoutes.get('/paired-agents', …)` (public `GET /api/v2/system/paired-agents`) returning `{ data: { consumers: { flag: 'OMNI_PAIRED_AGENT_CONSUMERS', enabled: boolean, reason: 'flag_unset' | 'multitenancy_enabled' | null } } }` from `pairedAgentFlagState('consumers')`; `packages/api/src/constants/scopes.ts`: `'GET /system/paired-agents': 'system:read'`; `packages/api/src/schemas/openapi/system.ts`: `PairedAgentsStatusSchema` registered at OpenAPI path `/system/paired-agents` beside `/system/update`; `packages/sdk/src/types.generated.ts` regenerated on #1482's merged SDK state.
2. `packages/cli/src/commands/doctor.ts` (on #1482's merged doctor): `DoctorDeps.fetchPairedAgentsStatus: (apiPort: number) => Promise<{ enabled: boolean; reason: 'flag_unset' | 'multitenancy_enabled' | null } | { error: string }>` (production calls the route with the stored CLI key); `checkPairedAgents` with id `paired-agents` added to `CheckId` and to `runAllChecks`; levels per Decision #12; header list updated.
3. `packages/api/src/__tests__/paired-agents-architecture.test.ts` (new): `PAIRED_AGENT_SLICE_FILES` lists every non-test source file this wish adds or changes; for each, the source has no comparison or `case` against a provider field with an external member (`claude`, `agno`, `openai`, `gemini`, `custom`, `omni-internal`), no comparison or `case` against a `DEVICE_CLIENTS` key (`login/config.ts:72-77`, imported), and none against a harness name in `HARNESS_NAMES = ['claude-code', 'codex', 'opencode', 'openclaw', 'hermes', 'herdr', 'brain']`. Fixture strings prove `agent.provider === 'claude'`, `provider !== "openai"`, `case 'agno':` under `switch (agent.provider)`, `clientId === 'omni-dsh'` and `harness === 'codex'` fail, and `agent.provider === 'paired'`, `AgentSystemSchema.options.includes(p)` and a `'custom.agent.reply'` literal pass.
4. Tests: `packages/api/src/routes/v2/__tests__/system-paired-agents.test.ts` (new: route, scope, three states); `packages/cli/src/__tests__/doctor.test.ts` (stubbed-deps cases); `packages/api/src/__tests__/paired-agent-rollback-postgres.test.ts` (new).
- Carried from the group 4 review: the rollback runbook and doctor wording state that grants are FORWARD-ONLY. Rows claimed while the flag is unset carry no source stamp and are never delivered through a grant; there is no backfill. A rollback-then-re-enable leaves a gap for the off period.

**Interfaces:**
- Consumes: `pairedAgentFlagState` (group 1); stamp (group 2); agent-owned access (group 3); agent-owned scan (group 4).
- Produces: `GET /api/v2/system/paired-agents` (scope `system:read`) with the shape above; `doctor` check id `paired-agents`; `PAIRED_AGENT_SLICE_FILES` and `HARNESS_NAMES`, which slices 3 to 7 extend.

**Acceptance Criteria:**
- [ ] `system-paired-agents.test.ts`: ON, `flag_unset` and `multitenancy_enabled` states; a key without `system:read` is refused.
- [ ] `doctor.test.ts`: ON is OK; `flag_unset` is OK with "paired agents OFF" and the variable; `multitenancy_enabled` is WARN naming `OMNI_MULTITENANCY_ENABLED`; a failed read is WARN with its reason; no state is FAIL and the exit code is unchanged; #1482's doctor cases still pass.
- [ ] `paired-agent-rollback-postgres.test.ts`: with an agent-owned consumer, a seeded grant and stamped rows made while the flag was on, unsetting it leaves new rows unstamped, refuses a create with `agentId`, keeps the consumer at 404 for agent B's key and a plain key, stops granted instance-less delivery, and leaves legacy consumers unchanged; setting it again resumes delivery; flag and multitenancy both `'true'` behaves as unset.
- [ ] `paired-agents-architecture.test.ts` green on slice 2's files with every fixture case. Pre-flight at `9ea2fa8dc`: the denylist patterns matched nothing in the shared files this wish touches, so whole-file scanning needs no allowlist; a hit introduced later fails the test rather than being allowlisted.

**Validation:**
```bash
test -z "$(find . -name node_modules -prune -o -name '.env*' ! -name '*.example' -print)" && "$HOST_GATE_SH" env -i HOME="$HOME" USER="$USER" PATH="$HOME/.autopg/bin/darwin-arm64/bin:/opt/homebrew/opt/libpq/bin:$PATH" TERM="${TERM:-xterm}" LANG="${LANG:-en_US.UTF-8}" bash -c 'bun run check && make marketplace-check && make test-pg-gate'
```

**depends-on:** Group 4

---

### Group 6: Multitenancy-on cases, enforced C15 matrix, live-role inventory and final aggregate gate

**Goal:** Prove that fixes 1 to 3 and follow-ups A and B stay active with multitenancy on and no paired-agent flag, prove C15 under FORCE RLS on an asserted runtime role, and close the wish with a maintained live-role inventory and one aggregate gate on the final tree.

**Deliverables:**
1. Multitenancy-on cases, each setting `process.env.OMNI_MULTITENANCY_ENABLED = 'true'`, deleting `OMNI_PAIRED_AGENT_CONSUMERS`, and restoring both in `afterEach`:
   - Fix 1 (C0), `packages/api/src/routes/v2/__tests__/event-consumers-scoped.test.ts`: an instance-restricted key cannot pull, lease, ack or delete an unscoped consumer, and its unscoped stream is refused.
   - Fix 2 (C15), `packages/api/src/__tests__/event-consumers-tenant-enforced-postgres.test.ts` (new), the enforced fixture: seed two tenants, an instance and a consumer each (superuser seeding only); `applyTenantRlsEnforcement(provisioner)` and `applyTenancyRoles(provisioner, passwords, DEFAULT_ROLE_NAMES, dbName)`; open the runtime connection with `pgRoleUrl` and call `assertPgTestRole` (asserting `current_user`, `rolsuper = false`, `rolbypassrls = false`) before the first runtime query; assert `relforcerowsecurity` true on `omni_events` and `instances` and false on `durable_consumers` and `agent_source_grants`; then, inside each tenant's worker scope, tenant A's key cannot list, inspect, pull, ack, stream or delete tenant B's consumer, and A's own six verbs succeed. A negative control in the same suite opens the superuser connection and expects `assertPgTestRole` to throw.
   - Fix 3, `packages/api/src/services/__tests__/agent-key-reconciliation-postgres.test.ts` (its enforced start-up block, which already applies enforcement and asserts the role): with multitenancy on, tenant A's widened system key is revoked once, A's bound instance gets a narrow key, and tenant B's keys are unchanged. Built on #1483's merged version of the suite.
   - Follow-up A, `packages/api/src/__tests__/agent-key-repair-startup.test.ts`: a throwing repair is logged, start-up continues and `/health` reports `degraded` with the reason.
2. Follow-up B (external prerequisite, Decision #14): if B has merged, add its multitenancy-on case in B's route key test; otherwise record in Review Results that the criterion stays open, and record B's proof (PR, test name, gate run) when it lands.
3. `packages/api/src/__tests__/paired-agents-live-role-inventory.test.ts` (new): `TWO_TENANT_PROOFS = ['packages/api/src/__tests__/event-consumers-postgres.test.ts', 'packages/api/src/services/__tests__/agent-key-reconciliation-postgres.test.ts', 'packages/api/src/__tests__/event-consumers-tenant-enforced-postgres.test.ts', 'packages/api/src/__tests__/paired-agent-grants-postgres.test.ts']` (the last for its runtime-role case); for each file, the source imports `assertPgTestRole` and `pgRoleUrl` from `@omni/db/pg-migrated-template` and calls `assertPgTestRole(`; no `*-postgres.test.ts` under `packages/` defines a local `function urlFor(`. Slices 3 to 7 append their two-tenant proofs.
4. Final aggregate gate: after this group merges as the last group, the orchestrator runs Decision #17's gate on `origin/dev` and records the run (suite count, skips = 0, `TWO_TENANT_PROOFS` suites listed) in Review Results.

- Carried from the group 2 review (open LOW): wrap `whatsapp-business.ts` `plugin.connect` (about line 255) in the producer-scope exit, like the other channel connects, with a test that its post-request work stamps NULL.
- Carried from the group 4 review, brought into group 6 by the orchestrator (t201, 2026-11-02) instead of slice 6:
  - **(F2) Reclaim cap.** When a reclaim scan of `(from, to]` returns a full `PULL_MAX_LIMIT` (500) page, the redelivered lease's `to` is capped at the last scanned `journal_seq`. Rows past the 500th match are never released by the ack undelivered. Test it with more than 500 grant-matched rows in one expired lease: each reclaim delivers the next rows, and none are skipped.
  - **(N1) Grant tenant enforcement.** Branch S's grant clause also requires `g.tenant_id IS NOT DISTINCT FROM omni_events.tenant_id`.
    - With the flag on, multitenancy is off; NULL-tenant consumers with NULL-tenant grants and rows must keep delivering.
    - Branch A gets the same requirement.
    - Test a grant whose tenant differs from the row's: it never delivers.
    - If the clause would refuse a NULL-tenant case the earlier groups' suites rely on, stop and report; do not weaken those suites.
  - **(F3, LOW) Positive control.** In `paired-agent-grants-postgres.test.ts`, the revoked-reclaim case gets a positive control: an expired lease under a still-active grant redelivers the same rows.
- Carried from the group 3 review (open LOWs, non-blocking): (a) a flag-on pass over the list and five verbs with a NULL-tenant (non-tenant-projected) harness; (b) replace the self-fulfilling unit create assertion in `event-consumers-agent-owned.test.ts` with one that observes the stored row; (c) defense in depth: the SQL admin branch also requires `instanceIds IS NULL`, mirroring `isAdminTierKey`.

**Interfaces:**
- Consumes: the merged fixes' suites and fixtures; `pgRoleUrl`, `assertPgTestRole` (`@omni/db/pg-migrated-template`); `DEFAULT_ROLE_NAMES`, `applyTenancyRoles`, `applyTenantRlsEnforcement` (`@omni/db`); groups 1 to 5 on `dev`.
- Produces: `TWO_TENANT_PROOFS`, which slices 3 to 7 extend.

**Acceptance Criteria:**
- [ ] The four multitenancy-on cases pass inside `make test-pg-gate` or the turbo tests, with no skip; existing assertions unchanged. Where a route refuses legacy credentials under multitenancy, the case uses the suite's tenant-credential fixture and asserts the fix's refusal or repair, never a 401.
- [ ] `event-consumers-tenant-enforced-postgres.test.ts` passes the six-verb matrix under FORCE RLS on the asserted runtime role, asserts the enforcement state, and its superuser negative control passes inside the disposable gate.
- [ ] `paired-agents-live-role-inventory.test.ts` passes for every listed suite.
- [ ] Follow-up B's case is added or its open status is recorded; the "fixes active with multitenancy on" criterion is checked only when B's proof is recorded.
- [ ] The final aggregate gate is green on `origin/dev` after this group and recorded.

**Validation:**
```bash
test -z "$(find . -name node_modules -prune -o -name '.env*' ! -name '*.example' -print)" && "$HOST_GATE_SH" env -i HOME="$HOME" USER="$USER" PATH="$HOME/.autopg/bin/darwin-arm64/bin:/opt/homebrew/opt/libpq/bin:$PATH" TERM="${TERM:-xterm}" LANG="${LANG:-en_US.UTF-8}" bash -c 'bun run check && make marketplace-check && make test-pg-gate'
```

**depends-on:** Group 5

---

## QA Criteria

_What must be verified on dev after merge. The QA agent tests each criterion._

- [ ] On a disposable stack with `OMNI_PAIRED_AGENT_CONSUMERS=true`, a typed connector delivery and a webhook delivery are journaled with their source stamp, and an agent's `/events/trigger` row carries its key and agent.
- [ ] With a seeded grant, the granted agent's consumer drains the connector row; another agent's key cannot see the consumer; revoking the grant stops delivery.
- [ ] With the flag unset, or with `OMNI_MULTITENANCY_ENABLED=true`, `omni doctor` shows paired agents OFF with the reason, nothing is stamped, and legacy consumers behave as before.
- [ ] On a disposable database whose `omni_events` estimate is past the preflight threshold (statistics set by the fixture) and which lacks the slice-2 indexes, boot refuses with the message naming the pending indexes and the runbook; following the runbook from the candidate checkout (`--check` exits 3, run, `--check` exits 0) the next boot migrates.
- [ ] The C0, C15 and C16 suites stay green on the merged tree.

---

## Assumptions / Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| A large production journal cannot take the four journal index builds inside the boot migrator, and an unprepared upgrade stops serving even with the paired-agent flag unset. | High | Decision #9 and the group 1 runbook: the operator prepares from the candidate checkout (`--check`, run, `--check`) before replacing the binary, with a recovery path when the new binary already refused to start. The estimate-based preflight backs this up but is not a guarantee: a stale low `reltuples` lets a large journal through to an in-band build, and `OMNI_ALLOW_BLOCKING_INDEX_BUILD=on` skips it. Build time on the deployed journal is unmeasured. |
| The owner later widens the admin/owner-tier policy. | Low | Decision #3 is the owner's ruling; widening it changes one function plus one truth table. |
| Follow-up B may not land, leaving one slice-2 criterion open. | Medium | Decision #14: the criterion stays unchecked and slice-2 acceptance is reported incomplete; B's implementation is not pulled into this wish. |
| `resolveKeyAgent` depends on bindings: an agent bound to no instance (the future `paired` agent) has no proven key before slice 3. | Low | Fails closed: its key is `unresolved` (create refused) and only admin/owner-tier keys reach its consumer until slice 3 swaps the body (Decision #2). |
| The producer `AsyncLocalStorage` follows fire-and-forget work started in a request, so such publishes carry the request's key. | Low | That work is done on the key's behalf; worker and NATS-consumer publishes start outside the request and carry none. Replays and retries under an operator key journal no new row (same event id, `ON CONFLICT (id) DO NOTHING`). |
| `resolveKeyAgent` costs one primary-key read of `api_keys` per authenticated consumer request and per journaled row with a producing key, plus instance and agent reads for system agent keys. | Low | No cache is added; slice 7's benchmark measures it. |
| Open #1480 and #1484 change files or semantics this wish depends on. | Medium | Decision #21: merge `origin/dev` and rerun the full gate (and `make sdk-generate` for #1484) after each lands. |
| Migration number collides with t1q0/t1pz or older open PRs. | Low | Decision #16; merge `origin/dev` (merge commit) before each PR. |
| Agent-owned consumer names still appear in the event-type inventory (`EventService.getTypes`) within a tenant. | Low | Names only, never rows; the design does not ask for C1 over the inventory. |

---

## Review Results

_The read-only reviewer returns evidence; the invoking orchestrator appends a timestamped block here after plan, execution, and PR reviews._

### Follow-up 2 done — 2026-11-02

The 21 suites with a local `urlFor` were migrated to `pgRoleUrl` in three PRs, each with an Opus SHIP and a green gate:
- #1536 (0a8c6e79a): 21 to 14;
- #1538 (7fcad1992): 14 to 7;
- #1539 (465520ad0): 7 to 0.

`LOCAL_URLFOR_ACKNOWLEDGED` is empty and `LOCAL_URLFOR_CEILING` is 0. The inventory test also asserts that its scanner sees the `TWO_TENANT_PROOFS` suites and more than 60 files, so the empty list cannot pass vacuously.

### Group 6 delivered and slice 2 close-out — 2026-11-02

#1534 merged to dev as 749c362c (G6). Opus round-2 SHIP on exactly 2323bd61b. CI passed 13/13 (3 skipped). Every group has now merged:

| Group | PR | Merge commit |
| --- | --- | --- |
| G1 | #1491 | c8aab9e5 |
| G2 | #1499 | 737ea78a |
| G3 | #1506 | 4bb6f0f9 |
| G4 | #1514 | 47ba216c |
| G5 | #1523 | 97937039 |
| G6 | #1534 | 749c362c |

**Final aggregate gate (Decision #17), run by the orchestrator on origin/dev 749c362c in its own detached worktree:** **GREEN**, GATE_EXIT=0. `bun run check` passed 30/30, `make marketplace-check` passed 85/85 and 17/17, and `make test-pg-gate` PASSED with 1,007 assertions across 66 suites, 0 skipped, on a disposable cluster that was destroyed afterwards. Record: omni.worktrees/.tools/aggregate-gate-slice2-749c362c.md.
- `TWO_TENANT_PROOFS` suites in the run: all four ran in the passing pg-gate run: `event-consumers-postgres.test.ts`, `event-consumers-tenant-enforced-postgres.test.ts`, `paired-agent-grants-postgres.test.ts` and `services/__tests__/agent-key-reconciliation-postgres.test.ts`.

**Success criteria:** all checked. Each was delivered by its group's merged PR, under a cross-provider Opus SHIP on the exact head and a green gate. "Fixes active with multitenancy on" is checked because follow-up B's proof landed: #1488 merged as a480eef8, and G6 adds its route-key multitenancy-on case.

**Follow-ups carried beyond slice 2** (the orchestrator batches them with the end-of-slice backlog):
1. Slice 6 grant writer:
   - it MUST stamp the grant's tenant from its source (G6 N1 ruling); a NULL grant is not a wildcard;
   - keep the hashable coalesce predicate (G6 amendment).
   - **In review** (branch `fix/pa-grant-tenant-c12`): `insertAgentSourceGrant` in `@omni/db` is the only sanctioned writer and stamps the source's tenant (no `tenantId` input; a missing or RLS-invisible source throws). `agent-source-grant-writer.test.ts` guards it, and `agent-source-grants-postgres.test.ts` proves the stamp under legacy and enforced RLS. The coalesce predicate is unchanged.
2. Migrate the 21 pre-existing `-postgres` suites that define a local `urlFor` to `pgRoleUrl`, and shrink `LOCAL_URLFOR_ACKNOWLEDGED` to 0. **Done:** #1536, #1538, #1539 (see "Follow-up 2 done").
3. Accepted C12 residuals, documented in the guard header:
   - getter and `providerName` fields;
   - unresolvable `channel`-named parameters, for-of and catch bindings;
   - a `hermes` map dispatched via `Object.entries`;
   - contrived forms;
   - provider aliases through reassignment or array destructuring.
   - **In review** (branch `fix/pa-grant-tenant-c12`): getter and `providerName` fields, and provider aliases through reassignment or array destructuring, are now rejected. The residual-1 commit moves 2 `C12 permits` fixtures to `C12 rejects` (t201 ruling: keep). Still accepted: `channel`-named parameters, for-of and catch bindings (G5 ruling), the `hermes` `Object.entries` map, and contrived forms.
4. Optional G6 review nits: an index-name check on branch I, and filter-only and Seq Scan negative fixtures for the EXPLAIN checker.
5. Branch A plan note: its seek uses `omni_events_agent_id_idx` or a bitmap rather than the G1 composite index. Accepted as the planner's choice.

### Group 6 review — 2026-11-02, Claude Opus (t24q)

**Round 1: FIX-FIRST @03994bc26.** The reclaim cap held every attack. Findings:
- HIGH: `IS NOT DISTINCT FROM` blocked the grant-driven seek; confirmed by diagnostic v2, and the predicate was changed by the amendment below.
- HIGH: the A-branch proof was masked by an FK error in cleanup.
- MEDIUM: the C15 matrix passed without the tenant guard.
- Two LOWs: the agent grant's tenant source, and `hasMore`.

**Round 2: SHIP @2323bd61b.** All fixed. The gate is green: the PG stage ran 3 times on fresh clusters, plus the full gate, with 1,007 assertions across 66 suites, 0 skipped. PR #1534.

Verdicts: omni.worktrees/.tools/review-pa-g6-opus-03994bc2.md, review-pa-g6-opus-2323bd61.md. Follow-up B is #1488, merged as a480eef8. Its multitenancy-on proof is in G6, so the "fixes active with multitenancy on" criterion is checkable once #1534 merges.

### Wish amendment — 2026-11-02, group 6 N1 predicate form (captain ruling, pre-approved by t201)

The N1 bullet names `g.tenant_id IS NOT DISTINCT FROM omni_events.tenant_id`. G6 uses the semantically identical, hashable equality `coalesce(g.tenant_id::text, '') = coalesce(omni_events.tenant_id::text, '')` instead.

**Why.** The Opus review (finding 2) showed that `IS NOT DISTINCT FROM` plans as `NOT(DistinctExpr)`, not an `OpExpr`. So `compute_semijoin_info` cannot unique-ify the grants side, and the grant-driven seek on `omni_events_source_type_seq_idx` is lost.

**Diagnostic v2.** It ran with ANALYZE and no planner flags, on 5,000 rows across 500 sources:
- the S branch seeks `source_id` only without N1 (the G4 shape) or with the coalesce form; neither the literal form nor 100k rows did;
- all forms return identical rows;
- the coalesce form ran in 0.077 ms against 1.115 ms for the literal form.

**Conditions:**
- a truth table on both clauses: NULL/NULL matches, T/T matches, and T/U, NULL/T and T/NULL do not;
- a code comment explaining the planner reason, so nobody "simplifies" it back.

The A branch does not seek `agent_id` in any form, including G4's, on this dataset. That is pre-existing behaviour, not caused by N1, and is checked separately.

### Captain ruling — 2026-11-02, group 6 live-role inventory (local `urlFor`)

Deliverable 3 assumes no `*-postgres.test.ts` under `packages/` defines a local `function urlFor(`. In fact 21 pre-existing suites on dev do (checked at 979370390), all outside `TWO_TENANT_PROOFS`. Migrating them is beyond G6's scope.

**Ruling: a ratchet**, using the route-ownership `UNDECLARED_ACKNOWLEDGED` and ceiling pattern. The inventory test freezes `LOCAL_URLFOR_ACKNOWLEDGED`, exactly those 21 paths, and asserts three things:
- the set of suites that define a local `urlFor` equals that list, so a new suite fails, and so does a migrated suite left listed;
- the list's length is at most `LOCAL_URLFOR_CEILING = 21`;
- every `TWO_TENANT_PROOFS` file uses the shared `pgRoleUrl`/`assertPgTestRole`.

The scan stays over all of `packages/`, with no file exclusions. **Follow-up (not G6):** migrate the 21 suites to `pgRoleUrl` and shrink the list to 0.

### Captain ruling — 2026-11-02, group 6 grant tenant (N1)

**The conflict.** G4's suite seeds grants with a NULL tenant (`grant()`, no writer existed) and expects them to deliver T-stamped connector rows. The new `IS NOT DISTINCT FROM` clause would therefore break existing cases.

**The contract.** A grant's `tenant_id` is its source's tenant. That is what the slice-6 writer must stamp, per the G4 review's N1. A NULL grant is not a wildcard: there is no `IS NULL OR` form.

**What G6 does:**
- The suite's `grant()` fixture defaults to the source's stored tenant. Setup only; no assertion changes.
- New tests: a grant from another tenant, or a NULL grant against a T row, never delivers. An untenanted NULL/NULL source still delivers.

**Behaviour change from G4:** a NULL-tenant grant no longer delivers tenant-stamped rows. No production grants exist yet, because there is no writer.

**Slice-6 constraint:** the grant writer MUST stamp the source's tenant.

The orchestrator may overrule this ruling.

### Group 5 delivered — 2026-11-02

#1523 merged to dev as 97937039 (G5: flag status route, doctor OFF line, rollback proof, C12 guard). Opus round-3 SHIP on 96122dee3, where the stop floor was met. The gate on that head was green: pg-gate 893 assertions across 64 suites, 0 skipped. One follow-up commit, 79ef09b41, regenerated the DSH route catalog for the new route. It is a generated line only, and the orchestrator checked it; CI then passed 14/14.

### Group 5 review — 2026-11-02, Claude Opus (t22r)

**Round 1: FIX-FIRST @a792bae9c.** Route, doctor, rollback suite, runbook, route ownership and merge were clean; the gate was green with 816 assertions. Three MEDIUM findings showed the weakened C12 guard slipping:
- F1: the channel exception keyed on the variable's NAME (`const channel = agent.harness; channel === 'codex'` passed, though the old checker failed it).
- F2: 28 harness/device forms neither checker caught (Object.is, Map.get, `in`, regex, constant indirection).
- F3: provider aliasing.

There was also F4 LOW: the rollback 400 did not assert its cause. All four were fixed in 14bbc9436: the exception is limited to harness names that are real channel types (only `hermes`), bindings are resolved, and five syntactic rules were added.

**Round 2: FIX-FIRST @f92469117.** 46 of 48 round-1 slips now FAIL; the other 2 are contrived forms the reviewer waived. Fresh probes found two MEDIUM gaps:
- G1: a `hermes` constant held in an object member, enum or `let` passes at the use site.
- G2: harness-keyed maps dispatched via `Object.keys`/`entries`/`Reflect.get`.

G3 and G4 are LOW.

**Stop floor (proposed by the reviewer, accepted by the orchestrator, t201):** round 3 is SHIP if the G1 and G2 forms FAIL and the 31 slice files stay at 0 hits. A syntactic guard cannot be complete, so there is no round-4 chase. The residual forms are documented in the guard's header and here:
- getter or non-`provider` field names (`getProvider(agent)`, `providerName`);
- unresolvable `channel`-named parameters, for-of and catch bindings compared with `'hermes'`;
- a `hermes`-keyed map dispatched via `Object.entries` with no literal;
- contrived template, concatenation and spread forms.

Verdicts: omni.worktrees/.tools/review-pa-g5-opus-a792bae9.md, review-pa-g5-opus-f9246911.md.

### Captain ruling — 2026-11-02, group 5 architecture test

`routes/v2/instances.ts` was changed by group 2's fix (producer-scope exits at connect and restart), so it joins `PAIRED_AGENT_SLICE_FILES`, beyond the original inventory. Its pre-existing legacy channel dispatch (`case 'hermes'`, `instance.channel === 'hermes'`) matched the literal harness denylist. Ruling (revised the same day under the orchestrator's conditions): default-deny with a narrow channel exception. Any comparison form against a harness-name literal still fails. The only newly passing shape compares against a channel discriminant, meaning an identifier or member chain whose final segment is exactly `channel` or `channelType`. Failing fixtures cover ===/!==/==, switch/case, includes(), Set.has(), object-map lookups, destructured and aliased fields, and ternaries. A differential test proves the new checker flags everything the old literal checker flagged, except the channel-discriminant cases. There is no allowlist and no file exclusion. The orchestrator accepted this, on the condition that the Opus review attacks the guard specifically; any slip-through is FIX-FIRST.

### Group 4 delivered — 2026-11-02

#1514 merged to dev as 47ba216c (G4, grant read clause and agent-owned scan). Opus SHIP on the exact merged head 223184aca.

### Group 4 review — 2026-11-02

DeepSeek break-it (t22p) @d99dd3f1f: 33 attacks, 1 hole. H1 (rows claimed while the flag was off get no source stamp, so grants never deliver them) is ACCEPTED as the approved forward-only design: group 2's flag-off criterion requires NULL columns (Decision #4), and there is no backfill. It is documented here, in the PR and in group 5's rollback runbook. Opus (t22q) FIX-FIRST: F1 MEDIUM, the I/S/A branches ran as three statements (three READ COMMITTED snapshots), so a row committed between them could be skipped and passed by the cursor. The fix is one UNION ALL statement. The break-it notes N1-N3 are not defects; N4 is F1. LOW: the reclaim 500-row cap carries to slice 6. Verdicts: omni.worktrees/.tools/breakit-pa-g4-d99dd3f1.md, review-pa-g4-opus-d99dd3f1.md.

### Group 3 delivered — 2026-11-02

#1506 merged to dev as 4bb6f0f9 (G3, agent-owned consumers).

### Group 3 review — 2026-11-02

DeepSeek break-it (t22h) @ee3076611: 2 holes in 35 scenarios. H1 MEDIUM: a T2 admin could create a consumer owned by a T1 agent. H2 LOW: an uppercase own UUID was falsely denied. Both were fixed in b343ae284: tenant-bounded getById (NULL only matches NULL, same 400 as a missing agent) and lowercase UUIDs at the boundary. Opus (t22k) SHIP @b343ae284 and SHIP @3a4aaa707 (merge with #1501/#1502/#1498; empty remerge-diff; key rotation semantics hold). 3 LOWs carried to group 6. Verdicts: omni.worktrees/.tools/breakit-pa-g3-ee307661.md, review-pa-g3-opus-b343ae28.md.

### Group 2 delivered — 2026-11-02

#1499 merged to dev (G2, provenance stamp).

### Group 2 review — 2026-11-02, Claude Opus (t226)

FIX-FIRST @192eb4761. HIGH: the producer AsyncLocalStorage store leaked into long-lived work started inside a request (channel connect/restart, automation reload), so later rows carried the caller's key and agent (wrong provenance). Fixed in e31dcba02 with a revocable per-request holder (anything outliving the request stamps NULL) plus explicit exits at connect/restart/startEngine/reloadEngine; 6 regression tests failed before the fix. The LOW findings (test bus hid the leak, uncached resolveKeyAgent, DDL generators in the barrel) were fixed. SHIP @afb2a7b15 (merged head, empty remerge-diff); verdict archived at omni.worktrees/.tools/review-1499-opus-afb2a7b1.md. PR #1499.
- Open LOW, carried to group 6: `whatsapp-business.ts:255` `plugin.connect` is authenticated but not wrapped in the producer-scope exit. Its in-request `instance.connected` envelope carries the caller's key (the correct principal, and `instance.*` is not journalled). Group 6 adds the same 2-line exit for parity with the other plugins, plus a test.
- For group 3: `resolveKeyAgent` is now memoized per request on the producer holder. `consumerCaller` should reuse that memo, not add a second resolution.

### Group 1 delivered — 2026-11-02

#1491 merged to dev as c8aab9e5 (migration 0094). Opus SHIP on exactly e0c829b06 after one FIX-FIRST round (5 doc and wording findings). Known gap accepted by the orchestrator: pg-gate replays the SQL through psql, not Drizzle migrate; 0094 has the same shape as deployed 0049/0079.

### Plan review 3 — 2026-11-01, Codex (t1zr), APPROVED

On WISH sha256 `75ad1daa…`: 0 findings. All review-2 findings and focused-check notes closed. Report: pa-plan-review-3.md in the orchestrator scratchpad. Plan approval only, not implementation or merge acceptance.

### Owner ruling — 2026-11-01, Decision #3 (relayed by t201)

Owner-level keys are exactly scope `*` AND no instance list, always checked after the tenant check. Plan review 1 finding 8 is closed and group 3 is no longer gated on it. This edit only changes the PROPOSED/pending wording; it was made after the APPROVED review.

### Plan review 1 — 2026-11-01, Codex (t1zr), FIX-FIRST

On WISH sha256 `ebe5fe1d…` at `origin/dev` `effb53b09`: 9 findings (6 HIGH, 3 MEDIUM). Coordinator rulings applied in this revision:
- 1 HIGH, unresolved agent key: three-way principal `none`/`agent`/`unresolved` (Decision #2, group 2 `KeyAgentResolution`); with the flag on an unresolved key's create is refused, never downgraded; hand-made `agent:` keys stay ordinary; group 3 owns route cases for inactive, missing/mixed-binding and widened keys and stored-ownership denial with the flag on and off.
- 2 HIGH, fixtures: the "fixtures untouched" promise is removed; group 1 owns `agentId: null` in typed `DurableConsumer` fixtures (audit: only `consumerRow`; `OmniEvent` row fixtures are cast); group 3 owns the route test harness and caller shapes; both groups recounted (G1 13 files, G3 9 files).
- 3 HIGH, follow-up B: group 6 verifies and records B's case; B is an external prerequisite; the criterion stays open until B's proof lands, otherwise acceptance is reported incomplete (Decision #14).
- 4 HIGH, RLS: group 6 adds the enforced C15 six-verb fixture (roles, FORCE RLS on RLS-managed tables only, role and enforcement-state assertions, superuser negative control); the token grep is replaced by the `TWO_TENANT_PROOFS` inventory test and a final aggregate gate after the last group (group 6 moved to last).
- 5 HIGH, index builds: instant-build claims removed; all four journal indexes join the online-DDL phase and boot preflight with invalid-index recovery; the migration stays ordinary and idempotent with no `CONCURRENTLY`; production execution operator-held (Decision #9, group 1).
- 6 HIGH, CHECK: `(source_kind IS NULL) = (source_id IS NULL)` plus the allowed-kind clause, mirrored in schema.ts, tested for both half-populated forms, both NULL, every kind and an unknown kind.
- 7 MEDIUM, resolver: ID-only swap point kept; one key read, then a short-circuit before instance and agent reads; performance statement corrected.
- 8 MEDIUM, owner tier: predicate marked PROPOSED, owner disposition pending (asked via t1m); truth table added to group 3; scope helpers no longer cited as proof.
- 9 MEDIUM, references and conflicts: base pinned to `effb53b09`; #1477/#1478 merged and the partial-stamp split removed; claim line references, imports and the three route paths corrected; #1482, #1480 and #1483 added with order and revalidation (Decision #21). Reviewer's group 4 notes folded in: cross-kind negatives and positive legacy-subscription/webhook grants, S/A authorized by grants only, a real restricted system agent key, revocation under shared reclaim.

### Plan review 2 — 2026-11-01, Codex (t1zr), FIX-FIRST

On WISH sha256 `8f57ef49…` at `origin/dev` `61b94710`: 3 findings (2 HIGH, 1 MEDIUM); plan review 1 findings 1, 3, 4, 6, 7 and 9 closed, 2 and 5 partly closed, 8 pending and gating group 3. Coordinator rulings applied in this revision:
- 1 HIGH, third route harness: `event-consumers-postgres.test.ts` (`appFor`, `:1126-1142`) joins group 3's fixture work with the suite's real `db` and a seeded ordinary key row, keeping its tenant-isolation assertions; all three route harnesses must pass in group 3's own gate; group 3 recounted to ~10 files, ~1,500 insertions.
- 2 HIGH, operator recovery: group 1 owns the runbook `docs/deployment/paired-agent-journal-indexes.md` (stage the candidate checkout, run from its `packages/db` with an explicit DDL-capable URL, `--check` / run / `--check`, definition check, recovery when the new binary already refused to start, keep the previous binary); `--check` gets a tested exit 3 when blocked (chosen over output inspection); the hard-coded 0041 text in `onlineDdlPreflightMessage` (`online-ddl.ts:287-296`) names the pending indexes and the runbook; the blocking override stays operator-only; acceptance inspects the four index definitions, not names; group 1 recounted to ~15 files, ~1,250 insertions.
- 3 MEDIUM, threshold semantics: the guard is called an estimate-based preflight; the stale-`reltuples` limit and `OMNI_ALLOW_BLOCKING_INDEX_BUILD` are disclosed; operator pre-upgrade preparation is the requirement; boundary (999,999 / 1,000,000) and stale-estimate tests use fixture-set statistics; no exact-count probe.
- Focused checks: `unresolved` is never admin, asserted in both the JS and SQL access tests regardless of the owner-tier ruling; the real HTTP widened-key case asserts 401 (#1483 merged) while the service-level 403 stays; route-level refusals for inactive and missing/mixed-binding keys use non-empty instance lists; conflict statuses refreshed (#1482, #1483 merged; #1480 open with its wider file set; #1484 newly open, recorded for groups 1, 3 and 5); base re-pinned to `61b94710`.
- Plan review 1 finding 8 (owner tier) remains pending via t1m and still gates group 3's merge.

---

## Files to Create/Modify

```
# Group 1 (~15 files, ~1,250 insertions)
packages/api/src/tenancy/feature-flag.ts
packages/api/src/tenancy/__tests__/feature-flag.test.ts
packages/api/src/index.ts                                   # start-up warn only
packages/db/drizzle/NNNN_paired_agent_consumers.sql         # next free number on dev (expected 0094)
packages/db/drizzle/meta/_journal.json
packages/db/src/schema.ts
packages/db/src/paired-agent-online-ddl.ts                  # new
packages/db/src/online-ddl.ts
packages/db/src/online-ddl.test.ts
packages/db/scripts/online-ddl.ts                           # --check exit 3 when blocked
docs/deployment/paired-agent-journal-indexes.md             # new operator runbook
packages/db/src/tenancy-rls.ts
packages/db/src/tenancy-rls.test.ts
packages/db/src/paired-agent-schema-postgres.test.ts        # new
packages/api/src/services/__tests__/event-consumers.test.ts # agentId: null in consumerRow only

# Group 2 (~17 files, ~1,500 insertions)
packages/core/src/events/types.ts
packages/core/src/events/envelope.ts
packages/core/src/events/factory.ts
packages/core/src/events/index.ts                           # export barrel, if needed
packages/core/src/events/__tests__/producer-stamping.test.ts  # new
packages/api/src/lib/producer-scope.ts                      # new
packages/api/src/lib/key-agent.ts                           # new
packages/api/src/lib/__tests__/key-agent.test.ts            # new
packages/api/src/middleware/auth.ts
packages/api/src/index.ts                                   # producer resolver registration
packages/api/src/plugins/event-persistence.ts
packages/api/src/services/connectors.ts                     # legacy and typed claim stamps only
packages/api/src/services/webhooks.ts                       # receive and triggerClaimed stamps only
packages/db/src/tenancy-db-access-guard.ts
packages/db/src/tenancy-db-access-guard.test.ts
packages/api/src/__tests__/event-persistence.test.ts
packages/api/src/__tests__/provenance-stamp-postgres.test.ts  # new

# Group 3 (~10 files, ~1,500 insertions)
packages/api/src/lib/key-agent.ts                           # isAdminTierKey
packages/api/src/services/event-consumers.ts
packages/api/src/routes/v2/event-consumers.ts
packages/api/src/schemas/openapi/event-consumers.ts
packages/sdk/src/types.generated.ts                         # make sdk-generate on #1482's merged state
packages/api/src/routes/v2/__tests__/event-consumers-scoped.test.ts      # harness and caller shapes
packages/api/src/routes/v2/__tests__/event-consumers-stream.test.ts      # harness keys and db stub
packages/api/src/__tests__/event-consumers-postgres.test.ts              # appFor: services.db and an ordinary key row
packages/api/src/services/__tests__/event-consumers-agent-owned.test.ts  # new
packages/api/src/__tests__/paired-agent-consumers-postgres.test.ts       # new

# Group 4 (~3 files, ~1,300 insertions)
packages/api/src/services/event-consumers.ts
packages/api/src/services/__tests__/event-consumers-agent-scan.test.ts   # new
packages/api/src/__tests__/paired-agent-grants-postgres.test.ts          # new

# Group 5 (~9 files, ~900 insertions)
packages/api/src/routes/v2/system.ts
packages/api/src/constants/scopes.ts
packages/api/src/schemas/openapi/system.ts
packages/sdk/src/types.generated.ts                         # make sdk-generate on #1482's merged state
packages/cli/src/commands/doctor.ts                         # on #1482's merged doctor
packages/cli/src/__tests__/doctor.test.ts
packages/api/src/routes/v2/__tests__/system-paired-agents.test.ts        # new
packages/api/src/__tests__/paired-agent-rollback-postgres.test.ts        # new
packages/api/src/__tests__/paired-agents-architecture.test.ts            # new

# Group 6 (~5 files, ~800 insertions)
packages/api/src/routes/v2/__tests__/event-consumers-scoped.test.ts
packages/api/src/__tests__/event-consumers-tenant-enforced-postgres.test.ts  # new
packages/api/src/services/__tests__/agent-key-reconciliation-postgres.test.ts  # #1483's merged suite
packages/api/src/__tests__/agent-key-repair-startup.test.ts
packages/api/src/__tests__/paired-agents-live-role-inventory.test.ts     # new
```
