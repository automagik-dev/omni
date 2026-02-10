# WISH: Fix UI Typecheck Errors (Pre-Existing)

> Fix the Dashboard.tsx typecheck errors that block `make typecheck` and the husky pre-push hook, preventing all pushes from succeeding without `--no-verify`.

**Status:** SHIPPED
**Created:** 2026-02-10
**Author:** Omni (requested by Felipe)
**Priority:** P0 (blocks all pushes)
**Branch:** `fix/ui-typecheck`

---

## Context

The `apps/ui` package has 4 typecheck errors in `Dashboard.tsx` that cause `make typecheck` to fail. Since the husky pre-push hook runs `make typecheck`, this blocks ALL git pushes across the entire monorepo unless `--no-verify` is used.

### Errors

1. `TS2305: Module '"@omni/sdk"' has no exported member 'EventAnalytics'`
2. `TS2305: Module '"@omni/sdk"' has no exported member 'EventMetrics'`
3. `TS2339: Property 'analytics' does not exist on type '{ list(...): ... }'` (events namespace)
4. `TS7006: Parameter 'bucket' implicitly has an 'any' type`

### Root Cause

The SDK (`packages/sdk`) exports `EventAnalytics` and `EventMetrics` from `src/index.ts` and `src/client.ts`, but:
- The UI's `tsconfig.json` uses `moduleResolution: "bundler"` which resolves `@omni/sdk` via `dist/`
- The `dist/` directory contains stale types (generated from an older OpenAPI spec that didn't have these schemas)
- The `events.analytics()` method exists in SDK source but isn't in the stale dist types

## Success Criteria

- [ ] `bun run --cwd apps/ui typecheck` passes with 0 errors
- [ ] `make typecheck` passes (all 11 packages, 0 failures)
- [ ] `git push` works without `--no-verify`
- [ ] Dashboard.tsx renders correctly with metrics/analytics data

## Scope

### IN Scope
- Fix the 4 typecheck errors in Dashboard.tsx
- Rebuild SDK dist types if needed
- Ensure UI tsconfig properly resolves SDK types

### OUT of Scope
- Adding new Dashboard features
- Refactoring the Dashboard component
- Changing the SDK's public API
- Fixing any non-typecheck UI issues

## Decisions

1. **Approach: Rebuild SDK + verify type exports** — The types exist in source, the dist is stale. Rebuilding should fix it. If dist rebuild doesn't help (because the OpenAPI spec is missing the schemas), we fall back to adding the types inline or regenerating the SDK from the current API spec.
2. **If analytics endpoint doesn't exist in API yet** — Remove the analytics query from Dashboard.tsx and the type imports (comment with TODO). Don't add phantom features.

---

## Execution Groups

### Group 1: Diagnose and Fix SDK Types
**Dependencies:** None
**Risk:** Low
**Estimated time:** 10-15 minutes

#### Tasks

1. **Rebuild SDK types**: Run `bun run --cwd packages/sdk build` to regenerate `dist/`
2. **Check if EventAnalytics/EventMetrics are in dist/index.d.ts** after rebuild
3. **If missing from dist**: Check if the OpenAPI spec includes analytics/metrics endpoints. If not, regenerate: `make sdk-generate`
4. **If still missing**: The API endpoints might not exist yet → remove the imports and analytics query from Dashboard.tsx, replace with TODO comments

#### Acceptance Criteria
- [ ] `EventAnalytics` and `EventMetrics` types resolve from `@omni/sdk` in UI context
- [ ] `events.analytics()` method exists on SDK client type
- [ ] `bucket` parameter has proper type annotation (not `any`)

#### Validation
```bash
bun run --cwd apps/ui typecheck
# Expected: 0 errors
```

### Group 2: Verify Full Pipeline
**Dependencies:** Group 1
**Risk:** None

#### Tasks
1. Run `make typecheck` — all 11 packages must pass
2. Run `make lint` — 0 errors (warnings OK)
3. Test `git push` works without `--no-verify`

#### Acceptance Criteria
- [ ] `make typecheck` → 11/11 pass
- [ ] `make lint` → 0 errors
- [ ] `git push` succeeds normally

#### Validation
```bash
make typecheck && make lint
# Expected: all pass
```
