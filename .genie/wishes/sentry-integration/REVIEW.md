# Review: Sentry Integration Wish Plan

**Reviewer:** Plan Reviewer Agent
**Date:** 2026-03-10
**Wish:** `sentry-integration`

---

## Verdict: **FIX-FIRST**

The plan is exceptionally well-researched with thorough brainstorm context, a comprehensive PII audit, and clear execution groups. The dependency graph is correct and the privacy strategy is solid. However, there are several gaps that must be addressed before implementation to avoid silent PII leaks, broken validation, and missing test coverage.

---

## Plan Review Checklist

- [x] Problem statement is one sentence and testable
- [x] Scope IN has concrete deliverables (13 items)
- [x] Scope OUT is explicit (8 items with rationale)
- [x] Every task has testable acceptance criteria
- [ ] **Tasks are bite-sized and independently shippable** — Group 5 spans 5+ files, should clarify file list
- [x] Dependencies tagged (depends-on / blocks)
- [ ] **Validation commands exist for each execution group** — Groups 2 and 5 have unreliable validation

---

## Gaps Found

### HIGH-1: Group 2 validation uses invalid DSN format

**Severity:** HIGH
**Group:** 2 (SDK Init)

The validation command `SENTRY_DSN=test bun run packages/api/src/index.ts` uses `test` as the DSN, which is not a valid Sentry DSN URL. The SDK will either throw a parse error or silently fail, making it impossible to distinguish "Sentry initialized correctly" from "Sentry errored on bad DSN."

**Fix:** Use a syntactically valid (but non-functional) DSN for validation:
```bash
# Valid format, points nowhere — confirms SDK parses and initializes
SENTRY_DSN=https://test@o0.ingest.sentry.io/0 bun run packages/api/src/index.ts 2>&1 | head -20
```
Or better, add `debug: true` conditionally so Sentry logs its init status, and grep for the init confirmation message.

---

### HIGH-2: Group 2 missing unit test for instrument.ts

**Severity:** HIGH
**Group:** 2 (SDK Init)

`instrument.ts` is the critical privacy configuration file — it wires `beforeSend`, `beforeBreadcrumb`, `beforeSendTransaction`, `beforeSendSpan`, `sendDefaultPii`, and `requestDataIntegration`. There is no test to verify these hooks are configured correctly.

**Fix:** Add a deliverable for `packages/api/src/lib/__tests__/instrument.test.ts` (or extend sentry-scrub tests) that:
- Imports the instrument module and verifies `Sentry.getClient()` returns a configured client when DSN is set
- Verifies `Sentry.getClient()` returns undefined when DSN is absent
- Validates that `sendDefaultPii` is `false`
- Optionally: integration test that sends a mock event through `beforeSend` and confirms scrubbing

---

### HIGH-3: Group 5 guard mechanism `Sentry.isInitialized()` may not exist

**Severity:** HIGH
**Group:** 5 (Tags + Metrics)

The deliverable states "All metric calls guarded: only emit if Sentry is initialized" but `Sentry.isInitialized()` is not a documented Sentry SDK API. The research docs don't mention this method.

**Fix:** Clarify the guard mechanism. Options:
1. `Sentry.getClient()` — returns `undefined` if SDK not initialized (documented API)
2. Check `process.env.SENTRY_DSN` before calling
3. Create a helper: `const sentryEnabled = () => !!Sentry.getClient()`

Specify which approach in the deliverable to avoid implementors guessing.

---

### HIGH-4: Group 1 missing `server_name` scrubbing

**Severity:** HIGH
**Group:** 1 (PII Scrubbing)

The brainstorm doc (DRAFT.md line 70) explicitly lists `server_name` as infrastructure PII to strip. The privacy research (line 121-122) confirms: `delete event.tags.server_name`. But Group 1's `scrubEvent` deliverable does not mention stripping `server_name` from tags.

**Fix:** Add to Group 1's `scrubEvent` function:
- Strip `event.tags.server_name` (hostname leaks infrastructure topology)
- Strip `event.server_name` (top-level field on Sentry events)

---

### MEDIUM-1: Group 2 missing `maxBreadcrumbs` config

**Severity:** MEDIUM
**Group:** 2 (SDK Init)

The brainstorm recommends `maxBreadcrumbs: 30` (privacy research line 273) to reduce PII exposure surface. Group 2's deliverables for `instrument.ts` don't include this setting, keeping the default of 100 breadcrumbs which increases the window for PII leaks in console breadcrumbs.

