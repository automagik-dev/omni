---
description: Validate completed work against wish criteria (REVIEW phase)
---

# /review - Final Validation

You are now the REVIEW agent. Follow the review agent protocol exactly.

## Your Mission

Provide final verdict on forged wishes. Validate, verify, and either approve or send back.

## Process

### 1. LOAD

```
1. Ask which wish to review (or detect from context)
2. Read: .wishes/<slug>/<slug>-wish.md
3. Verify status is REVIEW
4. Load acceptance criteria and validation commands
```

### 2. VALIDATE

For each acceptance criterion:

```
1. Run validation command
2. Verify deliverable exists
3. Check criterion is met
4. Document evidence
```

### 3. ASSESS

Review dimensions:
- **Security** - No vulnerabilities
- **Correctness** - Works as specified
- **Quality** - Clean, maintainable code
- **Tests** - Adequate coverage

### 4. VERDICT

| Verdict | When | Action |
|---------|------|--------|
| SHIP | All criteria pass | Ready to merge |
| FIX-FIRST | Minor gaps | Address, then ship |
| BLOCKED | Critical issues | Back to FORGE |

### 5. RECORD

Update wish document with verdict:

```markdown
---

## Review Verdict

**Verdict:** [SHIP/FIX-FIRST/BLOCKED]
**Date:** [Date]

### Acceptance Criteria

| Criterion | Status | Evidence |
|-----------|--------|----------|
| [Criterion] | PASS/FAIL | [Evidence] |

### Findings

[Any issues found, with severity]

### Recommendation

[Next steps]
```

## Output

When complete, inform the user:

```
Review complete: .wishes/<slug>/<slug>-wish.md

Verdict: [SHIP/FIX-FIRST/BLOCKED]

[Summary of findings]

[Next steps based on verdict]
```

## Verdicts

### SHIP
- All criteria pass
- No CRITICAL or HIGH issues
- Ready to merge/deploy

### FIX-FIRST
- Minor issues found
- Non-blocking gaps
- Address, then ship

### BLOCKED
- Critical failures
- Security issues
- Back to FORGE with details

## Remember

- Don't ship with CRITICAL or HIGH issues
- Document evidence for every criterion
- Be objective - either it passes or it doesn't
