# QA Results: Message Resilience

**Verdict:** PARTIAL
**Date:** 2026-02-10
**Tester:** QA Agent

## Summary

| Category | Passed | Failed | Skipped |
|----------|--------|--------|---------|
| API | 7 | 0 | 0 |
| CLI | 5 | 1 | 0 |
| Unit Tests | 19 | 0 | 0 |
| Regression | 0 | 0 | 0 |

## Test Results

### API Tests (Live System)

- [x] `GET /api/v2/health` returns healthy with db + nats checks
- [x] `GET /api/v2/health/consumers` returns consumer tracking status (200, `{"status":"ok","consumers":[],"totalTracked":0}`)
- [x] `POST /instances/:id/resync` with `{"since":"2h"}` triggers resync (200 + eventId)
- [x] `POST /instances/:id/resync` with ISO timestamp accepted (200 + correct since)
- [x] `POST /instances/:id/resync` with empty body defaults to 2h (200)
- [x] `POST /instances/:id/resync` returns 404 for unknown instance
- [x] `POST /instances/:id/resync` returns 401 without API key

### CLI Tests

- [x] `omni resync --help` shows correct usage, options, and examples
- [x] `omni resync` (no args) shows "Specify --instance or --all" error
- [x] `omni resync -i foo` (no since) shows "Specify --since" error
- [x] `omni resync -i <id> --since 2h --dry-run` shows dry run output correctly
- [ ] `omni resync -i <id> --since 2h` fails with UNAUTHORIZED (see BUG below)

### Unit Tests (19/19 pass)

- [x] consumer-config.test.ts: 7 tests — all critical consumers use `startFrom: 'first'`
- [x] consumer-offsets.test.ts: 5 tests — offset tracking, upsert, gap detection
- [x] resync.test.ts: 5 tests — resync endpoint trigger, timestamps, 404, 503

### Regression Tests

- [x] `make test` — 2175 pass, 0 fail in actual code (137 failures all from orphaned worktrees)
- [x] `make typecheck` — 10/10 pass
- [x] `make lint` — 486 files, 0 issues
- [x] `omni instances list` — works, shows 4 instances
- [x] `omni status` — works, shows API healthy
- [x] Pre-existing failure: `sdk-coverage.test.ts` — `events.analytics` unmapped (existed on main)

### Infrastructure Verification

- [x] `consumer_offsets` table exists with correct schema (5 columns)
- [x] All critical plugins use `startFrom: 'first'` (message-persistence: 5, event-persistence: 1, media-processor: 1, agent-responder main: 1)
- [x] Only ephemeral consumer uses `startFrom: 'last'` (agent-responder-typing)
- [x] NATS connected, 4 instances total, 3 active

## Failures

### [MEDIUM] CLI resync uses wrong auth header

**Test:** `omni resync -i <id> --since 2h`
**Expected:** Resync triggers successfully (like curl with `x-api-key`)
**Actual:** Returns "API key required" because CLI sends `Authorization: Bearer <key>` instead of `x-api-key: <key>`
**Root Cause:** `packages/cli/src/commands/resync.ts:78` uses `Authorization: Bearer` while all other CLI commands use `x-api-key`
**Impact:** MEDIUM — the resync CLI command doesn't work against the live API. The API endpoint itself works correctly (verified via curl).
**Fix:** Change line 78 from `Authorization: \`Bearer ${apiKey}\`` to `'x-api-key': apiKey`

## Evidence

- API health: `{"status":"healthy","version":"2.0.0","uptime":297}`
- Consumer health: `{"status":"ok","consumers":[],"totalTracked":0}`
- Resync response: `{"success":true,"data":{"instanceId":"...","eventId":"7780ac00-...","message":"Resync triggered for cezar-personal..."}}`
- consumer_offsets table: exists, 5 columns, correct schema
- startFrom verification: grep output confirms all critical consumers at 'first'
