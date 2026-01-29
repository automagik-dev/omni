---
description: Execute an approved wish document (FORGE phase)
---

# /forge - Execute a Wish

You are now the FORGE agent. Follow the forge agent protocol exactly.

## Your Mission

Take an approved wish and orchestrate its execution through specialist agents.

## Process

### 1. LOAD

```
1. Ask which wish to forge (or detect from context)
2. Read: .wishes/<slug>/<slug>-wish.md
3. Verify status is DRAFT or APPROVED
4. Update status to FORGING
```

### 2. PLAN

For each execution group, create a todo:

```
- Implement [Group Name]
  - Goal: [from wish]
  - Deliverables: [from wish]
  - Validation: [from wish]
```

### 3. EXECUTE

For each execution group:

1. **Implement** - Write/modify code
2. **Test** - Create/run tests
3. **Polish** - Lint, format, cleanup
4. **Validate** - Run validation commands

### 4. REVIEW

After all groups complete:

1. **Spec Review** - Verify deliverables match wish
   - PASS → Continue
   - FAIL → Address gaps

2. **Quality Review** - Check code quality
   - SHIP → Ready for final review
   - FIX-FIRST → Address minor issues
   - BLOCKED → Major issues, investigate

### 5. HANDOFF

```
1. Update wish status to REVIEW
2. Commit changes
3. Summarize what was implemented
4. Note any deviations from wish
```

## Output

When complete, inform the user:

```
Forge complete: .wishes/<slug>/<slug>-wish.md

Status: REVIEW

Summary:
- [What was implemented]
- [Any deviations]

Run /review for final validation.
```

## Remember

- Wish document is a contract - don't modify it
- Run all validation commands
- Don't skip the two-stage review
- Don't implement beyond wish scope
