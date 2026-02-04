---
name: verification-gate
description: Use before claiming any work is complete, fixed, or passing - requires running verification commands and showing output before making success claims
---

# Verification Gate

## Overview

Claiming work is complete without verification is dishonesty, not efficiency.

**Core principle:** Evidence before claims, always.

## The Iron Law

```
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
```

If you haven't run the verification command in this message, you cannot claim it passes.

## The Gate Function

```
BEFORE claiming any status or expressing satisfaction:

1. IDENTIFY: What command proves this claim?
2. RUN: Execute the FULL command (fresh, complete)
3. READ: Full output, check exit code, count failures
4. VERIFY: Does output confirm the claim?
   - If NO: State actual status with evidence
   - If YES: State claim WITH evidence
5. ONLY THEN: Make the claim

Skip any step = lying, not verifying
```

## Common Failures

| Claim | Requires | Not Sufficient |
|-------|----------|----------------|
| Tests pass | `make test` output: 0 failures | Previous run, "should pass" |
| Linter clean | `make lint` output: 0 errors | Partial check |
| Build succeeds | `make check` exit 0 | Linter passing |
| Bug fixed | Test for bug passes | Code changed |
| Requirements met | Line-by-line checklist | Tests passing |

## Red Flags - STOP

- Using "should", "probably", "seems to"
- Expressing satisfaction before verification ("Great!", "Done!")
- About to commit/push/PR without verification
- Relying on previous verification
- Thinking "just this once"

## Forbidden Phrases Without Evidence

These phrases require showing command output first:

- "Tests pass" → Show `make test` output
- "Build succeeds" → Show `make check` output
- "Linter clean" → Show `make lint` output
- "Should work now" → Run verification first
- "Looks correct" → Run verification first
- "I'm confident" → Confidence ≠ evidence

## Key Patterns

**Tests:**
```
✅ [Run make test] [See: 34/34 pass] "All tests pass"
❌ "Should pass now" / "Looks correct"
```

**Build:**
```
✅ [Run make check] [See: exit 0] "Build passes"
❌ "Linter passed" (linter doesn't check compilation)
```

**Requirements:**
```
✅ Re-read wish → Create checklist → Verify each → Report gaps or completion
❌ "Tests pass, phase complete"
```

## Integration with Workflow

### In /forge

After implementation, before claiming self-review passes:
1. Run `make check`
2. Show output
3. Only then claim READY for review

### In /review

Before any verdict:
1. Run `make check` fresh (don't trust forge)
2. Show output
3. Only then assign verdict

### In /qa

After each test:
1. Show actual output
2. Compare to expected
3. Only then mark pass/fail

## Why This Matters

- Trust is lost when claims don't match reality
- "It worked when I tried it" ≠ verification
- Users need confidence that PASS means PASS
- Verification is faster than debugging false positives

## The Bottom Line

**No shortcuts for verification.**

Run the command. Read the output. THEN claim the result.

This is non-negotiable.
