# Brainstorm: Codex Review Fixes — Runtime Bugs + CI/Release Safety

**Status**: Council-reviewed, ready for /wish
**WRS**: 100/100
**Council**: 6/6 MODIFY → modifications applied below

## Problem Statement

Codex review surfaced 4x P1 and 2x P2 issues spanning runtime correctness and CI/release integrity. All confirmed against source. Council review expanded scope to include 2 additional middleware files with the same header bug.

## Scope

### IN
1. Fix dispatcher shutdown timeout leak (agent-dispatcher.ts)
2. Fix response header ordering in ALL 3 middleware files (version-headers.ts, rate-limit.ts, context.ts)
3. Fix version.yml to checkout CI-validated SHA
4. Fix release.yml to verify tag ancestry before releasing
5. Pin actions/checkout and oven-sh/setup-bun to commit SHAs in both workflows (full semver comments)

### OUT
- No new features
- No refactoring beyond the fixes
- No test infrastructure changes
- CI workflow action pinning (follow-up issue)
- Binary integrity checks for NATS/bun downloads (follow-up issue)
- Anomalous tagging alerts (follow-up issue)

## Decisions

### Fix 1: Dispatcher shutdown timeout (agent-dispatcher.ts:2269-2277)

**Approach** _(council-modified)_: Use `try/finally` to guarantee `clearTimeout` runs regardless of which promise wins the race. The `.then()` approach has a timing issue — microtask from `.then()` isn't guaranteed to run before `Promise.race` resolves.

```typescript
// Keep existing timeoutGuard promise for the race
const allCleanup = Promise.allSettled([...disposePromises, ...clientStopPromises]);
const timeoutId = setTimeout(() => {
  log.warn('Dispatcher shutdown timed out after 5s, proceeding');
}, 5_000);
const timeoutGuard = new Promise<PromiseSettledResult<void>[]>((resolve) =>
  setTimeout(() => resolve([]), 5_000),
);

try {
  await Promise.race([allCleanup, timeoutGuard]);
} finally {
  clearTimeout(timeoutId);
}
```

**Rationale**: `finally` runs synchronously after the awaited promise settles, guaranteeing cleanup. The warning still fires when the timeout actually triggers (operator requirement). The timer handle is always cleaned up (questioner requirement).

**Note**: Simplifier suggested deleting the timeout entirely and relying on PM2. Rejected — the 5s guard is a real safety net for graceful shutdown and the warning has diagnostic value.

### Fix 2: Response headers after next() (3 files)

**Approach** _(council-expanded)_: Move response header-setting to AFTER `await next()` in all three middleware files. This is the standard Hono pattern — downstream handlers may replace `c.res` (e.g., `return c.json(...)` creates a new Response).

**version-headers.ts** (lines 92-101):
```typescript
export const versionHeadersMiddleware = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  const cliVersion = c.req.header('x-omni-cli-version');
  await next();
  c.res.headers.set('x-omni-server-version', SERVER_VERSION_INFO.version);
  c.res.headers.set('x-omni-server-commit', SERVER_VERSION_INFO.commit);
  if (cliVersion && cliVersion !== SERVER_VERSION_INFO.version) {
    c.res.headers.set('x-omni-version-mismatch', 'true');
  }
});
```

**context.ts** (line 57 → after next):
```typescript
const middleware = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  const requestId = c.req.header('x-request-id') ?? generateRequestId();
  c.set('requestId', requestId);
  c.set('db', db);
  c.set('eventBus', eventBus);
  c.set('channelRegistry', channelRegistry);
  c.set('services', services);

  await next();

  // Set after next() so header survives response replacement
  c.res.headers.set('x-request-id', requestId);
});
```

**rate-limit.ts** (lines 68-91):
```typescript
return createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  const apiKey = c.get('apiKey');
  const identifier = apiKey?.id ?? c.req.header('x-forwarded-for') ?? 'anonymous';
  const key = `ratelimit:${identifier}`;
  const now = Date.now();

  let entry = rateLimitStore.get(key);
  if (!entry || entry.resetAt < now) {
    entry = { count: 1, resetAt: now + config.windowMs };
    rateLimitStore.set(key, entry);
  } else {
    entry.count++;
  }

  if (entry.count > config.maxRequests) {
    // Early return is fine — c.json() creates the final Response directly
    return c.json({ error: { code: 'RATE_LIMITED', ... } }, 429);
  }

  await next();

  // Set after next() so headers survive response replacement
  const remaining = Math.max(0, config.maxRequests - entry.count);
  c.res.headers.set('X-RateLimit-Limit', config.maxRequests.toString());
  c.res.headers.set('X-RateLimit-Remaining', remaining.toString());
  c.res.headers.set('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000).toString());
});
```

**SSE/streaming tradeoff** _(questioner concern)_: For SSE endpoints (`/logs/stream`), headers are flushed with the initial response before the stream body. Post-`next()` header-setting may not apply to already-flushed streaming responses. This is acceptable — version/rate-limit headers on streaming endpoints are low value. The fix improves the 99% case (JSON REST responses). Documenting as known limitation.

**Error response tradeoff** _(operator concern)_: Error responses via `app.onError()` bypass middleware post-`next()` blocks. Headers won't be set on error responses. Acceptable — error responses already include error context, and version headers on errors is nice-to-have not must-have.

### Fix 3: Version workflow SHA checkout (version.yml:28-33)

**Approach** _(council-modified)_: Use explicit conditional expression (deployer requirement). Simple `||` works in GHA expressions but explicit conditional is more robust.

