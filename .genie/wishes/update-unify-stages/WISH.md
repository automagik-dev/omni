# Wish: Unify the omni update interface and absorb genie parity

| Field | Value |
|-------|-------|
| **Status** | DRAFT |
| **Slug** | `update-unify-stages` |
| **Date** | 2026-05-03 (rebased 2026-05-04 against `origin/dev`) |
| **Author** | Felipe Rosa <felipe@namastex.ai> |
| **Appetite** | medium |
| **Branch** | `wish/update-unify-stages-rebased` |
| **Repos touched** | `automagik/omni` |
| **Design** | _No brainstorm — direct wish_ |

> **Companion document:** [SHARED-DESIGN.md](./SHARED-DESIGN.md) — cross-repo unification spec (byte-identical to `automagik-dev/genie#update-unify-stages` SHARED-DESIGN.md).
> **Sibling wish:** [`automagik-dev/genie#update-unify-stages`](../../../../genie/.genie/wishes/update-unify-stages/WISH.md) — both wishes ship in parallel, target their respective `dev` branches. The two repos own independent implementations; only the public shape (flags, `VerifyResult`, `LegacyArtifact`, diagnostics schema) is shared.
> **Not a sibling:** `pgserve#autopg-upgrade-command` is unrelated (DB lifecycle migration, not CLI installer UX) and shipped 2026-05-03 on `main` via commit `466d1a4`. Removed from the original "trio" framing.

## Rebase notes (2026-05-04)

The original draft (2026-05-03) was authored before `feat(update): canonical-pgserve phase-2 cutoff pre-flight guard` (commit `ddebb05f`, 2026-05-02) shipped on `origin/dev`. That commit added a 110-LOC pre-flight stage to `packages/cli/src/commands/update.ts` — pure decision function `checkCanonicalPgservePreflight`, new `--skip-canonical-preflight` flag, 10 test cases at `packages/cli/src/__tests__/update-canonical-preflight.test.ts`. This wish is rebased to:

1. Acknowledge the new pre-flight stage as an existing pipeline step (slots between "channel resolution" and "registry version check" in the shared 14-stage pipeline).
2. Audit `install.sh` against its current 593-LOC state on `dev` (not the 540-LOC pre-`ddebb05f` snapshot).
3. Surface the dangling reference to `automagik-dev/genie#update-unify-stages` — that wish is now being authored in parallel.

## Summary

`omni update` is already the cleanest of the three CLIs — it has pre-flight version checks, a pure `decideUpdateVerify` decision function, hermetic restart envs, a documented sidecar cleanup, and (since `ddebb05f`) a phase-2 canonical-pgserve cutoff guard. This wish converges omni's update onto the shared 14-stage pipeline by absorbing the parts being unified in parallel on the genie side: a typed `cleanupLegacyArtifacts()` registry (generalizing the `nats-reply-sidecar.mjs` step), a post-update maintenance hook calling `runDoctor` with a JSON output, structured diagnostics JSON capture, and a small expansion of the verify result to include a `skipped` variant. The `install.sh` is slimmed from 593 LOC to ≤80 LOC by delegating its wizard portion to `omni install`.

## Scope

### IN

- Adopt the shared `VerifyResult` tagged-union shape:
  - Rename `decideUpdateVerify` → `decideVerify` with `decideUpdateVerify` as a deprecated alias.
  - Add the `skipped` variant (`{ kind: 'skipped'; reason: 'no-restart' | 'no-verify-flag' | 'no-running-services' }`).
  - Existing `ok` / `health-unreachable` / `version-mismatch` / `auth-invalid` variants stay byte-identical to today's exports.
- New `--no-verify` flag — restart services but skip the post-restart probe. Useful when a release has a broken `/api/v2/health` and operators need to roll forward.
- Generalize the `nats-reply-sidecar.mjs` cleanup into the shared `cleanupLegacyArtifacts()` registry pattern from the genie wish:
  - `LegacyArtifact { name, detect(), cleanup(), summary() }` interface.
  - Day-one entry: `nats-reply-sidecar` (the existing logic, lifted into the registry).
  - CLI flags `--no-legacy-cleanup` (rename of `--no-sidecar-cleanup`, with `--no-sidecar-cleanup` retained as an alias) and `--skip-cleanup=<comma,separated,names>`.
