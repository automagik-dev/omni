# Agent Instructions

> Omni v2 - Universal Event-Driven Omnichannel Platform

This project uses the **WISH → FORGE → REVIEW** workflow with **beads** for issue tracking and **genie-cli** for worker orchestration.

## Workflow Overview

```
/wish    → Plan and document requirements
/forge   → Execute the approved wish
/qa      → Integration testing (actually test the system)
/review  → Validate completed work
/council → Get multi-perspective review on decisions
```

## Quick Start

```bash
# Planning
/wish                         # Start planning a feature

# Execution (spawned workers - RECOMMENDED)
/forge --spawn                # Spawn worker in isolated worktree
/forge --spawn --parallel     # Parallel workers per group
term work <beads-id>          # Direct worker spawn

# Execution (inline - for quick fixes only)
/forge                        # Execute in current session (requires feature branch)

# Integration Testing
/qa                           # Full QA (API + CLI + Integration + Regression)
/qa --api                     # API testing only
/qa --cli                     # CLI testing only
/qa --ui                      # UI testing with Playwright
/qa --regression              # Regression suite only

# Validation
/review                       # Final validation

# Decisions
/council                      # Get council review on architecture
```

## Genie CLI (Worker Orchestration)

The project uses **genie-cli** for tmux-based worker orchestration.

### Launch Claude

```bash
claudio                       # Launch with default LLM profile
claudio <profile>             # Launch with specific profile
claudio profiles list         # List available profiles
```

### Worker Commands (term)

```bash
# Spawn workers
term work <beads-id>          # Spawn worker bound to issue
term work next                # Work on next ready issue
term spawn <skill>            # Spawn with specific skill

# Monitor workers
term workers                  # List all workers and states
term dashboard                # Live status dashboard
term dashboard --watch        # Auto-refresh dashboard

# Cleanup
term close <beads-id>         # Close issue + cleanup worker
term ship <beads-id>          # Close + merge to main
term kill <worker>            # Force kill stuck worker

# Session management
term ls                       # List tmux sessions
term new <name>               # Create new session
term attach <name>            # Attach to session
term read <session>           # Read session output
term exec <session> <cmd>     # Execute command in session
```

### Daemon

```bash
term daemon start             # Auto-sync beads across workers
term daemon status            # Check daemon status
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

# Dependencies
bd dep add <issue> <blocker>          # Issue depends on blocker
bd dep list <id>                      # List dependencies
bd blocked                            # Show all blocked issues
bd graph --all                        # Visualize dependency tree
```

**Issue types:** `task`, `bug`, `feature`, `chore`, `epic`

**Dependency flow:** When a blocker is closed, dependent issues become ready.

## Agent Hierarchy

### Orchestrators
- **WISH** - Planning phase, creates structured requirements
- **FORGE** - Execution phase, coordinates specialists
- **QA** - Testing phase, validates system actually works
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

### Skills (Methodology)

Skills enforce discipline and methodology. Located in `.claude/skills/`.

| Skill | When to Use |
|-------|-------------|
| `debug` | Before fixing any bug - enforces root cause investigation |
| `integration-tdd` | For API/service changes - test first with fixtures |
| `verification-gate` | Before claiming completion - evidence before claims |

**Usage:**
- Skills are referenced by commands (forge, review, qa)
- Use `debug` skill before attempting fixes
- Use `integration-tdd` for API endpoints
- Verification gate is enforced in forge self-review and review verdict

## Wish Document Location

Wishes are stored in: `.wishes/<slug>/<slug>-wish.md`

## Spawn Mode (Recommended for Features)

Forge spawns workers via `term` CLI with isolated git worktrees.

**Why spawn mode is recommended:**
- **Isolation**: Clean worktree prevents workspace pollution
- **Baseline verification**: Tests run before any work starts
- **Parallel execution**: Multiple groups can run simultaneously
- **No main branch risk**: Cannot accidentally commit to main

**When to use spawn mode:**
- Any feature with 2+ execution groups
- Changes affecting 3+ packages
- Long-running implementation tasks
- When you want monitoring via dashboard

**When inline is acceptable:**
- Quick single-file fixes
- Already on a feature branch
- Simple changes with one execution group

**How it works:**
```bash
# Via forge command
/forge --spawn --parallel

# Or directly via term
term work <beads-id>              # Spawn single worker
term work <beads-id-A>            # Spawn parallel workers
term work <beads-id-B>
```

This creates for each worker:
1. Git worktree at `.worktrees/<beads-id>/`
2. Tmux pane bound to the beads issue
3. Claude session executing the task

**Managing workers:**
```bash
term workers                      # List all workers and states
term dashboard --watch            # Live status dashboard
term read <session>               # Read session output
term attach <session>             # Attach to session
```

**Cleanup after wish ships:**
```bash
term ship <beads-id>              # Close + merge to main + cleanup
# Or manually:
term close <beads-id>             # Close issue + cleanup worker
```

**If you ARE a spawned worker:**
- You're in a worktree, not main repo
- Execute your assigned task only
- Commit to your feature branch
- Run `bd close <id>` when done (or `term close` from orchestrator)
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

## Commands: Use Make First

**ALWAYS check `make help` before running raw commands.** The Makefile wraps common tasks with proper setup, environment loading, and error handling.

```bash
make help         # Show all available commands (START HERE)
```

### Quick Reference

| Task | Command |
|------|---------|
| Full setup | `make setup` |
| Start dev | `make dev` |
| Run checks | `make check` |
| Lint | `make lint` |
| Typecheck | `make typecheck` |
| Generate SDK | `make sdk-generate` |
| Restart API | `make restart-api` |
| Run CLI | `make cli ARGS="--help"` |
| Install CLI globally | `make cli-link` |

### Development
```bash
make dev          # Start all services + API
make dev-api      # Start just the API (manual mode)
make dev-services # Start PostgreSQL + NATS + API via PM2
```

### Quality Checks
```bash
make check        # All checks: typecheck + lint + test
make typecheck    # TypeScript only
make lint         # Biome linter
make lint-fix     # Auto-fix lint issues
make test         # All tests
make test-api     # API package tests only
make test-file F=<path>  # Specific test file
```

### Individual Services
```bash
make restart-api     # Restart API only
make restart-nats    # Restart NATS only
make restart-pgserve # Restart PostgreSQL only
make logs-api        # View API logs
```

### CLI
```bash
make cli ARGS="--help"    # Run CLI from source
make cli-build            # Build CLI package
make cli-link             # Build + link globally (omni command)
```

### SDK
```bash
make sdk-generate   # Generate SDK from OpenAPI spec
```

### Database
```bash
make db-push      # Push schema changes (dev)
make db-studio    # Open Drizzle Studio
```

### Migrations
```bash
make migrate-messages-dry  # Dry run: events → messages
make migrate-messages      # Live migration
```

**When to use raw commands:** Only for edge cases not covered by make targets (e.g., specific bun flags, one-off debugging).

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
- Run raw commands without checking `make help` first
- Bypass make commands for common tasks (tests, lint, typecheck)
