# Design: CLI/API Version Handshake + Friendly Git-Based Update Flow

**Status:** VALIDATED
**Slug:** `cli-version-handshake-update`
**Date:** 2026-02-12

---

## Problem

Omni currently has friction around client/server version visibility and update behavior. Users can’t quickly tell when CLI and server are out of sync, and update flows feel split between “client vs server” mental models. This creates confusion during daily work and increases risk when teams operate across `main` and `dev` tracks.

---

## Solution

Introduce a lightweight version contract between CLI and API, powered by a single CI-generated `version.json` artifact (`2.YYYYMMDD.N`). CLI sends its version in request headers; API returns server version and optional update/mismatch hints. CLI surfaces short 1-line guidance only in `omni status` and `omni --version`.

Add `omni update` as a friendly wrapper over the existing git-based installer path, preserving branch tracking semantics (`main` default, `--dev` optional) and preserving config. Keep existing installer scripts intact and Jenkins-compatible to avoid automation breakage.

---

## Scope

### IN
- CI-generated shared `version.json` consumed by both CLI and server builds
- Request/response version headers (`x-omni-cli-version`, `x-omni-server-version`, update hint headers)
- Warn-only mismatch/update policy (no command blocking)
- Short update/mismatch one-liners in:
  - `omni status`
  - `omni --version`
- New `omni update` command wrapping current git-based install/update behavior
- Track-aware updates:
  - default `main`
  - optional `--dev`
  - persisted update channel in CLI config
- Backward-safe integration with existing Jenkins pipelines

### OUT
- Hard enforcement/blocking on version mismatch
- Automatic silent self-updating
- Replacing `install-client.sh` / `install.sh`
- Reworking deployment topology or release branching model
- Major command UX redesign beyond status/version and update command

---

## Key Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Use CI-generated `version.json` as single source of truth | Prevents drift between CLI and server version strings; deterministic build identity |
| 2 | Use thin HTTP header handshake for version info | Minimal-invasive, fast to implement, no payload schema churn |
| 3 | Apply warn-only policy | Fast adoption without disrupting workflows; safe quick win |
| 4 | Show hints only on `status` and `--version` | Keeps command output clean and avoids spam/fatigue |
| 5 | Implement `omni update` as wrapper (not replacement) | Preserves compatibility with existing git-based installers and docs |
| 6 | Keep branch-based updates (`main` / `--dev`) | Matches current workflow and supports stable vs dev tracks clearly |
| 7 | Keep Jenkins changes additive | Reduces risk of breaking existing automation jobs |

---

## Risks

| # | Risk | Impact | Mitigation |
|---|------|--------|------------|
| 1 | Version artifact not generated in some CI paths | Missing/incorrect version display | Add fallback defaults + CI validation step that fails build if artifact missing |
| 2 | Header contract not returned on some endpoints | Inconsistent hint behavior | Implement at shared API middleware layer and cover with tests |
| 3 | `omni update` changes break existing install flows | Upgrade failures in user environments | Keep installers untouched; wrapper delegates to existing script behavior |
| 4 | Jenkins pipeline regressions | Delivery disruption | Introduce additive stage only; no destructive changes; verify on current jobs |
| 5 | Track confusion (`main` vs `dev`) | Users unintentionally switch channels | Persist `updateChannel` in config and show it in `omni --version`/`status` |

---

## Success Definition

- `omni --version` shows CLI version stamp and, when available, concise server comparison.
- `omni status` shows one-line actionable hint when update exists or mismatch is detected.
- `omni update` works reliably with git-based source flow:
  - default updates from `main`
  - `--dev` updates from `dev`
- Existing installer scripts continue to work unchanged.
- Jenkins automations continue passing with added version artifact step.
- Operators report clearer, lower-friction update/compatibility workflow.

---

## Next Step

Run `/wish` to convert this design into an executable plan.
