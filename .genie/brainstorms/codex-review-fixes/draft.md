# Brainstorm: Codex Review Fixes — Runtime Bugs + CI/Release Safety

**Status**: Ready to crystallize
**WRS**: 100/100

## Problem Statement

Codex review surfaced 4x P1 and 2x P2 issues spanning runtime correctness and CI/release integrity. All confirmed against source.

## Scope

### IN
1. Fix dispatcher shutdown timeout leak (agent-dispatcher.ts)
2. Fix version headers middleware ordering (version-headers.ts)
3. Fix version.yml to checkout CI-validated SHA
4. Fix release.yml to verify tag ancestry before releasing
5. Pin actions/checkout and oven-sh/setup-bun to commit SHAs in both workflows

### OUT
- No new features
- No refactoring beyond the fixes
- No test infrastructure changes (existing tests cover the runtime fixes)

## Decisions

### Fix 1: Dispatcher shutdown timeout (agent-dispatcher.ts:2269-2277)

**Approach**: Save the timeout ID, clear it when `allCleanup` resolves.

```typescript
const timeoutId = setTimeout(() => { ... }, 5_000);
const allCleanup = Promise.allSettled([...disposePromises, ...clientStopPromises]);
allCleanup.then(() => clearTimeout(timeoutId));
await Promise.race([allCleanup, timeoutGuard]);
```

**Rationale**: Simplest fix — doesn't change the race semantics, just ensures cleanup of the timer.

### Fix 2: Version headers middleware (version-headers.ts:92-101)

**Approach**: Move header-setting to AFTER `await next()`, so it writes to the final `c.res`.

```typescript
export const versionHeadersMiddleware = createMiddleware(async (c, next) => {
  const cliVersion = c.req.header('x-omni-cli-version');
  await next();
  c.res.headers.set('x-omni-server-version', SERVER_VERSION_INFO.version);
  c.res.headers.set('x-omni-server-commit', SERVER_VERSION_INFO.commit);
  if (cliVersion && cliVersion !== SERVER_VERSION_INFO.version) {
    c.res.headers.set('x-omni-version-mismatch', 'true');
  }
});
```

**Rationale**: In Hono, middleware that needs to decorate the response must do so after `next()` returns, since downstream handlers may replace `c.res`. Reading the request header before `next()` is fine.

### Fix 3: Version workflow SHA checkout (version.yml:28-31)

**Approach**: Use `github.event.workflow_run.head_sha` for workflow_run triggers, fall back to `ref: dev` for workflow_dispatch.

```yaml
- uses: actions/checkout@<pinned-sha>
  with:
    ref: ${{ github.event.workflow_run.head_sha || 'dev' }}
    fetch-depth: 0
    token: ${{ secrets.GITHUB_TOKEN }}
```

**Rationale**: This ensures we tag the exact commit that CI validated, while preserving manual dispatch capability.

### Fix 4: Release workflow ancestry check (release.yml:27-42)

**Approach**: After finding the latest dev tag, verify it's an ancestor of the current main HEAD.

```bash
DEV_TAG_COMMIT=$(git rev-list -n 1 "$DEV_TAG")
if ! git merge-base --is-ancestor "$DEV_TAG_COMMIT" HEAD; then
  echo "Dev tag $DEV_TAG is not an ancestor of main HEAD, skipping"
  echo "skip=true" >> "$GITHUB_OUTPUT"
  exit 0
fi
```

**Rationale**: Prevents minting releases for code that hasn't been merged to main yet.

### Fix 5+6: Pin actions to commit SHAs

**Pinned SHAs** (resolved via `git ls-remote`):
- `actions/checkout@v4` → `actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5`
- `oven-sh/setup-bun@v2` → `oven-sh/setup-bun@3d267786b128fe76c2f16a390aa2448b815359f3`

Both version.yml and release.yml get pinned with `# v4` / `# v2` inline comments.

## Risks

| Risk | Mitigation |
|------|-----------|
| version.yml `head_sha` field might be empty on workflow_dispatch | `\|\|` fallback to `'dev'` handles this |
| Pinned SHAs go stale over time | Comments with version tags make updates easy; Dependabot can track |
| Release ancestry check could block legitimate releases | Only blocks when dev tags haven't been merged — correct behavior |
| Version headers after next() could interact with error middleware | Error middleware returns before version middleware's post-next runs — headers just won't be set on error responses, which is acceptable |

## Acceptance Criteria

1. `make check` passes with no "Dispatcher shutdown timed out" warning
2. Version response headers (`x-omni-server-version`, `x-omni-server-commit`) present on all successful API responses
3. version.yml checks out CI-validated SHA (visible in workflow run logs)
4. release.yml skips when latest dev tag isn't an ancestor of main HEAD
5. All actions pinned to full commit SHAs in both workflow files
6. No functional regressions — all existing tests pass