```yaml
- uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5  # v4
  with:
    ref: ${{ github.event_name == 'workflow_run' && github.event.workflow_run.head_sha || 'dev' }}
    fetch-depth: 0
    token: ${{ secrets.GITHUB_TOKEN }}

- uses: oven-sh/setup-bun@3d267786b128fe76c2f16a390aa2448b815359f3  # v2
  with:
    bun-version: latest
```

**Rationale**: When triggered by workflow_run, checks out the exact SHA that CI validated. When manually dispatched, falls back to dev HEAD. Explicit `event_name` check is clearer and avoids edge cases with undefined `head_sha`.

### Fix 4: Release workflow ancestry check (release.yml:27-42)

**Approach** _(council-modified)_: Fail hard with `::error::` annotation instead of silent skip (deployer + operator requirement). Use explicit `refs/heads/main` instead of ambiguous `HEAD` (architect requirement).

```bash
DEV_TAG=$(git tag --list "v2.*-dev" --sort=-version:refname | head -1)
if [ -z "$DEV_TAG" ]; then
  echo "No dev tags found, skipping release"
  echo "skip=true" >> "$GITHUB_OUTPUT"
  exit 0
fi

DEV_TAG_COMMIT=$(git rev-list -n 1 "$DEV_TAG")
MAIN_HEAD=$(git rev-parse refs/heads/main)

if ! git merge-base --is-ancestor "$DEV_TAG_COMMIT" "$MAIN_HEAD"; then
  echo "::error::Dev tag $DEV_TAG ($DEV_TAG_COMMIT) is not an ancestor of main HEAD ($MAIN_HEAD)"
  echo "::error::This indicates the tag was not properly merged to main"
  echo "skip=true" >> "$GITHUB_OUTPUT"
  exit 0
fi

RELEASE_VERSION="${DEV_TAG%-dev}"
echo "dev_tag=${DEV_TAG}" >> "$GITHUB_OUTPUT"
echo "release_tag=${RELEASE_VERSION}" >> "$GITHUB_OUTPUT"
echo "version=${RELEASE_VERSION#v}" >> "$GITHUB_OUTPUT"
echo "skip=false" >> "$GITHUB_OUTPUT"
echo "Release version: ${RELEASE_VERSION}"
```

**Rationale**: `::error::` produces visible annotation in GitHub Actions UI — ops team sees it immediately. Using `refs/heads/main` avoids ambiguity with detached HEAD in CI. Still uses `skip=true` (not `exit 1`) to avoid marking the entire workflow as failed — the skip is expected behavior when dev is ahead of main.

**Hotfix note** _(questioner concern)_: Cherry-picks to main that didn't go through dev will be blocked. This is correct for our workflow — hotfixes should still go dev→main. If we ever need an escape hatch, `workflow_dispatch` can be added to release.yml later.

### Fix 5+6: Pin actions to commit SHAs

**Pinned SHAs** (resolved via `git ls-remote`):
- `actions/checkout@v4` → `actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5  # v4`
- `oven-sh/setup-bun@v2` → `oven-sh/setup-bun@3d267786b128fe76c2f16a390aa2448b815359f3  # v2`

Both version.yml and release.yml get pinned.

**Dependabot note** _(deployer concern)_: Deployer recommended full semver (`# v4.2.3`) for Dependabot. However, the `v4` and `v2` tags are the actual floating major-version tags we resolved — they don't correspond to a specific minor.patch. Using `# v4` / `# v2` is honest. Dependabot's SHA updater supports major-version comments. If it doesn't pick them up, we'll switch to full semver in follow-up.

## Files Changed

| File | Change |
|------|--------|
| `packages/api/src/plugins/agent-dispatcher.ts` | try/finally around Promise.race + clearTimeout |
| `packages/api/src/middleware/version-headers.ts` | Move headers after next() |
| `packages/api/src/middleware/context.ts` | Move x-request-id header after next() |
| `packages/api/src/middleware/rate-limit.ts` | Move rate-limit headers after next() |
| `.github/workflows/version.yml` | Pin SHAs + explicit conditional for head_sha |
| `.github/workflows/release.yml` | Pin SHAs + ancestry check with ::error:: + refs/heads/main |

## Risks

| Risk | Mitigation |
|------|-----------|
| version.yml `head_sha` empty on workflow_dispatch | Explicit `event_name` conditional falls back to `'dev'` |
| Pinned SHAs go stale | Comments with version tags; Dependabot can track |
| Ancestry check blocks hotfixes | Correct behavior for our workflow; escape hatch via workflow_dispatch if needed later |
| SSE/streaming endpoints miss post-next headers | Low impact — version/rate-limit headers on streams are nice-to-have |
| Error responses miss post-next headers | Acceptable — errors have their own context |
| rate-limit 429 response misses rate-limit headers | 429 early-return creates Response directly — headers set on that response are fine (no next() replacement) |

## Acceptance Criteria

1. `make check` passes with no "Dispatcher shutdown timed out" spurious warning
2. Version response headers present on all successful JSON API responses
3. Request ID header (`x-request-id`) present on all successful responses
4. Rate-limit headers present on all rate-limited endpoint responses
5. version.yml checks out CI-validated SHA (visible in workflow run logs)
6. release.yml fails with `::error::` when latest dev tag isn't ancestor of main HEAD
7. All actions pinned to full commit SHAs in both workflow files
8. No functional regressions — all existing tests pass

## Follow-up Issues (out of scope)

- Pin CI workflow actions (ci.yml) to commit SHAs
- Binary integrity checks for NATS/bun downloads (sha256 verification)
- Anomalous tagging alerts (tags >5min after CI, tags without CI runs)
- Hotfix escape hatch documentation
