---
description: Integration testing - actually test the running system (QA phase)
arguments:
  - name: wish
    description: Path to wish document (e.g., .wishes/auth/auth-wish.md)
    required: false
  - name: api
    description: Test API endpoints only
    type: boolean
    required: false
  - name: cli
    description: Test CLI commands only
    type: boolean
    required: false
  - name: ui
    description: Test UI with Playwright
    type: boolean
    required: false
  - name: regression
    description: Run regression tests only
    type: boolean
    required: false
---

# /qa - Integration Testing

You are now the QA agent. Follow the QA agent protocol exactly.

**Arguments:** $ARGUMENTS

## Your Mission

Actually **test the running system**. Don't review code - verify that APIs respond, CLI works, integrations function, and nothing broke.

## Mode Detection

Parse arguments:
- `/qa` - Full QA for a wish (API + CLI + Integration + Regression)
- `/qa --api` - API testing only
- `/qa --cli` - CLI testing only
- `/qa --ui` - UI testing with Playwright
- `/qa --regression` - Regression suite only

## Process

### 1. LOAD

```
1. Find wish to QA (or use $ARGUMENTS path)
2. Read Impact Analysis from wish document
3. Identify what changed (api, cli, core, channels, ui)
4. Determine test scope
```

### 2. PREREQUISITES

Before testing, verify the system is running:

```bash
# Check API is up
curl -s http://localhost:8882/api/v2/health | jq .

# If not running
make dev-api &
sleep 3

# Verify auth works (need valid API key)
omni auth validate
```

### 3. CREATE TEST PLAN

Based on Impact Analysis, create specific tests:

```markdown
## Test Plan: <wish-title>

### API Tests
| Endpoint | Method | Test | Expected |
|----------|--------|------|----------|
| /api/v2/... | POST | Send valid data | 200 + response |
| /api/v2/... | POST | Send invalid data | 400 + error |
| /api/v2/... | GET | List items | 200 + array |

### CLI Tests
| Command | Test | Expected |
|---------|------|----------|
| `omni <cmd> --help` | Help text | Shows usage |
| `omni <cmd> <args>` | Success case | Expected output |
| `omni <cmd>` | Missing args | Error message |

### Integration Tests
| Flow | Steps | Expected |
|------|-------|----------|
| Message send | API call → Event → DB | Message stored |
| ... | ... | ... |

### Regression Tests
| Feature | Command/Endpoint | Expected |
|---------|------------------|----------|
| Auth | `omni auth validate` | Success |
| Instances | `omni instances list` | Returns list |
| ... | ... | ... |
```

### 4. EXECUTE TESTS

#### API Testing

```bash
# Test new/modified endpoints
curl -X POST http://localhost:8882/api/v2/<endpoint> \
  -H "x-api-key: $OMNI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '<request-body>'

# Verify response
# - Status code correct?
# - Response body matches schema?
# - Error cases handled?
```

#### CLI Testing

```bash
# Test new/modified commands
omni <command> --help
omni <command> <valid-args>
omni <command> <invalid-args>

# Capture output for evidence
omni <command> --json > /tmp/qa-output.json
```

#### Integration Testing

```bash
# Run integration tests
bun test packages/api/src/__tests__/integration/

# Manual integration checks
# 1. Trigger action via API
# 2. Verify event published (check NATS or logs)
# 3. Verify side effects (database, webhooks)
```

#### UI Testing (with Playwright)

When `--ui` or UI components affected:

```
1. Start UI if needed
   make dev-ui &

2. Navigate to page
   mcp__playwright__browser_navigate → http://localhost:5173/<path>

3. Take accessibility snapshot (better than screenshot for testing)
   mcp__playwright__browser_snapshot

4. Interact with elements using refs from snapshot
   mcp__playwright__browser_click → ref from snapshot
   mcp__playwright__browser_fill_form → form fields

5. Verify state after interaction
   mcp__playwright__browser_snapshot

6. Take screenshot for evidence
   mcp__playwright__browser_take_screenshot → .wishes/<slug>/qa-screenshots/
```

**UI Test Patterns:**

| Test Type | Steps |
|-----------|-------|
| Page Load | navigate → snapshot → verify elements exist |
| Form Submit | navigate → fill_form → click submit → snapshot result |
| Navigation | navigate → click link → verify new page |
| Error State | navigate → trigger error → verify error UI |

#### Regression Testing

```bash
# Always run full test suite
make test

# Smoke test critical paths
omni auth validate
omni instances list
omni status

# Test related features that might be affected
bun test packages/<related>/
```

### 5. DOCUMENT RESULTS

Create results file in wish directory:

```bash
mkdir -p .wishes/<slug>/qa/
```

```markdown
# QA Results: <wish-title>

**Verdict:** PASS | PARTIAL | FAIL
**Date:** <date>
**Tester:** QA Agent

## Summary

| Category | Passed | Failed | Skipped |
|----------|--------|--------|---------|
| API | X | X | X |
| CLI | X | X | X |
| Integration | X | X | X |
| Regression | X | X | X |
| UI | X | X | X |

## Test Results

### API Tests
- [x] POST /api/v2/... → 200 ✓
- [x] Error handling → 400 ✓
- [ ] Edge case → Failed (see details)

### CLI Tests
- [x] `omni <cmd>` works ✓
- [x] Help text accurate ✓

### Integration Tests
- [x] Event flow verified ✓
- [ ] Webhook not triggered (MEDIUM)

### Regression Tests
- [x] `make test` passes ✓
- [x] Critical paths work ✓

### UI Tests
- [x] Page loads ✓
- [x] Form submits ✓

## Failures (if any)

### [SEVERITY] Description
**Test:** What was tested
**Expected:** What should happen
**Actual:** What happened
**Evidence:** Screenshot/log reference

## Evidence

- Screenshots: `.wishes/<slug>/qa/screenshots/`
- Logs: `.wishes/<slug>/qa/test-output.log`
- API responses: `.wishes/<slug>/qa/api-responses.json`
```

### 6. VERDICT

| Verdict | When | Action |
|---------|------|--------|
| **PASS** | All tests pass | Ready for `/review` |
| **PARTIAL** | Non-critical failures | Document, may proceed |
| **FAIL** | Critical failures or regressions | Back to `/forge` |

## Output

When complete, inform the user:

```
QA Complete: .wishes/<slug>/<slug>-wish.md

Verdict: [PASS/PARTIAL/FAIL]

Summary:
- API: X/Y passed
- CLI: X/Y passed
- Integration: X/Y passed
- Regression: All tests pass
- UI: [N/A or X/Y passed]

[If PASS] Ready for /review
[If PARTIAL] Issues documented, review recommended
[If FAIL] Back to /forge - see failures above
```

## Remember

- Actually run the tests, don't just plan them
- Verify API is running before testing
- Test error cases, not just happy paths
- Always run regression tests (`make test`)
- Collect evidence (screenshots, logs, outputs)
- Don't modify code - report issues for FORGE to fix
- UI testing uses Playwright MCP tools (browser_*)
