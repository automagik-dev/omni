# WISH: Automated Versioning Pipeline

> Every commit to dev auto-versions and tags. Every merge to main creates a GitHub Release with auto-generated notes. Zero human ceremony.

**Status:** IMPLEMENTED
**Created:** 2026-02-15
**Author:** WISH Agent
**Beads:** N/A

---

## Problem

Versioning is manual and inconsistent. 12 package.json files have 7 different version strings (`2.0.0`, `2.0.0-dev.1`, `0.0.1`, `1.0.0`, `2.2.3`). The existing `generate-version.ts` produces `2.YYYYMMDD.N` but isn't wired to git tags, GitHub Releases, or package.json sync. No changelogs exist. This is an AI-autonomous repo — human-oriented versioning ceremonies (changesets, manual bumps) add friction with zero value.

## Assumptions

- **ASM-1:** Conventional commit prefixes (`feat:`, `fix:`, `test:`, `chore:`) are already used consistently and will continue to be
- **ASM-2:** The repo will continue using `dev` as the working branch with merges to `main` for releases
- **ASM-3:** All packages share a single unified version (monorepo = one product = one version)
- **ASM-4:** The `v` prefix is only for git tags, never in the version string itself

## Decisions

- **DEC-1:** Version format is `2.YYYYMMDD.N` where N = count of `v2.YYYYMMDD.*` tags that day + 1. Derived from git tags, no state files needed.
- **DEC-2:** On push to `dev` (after quality gate passes): tag `v2.YYYYMMDD.N-dev`, sync all package.json files
- **DEC-3:** On push to `main` (PR merge): tag `v2.YYYYMMDD.N`, create GitHub Release with auto-generated notes grouped by commit type
- **DEC-4:** `version.json` is generated at build time (not committed) — tags are the source of truth
- **DEC-5:** Bot commits (package.json sync) use `[skip ci]` to prevent infinite loops
- **DEC-6:** `audio-decode-shim` is excluded from version sync (it's a vendored fork with its own version)

## Risks

- **RISK-1:** Rebased/squashed history could change tag count → mitigated by counting existing tags, not commits
- **RISK-2:** Bot commit loop → mitigated by `[skip ci]` in commit message and `if` guard on workflow
- **RISK-3:** Failed CI on dev could tag broken code → mitigated by running version step AFTER quality gate passes
- **RISK-4:** Multiple rapid pushes same day → each gets unique N, no collision since tag check is atomic in CI

---

## Scope

### IN SCOPE

- GitHub Actions workflow: auto-tag on dev push (after CI passes)
- GitHub Actions workflow: auto-release on main push
- Script: `scripts/sync-versions.ts` — updates all package.json files to match a given version
- Script: update `scripts/generate-version.ts` to derive build number from git tags
- Release notes auto-generation grouped by conventional commit type
- Sync all 13 package.json versions (root + 11 packages + 1 app, excluding audio-decode-shim)

### OUT OF SCOPE

- NPM publishing (packages are private)
- Docker image tagging (not yet containerized)
- Changelog file committed to repo (GitHub Releases are the changelog)
- Per-package independent versioning
- Breaking change detection / major version bumps (manual, rare)

---

## Impact Analysis

### Packages Affected
| Package | Changes | Notes |
|---------|---------|-------|
| root | package.json version sync | Unified version |
| core | package.json version sync | Unified version |
| api | package.json version sync | Unified version |
| db | package.json version sync | Unified version |
| sdk | package.json version sync | Unified version |
| cli | package.json version sync | Unified version |
| channel-sdk | package.json version sync | Unified version |
| channel-whatsapp | package.json version sync | Unified version |
| channel-discord | package.json version sync | Unified version |
| channel-telegram | package.json version sync | Unified version |
| media-processing | package.json version sync | Unified version |
| apps/ui | package.json version sync | Unified version |
| audio-decode-shim | **EXCLUDED** | Vendored fork, own version |

### System Checklist
- [ ] **Events**: No changes
- [ ] **Database**: No changes
- [ ] **SDK**: No changes
- [ ] **CLI**: Version detection already reads version.json, no changes needed
- [ ] **Tests**: Test the sync script, test version derivation
- [ ] **CI**: New workflow files

---

## Execution Group A: Version Scripts

**Goal:** Create the scripts that derive version from tags and sync package.json files

**Packages:** scripts/

**Deliverables:**
- [ ] Update `scripts/generate-version.ts` to derive build number from git tags (`v2.YYYYMMDD.*` count)
- [ ] Create `scripts/sync-versions.ts` — takes a version string, updates all 13 package.json files (excluding audio-decode-shim)
- [ ] `make version` still works locally (falls back to build 1 if no tags exist)
- [ ] Add `make sync-versions` target

**Acceptance Criteria:**
- [ ] `bun scripts/generate-version.ts` produces correct version based on existing tags
- [ ] `bun scripts/sync-versions.ts 2.20260215.3` updates all 13 package.json files
- [ ] audio-decode-shim version is untouched
- [ ] Scripts work in CI (ubuntu-latest) and locally (macOS/Linux)

**Validation:**
```bash
bun scripts/generate-version.ts
bun scripts/sync-versions.ts 2.20260215.1
grep '"version"' packages/*/package.json apps/*/package.json package.json
```

---

## Execution Group B: CI Workflows

**Goal:** GitHub Actions that auto-tag dev pushes and auto-release main merges

**Packages:** .github/workflows/

**Deliverables:**
- [ ] `.github/workflows/version.yml` — triggers on push to `dev` after quality gate, creates `v{version}-dev` tag, syncs package.json, pushes bot commit
- [ ] `.github/workflows/release.yml` — triggers on push to `main`, creates `v{version}` tag, generates release notes from commits since last release, creates GitHub Release
- [ ] Bot commit uses `[skip ci]` to prevent loops
- [ ] Release notes grouped by type: Features, Fixes, Tests, Other

**Acceptance Criteria:**
- [ ] Push to `dev` → new `v2.YYYYMMDD.N-dev` tag appears in repo
- [ ] All package.json files updated to matching version
- [ ] Merge `dev → main` → GitHub Release created with grouped release notes
- [ ] No infinite CI loops from bot commits
- [ ] Manual `workflow_dispatch` available for re-running if needed

**Validation:**
```bash
# After push to dev:
git tag --list 'v2.*-dev' | tail -5

# After merge to main:
gh release list --limit 5
gh release view v2.YYYYMMDD.N
```

---

## Version Flow Diagram

```
Developer/AI pushes to dev
  │
  ├─ CI: quality-gate job (existing)
  │   ├─ typecheck
  │   ├─ lint
  │   └─ test
  │
  └─ CI: version job (NEW, needs: quality-gate)
      ├─ derive version: count v2.YYYYMMDD.* tags → N+1
      ├─ generate version.json
      ├─ sync all package.json files
      ├─ commit "[skip ci] version: 2.YYYYMMDD.N"
      ├─ tag v2.YYYYMMDD.N-dev
      └─ push commit + tag

PR merge dev → main
  │
  └─ CI: release job (NEW)
      ├─ read version from latest dev tag (strip -dev)
      ├─ tag v2.YYYYMMDD.N
      ├─ collect commits since last release tag
      ├─ group by type (feat/fix/test/chore)
      └─ gh release create with grouped notes
```
