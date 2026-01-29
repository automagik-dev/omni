# Agent Instructions

> Omni v2 - Universal Event-Driven Omnichannel Platform

This project uses the **WISH → FORGE → REVIEW** workflow with **beads** for issue tracking.

## Workflow Overview

```
/wish    → Plan and document requirements
/forge   → Execute the approved wish
/review  → Validate completed work
/council → Get multi-perspective review on decisions
```

## Quick Start

```bash
# Planning
/wish                         # Start planning a feature

# Execution (inline)
/forge                        # Execute in current session

# Execution (spawned sessions)
/forge --spawn                # Spawn tmux session with worktree
/forge --spawn --parallel     # Parallel sessions per group
/forge --spawn --group A      # Spawn only group A

# Validation
/review                       # Final validation

# Decisions
/council                      # Get council review on architecture
```

## Beads Issue Tracking

```bash
# Finding work
bd ready                              # Show ready issues (no blockers)
bd list                               # List all open issues
bd show <id>                          # View issue details

# Creating issues
bd create "title" --type feature      # Create feature issue
bd create "title" --type bug          # Create bug issue
bd create "title" --type task         # Create task issue
bd q "quick title"                    # Quick capture (outputs ID only)

# Working on issues
bd update <id> --status in_progress   # Claim work
bd close <id>                         # Complete work

# Syncing
bd sync                               # Export to JSONL (sync with git)
```

**Issue types:** `task`, `bug`, `feature`, `chore`, `epic`

## Agent Hierarchy

### Orchestrators
- **WISH** - Planning phase, creates structured requirements
- **FORGE** - Execution phase, coordinates specialists
- **REVIEW** - Validation phase, final verdict

### Council (Advisory)
10 perspectives for architectural decisions:
- `questioner` - Challenges assumptions
- `architect` - Systems thinking
- `benchmarker` - Performance analysis
- `simplifier` - Complexity reduction
- `sentinel` - Security auditing
- `ergonomist` - Developer experience
- `operator` - Operations concerns
- `deployer` - Deployment readiness
- `measurer` - Observability
- `tracer` - Production debugging

### Specialists (Execution)
- `implementor` - Feature implementation
- `tests` - Test coverage
- `refactor` - Code restructuring
- `git` - Version control
- `commit` - Commit creation
- `fix` - Bug fixes
- `polish` - Code cleanup
- `qa` - Quality assurance

## Wish Document Location

Wishes are stored in: `.wishes/<slug>/<slug>-wish.md`

## Parallel Execution (Spawn Mode)

Forge can spawn isolated tmux sessions with git worktrees for parallel work.

**When to spawn:**
- Multiple groups can run in parallel
- Want isolated environment per task
- Long-running tasks you want to monitor

**How it works:**
```bash
/forge --spawn --parallel
```

This creates for each group:
1. Git worktree at `~/.worktrees/omni-v2/<slug>-<group>-<id>/`
2. Tmux session named `<slug>-<group>-<id>`
3. Claude session executing that group's tasks

**Managing spawned sessions:**
```bash
tmux ls                           # List all sessions
tmux attach -t <session>          # Attach to session
tmux capture-pane -t <session> -p # See session output
tmux kill-session -t <session>    # Kill session
```

**Cleanup after wish ships:**
```bash
git worktree remove ~/.worktrees/omni-v2/<session>
tmux kill-session -t <session>
git merge feat/<session>
```

**If you ARE a spawned session:**
- You're in a worktree, not main repo
- Execute your assigned group only
- Commit to your feature branch
- Close your beads issue when done
- Exit when complete

## Landing the Plane (Session Completion)

**When ending a work session**, complete ALL steps below.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work**
   ```bash
   bd create "Remaining task description" --type task
   ```

2. **Run quality gates** (if code changed)
   ```bash
   make check  # typecheck + lint + test
   ```

3. **Update issue status**
   ```bash
   bd close <id>
   bd sync
   ```

4. **PUSH TO REMOTE** (MANDATORY)
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```

5. **Verify and hand off**
   - All changes committed AND pushed
   - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing
- If push fails, resolve and retry

## Tech Stack

- **Runtime:** Bun (not Node.js)
- **Language:** TypeScript (strict)
- **HTTP:** Hono
- **API:** tRPC + OpenAPI
- **Database:** PostgreSQL + Drizzle
- **Events:** NATS JetStream
- **Validation:** Zod

## Key Commands

```bash
make dev          # Start development
make test         # Run tests
make typecheck    # Type checking
make lint         # Linting
make check        # All quality checks
make db-push      # Push schema changes
make db-studio    # Open Drizzle Studio
```

## Project Structure

```
packages/
├── core/           # Events, identity, schemas
├── api/            # HTTP API (Hono + tRPC)
├── channel-sdk/    # Plugin SDK
├── channel-*/      # Channel implementations
├── cli/            # LLM-optimized CLI
├── sdk/            # Auto-generated SDK
└── mcp/            # MCP Server

.claude/
├── agents/         # Agent definitions
├── commands/       # Slash commands
└── hooks/          # Automation hooks

.wishes/            # Wish documents
```

## Never Do

- Use npm/yarn/pnpm (use Bun)
- Skip events for state changes
- Mix channel logic in core
- Use `any` types
- Leave uncommitted work
- Stop without pushing
