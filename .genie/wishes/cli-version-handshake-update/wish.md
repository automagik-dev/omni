# Wish: CLI/API Version Handshake + `omni update` (Git-Track Aware)

**Status:** COMPLETE
**Slug:** `cli-version-handshake-update`
**Created:** 2026-02-12
**Depends on:** Nothing

---

## Summary

Implement a fast, low-risk version-awareness flow between Omni CLI and API using a shared CI-generated `version.json` artifact (`2.YYYYMMDD.N`), plus a friendly `omni update` command.

This gives operators clear one-line visibility of update/mismatch status without disrupting command execution, keeps updates git-based (`main` default, `--dev` optional), and preserves existing installer + Jenkins automation behavior.

---

## Scope

### IN
- Shared CI-generated `version.json` consumed by CLI and API builds
- Thin version handshake via headers:
  - request: `x-omni-cli-version`
  - response: `x-omni-server-version` + optional update/mismatch hint headers
- Warn-only policy (no blocking)
- One-line hints only in:
  - `omni --version`
  - `omni status`
- New `omni update` command:
  - git-based update path
  - default track: `main`
  - optional track: `--dev`
  - preserve config + backup binary
- Persist update channel in CLI config (`main|dev`)
- Additive Jenkins integration only (non-breaking)

### OUT
- Hard-block version enforcement
- Auto-silent self-updates
- Replacing `install-client.sh`/`install.sh`
- Branching model changes (`feat/* -> dev -> main` remains as-is)
- Broad CLI UX redesign

---

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | CI artifact `version.json` is source of truth | Prevents server/CLI drift |
| 2 | Header-based handshake | Minimal implementation surface |
| 3 | Warn-only mismatch handling | Zero workflow interruption |
| 4 | Hints only on `status` and `--version` | Keep command output quiet |
| 5 | `omni update` wraps existing install flow | Preserve compatibility and docs |
| 6 | Update tracks: `main` default, `--dev` optional | Matches existing git branch operations |
| 7 | Jenkins changes are additive | Avoid breaking current automations |

---

## Success Criteria

- [ ] CLI and API both expose same timestamp version lineage from shared artifact
- [ ] `omni --version` shows concise local/server version context when available
- [ ] `omni status` shows one-line `update available` or `mismatch` hint when relevant
- [ ] No command is blocked due to version mismatch
- [ ] `omni update` works for `main` and `--dev` tracks
- [ ] Existing install scripts continue working unchanged
- [ ] Jenkins pipelines continue green with new version artifact step

---

## Execution Groups

### Group 1: Version Artifact + Build Wiring (CI-safe)
**Priority:** P0
**Goal:** Produce one deterministic, CI-generated version artifact consumed by both CLI and API without breaking Jenkins.
**Deliverables:**
- `version.json` schema and generator script (`2.YYYYMMDD.N` + metadata)
- Jenkins/CI stage wiring that produces and publishes artifact for both builds
- Fail-fast validation when artifact is missing

#### Task 1.1: Define shared version artifact schema + generation
**What:** Add `version.json` generation step in CI/Jenkins with format `2.YYYYMMDD.N` and metadata (commit/date/channel).

**Files likely touched:**
- `Jenkinsfile` (or CI scripts used by Jenkins)
- `scripts/` version generation utility (new)
- package build scripts that embed/read artifact

**Acceptance Criteria:**
- [ ] Version artifact generated deterministically per build
- [ ] Artifact available to both API and CLI packaging steps
- [ ] Build fails clearly if artifact is missing in required path
- [ ] Existing Jenkins jobs still pass

**Validation commands:**
- `make check`
- Jenkins job run for CLI + API build path

---

### Group 2: API Header Handshake
**Priority:** P0 (depends on Group 1)
**Goal:** Expose stable server version metadata and hints via response headers.
**Deliverables:**
- Shared API middleware setting version headers on all responses
- Standardized hint header format for update/mismatch

#### Task 2.1: Add server version response headers
**What:** Add shared API middleware/response hook returning `x-omni-server-version` and optional hint headers.