**Fix:** Add `maxBreadcrumbs: 30` (or similar reduced value) to the `Sentry.init()` config in Group 2 deliverables.

---

### MEDIUM-2: Group 4 missing explicit `monitorConfig` per job

**Severity:** MEDIUM
**Group:** 4 (Cron Monitoring)

The deliverable says to use `Sentry.withMonitor(monitorSlug, handler, monitorConfig)` with "schedule from existing cron expression" and "appropriate checkinMargin and maxRuntime." But it doesn't specify the actual values per job. The implementor needs to translate `CronExpressions.EVERY_15_MINUTES` to `"*/15 * * * *"` and choose margin/runtime values.

**Fix:** Add a table to Group 4 deliverables:

| Job | Cron | checkinMargin | maxRuntime |
|-----|------|--------------|------------|
| dead-letter-auto-retry | `*/15 * * * *` | 5 | 10 |
| payload-cleanup | `0 3 * * *` | 10 | 30 |
| dead-letter-cleanup | `0 3 * * *` | 10 | 15 |
| contacts-sync-daily | `0 4 * * *` | 15 | 60 |
| groups-sync-daily | `0 5 * * *` | 15 | 60 |
| unread-count-refresh | `0 * * * *` | 5 | 5 |

---

### MEDIUM-3: Group 5 validation is fragile (negative grep test)

**Severity:** MEDIUM
**Group:** 5 (Tags + Metrics)

The validation command is:
```bash
grep -r 'Sentry.metrics' packages/api/src/ | grep -viE 'channel_type|provider_type|model|job_type|unit'
```
This is a fragile negative test — it only checks that no *unexpected* attribute names exist. It doesn't verify that metrics are actually emitting or that the guard check works. A typo in the metric name would pass this test.

**Fix:** Add a positive validation:
1. Create a simple test that mocks `Sentry.metrics.count` and verifies calls with expected attributes
2. Or add a grep for expected metric calls: `grep -r 'Sentry.metrics\.\(count\|gauge\|distribution\)' packages/api/src/ | wc -l` should match expected count (6+ calls)

---

### MEDIUM-4: Group 3 Sentry capture should handle `OmniError.context` PII explicitly

**Severity:** MEDIUM
**Group:** 3 (Error Capture)

Group 3 deliverables say: `For OmniError: tag error.code, extra error.context (scrubbed)`. The word "scrubbed" is ambiguous — does it mean:
- a) The `beforeSend` hook from Group 1 handles it (implicit, via `scrubEvent` walking `event.extra`)
- b) The error handler scrubs inline before calling `scope.setExtra()`

Option (a) is correct given the dependency, but the deliverable should be explicit to avoid an implementor adding raw `error.context` to extras and assuming "someone else handles it."

**Fix:** Change the deliverable to:
```
For OmniError: tag error.code, extra error.context
(PII scrubbing handled by beforeSend hook from Group 1 — do NOT scrub inline to avoid double processing)
```

---

### MEDIUM-5: Discord snowflake regex `\d{17,22}` false positive risk

**Severity:** MEDIUM
**Group:** 1 (PII Scrubbing)

The regex `\d{17,22}` for Discord snowflakes will match any 17-22 digit number. While rare in most contexts, this could inadvertently scrub legitimate numeric data (large counters, composite IDs). The risk assessment table should note this.

**Fix:** Either:
1. Narrow the pattern to only apply in Discord-related contexts (check for `discord` in the surrounding text or context)
2. Document the false-positive risk in the scrub module comments and acceptance criteria
3. Only apply this pattern in `scrubEvent`/`scrubBreadcrumb` when `channelType === 'discord'`

---

### LOW-1: `.env.example` section heading needed

**Severity:** LOW
**Group:** 2 (SDK Init)

The current `.env.example` doesn't have a Sentry section. The deliverable should specify adding a full section with comments, not just appending vars.

**Fix:** Deliverable should specify:
```bash
# -----------------------------------------------------------------------------
# Sentry (Error Tracking & Performance Monitoring)
# -----------------------------------------------------------------------------
# SENTRY_DSN=https://...@o123.ingest.sentry.io/456
# SENTRY_TRACES_SAMPLE_RATE=0.1
# SENTRY_ENVIRONMENT=development
```

---

### LOW-2: Group 6 and Group 7 are non-code tasks mixed with code groups

**Severity:** LOW
**Groups:** 6, 7

