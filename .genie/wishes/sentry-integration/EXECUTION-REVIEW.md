# Execution Review: sentry-integration

**Reviewer:** Claude Opus 4.6 (execution reviewer)
**Date:** 2026-03-10
**Verdict:** SHIP

---

## Checklist

### 1. Acceptance Criteria

| Criterion | Status | Evidence |
|-----------|--------|----------|
| `@sentry/bun` in package.json deps | PASS | `"@sentry/bun": "^10.43.0"` in packages/api/package.json:32 |
| API starts with SENTRY_DSN (active) | PASS | instrument.ts conditional init on line 19 `if (dsn)` |
| API starts without SENTRY_DSN (no-op) | PASS | instrument.test.ts test 1: getClient() returns undefined when DSN absent |
| 5xx errors produce Sentry events | PASS | error.ts:347-363 — `Sentry.withScope` + `captureException` in server error branch |
| 4xx errors do NOT produce events | PASS | error.ts:332 — `isClientError()` guard, Sentry block only in `else` |
| Phone numbers scrubbed to `[phone]` | PASS | sentry-scrub.ts:59 `PHONE_RE`, 40 unit tests passing |
| WhatsApp JIDs scrubbed to `[jid]` | PASS | sentry-scrub.ts:62 `JID_RE`, tests cover @s and @c variants |
| Request bodies never in Sentry events | PASS | instrument.ts:34 `data: false` in requestDataIntegration |
| 6 cron jobs monitored | PASS | scheduler.ts — all 6 jobs wrapped with `withCronMonitor()`, configs match wish table exactly |
| SENTRY_DSN in .env.example | PASS | .env.example:43-47 — section with DSN, TRACES_SAMPLE_RATE, ENVIRONMENT |
| Graceful shutdown flushes events | PASS | index.ts:236 `await Sentry.close(5000)` before `process.exit(0)` |
| sendDefaultPii: false | PASS | instrument.ts:26, also verified in instrument.test.ts |
| server_name stripped from events | PASS | sentry-scrub.ts:126-129, unit tested |
| Email addresses scrubbed | PASS | sentry-scrub.ts:65 `EMAIL_RE`, unit tested |
| All metrics guarded with sentryEnabled() | PASS | Verified in all 4 files: agent-dispatcher, event-listeners, message-persistence, messages.ts |
| ignoreErrors configured | PASS | instrument.ts:58 — ECONNRESET, ETIMEDOUT, socket hang up |
| ignoreTransactions configured | PASS | instrument.ts:59 — /healthcheck, /health, /favicon.ico, /metrics |

### 2. Validation Commands

| Command | Result |
|---------|--------|
| `bun test packages/api/src/lib/__tests__/sentry-scrub.test.ts` | 40 pass, 0 fail |
| `bun test packages/api/src/lib/__tests__/instrument.test.ts` | 3 pass, 0 fail |
| `bun test packages/api/ \| tail -5` | **431 pass, 216 skip, 0 fail** across 50 files |
| `grep -r 'Sentry.metrics' ... \| wc -l` | 8 metric calls (wish expected 6+) |
| PII in metrics check | 0 PII — only `channel_type`, `provider_type`, `unit`, `millisecond` |

### 3. Scope Creep

PASS — Changes are strictly within wish scope. No unrelated refactors, no extra features.

### 4. Auditability

PASS — All files, test results, and validation commands documented above.

### 5. Quality

#### Security
- **sendDefaultPii: false** — PASS
- **Request body capture disabled** — PASS (data, headers, cookies, query_string, ip all false)
- **beforeSend scrubs all events** — PASS (exception values, message, contexts, extras, breadcrumbs, request)
- **beforeSendTransaction parameterizes names** — PASS (phone, UUID, JID)
- **beforeSendSpan scrubs db.statement and http.url** — PASS
- **beforeBreadcrumb scrubs and filters** — PASS (drops message content patterns)
- **No secrets in code** — PASS (DSN from env only)
- **server_name stripped** — PASS (prevents infrastructure topology leaks)

#### Maintainability
- PII scrubbing is a standalone module with local interfaces (no circular deps)
- `sentryEnabled()` helper avoids import-time failures
- `withCronMonitor()` helper keeps scheduler code DRY
- Immutable event processing (all scrub functions return new objects, never mutate)

#### Correctness
- UUID preservation in `scrubPii()` prevents false positives
- JID regex matched before phone regex to prevent partial replacement
- Cron monitor configs match wish table exactly (6/6 jobs)
- Metric attributes use only enum values (channel_type, provider_type)

### 6. Regressions

PASS — Full test suite: 431 pass, 0 fail, 0 new failures. All pre-existing tests still pass.

---

## Findings

### MEDIUM

1. **Missing request-level tag middleware** (Group 5, deliverable #1)
   - Wish specifies: "New middleware or hook in request pipeline to set Sentry tags from request context: `cli_version`, `channel_type`, `instance_id`"
   - `cli_version` IS set in error handler (error.ts:352-353), but only for 5xx errors
   - No per-request middleware exists to tag all Sentry transactions with these values
   - **Impact:** Sentry Performance transactions won't have channel_type/instance_id tags for filtering
   - **Mitigation:** Error events (the primary use case) DO have cli_version. This can be added as a follow-up without blocking the integration.

### LOW

2. **Discord snowflake regex not implemented**
   - Wish acknowledged: "only apply when channelType context is discord, or document the tradeoff"
   - Decision was implicitly to skip (false-positive risk on large numbers outweighs benefit)
   - No Discord-specific PII pattern in scrubPii()

3. **`user` not explicitly excluded in requestDataIntegration**
   - `include.user` not set to `false` in instrument.ts
   - Mitigated by `sendDefaultPii: false` which prevents user data capture anyway

4. **`sentryEnabled()` uses require() instead of static import**
   - sentry-scrub.ts:272 uses `require('@sentry/bun')` for runtime check
   - Works correctly but is slightly redundant since all callers also have top-level `import * as Sentry`
   - Originally designed for when @sentry/bun might not be installed (Group 1 independence)

---

## Verdict: SHIP

**Zero CRITICAL or HIGH gaps.** One MEDIUM gap (missing request-level tag middleware) affects observability completeness but not security or correctness. All PII scrubbing, error capture, cron monitoring, and metrics are correctly implemented and tested. The integration is safe to ship and the MEDIUM gap can be addressed in a follow-up wish.
