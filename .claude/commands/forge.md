---
description: Execute an approved wish document (FORGE phase)
arguments:
  - name: wish
    description: Path to wish document (e.g., .wishes/auth/auth-wish.md)
    required: false
  - name: spawn
    description: Spawn tmux sessions instead of inline execution
    type: boolean
    required: false
  - name: group
    description: Execute only specific group (A, B, C)
    required: false
  - name: parallel
    description: Spawn all groups in parallel sessions
    type: boolean
    required: false
---

# /forge - Execute a Wish

You are now the FORGE agent. Follow the forge agent protocol exactly.

**Arguments:** $ARGUMENTS

## CRITICAL: Context Efficiency

**NEVER read full wish documents when listing available wishes.**
- Use `grep` to extract only Status/Beads from frontmatter (first 15 lines)
- Only read full wish content AFTER user selects which to forge
- This prevents context bloat from loading 16+ wish documents

## Mode Detection

Parse arguments to determine mode:

1. **Inline mode** (default): Execute in current session
   - `/forge` or `/forge .wishes/auth/auth-wish.md`

2. **Spawn mode**: Create tmux sessions with worktrees
   - `/forge --spawn` - Spawn session for wish
   - `/forge --spawn --parallel` - Spawn parallel sessions per group
   - `/forge --spawn --group A` - Spawn only group A

## Spawn Mode

When `--spawn` is present:

```bash
# 1. Determine wish and groups
WISH_PATH=".wishes/<slug>/<slug>-wish.md"
WISH_SLUG="<slug>"
# Get beads ID from wish document (created by /wish)
BEADS_ID=$(grep "Beads:" "$WISH_PATH" | awk '{print $2}')

# 2. For each group (or specified --group):
GROUP="A"
SESSION_NAME="${WISH_SLUG}-${GROUP}-${BEADS_ID}"
WORKTREE_PATH="$HOME/.worktrees/omni-v2/${SESSION_NAME}"

# 3. Create worktree
git worktree add "$WORKTREE_PATH" -b "feat/${SESSION_NAME}"

# 4. Create tmux session
tmux new-session -d -s "$SESSION_NAME" -c "$WORKTREE_PATH"

# 5. Start Claude with forge command
tmux send-keys -t "$SESSION_NAME" "claude --dangerously-skip-permissions '/forge $WISH_PATH --group $GROUP'" Enter

# 6. Update beads
bd update "$BEADS_ID" --status in_progress
```

**Output for spawn mode:**
```
Spawned forge sessions:

- auth-A-abc123: tmux attach -t auth-A-abc123
- auth-B-abc123: tmux attach -t auth-B-abc123

Beads: omni-v2-abc123 (in_progress)

Monitor: tmux ls
Attach: tmux attach -t <session>
```

## Inline Mode (Default)

When no `--spawn`:

### 1. LOAD

**IMPORTANT: Context efficiency** - Do NOT read full wish documents when listing. Only extract frontmatter.

```
1. Find wishes to forge:
   - Glob: .wishes/**/*-wish.md
   - Use grep to extract ONLY frontmatter fields (first 15 lines):
     grep -m1 "^# WISH:" <file>     # Title
     grep -m1 "^\*\*Status:\*\*" <file>  # Status
     grep -m1 "^\*\*Beads:\*\*" <file>   # Beads ID
   - ONLY show wishes with Status: DRAFT, READY, or APPROVED
   - SKIP wishes with Status: SHIPPED, REVIEW, FORGING
   - Display as compact table (slug, status, beads) - NOT full content
2. Ask which wish to forge (or use $ARGUMENTS path)
3. ONLY AFTER selection: Read full wish document
4. Verify status is DRAFT, READY, or APPROVED
5. Extract beads ID from wish document (Beads: <id>)
6. Update status to FORGING
7. Update beads: bd update <beads-id> --status in_progress
```

**Example listing output (compact):**
```
Available wishes to forge:

| Slug | Status | Beads |
|------|--------|-------|
| send-complete | DRAFT | omni-y51 |
| history-sync | DRAFT | omni-rnc |
| unified-messages | DRAFT | omni-p5c |
```

If `--group` specified, only load that group.

### 2. PLAN

For each execution group (or specified group), create a todo:

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

### 4. SELF-REVIEW

After all groups complete:

1. **Spec Review** - Verify deliverables match wish
   - PASS: Continue
   - FAIL: Address gaps

2. **Quality Review** - Check code quality
   - READY: Ready for /review
   - FIX-FIRST: Address minor issues
   - BLOCKED: Major issues, investigate

**Note:** This is self-review only. Forge NEVER sets SHIPPED status - only `/review` can ship.

### 5. HANDOFF

```
1. Update wish status to REVIEW
2. Commit changes
3. bd sync
4. Summarize what was implemented
5. Note any deviations from wish
```

## Output

**Inline mode complete:**
```
Forge complete: .wishes/<slug>/<slug>-wish.md

Status: REVIEW
Beads: omni-v2-abc123 (in_progress)

Summary:
- [What was implemented]
- [Any deviations]

Run /review for final validation.
```

## Cleanup (after wish ships)

```bash
# Remove worktree
git worktree remove ~/.worktrees/omni-v2/<session-name>

# Kill tmux session (if still running)
tmux kill-session -t <session-name>

# Merge branch
git checkout main
git merge feat/<session-name>
git branch -d feat/<session-name>
```

## Remember

- **NEVER set status to SHIPPED** - Only /review can ship
- Wish document is a contract - don't modify it
- Run all validation commands
- Don't skip the two-stage review
- Don't implement beyond wish scope
- Always sync beads: `bd sync`
- Don't close beads - only /review closes beads on SHIP verdict
