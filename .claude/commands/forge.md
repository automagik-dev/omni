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

```
1. Ask which wish to forge (or use $ARGUMENTS path)
2. Read: .wishes/<slug>/<slug>-wish.md
3. Verify status is DRAFT or APPROVED
4. Extract beads ID from wish document (Beads: <id>)
5. Update status to FORGING
6. Update beads: bd update <beads-id> --status in_progress
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

### 4. REVIEW

After all groups complete:

1. **Spec Review** - Verify deliverables match wish
   - PASS: Continue
   - FAIL: Address gaps

2. **Quality Review** - Check code quality
   - SHIP: Ready for final review
   - FIX-FIRST: Address minor issues
   - BLOCKED: Major issues, investigate

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
Beads: omni-v2-abc123 (closed)

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

- Wish document is a contract - don't modify it
- Run all validation commands
- Don't skip the two-stage review
- Don't implement beyond wish scope
- Always sync beads: `bd sync`
