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
/wish                    # Start planning a feature

# Execution
/forge                   # Execute an approved wish

# Validation
/review                  # Final validation

# Decisions
/council                 # Get council review on architecture
```

## Beads Issue Tracking

```bash
bd ready                              # Find available work
bd show <id>                          # View issue details
bd update <id> --status in_progress   # Claim work
bd close <id>                         # Complete work
bd sync                               # Sync with git
```

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

## Landing the Plane (Session Completion)

**When ending a work session**, complete ALL steps below.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work**
   ```bash
   bd add "Remaining task description"
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
