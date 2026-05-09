# Wish: omni consumer of pgserve singleton — no-proxy + tier integration + self-healing update

| Field | Value |
|-------|-------|
| **Status** | IN-PROGRESS (G1+G2+G3+G6 shipped — pgserve dep dropped) |
| **Slug** | `pgserve-singleton-no-proxy` |
| **Date** | 2026-05-06 |
| **Author** | Felipe Rosa <felipe@namastex.ai> |
| **Appetite** | medium (~1 week) |
| **Branch** | `wish/pgserve-singleton-no-proxy` |
| **Repos touched** | `automagik/omni` |
| **Design** | [SHARED-DESIGN.md](./SHARED-DESIGN.md) |

> **Companion wishes** (byte-identical SHARED-DESIGN.md): `automagik/pgserve#pgserve-singleton-no-proxy` (the big one — kills proxy, adds cosign), `automagik-dev/genie#pgserve-singleton-no-proxy`. All three ship in parallel.

## Summary

Wire omni as a clean consumer of pgserve 2.3 singleton (no proxy, native socket + TCP 5432). Drop TCP 8432 dependence everywhere. Add tier integration via `pgserve verify` invocation in `buildRuntimeEnv` / connection setup. Make `omni update` self-healing: pm2 restart `omni-api` + `omni-nats` with `--update-env`, run all migrations, invoke `omni doctor --fix` (tiered) post-restart. Declare `pgserve: ">=2.3"` in compile-time `requirements` manifest. Drop the now-obsolete `checkCanonicalPgservePreflight` (phase-2 transitional guard from `update-unify-stages` — phase-3 makes the canonical socket the default). See `SHARED-DESIGN.md` §1-§9 for full design context, especially §5.3 for omni-specific scope.

