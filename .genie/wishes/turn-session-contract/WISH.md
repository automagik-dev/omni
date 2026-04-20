# Wish: Turn-Session Contract — Omni Side

| Field | Value |
|-------|-------|
| **Status** | DRAFT |
| **Slug** | `turn-session-contract` |
| **Date** | 2026-04-19 |
| **Design** | _No brainstorm — direct wish_ (cross-repo design in [namastexlabs/genie-configure](https://github.com/namastexlabs/genie-configure/blob/main/.genie/brainstorms/turn-session-contract/DESIGN.md)) |

## Summary

Ship the omni-side of the turn-session contract: add `api_keys.executor_id` column, teach `omni connect <instance> <agent>` to record the current genie executor ID on the minted key, extend the scope-enforcer to reject keys whose bound executor has terminalized (by reading genie's executor state lazily on each authz request), and carve out admin/personal profiles as agent-lifetime keys that skip the check. This wish depends on the genie-side wish landing first (for the executor read endpoint and `GENIE_EXECUTOR_ID` env contract).

## Scope

### IN
- `api_keys.executor_id` column (nullable TEXT)
- `omni connect <instance> <agent>` reads `GENIE_EXECUTOR_ID` env and sets it on the minted key
- Scope-enforcer middleware extension: lazy read of genie's executor state; 401 with `reason='turn_closed'` when terminal
- Fail-closed behavior when genie is unreachable (configurable)
- Admin/personal profile carve-out: always mint with `executor_id=NULL`
- Tests for cs/scout/coworker profile key lifecycle (bound → released on turn close)
- Tests for admin/personal profile lifecycle (agent-lifetime, not turn-lifetime)
- Metrics: `scope_enforcer_executor_check_duration`, `scope_enforcer_genie_unreachable_count`

### OUT
- Genie-side changes (see `genie/.genie/wishes/turn-session-contract` — **this wish is `blocked-by` that one**)
- Changes to profile definitions themselves (owned by `omni-scope-profiles`)
- Changes to `omni connect` env sandbox (owned by `omni-turn-based-dx`)
- Cross-DB transaction logic (not needed — lazy read pattern avoids it)
- Automatic key rotation on turn close (keys aren't rotated, they're bound; release is implicit via executor state)
- NATS event consumer for turn close (explicitly rejected — lazy read is simpler)

## Decisions

| Decision | Rationale |
|----------|-----------|
| D6: lazy check of genie's executor state on every authz request | No eventual-consistency window, no background consumer, microsecond overhead |
| D6a: `api_keys.executor_id TEXT` nullable | Simple FK-shaped string; no cross-DB FK constraint |
| D6b: fail-closed on genie unreachable | Authz failure is safer than unauthorized sends; admin/personal carve-out preserves operator access |
| D6c: admin/personal profiles mint with `executor_id=NULL` | These are agent-lifetime, not turn-lifetime; preserve operator-tier semantics |

See full decision rationale in `DESIGN.md` (cross-repo).

## Success Criteria

- [ ] **C9** `api_keys.executor_id` column exists (nullable TEXT). Set by `omni connect <instance> <agent>` when `GENIE_EXECUTOR_ID` is present in env.
- [ ] **C10** Scope-enforcer rejects keys whose bound executor is terminal. Returns 401 with `reason='turn_closed'` in body.
- [ ] **C11** Admin and personal profiles mint with `executor_id=NULL` (agent-lifetime keys). Verified by `omni keys create --profile admin` and `--profile personal` tests.
- [ ] **C12** Scope-enforcer fails closed when genie's DB is unreachable. Returns 503 (or configured safe-deny) on next authz request.
- [ ] Cross-wish integration: genie-side `genie done` → omni authz returns 401 on the same key within 1 second.
- [ ] Metrics emitted: `scope_enforcer_executor_check_duration` (histogram), `scope_enforcer_genie_unreachable_count` (counter).
- [ ] p99 of executor check < 10ms under load (1000 req/s).
- [ ] Admin key survives a genie outage (not gated by executor check).

## Execution Strategy

Dependency graph: G1 → G2 → G3. All groups are sequential; every group depends on its predecessor (schema must exist before `omni connect` reads it; scope-enforcer needs both the column and the env contract).

Cross-wish precondition: genie-side Groups 1 (schema/state), 3 (`GENIE_EXECUTOR_ID` env contract), 6 (executor read endpoint) must all be merged to `dev` before Wave 1 can begin.

### Wave 1 (solo — schema foundation)
| Group | Agent | Description |
|-------|-------|-------------|
| G1 | engineer | Schema migration: `api_keys.executor_id TEXT` nullable + index + admin/personal profile carve-out |

### Wave 2 (solo — CLI env integration)
| Group | Agent | Description |
|-------|-------|-------------|
| G2 | engineer | `omni connect` reads `GENIE_EXECUTOR_ID` env and sets on minted key |

### Wave 3 (solo — authz middleware + perf gate)
| Group | Agent | Description |
|-------|-------|-------------|
| G3 | engineer | Scope-enforcer extension: executor check + fail-closed + metrics + load test |
| review | reviewer | Review G1-G3 against Success Criteria + cross-wish integration test |

## Execution Groups

### Group 1: Schema + admin/personal carve-out
**Goal:** Add the `executor_id` column and wire profile-level defaults.

**Deliverables:**
1. Drizzle migration: `ALTER TABLE api_keys ADD COLUMN executor_id TEXT` (nullable) + index on the column.
2. Update `packages/db/src/schema.ts` with the new field + Zod schema.
3. Profile resolver (`packages/api/src/lib/profiles.ts`): admin and personal always resolve with `executor_id=NULL`; cs/scout/coworker propagate the caller's value.
4. Unit tests: `omni keys create --profile admin` → `executor_id IS NULL`; `--profile cs` with env `GENIE_EXECUTOR_ID=abc` → `executor_id='abc'`.

**Acceptance Criteria:**
- [ ] Migration applies cleanly
- [ ] `make typecheck` + `make lint` pass
- [ ] Zod schema + TS types exported correctly
- [ ] Profile carve-out tests pass
- [ ] Index exists on `executor_id` (verified via `\d api_keys`)

**Validation:**
```bash
cd /home/genie/workspace/agents/genie-configure/repos/omni && make check
```

**depends-on:** `automagik-dev/genie#turn-session-contract` Group 1 (genie schema must land first)

---

### Group 2: `omni connect` env integration
**Goal:** `omni connect <instance> <agent>` mints a key with the current turn's executor ID attached.

**Deliverables:**
1. `packages/cli/src/commands/connect.ts` reads `process.env.GENIE_EXECUTOR_ID` at mint time.
2. If set, passes to the keys-create endpoint as `executorId`; if unset (non-genie context), mints with `executor_id=NULL`.
3. Log a warning when `GENIE_EXECUTOR_ID` is unset inside a genie agent context (detected by `GENIE_AGENT_NAME` being set) — suggests misconfiguration.
4. Integration test: run `omni connect` with env vars set, verify key row has correct `executor_id`.

**Acceptance Criteria:**
- [ ] `omni connect` in a genie session → key has non-null `executor_id` matching env
- [ ] `omni connect` outside a genie session → key has `executor_id=NULL`
- [ ] Warning logged when `GENIE_AGENT_NAME` set but `GENIE_EXECUTOR_ID` unset
- [ ] Existing `omni connect` behavior preserved for non-turn contexts

**Validation:**
```bash
cd /home/genie/workspace/agents/genie-configure/repos/omni && make test-file F=packages/cli/src/commands/connect.test.ts
```

**depends-on:** Group 1

---

### Group 3: Scope-enforcer extension
**Goal:** Middleware rejects keys whose bound executor is terminal; fails closed on genie unreachable; admin/personal skip the check.

**Deliverables:**
1. `packages/api/src/middleware/scope-enforcer.ts`: after existing scope/allowlist checks, if `key.executor_id IS NOT NULL`, call `fetchExecutorState(executor_id)`.
2. `fetchExecutorState()`: calls genie's `GET /executors/:id/state` endpoint (or queries via readonly PG role — config option). Timeout 500ms. Caches result for 5 seconds (in-memory LRU keyed by executor_id) to absorb burst load.
3. Logic: if state ∈ `{terminal, error}` → deny with 401 `{reason: 'turn_closed'}`. If fetch fails → deny with 503 `{reason: 'authz_backend_unreachable'}` (fail-closed). If profile ∈ `{admin, personal}` → skip the check entirely (carve-out).
4. Metrics (Prometheus-compatible): `scope_enforcer_executor_check_duration_ms` (histogram with p50/p99), `scope_enforcer_genie_unreachable_count` (counter), `scope_enforcer_turn_closed_count` (counter).
5. Integration test suite: (a) open turn via `omni connect` → call API → 200; (b) close turn via `genie done` on genie side → call API → 401 within 1s; (c) admin profile → always 200 regardless of executor state; (d) genie DB offline → 503 for cs profile, 200 for admin profile.
6. Load test (two-tier plan):
   - **CI tier** — `make perf-scope-enforcer` runs a bounded synthetic load (200 req/s for 30s) with p99 check duration < 20ms gate; runs on every PR to catch regressions. Uses a seeded in-memory executor-state stub so CI never depends on live genie.
   - **Staging tier** — Full-scale run (1000 req/s for 5min) against a real genie daemon on staging; p99 < 10ms gate. Required to be green before Phase B of the genie-side migration (genie G8) is promoted to production. Documented in `docs/runbooks/turn-session-load-test.md` with exact invocation + expected metrics shape.
   - Harness: existing `packages/api/test/perf/` infrastructure, or new if none exists (check with `ls packages/api/test/` during G3 kickoff).

**Acceptance Criteria:**
- [ ] Terminal executor → 401 with correct reason
- [ ] Active executor → passes through to existing scope check
- [ ] Genie unreachable → 503 for turn-lifetime profiles, 200 for agent-lifetime profiles
- [ ] Cache hits return in < 1ms
- [ ] p99 < 10ms at 1000 req/s
- [ ] Metrics visible via existing Prometheus endpoint
- [ ] Cross-wish integration test passes

**Validation:**
```bash
cd /home/genie/workspace/agents/genie-configure/repos/omni && make test-file F=packages/api/src/middleware/scope-enforcer.test.ts && make check
```

**depends-on:** Group 2, `automagik-dev/genie#turn-session-contract` Group 6 (executor read endpoint)

---

## QA Criteria

_Verified on dev after merge. QA agent tests each criterion._

- [ ] Full cycle: spawn genie agent → `omni connect <instance> <agent>` → verify key has `executor_id` → do work → `genie done` on genie → next `omni send` with that key gets 401
- [ ] Admin profile: mint via `omni keys create --profile admin` → executor_id is NULL → key survives closing any turn
- [ ] Personal profile: same as admin — agent-lifetime, not turn-lifetime
- [ ] Genie DB stopped (`pm2 stop pgserve`) → cs-profile requests get 503, admin-profile requests get 200
- [ ] Genie DB resumed → cs-profile requests resume 200 within cache TTL (5s)
- [ ] Metrics visible in Grafana: `scope_enforcer_executor_check_duration_ms`, `scope_enforcer_turn_closed_count`
- [ ] No performance regression on non-turn API requests (baseline latency unchanged)

---

## Dependencies

- **blocked-by:** `automagik-dev/genie#turn-session-contract` — requires genie Groups 1 (schema), 3 (env contract), 6 (executor read endpoint) merged to dev before this wish can execute

---

## Assumptions / Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| R3: Cross-DB authz read adds latency | Medium | 5s LRU cache absorbs burst; p99 gate in G3 acceptance criteria; fail-closed if > 50ms sustained |
| R4: Genie DB outage blocks omni authz | Medium | Admin/personal carve-out preserves operator access; monitor + alert; document failure mode |
| R5: Key-release race — post-close tail-send gets 401 | Medium | Close verb is last in skill flow by contract; audit log captures window for debugging |
| Cache TTL causes brief window of "zombie-allowed" requests after close | Low | 5s TTL is bounded; in practice agents don't send on closed keys (skill contract); trade-off is acceptable for latency |
| Missing `executor_id` on key that should have one | Low | G2 logs warning when `GENIE_AGENT_NAME` set but `GENIE_EXECUTOR_ID` unset; operator can audit |

---

## Review Results

_Populated by `/review` after execution completes._

---

## Files to Create/Modify

```
Created:
  packages/db/drizzle/NNNN_api_keys_executor_id.sql
  packages/api/src/middleware/__tests__/scope-enforcer-executor.test.ts
  packages/api/src/lib/executor-state-client.ts
  packages/api/src/lib/executor-state-client.test.ts
  packages/cli/src/commands/__tests__/connect-env.test.ts

Modified:
  packages/db/src/schema.ts                          (api_keys.executor_id)
  packages/api/src/lib/profiles.ts                   (admin/personal carve-out)
  packages/api/src/middleware/scope-enforcer.ts      (executor check logic)
  packages/api/src/middleware/scope-enforcer.test.ts
  packages/cli/src/commands/connect.ts               (GENIE_EXECUTOR_ID env read)
  packages/api/src/metrics.ts                        (new histograms + counters)
  README.md                                          (cross-wish integration notes)
```
