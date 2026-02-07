# Term CLI Notes — Omni's Field Report 🐙

_What works, what doesn't, and what I wish existed._

---

## Full Command Inventory (2026-02-07)

### Session Management
| Command | Works? | Notes |
|---------|--------|-------|
| `term ls` | ✅ | Lists sessions with window count, attached status |
| `term new <name>` | ✅ | Creates session |
| `term rm <name>` | ✅ | Kills session |
| `term attach <name>` | ✅ | Attaches |
| `term info <session>` | ✅ | Quick overview (panes, state) |

### Pane & Window
| Command | Works? | Notes |
|---------|--------|-------|
| `term pane ls <session>` | ✅ | Lists all panes with IDs, window names, titles — essential |
| `term pane rm <pane-id>` | ✅ | Removes by ID |
| `term window new <session> <name>` | ✅ | Creates window |
| `term window ls <session>` | ✅ | Lists windows |
| `term window rm <window-id>` | ✅ | Removes window |
| `term split <session> v/h` | ⚠️ | Splits ACTIVE pane, not specifiable — can wreck Claude Code's space |

### Input/Output
| Command | Has `-p` pane targeting? | Notes |
|---------|--------------------------|-------|
| `term send <session> <keys>` | ✅ `-p, --pane <id>` | Also has `--no-enter` |
| `term read <session>` | ❌ | Always reads first pane. Has `--search`, `--grep`, `--all`, `--reverse` |
| `term exec <session> <cmd>` | ❌ | Creates ghost "shell" window! Not pane-aware |

### Claude Code Orchestration (`term orc`) ⭐
| Command | Has `--pane`? | Notes |
|---------|---------------|-------|
| `term orc status <session>` | ✅ | Detects Claude state (idle/working/permission/complete), confidence % |
| `term orc send <session> <msg>` | ✅ | Sends prompt, tracks completion. Has `--method`, `--timeout`, `--no-wait` |
| `term orc approve <session>` | ✅ | Approves permission requests |
| `term orc answer <session> <choice>` | ✅ | Answers interactive questions |
| `term orc run <session> <msg>` | ✅ | Fire-and-forget with auto-approve |
| `term orc watch <session>` | ✅ | Live event stream |
| `term orc start <session>` | ? | Haven't tested — starts Claude Code |
| `term orc methods` | ✅ | Lists completion detection methods (silence-Xs, state-detection, hybrid) |

### Worker Orchestration
| Command | Works? | Notes |
|---------|--------|-------|
| `term workers` | ❌ HANGS | Times out after 5s with no output |
| `term work <bd-id>` | ? | Spawns worker bound to beads issue |
| `term create <title>` | ✅ | Creates beads issue |
| `term close <task-id>` | ? | Not tested |
| `term kill <worker>` | ? | Not tested |
| `term approve <worker>` | ? | Not tested |
| `term answer <worker> <choice>` | ? | Not tested |

### Spawning
| Command | Notes |
|---------|-------|
| `term spawn [skill]` | Spawns Claude with skill. Interactive picker if no skill specified |
| `term brainstorm` | Spawns Claude with brainstorm skill |
| `term skills` | Shows "No skills found" — skills dir may not be configured |

### Other
| Command | Notes |
|---------|-------|
| `term hook list/set/rm` | No hooks configured currently |
| `term daemon status/start/stop` | Beads daemon not running. Legacy DB warning |
| `term shortcuts` | Generates tmux/termux keybinding configs |

---

## Bugs & Issues Found

### 1. `term read` has no pane targeting (CRITICAL)
Can't read output from a specific pane. Only reads the default pane of a session.
**Workaround:** `tmux capture-pane -t %1 -p -S -`

### 2. `term exec` creates ghost windows (ANNOYING)
`term exec genie "command"` doesn't run in an existing pane — creates a new "shell" window.
Leaves orphan windows that need manual cleanup.

### 3. `term send` without `-p` sends to %0 — DANGEROUS
Default sends to the human's terminal pane. I accidentally executed a command in Felipe's shell.

### 4. `term split` can't target a pane (RISKY)
Splits the active pane. I accidentally halved Claude Code's screen real estate.

### 5. `term workers` hangs (BUG)
Times out with no output. Probably related to beads daemon not running / legacy DB.

### 6. `term skills` shows nothing
"No skills found in .claude/skills/ or ~/.claude/skills/" — but skills exist in genie-cli plugins dir.

### 7. Beads legacy DB warning
`bd list` works but shows migration warning every time. Needs `bd migrate --update-repo-id`.

---

## The Right Way to Pilot Claude Code from OpenClaw

```bash
# Check state
term orc status genie --pane %1

# Send a prompt and wait for completion
term orc send genie --pane %1 "your prompt here"

# Send without waiting
term orc send genie --pane %1 "prompt" --no-wait

# Approve permission
term orc approve genie --pane %1

# Answer a question
term orc answer genie --pane %1 "1"

# Fire and forget with auto-approve
term run genie "prompt" -p %1 -a

# Read output (must use tmux directly)
tmux capture-pane -t %1 -p -S -    # full scrollback
tmux capture-pane -t %1 -p         # visible only
```

### Quick State Check Pattern
```bash
# One-liner: state + last output
term orc status genie --pane %1 --json 2>/dev/null | jq '{state, detail, confidence}'
```

---

## Recommendations for genie-cli

### Priority 1 (Blocks efficient AI piloting)
1. Add `-p, --pane <id>` to `term read` — most critical gap
2. Fix `term exec` to use existing panes (or add `--pane`)
3. Fix `term workers` hanging

### Priority 2 (Safety)
4. `term send` should WARN or REFUSE if no `-p` is given in multi-pane sessions
5. `term split` should accept `--pane` target

### Priority 3 (Polish)
6. Fix `term skills` to find skills in genie-cli plugins dir
7. Fix beads legacy DB (or suppress the warning)

---

_Updated: 2026-02-07_
