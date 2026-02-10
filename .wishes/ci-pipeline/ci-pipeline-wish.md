# WISH: CI/CD Pipeline for Fresh-Environment Validation

> GitHub Actions workflows that catch "works on my machine" bugs by running setup, build, and quality checks on every push and PR.

**Status:** DRAFT
**Created:** 2026-02-10
**Author:** WISH Agent
**Beads:** omni-gt7
**GitHub:** #17

---

## Problem

There is **no CI/CD pipeline** in the repository. Three setup issues (#14, #15, #16) were only discovered when running `make setup` in a fresh environment:

- **#14** — API starts twice (port conflict)
- **#15** — DB schema init runs before PostgreSQL is ready
- **#16** — SDK not built before UI dev server needs it

All are "works on my machine" bugs that CI would catch immediately.

## Assumptions

- **ASM-1**: pgserve (`bunx pgserve`) works in GitHub Actions runners (no external Postgres needed)
- **ASM-2**: NATS binary can be downloaded in CI via `ensure-nats.sh` (Linux amd64)
- **ASM-3**: PM2 can manage services in CI the same way as local dev
- **ASM-4**: Default `.env.example` values are sufficient for CI (no secrets needed for smoke test)

## Decisions

- **DEC-1**: Use pgserve + downloaded NATS binary in CI (same as local dev) — no Docker services
- **DEC-2**: Single workflow file `.github/workflows/ci.yml` with parallel jobs
- **DEC-3**: Cache `node_modules`, `bin/` (NATS binary), and `.pgserve-data` between runs
- **DEC-4**: Run on push to `main` and all PRs
- **DEC-5**: Branch protection configuration is OUT OF SCOPE (manual GitHub settings step)

## Risks

- **RISK-1**: pgserve may behave differently on GitHub Actions Ubuntu runners vs WSL2 — **Mitigation:** smoke test catches this immediately on first run
- **RISK-2**: NATS download could be rate-limited in CI — **Mitigation:** cache the `bin/` directory between runs
- **RISK-3**: PM2 process startup timing may differ in CI — **Mitigation:** `_init-db-wait` already retries up to 15 times with 2s intervals

---

## Scope

### IN SCOPE

- GitHub Actions workflow file (`.github/workflows/ci.yml`)
- Three parallel CI jobs: quality gate, build validation, smoke test
- Bun + NATS binary caching
- Documentation of required branch protection settings

### OUT OF SCOPE

- Docker/container-based CI
- Deployment pipelines (staging, production)
- GitHub branch protection rule configuration (manual step, documented)
- UI E2E tests (Playwright)
- Secret management / external service integration

---

## Impact Analysis

### Packages Affected

| Package | Changes | Notes |
|---------|---------|-------|
| (root) | `.github/workflows/ci.yml` | New workflow file |
| (root) | Makefile (possibly) | CI-specific target if needed |

No application code changes. This is purely CI infrastructure.

### System Checklist

- [ ] **Events**: No changes
- [ ] **Database**: No schema changes
- [ ] **SDK**: No changes
- [ ] **CLI**: No changes
- [ ] **Tests**: Existing tests run in CI, no new tests needed

---

## Execution Groups

### Group A: CI Workflow

**Goal:** Create a GitHub Actions workflow that validates the project on every push/PR with three parallel jobs.

**Files:**
- `.github/workflows/ci.yml` (new)

**Deliverables:**

#### Job 1: Quality Gate (`make check`)
- [ ] Install Bun
- [ ] `bun install`
- [ ] Build SDK + CLI dist (`_build-dist` dependency)
- [ ] Run `make typecheck`
- [ ] Run `make lint`
- [ ] Run `make test` (with pgserve + NATS running for DB tests)

#### Job 2: Build Validation
- [ ] `bun install`
- [ ] `bun run build` (turbo build — validates dependency order)
- [ ] Verify `packages/sdk/dist` exists
- [ ] Verify `packages/cli/dist` exists

#### Job 3: Smoke Test (Fresh Environment)
- [ ] `bun install`
- [ ] Copy `.env.example` to `.env`
- [ ] `make ensure-nats` (download NATS binary)
- [ ] Start pgserve + NATS via PM2 (`make dev-services`)
- [ ] Wait for PostgreSQL readiness (`_init-db-wait` pattern)
- [ ] `make db-push` (initialize schema)
- [ ] Build SDK (`_build-dist`)
- [ ] Start API in background
- [ ] `curl --fail http://localhost:8882/api/v2/health`
- [ ] Verify single process on port 8882 (catches #14)

#### Caching Strategy
- [ ] Cache `~/.bun/install/cache` (bun packages)
- [ ] Cache `bin/` (NATS binary, ~20MB)
- [ ] Cache `node_modules` (keyed on lockfile hash)

**Acceptance Criteria:**
- [ ] Workflow runs on push to `main` and on PRs
- [ ] All three jobs run in parallel
- [ ] Fresh `bun install` + service startup works in CI
- [ ] Health endpoint returns 200 after startup
- [ ] `make check` passes (typecheck + lint + test)
- [ ] `bun run build` succeeds with correct dependency order
- [ ] Workflow completes in < 5 minutes (target)
- [ ] Caching reduces subsequent run times

**Validation:**
```bash
# Push to a test branch and verify:
# 1. All three jobs appear in GitHub Actions
# 2. All three jobs pass
# 3. Cached runs are faster than first run
gh run list --limit 3
gh run view <id>
```

---

## Post-Ship (Manual Steps)

After the workflow is green:

1. **Enable branch protection** on `main`:
   - Require status checks to pass before merging
   - Required checks: `quality-gate`, `build-validation`, `smoke-test`
2. **Add status badge** to README (optional)

---

## Reference: Current Local Dev Flow

```
make setup
  ├── check-deps          # Verify bun, pm2, etc.
  ├── install
  │   ├── bun install
  │   ├── cp .env.example .env
  │   └── drizzle-kit push (may skip if no DB)
  ├── dev-services
  │   ├── ensure-nats.sh  # Download NATS binary
  │   └── pm2 start       # pgserve + NATS
  ├── _init-db-wait       # Retry DB init up to 15x
  ├── _build-dist         # Build SDK + CLI
  └── bun run dev         # turbo dev (API + UI)
```

The CI smoke test mirrors this flow minus `bun run dev` (replaced with targeted health check).
