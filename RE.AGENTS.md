# Agent Instructions

> Omni v2 - Universal Event-Driven Omnichannel Platform

## Philosophy

Omni v2 is an **event-first, plugin-based** messaging platform. Every design decision prioritizes:

1. **Events as source of truth** - Every action produces an event
2. **Plugin isolation** - Channels are plugins, not core code
3. **Type safety** - End-to-end TypeScript with Zod schemas
4. **LLM-native** - Built for AI agent consumption

---

<EXTREMELY_IMPORTANT>
## Bun Ecosystem - Mandatory Compliance

This project uses **Bun exclusively**. You MUST follow these rules without exception.

| Task | MUST Use | NEVER Use |
|------|----------|-----------|
| Install packages | `bun install`, `bun add` | `npm install`, `yarn add`, `pnpm add` |
| Run scripts | `bun run <script>` | `npm run`, `yarn`, `pnpm run` |
| Execute binaries | `bunx <cmd>` | `npx`, `yarn dlx`, `pnpm dlx` |
| Run TypeScript | `bun <file.ts>` | `node`, `ts-node`, `tsx` |
| Run tests | `bun test` | `jest`, `vitest`, `npm test` |
| Watch mode | `bun --watch` | `nodemon`, `ts-node-dev` |

If you catch yourself about to run a prohibited command, STOP and use the Bun equivalent.
</EXTREMELY_IMPORTANT>

---

## Tech Stack (Locked Decisions)

| Category | Use This | Not This |
|----------|----------|----------|
| Runtime | Bun | Node.js |
| Language | TypeScript (strict) | JavaScript |
| HTTP Framework | Hono | Express, Fastify |
| Type-safe API | tRPC | GraphQL, REST-only |
| Database ORM | Drizzle | Prisma, TypeORM |
| Database | PostgreSQL | MySQL, MongoDB |
| Event Bus | NATS JetStream | Redis Pub/Sub, RabbitMQ |
| Validation | Zod | Joi, Yup |
| Monorepo | Turborepo | Nx, Lerna |
| Process Manager | PM2 | Forever, systemd |

## Project Structure

```
omni-v2/
├── packages/
│   ├── core/           # Events, identity, schemas (shared)
│   ├── api/            # HTTP API (Hono + tRPC + OpenAPI)
│   ├── channel-sdk/    # Plugin SDK for channel developers
│   ├── channel-*/      # Official channel implementations
│   ├── cli/            # LLM-optimized CLI
│   ├── sdk/            # Auto-generated TypeScript SDK
│   └── mcp/            # MCP Server for AI assistants
├── apps/
│   └── ui/             # React dashboard
├── docs/               # Documentation
├── scripts/            # Build, deploy, SDK generation
├── .claude/            # AI workflow (agents, commands, hooks, skills)
└── .wishes/            # Wish documents
```

## Where to Put Things

| What | Where | Why |
|------|-------|-----|
| Event definitions | `packages/core/src/events/` | Single source of truth |
| Zod schemas | `packages/core/src/schemas/` | Shared validation |
| Database schema | `packages/core/src/db/` | Drizzle schema |
| API endpoints | `packages/api/src/routes/` | HTTP handlers |
| tRPC routers | `packages/api/src/trpc/` | Type-safe internal API |
| Channel plugins | `packages/channel-*/` | Isolated per channel |
| Shared types | `packages/core/src/types/` | TypeScript interfaces |
| CLI commands | `packages/cli/src/commands/` | LLM-optimized CLI |

## Commands: Use Make First

**ALWAYS check `make help` before running raw commands.** The Makefile wraps common tasks with proper setup, environment loading, and error handling.

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
make dev-api      # Start just the API
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

### SDK & Database
```bash
make sdk-generate   # Generate SDK from OpenAPI spec
make db-push        # Push schema changes (dev)
make db-studio      # Open Drizzle Studio
```

### Migrations
```bash
make migrate-messages-dry  # Dry run: events → messages
make migrate-messages      # Live migration
```

**When to use raw commands:** Only for edge cases not covered by make targets (e.g., specific bun flags, one-off debugging).

## Workflow: WISH → FORGE → QA → REVIEW

```
/wish    → Plan and document requirements
/forge   → Execute the approved wish
/qa      → Integration testing (actually test the system)
/review  → Validate completed work
/council → Get multi-perspective review on decisions
```

### Quick Start

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

### Wish Documents

Stored in: `.wishes/<slug>/<slug>-wish.md`

## Genie CLI (Worker Orchestration)

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

## Spawn Mode (Recommended for Features)

Forge spawns workers via `term` CLI with isolated git worktrees.

**When to use spawn mode:**
- Any feature with 2+ execution groups
- Changes affecting 3+ packages
- Long-running implementation tasks

**When inline is acceptable:**
- Quick single-file fixes
- Already on a feature branch
- Simple changes with one execution group

**How it works:**
```bash
/forge --spawn --parallel       # Via forge command
term work <beads-id>            # Or directly via term

# Parallel workers
term work <beads-id-A>
term work <beads-id-B>
```

Creates for each worker:
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

Located in `.claude/skills/`.

| Skill | When to Use |
|-------|-------------|
| `debug` | Before fixing any bug - enforces root cause investigation |
| `integration-tdd` | For API/service changes - test first with fixtures |
| `verification-gate` | Before claiming completion - evidence before claims |
| `frontend-design` | For UI/dashboard work |

## Landing the Plane (Session Completion)

**MANDATORY WORKFLOW when ending a work session:**

1. **File issues for remaining work** — `bd create "Remaining task" --type task`
2. **Run quality gates** — `make check`
3. **Update issue status** — `bd close <id> && bd sync`
4. **PUSH TO REMOTE** (MANDATORY):
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Verify and hand off** — provide context for next session

**CRITICAL:** Work is NOT complete until `git push` succeeds. NEVER stop before pushing.

## Never Do

- Use npm/yarn/pnpm (use Bun)
- Mix channel logic in core (channels are plugins)
- Skip event publishing for state changes
- Use raw SQL (use Drizzle)
- Create REST endpoints without OpenAPI docs
- Skip Zod validation on external inputs
- Hardcode channel-specific behavior in core
- Use `any` types
- Leave uncommitted work
- Stop without pushing
- Bypass make commands for common tasks