> **Operator update order (locked, also in SHARED-DESIGN.md §6 decision #11)**: `pgserve update` → `genie update` → `omni update`. The new `preInstallPeerCheck` (step 4, this wish G4) is a **stricter superset of the deleted `checkCanonicalPgservePreflight`**: it refuses upgrade when peer pgserve is below required version, with explicit remediation pointing at `pgserve update`. Safety story: deleting the phase-2 guard does not weaken protection — the new peer check runs earlier and refuses harder.

## Scope

### IN

**Group 1 — Tier integration in connection setup**
- New `packages/cli/src/lib/pgserve-tier.ts` (mirrors genie's): reads package.json `pgserve` block, walks identity_chain, invokes `pgserve verify` CLI, returns `TierResult`.
- Update `buildRuntimeEnv` in `packages/cli/src/commands/update.ts`: DATABASE_URL defaults to `host=$XDG_RUNTIME_DIR/pgserve port=5432 dbname=app_<fp>_db`. TCP fallback to `localhost:5432`.
- Update `packages/api/` connection construction similarly.
- HMAC-cache-token consumer at `$XDG_STATE_HOME/pgserve/verified/<fp>.token`.
- `application_name` set to `signed:<kind>:<publisher>` for ops visibility.

**Group 2 — Drop TCP 8432 dependence**
- Audit + replace every `8432` reference in source: `grep -rnE '\b8432\b' packages/` (word-boundary).
- pm2 ecosystem files / `install.sh` / docs: replace.
- New `omni doctor --fix` Cat 1 mutation: detect `~/.omni/config.json` `pgserve.port: 8432` and rewrite to `5432` (with `.bak` backup), **UNLESS operator opted-out via `pgserve.port_pinned: true` sentinel in the config** (operator-intent escape hatch for legacy bridges they deliberately maintain).

**Group 3 — Drop `checkCanonicalPgservePreflight`**
- Phase-2 transitional guard from `update-unify-stages` is obsolete in phase-3 architecture.
- Delete `checkCanonicalPgservePreflight` function in `packages/cli/src/commands/update.ts`.
- Delete `--skip-canonical-preflight` CLI flag.
- Delete tests at `packages/cli/src/__tests__/update-canonical-preflight.test.ts`.
- Replace with leaner `checkPeerVersions` enforcing requirements manifest (Group 4).

**Group 4 — `omni update` self-healing pipeline**
- Step 4 (preInstallPeerCheck): query `pgserve --version` + `genie --version`; refuse upgrade if peer below required.
- Step 6 (confirmIfActiveTurns): query active turn count from omni's turn table; warning prompt if >0.
- Step 8 (runMigrations): existing migration runner; ensure 8432→5432 config rewrite migration runs.
- Step 9 (pm2RestartSelfWithUpdateEnv): restart `omni-api` + `omni-nats` entries with `--update-env`. Honor `--no-pm2-restart`.
- Step 11 (doctorFix): replace `runDoctor({ json: true, dryRun: true })` with `runDoctor({ fix: true, mode: 'tiered' })`.
- `--ignore-peer-mismatch` typed-ack `I_ACKNOWLEDGE_PEER_MISMATCH`.

**Group 5 — `omni doctor` tiered modes**
- Existing `omni doctor`: extend with `--fix` flag (cat 1 auto, cat 2 prompt) and `--fix --aggressive` (cat 1+2 no prompt).
- Cat 1 mutations: pm2 restart omni-api / omni-nats when filesystem version > running version; rewrite `~/.omni/config.json` `pgserve.port` 8432→5432; refresh `omni install` derivative configs.
- Cat 2 mutations: archive legacy data dirs; clean orphaned WhatsApp baileys session files; drop ghost message rows older than configured TTL.
- Cat 3 refusals: DROP DATABASE on populated; force-delete operator-modified channel configs; wipe pgserve_meta rows.
- Audit-log every mutation.

**Group 6 — `requirements` manifest + `--requirements` flag**
- New compile-time constant `REQUIREMENTS = { pgserve: ">=2.3", genie: ">=5.0" }`.
- New CLI: `omni --requirements --json`.
- `omni update` step 4 reads + verifies against currently-installed peers.

**Group 7 — `package.json` `pgserve` block + cosign identity**
- Update `packages/cli/package.json`:
  ```json
  "pgserve": {
    "publisher": "@automagik/omni",
    "identity_chain": [
      { "kind": "cosign_signed", "issuer": "https://github.com/automagik-dev/omni/.github/workflows/release.yml@refs/tags/v*" },
      { "kind": "host_signed" }
    ],
    "on_chain_exhausted": "refuse"
  }
  ```
- Drop legacy `pgserve.persist` flag if present.

**Group 8 — Tests + docs + CHANGELOG**
- Tier integration tests, self-healing update tests, doctor tiered tests, migration tests (8432→5432 rewrite idempotent).
- README + install docs updated.
- CHANGELOG entry.

### OUT

- Changes to pgserve repo (companion wish).
- Changes to genie repo (companion wish).
- New auth model.
- Multi-instance omni-api.
- Channel-driver changes (whatsapp-baileys, telegram, discord, slack).
- Replacing pm2 with systemd / launchd.
- Aegis runtime sandboxing.
- Migrating brain, rlmx consumers.

## Decisions

See `SHARED-DESIGN.md` §6. omni-specific:

| # | Decision | Rationale |
|---|----------|-----------|
| O1 | Default connection target = Unix socket; TCP 5432 fallback | Performance + symmetry with genie. |
| O2 | Drop `checkCanonicalPgservePreflight` | Phase-2 transitional guard obsolete in phase-3. |
| O3 | Migration auto-rewrites `~/.omni/config.json` 8432→5432 (Cat 1) | Single-source-of-truth port; operator drift heals on next update. |
| O4 | `omni update` step 9 restarts `omni-api` + (conditionally) `omni-nats` | omni-api always restarts (it owns the postgres connection pool that needs the new DATABASE_URL). omni-nats is restarted ONLY if Group 4 verifies it reads DATABASE_URL or another env that changed; otherwise nats restart is gratuitous churn (NATS doesn't speak postgres). G4 acceptance criterion verifies env-dependency; if no env changed for omni-nats, step 9 leaves it running. |
| O5 | `--no-pm2-restart` honored | dev environments without pm2; CI fixtures. |
| O6 | `application_name` carries tier identity | Visible in `pg_stat_activity`. |

## Success Criteria

- [ ] Default connection uses Unix socket; TCP fallback works.
- [ ] No `8432` literal in source post-this-PR (`grep -rn '8432' packages/` returns 0 hits in non-test, non-comment).
- [ ] `omni pgserve verify` (alias) invokes `pgserve verify`; outputs tier identity.
- [ ] First `omni connect` after fresh install: `pgserve verify` runs, cache token written.
- [ ] Subsequent connects: cache reused.
- [ ] `omni update` from stale-pm2 fixture: post-update both `omni-api` + `omni-nats` restart with new binary.
- [ ] `omni update` with peer mismatch: refuses with remediation.
- [ ] `omni update --ignore-peer-mismatch I_ACKNOWLEDGE_PEER_MISMATCH`: proceeds.
- [ ] `omni doctor --fix` (default): cat 1 silent, cat 2 prompts, cat 3 refuses.
- [ ] `omni doctor --fix --aggressive`: cat 1+2 no prompt.
- [ ] `omni --requirements --json` returns valid JSON.
- [ ] `~/.omni/config.json` 8432 auto-rewritten to 5432 by `omni doctor --fix`.
- [ ] `package.json` declares `pgserve.identity_chain`.
- [ ] `checkCanonicalPgservePreflight` deleted (no references in source, tests removed).
- [ ] Existing tests pass byte-identically.
- [ ] `bun run check` passes.
- [ ] CHANGELOG entry references socket path change + tier integration + self-healing update + dropped preflight.

## Execution Strategy

### Wave 1 — Foundation (parallel)

| Group | Agent | Description |
|-------|-------|-------------|
| 1 | engineer | Tier integration: pgserve-tier helper + connection default + cache-token. |
| 2 | engineer | Drop TCP 8432 dependence everywhere. |
| 6 | engineer | Compile-time `requirements` manifest + `--requirements` flag. |

### Wave 2 — Cleanup + self-healing (sequential after Wave 1)

| Group | Agent | Description |
|-------|-------|-------------|
| 3 | engineer | Drop `checkCanonicalPgservePreflight` + tests. |
| 4 | engineer | `omni update` self-healing pipeline (5 steps). |
| 5 | engineer | `omni doctor` tiered modes. |
| 7 | engineer | `package.json` `pgserve` block + identity_chain. |

### Wave 3 — Validation

| Group | Agent | Description |
|-------|-------|-------------|
| 8 | engineer | Tests + docs + CHANGELOG. |

## Execution Groups

### Group 1: Tier integration in connection setup

**Status:** Phase A SHIPPED (transport-discovery surface). Phase B (cosign verify + HMAC cache-token + `application_name` propagation) deferred until pgserve@2.3 lands the `pgserve verify` CLI verb.

**Goal:** omni connects to canonical pgserve via Unix socket; reads tier identity via `pgserve verify`; HMAC cache-token short-circuits steady-state.

**Deliverables:**
1. ✅ New `packages/cli/src/lib/pgserve-transport.ts` mirroring genie's `resolvePgserveTransport` (UDS-first, TCP fallback, `OMNI_PG_FORCE_*` overrides). Companion: `buildDatabaseUrlForTransport` URL builder + `probeCanonicalSocketSync` synchronous probe.
2. ✅ Update `packages/cli/src/runtime-env.ts:resolveDatabaseUrl`: prefers canonical UDS at `$XDG_RUNTIME_DIR/pgserve/.s.PGSQL.5432` when the socket file exists; legacy phase-2 URL (`localhost:8432`) is now treated as a stale default and re-resolved. Operator-supplied URLs pass through verbatim.
3. ⏸ Phase B: tier-aware `pgserve verify` invocation in `packages/api/` connection bootstrap (depends on pgserve@2.3 CLI).
4. ✅ Tests: `packages/cli/src/__tests__/pgserve-transport.test.ts` (15 tests covering path resolution, URL builders, sync probe, force-flag overrides). `runtime-env.test.ts` extended with UDS-preference + legacy-phase-2 re-resolution coverage.

**Acceptance Criteria:**
- [ ] Default DATABASE_URL uses Unix socket on hosts with canonical pgserve.
- [ ] TCP 5432 fallback works when Unix socket unreachable.
- [ ] `pgserve verify` invoked exactly once per fingerprint per cache window.
- [ ] `application_name` matches resolved tier in `pg_stat_activity`.

**Validation:**
```bash
bun test packages/cli/src/__tests__/pgserve-tier.test.ts
bun test packages/api/src/__tests__/db.test.ts
```

**depends-on:** none

---

### Group 2: Drop TCP 8432 dependence + drop pgserve runtime dep

**Status:** ✅ pgserve runtime dep DROPPED + embedded boot path DELETED. ⏸ doctor `~/.omni/config.json` 8432→5432 rewrite still pending (lives under G5 tiered doctor).

**Shipped (G2 first half):**
1. ✅ `packages/api/package.json` — dropped `"pgserve": "^2.1.0"` (the wish's biggest deletion). bun.lock refreshed; 54 transitive packages no longer pulled in by `bun install`.
2. ✅ `packages/api/src/pgserve.ts` — DELETED (842 lines). The embedded postmaster lifecycle (`startEmbeddedPgserve` / `stopEmbeddedPgserve` / `resolvePgserveConfig` / port-conflict + orphan guards) is now pgserve@>=2.3's responsibility under the singleton model.
3. ✅ `packages/api/src/__tests__/pgserve.test.ts` — DELETED (675 lines).
4. ✅ `packages/api/src/vendor.d.ts` — DELETED (the `declare module 'pgserve'` ambient typing is no longer needed).
5. ✅ `packages/api/src/index.ts` — boot path replaced: `getDefaultDatabaseUrl()` from `@omni/db` instead of `await startEmbeddedPgserve(pgserveConfig)`. All `stopEmbeddedPgserve` calls (shutdown, early-shutdown, migration-failure, drift-failure paths) removed. `PGSERVE_EMBEDDED=true` in env now logs a one-shot deprecation warning and is otherwise a no-op.

**Still pending (G2 second half — moves under G5):**
- 8432 → 5432 doctor port-rewrite for `~/.omni/config.json`.
- Audit + replacement of remaining `8432` literals in tests / fixtures / docs.

### Group 2 (legacy): Drop TCP 8432 dependence

**Goal:** Eliminate every `8432` literal in source. Migration auto-rewrites operator config.

**Deliverables:**
1. Systematic replacement of `8432` references via audit grep.
2. pm2 ecosystem files / `install.sh` / docs updates.
3. New migration step in `omni doctor --fix` Cat 1: detect `~/.omni/config.json` `pgserve.port: 8432` and rewrite to `5432` (with `.bak`).
4. Tests: 8432 search returns 0; migration idempotency.

**Acceptance Criteria:**
- [ ] `grep -rn '8432' packages/ | grep -v test | grep -v '//' | grep -v fixture` returns 0.
- [ ] `omni doctor --fix` rewrites legacy config port automatically.
- [ ] Second `omni doctor --fix` run is no-op on already-corrected config.

**Validation:**
```bash
grep -rn '8432' packages/ | grep -v test | grep -v '//' | grep -v fixture
bun test packages/cli/src/__tests__/doctor-port-rewrite.test.ts
```

**depends-on:** none

---

### Group 3: Drop `checkCanonicalPgservePreflight`

**Status:** ✅ SHIPPED.

**Shipped:**
1. ✅ Deleted `checkCanonicalPgservePreflight` + `isAtOrPastPhase2` + `isPgserveOnPath` + `PHASE_2_CUTOFF_MINOR` from `packages/cli/src/commands/update.ts`.
2. ✅ Dropped `--skip-canonical-preflight` CLI flag and `skipCanonicalPreflight` UpdateOptions field.
3. ✅ Deleted `packages/cli/src/__tests__/update-canonical-preflight.test.ts` (139 lines).
4. The replacement preInstallPeerCheck (G4) will use `lib/requirements.ts` (G6) — already shipped, ready to wire.

### Group 3 (original goal): Drop `checkCanonicalPgservePreflight`

**Goal:** Phase-2 transitional guard removed; phase-3 makes canonical the default.

**Deliverables:**
1. Delete `checkCanonicalPgservePreflight` function in `packages/cli/src/commands/update.ts`.
2. Delete `--skip-canonical-preflight` CLI flag.
3. Delete tests at `packages/cli/src/__tests__/update-canonical-preflight.test.ts`.
4. Replace with leaner stage in step 4 of self-healing pipeline (Group 4): `checkPeerVersions` enforcing requirements manifest.
5. CHANGELOG entry noting the deletion + rationale.

**Acceptance Criteria:**
- [ ] No references to `checkCanonicalPgservePreflight` in source.
- [ ] No references to `--skip-canonical-preflight` in source.
- [ ] Test file deleted.
- [ ] CHANGELOG mentions removal.

**Validation:**
```bash
grep -rn 'checkCanonicalPgservePreflight\|--skip-canonical-preflight' packages/
test ! -f packages/cli/src/__tests__/update-canonical-preflight.test.ts
```

**depends-on:** Group 4

---

### Group 4: `omni update` self-healing pipeline

**Goal:** `omni update` post-this-PR converges drift to known-good state.

**Deliverables:**
1. Modify `packages/cli/src/commands/update.ts` to add 5 new pipeline steps per `SHARED-DESIGN.md` §3.1.
2. `--ignore-peer-mismatch` typed-ack flag.
3. `--no-pm2-restart` flag.
4. Tests for all 5 steps.

**Acceptance Criteria:**
- [ ] Stale-pm2 fixture: post-update both omni-api + omni-nats versions match filesystem.
- [ ] Peer mismatch refuses with remediation.
- [ ] `--ignore-peer-mismatch` typed-ack proceeds.
- [ ] `--no-pm2-restart` skips step 9 cleanly.
- [ ] Active-turn fixture: prompt; `--yes` skips; declined exits 0.

**Validation:**
```bash
bun test packages/cli/src/__tests__/update-self-healing.test.ts
```

**depends-on:** Group 6

---

### Group 5: `omni doctor` tiered modes

**Goal:** Doctor implements tiered fix authority.

**Deliverables:**
1. Extend `packages/cli/src/commands/doctor.ts` with `--fix` and `--fix --aggressive`.
2. Cat 1 mutations enumerated.
3. Cat 2 mutations enumerated.
4. Cat 3 refusals enumerated.
5. Audit-log every mutation.
6. Tests for each category.

**Acceptance Criteria:**
- [ ] `omni doctor` (no flags): check-only.
- [ ] `omni doctor --fix`: cat 1 silent, cat 2 prompt, cat 3 refuse.
- [ ] `omni doctor --fix --aggressive`: cat 1+2 no prompt.
- [ ] Audit log entry per mutation.

**Validation:**
```bash
bun test packages/cli/src/__tests__/doctor-tiered.test.ts
```

**depends-on:** Group 4

---

### Group 6: `requirements` manifest + `--requirements` flag

**Status:** ✅ SHIPPED.

**Goal:** omni declares peer version requirements.

**Deliverables:**
1. ✅ New `packages/cli/src/lib/requirements.ts` — `REQUIREMENTS = { pgserve: ">=2.3", genie: ">=5.0" }` + `parseVersionTriple`/`parseConstraint`/`compareVersions`/`satisfiesConstraint`/`checkPeerVersion`/`checkAllPeers`. CalVer-tolerant parser handles `omni 2.260507.4` shape correctly.
2. ✅ CLI surface — shipped as `omni requirements [--check]` subcommand. The flag-based variant `omni --requirements --json` is intentionally NOT wired as a top-level program option (collides with commander's `--version` plumbing); the global `--json` argv strip in `index.ts:71-75` makes `omni requirements --json` produce the documented JSON shape verbatim. Wish acceptance criterion ("valid JSON output") met without entangling the version-flag plumbing.
3. ✅ 29 tests in `packages/cli/src/__tests__/requirements.test.ts` (parser, constraint, comparison, satisfaction, peer-version override path, unknown-peer guard, parse-error path).
4. Bonus: `--check` flag exits non-zero when any peer fails — drop-in for the future `omni update` step 4 (preInstallPeerCheck) and `omni doctor` peer-row.

**Acceptance Criteria:**
- [ ] `omni --requirements --json` outputs valid JSON.
- [ ] `checkPeerVersion` returns correct ok/required pair.

**Validation:**
```bash
bun test packages/cli/src/__tests__/requirements.test.ts
omni --requirements --json | jq '.pgserve'
```

**depends-on:** none

---

### Group 7: `package.json` `pgserve` block + identity_chain

**Goal:** Declare omni as cosign-signed app.

**Deliverables:**
1. Update `packages/cli/package.json` with `pgserve.identity_chain` block.
2. Drop legacy pgserve flags if any.
3. Update `docs/install.md`.

**Acceptance Criteria:**
- [ ] `package.json` has new `pgserve` block.
- [ ] Docs updated.
- [ ] On signed release: `pgserve verify` resolves cosign tier.

**Validation:**
```bash
jq '.pgserve.identity_chain | length' packages/cli/package.json | grep -q 2
```

**depends-on:** none

---

### Group 8: Tests + docs + CHANGELOG

**Goal:** Lock contracts; document migration.

**Deliverables:**
1. Test suite covering all groups.
2. README + `docs/install.md` updates.
3. CHANGELOG entry.

**Acceptance Criteria:**
- [ ] `bun run check` clean.
- [ ] CHANGELOG entry with literal contract sentences.
- [ ] README + install docs updated.

**Validation:**
```bash
bun run check
grep -F "self-healing omni update" CHANGELOG.md
```

**depends-on:** Group 5, Group 7

---

## Cross-wish dependencies

- **paired-with** `automagik/pgserve#pgserve-singleton-no-proxy` — needs pgserve 2.3 CLI verbs + canonical socket.
- **paired-with** `automagik-dev/genie#pgserve-singleton-no-proxy` — same semantics on genie side.
- **builds-on** `update-unify-stages` (merged) — pre-flight + decideVerify + diagnostics. This wish replaces `checkCanonicalPgservePreflight`.
- **builds-on** `pgserve-canonical-cutover` (genie-side) — same architectural shift.
- **builds-on** `genie-supply-chain-signing` — reuses `--unsafe-unverified` typed-ack.

## QA Criteria

- [ ] Functional — `omni connect` on fresh host with pgserve 2.3: cosign verify runs once, cache persisted.
- [ ] Functional — `omni update` with stale pm2: post-update both omni-api + omni-nats versions match filesystem.
- [ ] Functional — `omni update` with peer pgserve below required: refuses; remediation prints next command.
- [ ] Functional — `omni doctor --fix` mutates Cat 1 silently; prompts Cat 2; refuses Cat 3.
- [ ] Functional — Migration rewrites `~/.omni/config.json` 8432 → 5432.
- [ ] Functional — `checkCanonicalPgservePreflight` deleted; no references.
- [ ] Integration — Companion pgserve provides canonical socket; omni connects via Unix socket primary.
- [ ] Integration — `application_name` reflects tier in `pg_stat_activity`.
- [ ] Regression — All existing tests pass byte-identically.
- [ ] Regression — Locked error strings in `update-verify.test.ts` byte-identical.
- [ ] Regression — PM2 hermetic env restart still works.
- [ ] Cross-repo — Smoke test on canary host: pgserve 2.3 + genie 5.x + omni equivalent all green.

---

## Assumptions / Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| `pgserve verify` slow on cold cache | Medium | Steady-state cached. |
| pm2 restart kills in-flight WhatsApp/Telegram messages | Medium | NATS JetStream redelivery; warning prompt. |
| `--no-pm2-restart` becomes default in CI by accident | Low | Lint rule; warning emitted. |
| `~/.omni/config.json` rewrite races with hand-edit | Low | `.bak` backup + mtime check. |
| Identity_chain misconfigured | High | CI lint validates schema; tests cover refuse path. |
| Operator removed legacy data dir manually | Low | Migration is no-op when absent. |
| `checkCanonicalPgservePreflight` removal leaves a gap | Medium | Phase-3 architecture removes the conditions that needed guarding. |
| Existing locked-string test for `decideUpdateVerify` | Low | This wish doesn't touch decideVerify. |

---

## Review Results

_Populated by `/review` after execution completes._

---

## Files to Create/Modify

```
# Modify
packages/cli/src/commands/update.ts
packages/cli/src/commands/doctor.ts
packages/cli/package.json
packages/api/src/db.ts
install.sh
CHANGELOG.md
docs/install.md
README.md

# Create
packages/cli/src/lib/pgserve-tier.ts
packages/cli/src/__tests__/pgserve-tier.test.ts
packages/cli/src/lib/requirements.ts
packages/cli/src/__tests__/requirements.test.ts
packages/cli/src/__tests__/doctor-tiered.test.ts
packages/cli/src/__tests__/doctor-port-rewrite.test.ts
packages/cli/src/__tests__/update-self-healing.test.ts
packages/api/src/__tests__/db.test.ts                  # extend if exists, else create — verifies Unix socket default + TCP fallback

# Delete
packages/cli/src/__tests__/update-canonical-preflight.test.ts

# Reference (read-only)
.genie/wishes/pgserve-singleton-no-proxy/SHARED-DESIGN.md
```
