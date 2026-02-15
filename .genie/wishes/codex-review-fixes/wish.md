# Wish: Codex Review Fixes — Runtime Bugs + CI/Release Safety

**Status:** DONE
**Slug:** `codex-review-fixes`
**Created:** 2026-02-15

---

## Summary

Fix 4 P1 and 2 P2 issues from Codex review: dispatcher shutdown timeout leak, unreliable response headers in 3 Hono middleware files, version workflow tagging unvalidated code, and release workflow tagging unreachable code. Also pin GitHub Actions to commit SHAs for supply-chain hardening.

---

## Scope

### IN
- Fix dispatcher shutdown timeout leak with `try/finally` + `clearTimeout` (agent-dispatcher.ts)
- Move response headers to after `await next()` in version-headers.ts, context.ts, and rate-limit.ts
- Fix version.yml to checkout CI-validated SHA via explicit conditional expression
- Fix release.yml to verify tag ancestry with `::error::` annotation and explicit `refs/heads/main`
- Pin `actions/checkout` and `oven-sh/setup-bun` to commit SHAs in both workflow files

### OUT
- No new features or behavioral changes beyond the fixes
- No CI workflow (ci.yml) action pinning (follow-up)
- No binary integrity checks for NATS/bun downloads (follow-up)
- No anomalous tagging alerts (follow-up)
- No hotfix escape hatch documentation (follow-up)
- No test infrastructure changes

---

## Decisions

- **DEC-1:** Use `try/finally` for timeout cleanup, not `.then()`. The `.then()` microtask isn't guaranteed to run before `Promise.race` resolves. `finally` is synchronous after the awaited promise settles.
- **DEC-2:** Fix all 3 middleware files with the same header bug (version-headers, context, rate-limit), not just the one Codex flagged. Architect council member identified the pattern — fixing only one creates inconsistency.
- **DEC-3:** Use explicit `event_name == 'workflow_run' && head_sha || 'dev'` conditional in version.yml. More robust than bare `||` for GHA expressions.
- **DEC-4:** Ancestry check uses `::error::` annotation + `skip=true` (not `exit 1`). Visible in GHA UI without marking the entire workflow run as failed.
- **DEC-5:** Use `refs/heads/main` instead of ambiguous `HEAD` in release.yml ancestry check. Avoids detached HEAD edge cases in CI runners.
- **DEC-6:** Accept that SSE/streaming endpoints and error responses won't get post-`next()` headers. Low impact — version/rate-limit headers on streams are nice-to-have.

---

## Success Criteria

- [ ] `make check` passes with no "Dispatcher shutdown timed out" spurious warning
- [ ] Version response headers present on all successful JSON API responses
- [ ] `x-request-id` header present on all successful responses
- [ ] Rate-limit headers present on rate-limited endpoint responses
- [ ] version.yml checks out CI-validated SHA (verified by reading workflow file)
- [ ] release.yml fails with `::error::` when dev tag isn't ancestor of main HEAD
- [ ] All actions pinned to full commit SHAs in both workflow files
- [ ] No functional regressions — all existing tests pass

---

## Assumptions

- **ASM-1:** Hono middleware post-`next()` header-setting works correctly on the final `c.res` for standard JSON responses. This is the documented Hono pattern.
- **ASM-2:** `github.event.workflow_run.head_sha` accurately reflects the commit that CI validated in the triggering run.
- **ASM-3:** The pinned SHA for `actions/checkout@v4` (34e11487...) and `oven-sh/setup-bun@v2` (3d267786...) are the current tag targets as of 2026-02-15.

## Risks

- **RISK-1:** SSE/streaming endpoints miss post-next headers — Mitigation: documented as known limitation, low impact
- **RISK-2:** Error responses miss version/request-id headers — Mitigation: acceptable tradeoff, errors have their own context
- **RISK-3:** Pinned SHAs go stale over time — Mitigation: version tag comments enable Dependabot tracking
- **RISK-4:** Ancestry check blocks legitimate hotfix cherry-picks — Mitigation: correct for our dev→main workflow; workflow_dispatch escape hatch can be added later
- **RISK-5:** rate-limit 429 early-return skips post-next headers — Mitigation: 429 response is created directly via `c.json()`, rate-limit headers need to be set on that response too (handled in implementation)

---

## Execution Groups

### Group A: Runtime Fixes (agent-dispatcher + middleware)

**Goal:** Fix the two runtime correctness bugs — dispatcher timeout leak and response headers lost on replacement.

**Deliverables:**
- `agent-dispatcher.ts`: Wrap `Promise.race` in `try/finally`, call `clearTimeout` in `finally` block
- `version-headers.ts`: Move `x-omni-server-version`, `x-omni-server-commit`, `x-omni-version-mismatch` headers to after `await next()`
- `context.ts`: Move `x-request-id` header to after `await next()`
- `rate-limit.ts`: Move `X-RateLimit-*` headers to after `await next()`, keep 429 early-return path as-is

**Acceptance Criteria:**
- [ ] `make check` passes cleanly (no spurious timeout warning)
- [ ] `make typecheck` passes
- [ ] `make lint` passes
- [ ] Existing API tests pass with no regressions

**Validation:** `make check`

---

### Group B: CI/Release Workflow Fixes

**Goal:** Fix version and release workflows to tag validated code and harden supply chain.

**Deliverables:**
- `version.yml`: Pin `actions/checkout` and `oven-sh/setup-bun` to commit SHAs; change checkout ref to explicit conditional `github.event_name == 'workflow_run' && github.event.workflow_run.head_sha || 'dev'`
- `release.yml`: Pin `actions/checkout` to commit SHA; add ancestry check using `git merge-base --is-ancestor` with `refs/heads/main` and `::error::` annotation; restructure "Get latest dev tag" step

**Acceptance Criteria:**
- [ ] version.yml uses pinned SHA for actions/checkout (34e114876b0b11c390a56381ad16ebd13914f8d5)
- [ ] version.yml uses pinned SHA for oven-sh/setup-bun (3d267786b128fe76c2f16a390aa2448b815359f3)
- [ ] version.yml checkout ref uses explicit conditional with head_sha
- [ ] release.yml uses pinned SHA for actions/checkout
- [ ] release.yml includes ancestry check with `::error::` annotation
- [ ] release.yml uses `refs/heads/main` (not `HEAD`) in ancestry check
- [ ] YAML syntax is valid (`python3 -c "import yaml; yaml.safe_load(open(f))"` for both files)

**Validation:** `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/version.yml')); yaml.safe_load(open('.github/workflows/release.yml')); print('YAML valid')"` + manual review of diff

---

## Review Results

_Populated by `/review` after execution completes._

---

## Files to Create/Modify

```
packages/api/src/plugins/agent-dispatcher.ts    # try/finally + clearTimeout
packages/api/src/middleware/version-headers.ts   # Headers after next()
packages/api/src/middleware/context.ts           # x-request-id after next()
packages/api/src/middleware/rate-limit.ts        # Rate-limit headers after next()
.github/workflows/version.yml                   # Pin SHAs + head_sha conditional
.github/workflows/release.yml                   # Pin SHAs + ancestry check
```