Groups 6 (MCP Server) and 7 (Server-Side Rules) are manual/interactive tasks (browser OAuth, Sentry UI configuration) mixed in with code delivery groups. This can confuse CI/review processes.

**Fix:** Tag these groups explicitly as `type: manual` in the plan to distinguish from code deliverables. No code review or PR needed for these.

---

### LOW-3: No rollback documentation

**Severity:** LOW
**All Groups**

The plan mentions opt-in via `SENTRY_DSN` but doesn't document rollback if the `@sentry/bun` package itself causes issues (startup crashes, memory leaks, incompatibilities). Since `@sentry/bun` is acknowledged as beta (Risk table row 1), a rollback path should be documented.

**Fix:** Add a Rollback section:
- **Quick disable:** Remove `SENTRY_DSN` env var (Sentry becomes no-op)
- **Full removal:** `bun remove @sentry/bun`, delete `instrument.ts`, revert `index.ts` first-line import, revert error middleware changes

---

## Execution Group Assessment

| Group | Scope | Shippable? | Gaps |
|-------|-------|-----------|------|
| 1: PII Scrubbing | Well-scoped, standalone module + tests | Yes | HIGH-4 (missing server_name), MEDIUM-5 (snowflake regex) |
| 2: SDK Init | Well-scoped | Yes, after fixes | HIGH-1 (bad DSN), HIGH-2 (no test), MEDIUM-1 (maxBreadcrumbs) |
| 3: Error Capture | Well-scoped | Yes | MEDIUM-4 (ambiguous scrub responsibility) |
| 4: Cron Monitoring | Well-scoped | Yes, after fix | MEDIUM-2 (missing config table) |
| 5: Tags + Metrics | Too scattered — 5+ files | Yes, but fragile | HIGH-3 (guard mechanism), MEDIUM-3 (validation) |
| 6: MCP Server | Clear, independent | Yes (manual) | LOW-2 (tag as manual) |
| 7: Server-Side Rules | Clear, independent | Yes (manual) | LOW-2 (tag as manual) |

## Dependency Graph Assessment

The dependency graph is **correct**:
```
Group 1 ← independent
Group 6 ← independent
Group 2 ← depends on Group 1 ✓
Group 3 ← depends on Group 2 ✓
Group 4 ← depends on Group 2 ✓
Group 5 ← depends on Group 2 ✓
Group 7 ← depends on Group 2 ✓ (needs events flowing)
```

Parallel wave 1 (Groups 1+6) and parallel wave 2 (Groups 3+4+5) are correctly identified.

## Risk Assessment

| Risk | Covered? | Notes |
|------|----------|-------|
| PII leak via error messages | Yes | Comprehensive regex patterns in Group 1 |
| PII leak via request bodies | Yes | `requestDataIntegration({ data: false })` |
| PII leak via AI prompts | Yes | `sendDefaultPii: false` blocks prompt capture |
| PII leak via breadcrumbs | Yes | `beforeBreadcrumb` scrubs console data |
| PII leak via `server_name` | **No** | Missing from Group 1 — see HIGH-4 |
| SDK causes startup crash | Partial | Opt-in via DSN, but no rollback docs |
| `postgresIntegration` incompatible with Bun | Yes | Acknowledged, graceful fallback |
| Performance overhead | Yes | 10% sampling, ignoreTransactions for healthchecks |

## Summary of Required Fixes

### Must fix before SHIP (4 items):
1. **HIGH-1:** Fix Group 2 validation DSN to use valid format
2. **HIGH-2:** Add unit test for `instrument.ts` configuration
3. **HIGH-3:** Clarify Sentry initialization guard (`Sentry.getClient()` vs `isInitialized()`)
4. **HIGH-4:** Add `server_name` stripping to Group 1 `scrubEvent`

### Should fix (5 items):
5. **MEDIUM-1:** Add `maxBreadcrumbs` to Group 2 config
6. **MEDIUM-2:** Add explicit `monitorConfig` table for Group 4
7. **MEDIUM-3:** Improve Group 5 validation with positive test
8. **MEDIUM-4:** Clarify scrub responsibility in Group 3 deliverables
9. **MEDIUM-5:** Document Discord snowflake regex false-positive risk

### Nice to fix (3 items):
10. **LOW-1:** Add `.env.example` section heading format
11. **LOW-2:** Tag Groups 6/7 as `type: manual`
12. **LOW-3:** Add rollback documentation section