**Files likely touched:**
- `packages/api/src/**` (shared middleware / server bootstrap)
- Health/status endpoint formatting where needed

**Acceptance Criteria:**
- [ ] API returns `x-omni-server-version` consistently
- [ ] Optional hints are emitted in a stable, parseable format
- [ ] No API contract regressions

**Validation commands:**
- `cd packages/api && bun run tsc --noEmit && bun test`

---

### Group 3: CLI Handshake + One-Line UX
**Priority:** P0 (depends on Groups 1-2)
**Goal:** Send CLI version to API and show concise update/mismatch hints only in status/version.
**Deliverables:**
- CLI request header injection (`x-omni-cli-version`)
- One-line hint output in `omni status` and `omni --version`

#### Task 3.1: Send CLI version header + parse server hints
**What:** CLI client sends `x-omni-cli-version`; `status` and `--version` consume response headers.

**Files likely touched:**
- `packages/cli/src/index.ts`
- `packages/cli/src/commands/status.ts`
- shared CLI HTTP client/util layer

**Acceptance Criteria:**
- [ ] CLI sends its version header on API requests
- [ ] `omni status` prints at most one concise hint line when relevant
- [ ] `omni --version` includes concise local/server mismatch/update context
- [ ] Other commands remain unchanged/noisy output not introduced

**Validation commands:**
- `cd packages/cli && bun run tsc --noEmit && bun test`

---

### Group 4: `omni update` Command (Git-track aware)
**Priority:** P0 (depends on Group 1)
**Goal:** Simple `omni update` wrapping existing git-based installer with main/dev track control.
**Deliverables:**
- New `omni update` command (`--dev` flag)
- Delegation to existing install scripts with config/binary preservation

#### Task 4.1: Implement update wrapper preserving installer behavior
**What:** Add `omni update` command delegating to existing git-based install/update flow.

**Behavior:**
- default `omni update` → `main` track
- `omni update --dev` → `dev` track
- preserve `~/.omni/config.json`
- keep backup/rollback behavior for binary

**Files likely touched:**
- `packages/cli/src/commands/*` (new update command)
- install script invocation helper
- docs/help text

**Acceptance Criteria:**
- [ ] `omni update` updates from main by default
- [ ] `omni update --dev` updates from dev
- [ ] Existing install scripts remain functional as-is
- [ ] Failure path leaves previous binary recoverable

**Validation commands:**
- `omni update --help`
- manual dry-run in test environment for main/dev tracks
- `cd packages/cli && bun test`

---

### Group 5: Config + Compatibility Safety
**Priority:** P1 (depends on Groups 3-4)
**Goal:** Persist update channel preference and display current track concisely.
**Deliverables:**
- `updateChannel` config key (`main` default, `dev` override)
- Compact track display in status/version output

#### Task 5.1: Persist update channel and display it succinctly
**What:** Add `updateChannel` in CLI config and show in `status`/`--version` context.

**Files likely touched:**
- CLI config store/parser
- status/version output formatting

**Acceptance Criteria:**
- [ ] `updateChannel` defaults to `main`
- [ ] `--dev` update can set/switch track explicitly
- [ ] Output clearly indicates current track without clutter

**Validation commands:**
- `cd packages/cli && bun run tsc --noEmit && bun test`

---

## Risks

| # | Risk | Impact | Mitigation |
|---|------|--------|------------|
| 1 | Artifact missing in some Jenkins path | Wrong/empty version display | Add mandatory generation + fail-fast checks |
| 2 | Header not present on some responses | Inconsistent hints | Centralize at shared middleware layer |
| 3 | Update wrapper breaks installer behavior | Update regressions | Delegate to existing scripts; do not replace logic |
| 4 | Track confusion (`main` vs `dev`) | Unintended upgrades | Persist/update channel and display clearly |

---

## Dependency Graph

`Group 1` → (`Group 2`, `Group 4`) → `Group 3` → `Group 5`

---

## Ready for Next Step

Run `/plan-review` to validate this wish, then `/make` to execute.