- Post-update maintenance hook: call `runDoctor({ json: true, dryRun: true })` after a successful restart + verify; capture the `DoctorReport` into diagnostics. Gated by `--skip-maintenance` and `OMNI_UPDATE_SKIP_MAINTENANCE` env (matching genie's flag name).
- Diagnostics JSON capture on every `omni update`:
  - Path: `~/.omni/logs/update-diagnostics-<iso>.json`.
  - Schema mirrors genie's (same field names) but with `schemaVersion: 1` (omni's first — asymmetric per `SHARED-DESIGN.md` decision #4).
  - Includes: install metadata, registry probe result, install outcome, restart outcome, `verify: VerifyResult`, `cleanups: CleanupReport`, `maintenance: { outcome, durationMs, doctorReport? }`, recent pm2 log signals.
- Detect parallel npm-global install via `npm root -g`. Omni doesn't support npm-global server, but a parallel install hides stale binaries on PATH and confuses `which omni`. Print a warning recommending `npm uninstall -g @automagik/omni`.
- Slim `install.sh` to bootstrap-only:
  - `ensure_bun`
  - resolve channel from `~/.omni/config.json`
  - `bun add -g @automagik/omni@<channel>`
  - `omni install --non-interactive`
  - The wizard prompts (api url, api key, instance creation, AI provider) move into `omni install` (they may already be there — verify and reuse).
- Tests:
  - Lock the new `skipped` variant of `decideVerify`.
  - Lock the renamed alias (`decideUpdateVerify` still exported and identical).
  - Diagnostics file shape + `schemaVersion: 1`.
  - Cleanup registry roundtrip (detect/cleanup/skip).
  - Parallel npm-global install warning.
  - All existing tests in `update-verify.test.ts` continue to pass byte-identically; locked error strings preserved.

### OUT

- No shared package between repos. Independent implementations per `SHARED-DESIGN.md` decision #3.
- No changes to `decideUpdateVerify`'s existing return shape — only an additional variant. The `version-mismatch`, `auth-invalid`, `health-unreachable`, and `ok` variants stay byte-identical.
- No changes to the locked error strings (`Server version mismatch: cli=v… server=v…. Run: omni doctor` and `Auth key invalid after restart. Run: omni doctor --fix`). Tests in `update-verify.test.ts` pin them and stay green.
- No changes to PM2 process names, hermetic env construction (`buildRuntimeEnv`), or `auth.validate()` semantics.
- No changes to `omni doctor` UI. The post-update probe consumes `runDoctor`'s existing return value (omni's doctor is already typed — this is what genie's wish is migrating to).
- No genie or pgserve code in this PR.

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | `decideUpdateVerify` keeps its name as an exported alias | External consumers (none known, but conservative) won't break. Internal callers move to `decideVerify`. |
| 2 | Diagnostics `schemaVersion: 1` (asymmetric with genie's `2`) | Per `SHARED-DESIGN.md` decision #4: each repo evolves its own schema. Aligned numbers would be a false coupling signal. |
| 3 | `--no-sidecar-cleanup` retained as an alias of `--no-legacy-cleanup` | Existing scripts and runbooks reference `--no-sidecar-cleanup`. Removing it would break operators mid-migration. |
| 4 | Post-update `runDoctor` runs with `dryRun: true` | The probe is read-only. `omni doctor --fix` stays a separate explicit operator action. |
| 5 | Slimmed install.sh in same PR (not split) | The wizard moves into `omni install`; splitting would leave install.sh in a transitional state where part of its logic runs in bash and part in TS. |
| 6 | `--no-verify` semantically distinct from `--no-restart` | `--no-restart` skips the entire post-install path; `--no-verify` restarts services but skips the probe. Operators need both escape hatches. |
| 7 | `--skip-maintenance` matches genie's flag name (not omni-specific) | Cross-CLI consistency. The shared mental model is "the maintenance step runs after verify; this flag skips it." |
| 8 | Rename `decideUpdateVerify` → `decideVerify`; `decideUpdateVerify` retained as deprecated alias (pointer-equal export) | Public-shape parity with genie's wish. Internal callers move to `decideVerify`; the alias preserves any external consumer (none known but conservative). |
| 9 | Phase-2 canonical-pgserve preflight (`ddebb05f`) is treated as Stage 2.5 of the shared pipeline | Already-shipped pre-flight step that runs before `checkLatestVersion` (Stage 2). The wish does NOT modify it; it is recognized in `SHARED-DESIGN.md` §4.2 as an omni-specific stage that genie has no equivalent for. |
| 10 | install.sh slimmed in same PR as the `omni install --non-interactive` wire | Splitting would leave install.sh in a mixed state (part bash-wizard, part TS-wizard) for one release cycle; cleaner to land both halves together. |

## Success Criteria

- [ ] `decideVerify` is the canonical export from `update.ts`; `decideUpdateVerify` is exported as `export const decideUpdateVerify = decideVerify` and tagged `@deprecated` in JSDoc.
- [ ] `decideVerify` returns the `skipped` variant for `--no-restart`, `--no-verify`, and the no-running-services path.
- [ ] All existing test cases in `update-verify.test.ts` pass byte-identically with no string changes.
- [ ] `omni update --no-verify` restarts services but emits `Server: v… (skipped)` in the banner.
- [ ] `omni update --no-legacy-cleanup` skips the sidecar cleanup; `omni update --no-sidecar-cleanup` is accepted and behaves identically.
- [ ] `omni update --skip-cleanup=nats-reply-sidecar` skips that one entry only.
- [ ] After a successful `omni update`, a file matching `~/.omni/logs/update-diagnostics-*.json` is written with `schemaVersion: 1`, `verify`, `cleanups`, and `maintenance` blocks.
- [ ] When a parallel npm-global `@automagik/omni` install is detected, `omni update` prints a warning and the path of the parallel install.
- [ ] `runDoctor({ json: true, dryRun: true })` returns a `DoctorReport` consumable by the post-update path; the report is captured in diagnostics under `maintenance.doctorReport`.
- [ ] `wc -l install.sh` ≤ 80 (current state on `dev`: 593 LOC; gap: 513 LOC to remove); on a fresh box, `bash install.sh --server` produces an end-state indistinguishable from the previous wizard.
- [ ] `bun test packages/cli/src/__tests__/update-verify.test.ts` passes; new tests added for diagnostics shape, cleanup registry, and parallel-install warning.
- [ ] No regression in PM2 hermetic env behavior (the 2026-04-06 cross-DB incident root cause stays fixed).
- [ ] Fresh-box smoke test: `bash install.sh --server` (slimmed) produces an end-state byte-identical to the previous wizard for the `--server` mode — verified by diff'ing `~/.omni/`, pm2 process list, and `omni status --json` output before/after.

## Execution Strategy

This wish ships in two waves. Wave 1 lands the data-shape changes; Wave 2 wires them into the user-facing surface.

### Wave 1 — Shared shapes (parallel)

| Group | Agent | Description |
|-------|-------|-------------|
| 1 | engineer | Adopt shared `VerifyResult` shape: rename to `decideVerify`, keep alias, add `skipped` variant. |
| 2 | engineer | New `cleanupLegacyArtifacts()` registry; lift `nats-reply-sidecar` cleanup into a `LegacyArtifact` entry; rename flag with alias. |

### Wave 2 — Integration (sequential after Wave 1)

| Group | Agent | Description |
|-------|-------|-------------|
| 3 | engineer | Post-update maintenance hook (`runDoctor` JSON dry-run) + `--skip-maintenance` + env. |
| 4 | engineer | Diagnostics JSON capture — `~/.omni/logs/update-diagnostics-*.json` with shared schema + `schemaVersion: 1`. |
| 5 | engineer | Parallel npm-global install detection + warning; `--no-verify` flag; install.sh slim; tests + docs. |

## Execution Groups

### Group 1: Adopt shared VerifyResult shape

**Goal:** Bring omni's `decideUpdateVerify` onto the shared `VerifyResult` shape so it lines up byte-for-byte with the genie reference. Add the `skipped` variant. Keep all current consumers working.

**Deliverables:**
1. New canonical export from `packages/cli/src/commands/update.ts`:
   ```ts
   export type VerifyResult =
     | { kind: 'ok'; cliVersion: string; serverVersion: string }
     | { kind: 'health-unreachable'; apiPort: number }
     | { kind: 'version-mismatch'; cliVersion: string; serverVersion: string | null }
     | { kind: 'auth-invalid' }
     | { kind: 'skipped'; reason: 'no-restart' | 'no-verify-flag' | 'no-running-services' };
   ```
2. `decideVerify(args): VerifyResult` — same logic as today's `decideUpdateVerify`, plus the `skipped` short-circuit.
3. Backward alias: `export const decideUpdateVerify = decideVerify;` with `@deprecated use decideVerify` in the JSDoc.
4. Existing tests pass without modification (locked error strings stay).
5. New tests cover the `skipped` variant.

**Acceptance Criteria:**
- [ ] `decideUpdateVerify` and `decideVerify` are pointer-equal (same function reference).
- [ ] All current cases in `update-verify.test.ts` pass with zero string changes.
- [ ] New test case: `decideVerify({ skipReason: 'no-restart' })` returns `{ kind: 'skipped', reason: 'no-restart' }`.

**Validation:**
```bash
bun test packages/cli/src/__tests__/update-verify.test.ts
```

**depends-on:** none

---

### Group 2: Cleanup registry — lift sidecar cleanup into the shared pattern

**Goal:** Replace the bespoke `cleanupSidecars()` call with a registry-based `cleanupLegacyArtifacts(skipList)` so future cleanups (e.g. legacy WhatsApp baileys session formats) drop in without code changes to the update flow.

**Deliverables:**
1. New module `packages/cli/src/legacy-cleanup.ts`:
   ```ts
   interface LegacyArtifact {
     readonly name: string;
     detect(): Promise<boolean>;
     cleanup(): Promise<{ removed: string[]; warnings: string[] }>;
     summary(): string;
   }
   export const REGISTRY: LegacyArtifact[];
   export async function cleanupLegacyArtifacts(skipList: Set<string>): Promise<CleanupReport>;
   ```
2. Day-one registry entry: `nats-reply-sidecar` — wraps the existing `cleanupSidecars()` / `cleanupSucceeded()` / `formatCleanupSummary()` logic.
3. CLI flags:
   - `--no-legacy-cleanup` — primary name.
   - `--no-sidecar-cleanup` — alias, prints a one-line deprecation note.
   - `--skip-cleanup=<comma,separated,names>` — fine-grained skip.
4. The existing `runSidecarCleanup()` helper in `update.ts` is replaced with a call to `cleanupLegacyArtifacts()`.
5. Operator-facing summary output unchanged: `formatCleanupSummary()` still drives the human-readable lines.

**Acceptance Criteria:**
- [ ] `cleanupLegacyArtifacts(new Set())` runs the sidecar cleanup with byte-identical output to today's behavior.
- [ ] `cleanupLegacyArtifacts(new Set(['nats-reply-sidecar']))` skips it.
- [ ] `--no-sidecar-cleanup` prints `(deprecated alias for --no-legacy-cleanup)` once and behaves identically.
- [ ] No change to `docs/migration/nats-genie-sidecar-decommission.md`.

**Validation:**
```bash
bun test packages/cli/src/__tests__/legacy-cleanup.test.ts
```

**depends-on:** none

---

### Group 3: Post-update maintenance hook

**Goal:** After a successful restart + verify, run `omni doctor` in dry-run mode and capture the `DoctorReport` so operators see a health snapshot without needing a follow-up command.

**Deliverables:**
1. New helper in `update.ts`: `runPostUpdateMaintenance(): Promise<DoctorReport | null>` calling `runDoctor({ json: true, dryRun: true })`.
2. Wire into the success path of `restartServicesAndVerify` after the banner — only when `verify.kind === 'ok'`.
3. Gated by:
   - `--skip-maintenance` CLI flag.
   - `OMNI_UPDATE_SKIP_MAINTENANCE` env var.
4. The maintenance call is non-blocking: if `runDoctor` throws, we log a warning and proceed with exit 0.
5. Add `maintenance: { outcome: 'completed' | 'failed' | 'skipped'; durationMs: number; doctorReport?: DoctorReport; error?: string }` to a struct that diagnostics will pick up in Group 4.

**Acceptance Criteria:**
- [ ] On a healthy box, `omni update` runs the post-update doctor and prints a one-line summary like `Maintenance: 12 ok, 0 warn, 0 fail`.
- [ ] `omni update --skip-maintenance` and `OMNI_UPDATE_SKIP_MAINTENANCE=1 omni update` both skip the call.
- [ ] A failing `runDoctor` does NOT change exit code from 0.
- [ ] On non-`ok` verify outcomes, maintenance is skipped automatically (no point probing further).

**Validation:**
```bash
bun test packages/cli/src/__tests__/update-maintenance.test.ts
```

**depends-on:** Group 1

---

### Group 4: Diagnostics JSON capture

**Goal:** Write a structured diagnostics file on every `omni update` invocation so operators (and `/genie:report`) have install + verify + cleanup + maintenance breadcrumbs in one place.

**Deliverables:**
1. New `collectUpdateDiagnostics()` in `update.ts`:
   - Path: `~/.omni/logs/update-diagnostics-<iso>.json`.
   - `schemaVersion: 1` (omni's first).
   - Fields (mirroring genie's shape with omni-specific contents):
     ```jsonc
     {
       "schemaVersion": 1,
       "generatedAt": "ISO",
       "cli": "omni",
       "update": { "channel": "...", "primaryMethod": "bun", "globalInstalls": ["bun"] },
       "runtime": { "platform": "...", "arch": "...", "node": "...", "bun": "...", "npm": "..." },
       "verify": <VerifyResult>,
       "cleanups": <CleanupReport>,
       "maintenance": { "outcome": "...", "durationMs": N, "doctorReport"?: <DoctorReport>, "error"?: "..." },
       "recentLogSignals": { "pm2": [ ... ] },
       "paths": { "omniHome": "~/.omni", "logsDir": "~/.omni/logs" }
     }
     ```
2. Called on every code path that exits — including `--no-restart`, `--no-verify`, and confirmed-cancel paths.
3. JSDoc top-of-file documenting the schema-bump policy.
4. The file write is non-fatal: a write failure logs but doesn't change exit code.

**Acceptance Criteria:**
- [ ] After every `omni update` invocation (success or failure), exactly one `update-diagnostics-*.json` file is written.
- [ ] The file parses as valid JSON and contains all required top-level keys.
- [ ] `verify` matches the runtime `VerifyResult` exactly.
- [ ] `cleanups` reflects what actually ran (including `--no-legacy-cleanup` → empty array).
- [ ] On `--no-restart`, the file shows `verify: { kind: 'skipped', reason: 'no-restart' }`.

**Validation:**
```bash
bun test packages/cli/src/__tests__/update-diagnostics.test.ts
```

**depends-on:** Group 1, Group 2, Group 3

---

### Group 5: Parallel install detection + --no-verify + install.sh slim + tests + docs

**Goal:** Last-mile polish — surface accidental npm-global installs, expose `--no-verify`, slim install.sh, expand the test suite, document the unified shape.

**Deliverables:**
1. `detectParallelNpmGlobal(): Promise<string | null>` — runs `npm root -g` and checks for `@automagik/omni` there. Returns the path or `null`.
2. Warning printed before install runs: `⚠ Parallel npm-global install detected at <path>. Run: npm uninstall -g @automagik/omni`.
3. `--no-verify` flag — restarts services but skips the probe; `decideVerify` returns `{ kind: 'skipped', reason: 'no-verify-flag' }`.
4. New `install.sh` (~70 lines):
   - `ensure_bun`
   - `omni_channel()` (existing helper) → resolved channel
   - `bun add -g @automagik/omni@<channel>`
   - `omni install --non-interactive` (which already exists per current install.sh line 205)
   - Optional: forward `--cli` / `--server` mode flags to `omni install`.
5. Verify the existing wizard logic (api url, api key, instance creation, AI provider) is fully present in `omni install`. If anything's missing, file a follow-up issue and surface in PR description — do not block the wish.
6. Expanded tests:
   - Parallel-install warning (mock `npm root -g`).
   - `--no-verify` produces correct `VerifyResult.skipped`.
   - Diagnostics file is written under every exit path.
   - Help text enumerates every flag including aliases.
7. Update CLI help in `createUpdateCommand()` to list every flag.

**Acceptance Criteria:**
- [ ] `wc -l install.sh` ≤ 80.
- [ ] On a fresh box, `bash install.sh --cli` and `bash install.sh --server` produce end-states identical to the pre-slim script.
- [ ] `omni update --no-verify` shows `Server: v… (skipped)` in the banner.
- [ ] When a parallel npm-global install is present, the warning fires before `bun add -g` runs.
- [ ] `omni update --help` lists all of: `--yes`, `--no-restart`, `--no-verify`, `--no-legacy-cleanup`, `--skip-cleanup`, `--skip-maintenance`, `--next`, `--stable`. `--no-sidecar-cleanup` listed as deprecated alias.
- [ ] `bun test packages/cli/src/__tests__/update-*.test.ts` passes.

**Validation:**
```bash
wc -l install.sh && bun test packages/cli/src/__tests__/
```

**depends-on:** Group 4

---

## Cross-wish dependencies

- **paired-with** [`automagik-dev/genie#update-unify-stages`](../../../../genie/.genie/wishes/update-unify-stages/WISH.md) — both wishes ship in parallel against their respective `dev` branches. The `LegacyArtifact` interface and `cleanupLegacyArtifacts()` registry signature originate in the genie wish; this wish copies the type signatures (independent code, identical shape per `SHARED-DESIGN.md` decision #3). Neither wish blocks the other — they target different repos.
- **not-paired-with** `pgserve#autopg-upgrade-command` — different domain (DB lifecycle migration, not CLI installer UX); shipped 2026-05-03 on `main` via commit `466d1a4`. The original "trio" framing was a mental bundle; operationally these are independent workstreams.
- **builds-on** `ddebb05f feat(update): canonical-pgserve phase-2 cutoff pre-flight guard` (already on `origin/dev`) — recognized as Stage 2.5 of the shared pipeline. This wish does not modify the preflight; it slots cleanly in front of the existing flow.

## QA Criteria

_What must be verified on `dev` after merge. The QA agent tests each criterion._

- [ ] Functional — `omni update` on a current machine exits 0 in <2s with the locked "Already up to date" line; behavior unchanged from before this wish.
- [ ] Functional — `omni update --no-verify` restarts services but skips the probe; banner shows `Server: v… (skipped)`; exit 0.
- [ ] Functional — `omni update --no-legacy-cleanup` skips the sidecar cleanup; existing PM2-managed sidecar (if any) is not killed.
- [ ] Functional — `omni update --no-sidecar-cleanup` is accepted with a one-line deprecation notice and behaves identically to `--no-legacy-cleanup`.
- [ ] Integration — `~/.omni/logs/update-diagnostics-*.json` is written on every invocation (success, failure, declined, `--no-restart`).
- [ ] Integration — Diagnostics `verify` block matches the runtime `VerifyResult` exactly across all five variants.
- [ ] Integration — Post-update maintenance produces a `DoctorReport` captured in diagnostics under `maintenance.doctorReport`.
- [ ] Integration — When a parallel npm-global `@automagik/omni` install is present, the warning fires and is captured in diagnostics.
- [ ] Integration — Slimmed `install.sh` produces an end-state identical to the previous wizard on a fresh container.
- [ ] Regression — Locked error strings in `update-verify.test.ts` are byte-identical pre and post merge.
- [ ] Regression — `decideUpdateVerify` is still exported and pointer-equal to `decideVerify`.
- [ ] Regression — PM2 hermetic env restart (the 2026-04-06 cross-DB incident root cause) still works.
- [ ] Regression — `formatCleanupSummary()` output for sidecar cleanup is byte-identical to today's.

---

## Assumptions / Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| External consumer relies on `decideUpdateVerify` name being exported | Low | Keep alias; mark deprecated; remove only in a future major. |
| `runDoctor({ dryRun: true })` is slow enough to make `omni update` feel sluggish | Medium | Time it in Group 3; if >2s, gate behind a 5s deadline + degrade to `outcome: 'skipped'` with a `error: 'timeout'`. |
| Slimmed `install.sh` misses an interactive wizard path that `omni install` doesn't yet handle (e.g. AI provider configuration) | Medium | Group 5 acceptance includes a fresh-box smoke test in `--server` mode covering the full wizard. If a path is missing, port it into `omni install` first. |
| Diagnostics JSON write fails on read-only filesystems (CI containers) | Low | Wrap in try/catch; failure logs but never changes exit code. |
| Cleanup registry lifts the sidecar logic incorrectly and breaks the existing `nats-reply-sidecar.mjs` migration runbook | High | Group 2 acceptance requires byte-identical output from `formatCleanupSummary()`. Add a regression test that mocks a running sidecar and asserts the output line-for-line. |
| Renaming `--no-sidecar-cleanup` confuses operators mid-migration | Low | Keep alias indefinitely; deprecation notice is a single line, not a wall of warning text. |

---

## Review Results

_Populated by `/review` after execution completes._

---

## Files to Create/Modify

```
# Modify
packages/cli/src/commands/update.ts
packages/cli/src/__tests__/update-verify.test.ts
install.sh

# Create
packages/cli/src/legacy-cleanup.ts
packages/cli/src/__tests__/legacy-cleanup.test.ts
packages/cli/src/__tests__/update-maintenance.test.ts
packages/cli/src/__tests__/update-diagnostics.test.ts

# Reference (read-only, do not modify)
.genie/wishes/update-unify-stages/SHARED-DESIGN.md
docs/migration/nats-genie-sidecar-decommission.md
```
