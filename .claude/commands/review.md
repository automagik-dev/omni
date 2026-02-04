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
4. Extract beads ID from wish document (Beads: <id>)
5. Load acceptance criteria and validation commands
```

### 2. VALIDATE

For each acceptance criterion:

```
1. Run validation command
2. Verify deliverable exists
3. Check criterion is met
4. Document evidence
```

### 3. SYSTEM VALIDATION

Check all affected system components from the wish's Impact Analysis:

**Core Validation:**
```bash
make check                    # typecheck + lint + test
```

**Package-Specific Checks:**
| If Changed | Verify |
|------------|--------|
| `core/events/` | Event types defined, handlers registered |
| `db/schema.ts` | Schema pushed (`make db-push`), migrations work |
| `api/routes/` | Endpoints work, OpenAPI spec updated |
| `sdk/` | Regenerated (`bun generate:sdk`), types correct |
| `cli/commands/` | Commands work, help text accurate |
| `channel-*/` | Plugin interface respected, events emitted |

**Integration Checks:**
- [ ] Events flow correctly through NATS
- [ ] Database queries use Drizzle (no raw SQL)
- [ ] SDK client can call new/modified endpoints
- [ ] CLI commands function as documented

### 4. ASSESS

Review dimensions:
- **Security** - No vulnerabilities, no secrets exposed
- **Correctness** - Works as specified
- **Quality** - Clean, maintainable code
- **Tests** - Adequate coverage for affected packages
- **Integration** - All system components work together

### 4. VERDICT

| Verdict | When | Action |
|---------|------|--------|
| SHIP | All criteria pass | Ready to merge |
| FIX-FIRST | Minor gaps | Address, then ship |
| BLOCKED | Critical issues | Back to FORGE |

### 5. RECORD

Update wish document with verdict AND close beads if SHIP:

```bash
# If SHIP verdict:
bd close <beads-id>
bd sync
# Update wish status to SHIPPED

# If FIX-FIRST verdict:
# Keep beads open, update wish status to FIX-FIRST

# If BLOCKED verdict:
# Keep beads open, update wish status to BLOCKED
```

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

## System-Specific Blockers

These issues automatically block SHIP verdict:

| Issue | Why It Blocks |
|-------|---------------|
| `make check` fails | Quality gate not passed |
| SDK not regenerated after API change | Client types out of sync |
| Events skipped for state changes | Violates event-first architecture |
| Raw SQL used instead of Drizzle | Consistency violation |
| Channel logic in core package | Plugin isolation violated |
| npm/yarn/pnpm used | Must use Bun only |

## Remember

- Don't ship with CRITICAL or HIGH issues
- Document evidence for every criterion
- Be objective - either it passes or it doesn't
- Verify all packages in Impact Analysis are addressed
- Run `bun generate:sdk` if any API routes changed
- Ensure `make check` passes before SHIP verdict
