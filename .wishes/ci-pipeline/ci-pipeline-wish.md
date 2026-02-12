# WISH: CI/CD Pipeline for Fresh-Environment Validation

> GitHub Actions workflows that catch "works on my machine" bugs by running setup, build, and quality checks on every push and PR.

**Status:** APPROVED
**Created:** 2026-02-10
**Updated:** 2026-02-12
**Author:** WISH Agent
**Beads:** omni-gt7
**GitHub:** #17

---

## Problem

The CI pipeline exists (`.github/workflows/ci.yml`) but is **incomplete**. It has a single quality-gate job that runs typecheck, lint, and test — but **136 out of 297 tests are silently skipped** because there's no database in CI.

The original motivation was catching fresh-environment issues (#14, #15, #16). The smoke test job — the core value of this wish — was never implemented.

### Current State (as of 2026-02-12)

| What | Status |
|------|--------|
| Quality Gate job | Exists, but 136 tests skip (no DB) |
| Build Validation job | Missing |
| Smoke Test job | Missing |
| Caching | None (re-downloads everything) |
| Run time | ~1m15s (only 1 job) |

---

## Assumptions

- **ASM-1**: pgserve (`bunx pgserve`) works on GitHub Actions Ubuntu runners — **validated partially**: pgserve is a bun package that embeds PostgreSQL, no native deps needed
- **ASM-2**: NATS binary can be downloaded in CI via `ensure-nats.sh` (Linux amd64) — **high confidence**: standard curl + tar from GitHub releases
- **ASM-3** ~~PM2 in CI~~: **REVISED** — Skip PM2 in CI entirely. Start processes directly with `&` (background). Simpler, fewer deps, faster.
- **ASM-4**: Default `.env.example` values are sufficient for CI (no secrets needed) — **confirmed**: .env.example uses localhost with default credentials

## Decisions

- **DEC-1**: Use pgserve + downloaded NATS binary in CI (same as local dev) — no Docker services
- **DEC-2**: Single workflow file `.github/workflows/ci.yml` with parallel jobs
- **DEC-3**: Cache bun packages and NATS binary between runs
- **DEC-4**: Run on push to `main`/`dev` and all PRs (current behavior, keep it)
- **DEC-5**: Branch protection configuration is OUT OF SCOPE (manual GitHub settings step)
- **DEC-6** (NEW): **No PM2 in CI** — start pgserve and NATS directly as background processes. CI doesn't need process management, just process launch.
- **DEC-7** (NEW): **Two jobs, not three** — merge build validation into quality gate. Build already runs as a turbo dependency of typecheck. Just add dist/ verification as a step. Smoke test remains separate.

## Risks

- **RISK-1**: pgserve may behave differently on GitHub Actions Ubuntu runners vs WSL2 — **Mitigation:** smoke test catches this immediately on first run; pgserve is pure-bun with embedded PG
- **RISK-2**: NATS download could be rate-limited in CI — **Mitigation:** cache the `bin/` directory between runs
- **RISK-3** ~~PM2 timing~~: **Eliminated** by DEC-6 (no PM2 in CI)
- **RISK-4** (NEW): pgserve startup time in CI may be slower than local — **Mitigation:** retry loop (`_init-db-wait` pattern) with 15 attempts × 2s = 30s max wait

---

## Scope

### IN SCOPE

- Update `.github/workflows/ci.yml` (existing file)
- Two parallel CI jobs: quality gate (with DB), smoke test
- pgserve + NATS as direct background processes (no PM2)
- Bun + NATS binary caching via `actions/cache`
- dist/ output verification in quality gate

### OUT OF SCOPE

- Docker/container-based CI
- Deployment pipelines (staging, production)
- GitHub branch protection rule configuration (manual step, documented)
- UI E2E tests (Playwright)
- Secret management / external service integration
- PM2 installation in CI

---

## Impact Analysis

### Packages Affected

| Package | Changes | Notes |
|---------|---------|-------|
| (root) | `.github/workflows/ci.yml` | Update existing workflow |

No application code changes. This is purely CI infrastructure.

### System Checklist

- [x] **Events**: No changes
- [x] **Database**: No schema changes (pgserve is infra only)
- [x] **SDK**: No changes
- [x] **CLI**: No changes
- [x] **Tests**: Existing tests — currently skipped ones should now PASS with DB available

---

## Execution Groups

### Group A: Complete CI Workflow

**Goal:** Update the existing CI workflow to run all tests (including DB-dependent) and add a smoke test job that validates the fresh-environment setup flow.

**Files:**
- `.github/workflows/ci.yml` (update)

---

#### Job 1: Quality Gate (typecheck + lint + test + build verification)

Updates the existing job to include a database and verify build outputs.

**Steps:**
1. Checkout + setup Bun
2. Cache bun packages (`~/.bun/install/cache`, keyed on `bun.lock`)
3. Cache NATS binary (`bin/`, keyed on NATS version)
4. `bun install`
5. `cp .env.example .env`
6. Download NATS: `./scripts/ensure-nats.sh`
7. Start pgserve: `bunx pgserve --port 8432 --data .pgserve-data --no-cluster &`
8. Start NATS: `./bin/nats-server -js -p 4222 &`
9. Wait for DB: retry `drizzle-kit push --force` up to 15 times with 1s sleep
10. `bun run build` (turbo build — all packages)
11. Verify `packages/sdk/dist` exists
12. Verify `packages/cli/dist` exists
13. `bun run typecheck`
14. `bunx biome check .`
15. `bun test --env-file=.env`

**Key changes from current:**
- Steps 5-9 are NEW (DB + NATS infrastructure)
- Steps 11-12 are NEW (build output verification)
- Tests should now report **~297 pass, ~0 skip** instead of **161 pass, 136 skip**

---

#### Job 2: Smoke Test (Fresh Environment)

Validates the full `make setup` → health check flow in a clean environment. This is the core value of the wish.

**Steps:**
1. Checkout + setup Bun
2. Cache bun packages (same key as Job 1)
3. Cache NATS binary (same key as Job 1)
4. `bun install`
5. `cp .env.example .env`
6. Download NATS: `./scripts/ensure-nats.sh`
7. Start pgserve: `bunx pgserve --port 8432 --data .pgserve-data --no-cluster &`
8. Start NATS: `./bin/nats-server -js -p 4222 &`
9. Wait for DB: retry `drizzle-kit push --force` up to 15 times with 1s sleep
10. Build all: `bun run build`
11. Start API in background:
    ```bash
    OMNI_PACKAGES_DIR=$PWD/packages bun packages/api/src/index.ts &
    ```
12. Wait for API: retry `curl --fail http://localhost:8882/api/v2/health` up to 15 times
13. Verify health response is valid JSON with `status: "ok"` or similar
14. Verify single process on port 8882: `lsof -ti:8882 | wc -l` equals 1 (catches #14)

---

#### Caching Strategy

```yaml
# Bun packages (shared across jobs)
- uses: actions/cache@v4
  with:
    path: ~/.bun/install/cache
    key: bun-${{ runner.os }}-${{ hashFiles('bun.lock') }}

# NATS binary (shared across jobs)
- uses: actions/cache@v4
  with:
    path: bin/
    key: nats-${{ runner.os }}-v2.10.24
```

---

### Acceptance Criteria

- [ ] Workflow runs on push to `main`/`dev` and on PRs
- [ ] Both jobs run in parallel
- [ ] Quality gate runs ALL tests (0 skips for DB-related reasons)
- [ ] Quality gate verifies `sdk/dist` and `cli/dist` exist
- [ ] Smoke test starts pgserve + NATS without PM2
- [ ] Smoke test health endpoint returns 200
- [ ] Smoke test verifies single process on API port
- [ ] Workflow completes in < 5 minutes (target)
- [ ] Caching reduces subsequent run times
- [ ] Concurrency control cancels superseded runs (already exists)

### Validation

```bash
# Push to a test branch and verify:
git checkout -b ci/complete-pipeline
# ... make changes ...
git push -u origin ci/complete-pipeline

# 1. Both jobs appear in GitHub Actions
gh run list --limit 3

# 2. Quality gate: check test counts (should be ~297 pass, 0 skip)
gh run view <id> --log | grep -E "pass|skip|fail"

# 3. Smoke test: check health check passed
gh run view <id> --log | grep "health"

# 4. Verify caching works on second push
git commit --allow-empty -m "test cache"
git push
# Second run should be faster
```

---

## Post-Ship (Manual Steps)

After the workflow is green:

1. **Enable branch protection** on `main`:
   - Require status checks to pass before merging
   - Required checks: `quality-gate`, `smoke-test`
2. **Add status badge** to README (optional)
3. **Monitor first few runs** — watch for pgserve/NATS startup issues on GitHub runners

---

## Reference: CI vs Local Dev

```
Local (make dev):                    CI Quality Gate:
  dev-services (PM2)                   pgserve & (background)
    ├── pgserve                        nats-server & (background)
    └── nats-server                    drizzle-kit push (retry loop)
  _init-db-wait                        bun run build
  _build-dist                          typecheck + lint + test
  bun run dev                          (exit)

                                     CI Smoke Test:
                                       pgserve & (background)
                                       nats-server & (background)
                                       drizzle-kit push (retry loop)
                                       bun run build
                                       bun api/src/index.ts & (background)
                                       curl health endpoint
                                       verify single process on port
                                       (exit)
```

Key difference: CI uses direct background processes (`&`), local dev uses PM2.
