# Omni v2

> Universal Event-Driven Omnichannel Platform

**Read @AGENTS.md for full workflow documentation.**

**See @.claude/CLAUDE.md for detailed development guidelines.**

## Quick Reference

```
/wish    → Plan features (WISH phase)
/forge   → Execute plans (FORGE phase)
/review  → Validate work (REVIEW phase)
/council → Architectural review
```

## Essentials

- **Runtime:** Bun only (never npm/yarn/node)
- **Language:** TypeScript (strict, no `any`)
- **Events:** NATS JetStream (events are source of truth)
- **Validation:** Zod schemas on all external inputs
- **Database:** PostgreSQL + Drizzle ORM

## Commands

```bash
make dev          # Start development
make test         # Run tests
make check        # All quality checks (typecheck + lint + test)
make db-push      # Push schema changes
```

## Project Structure

```
packages/
├── core/           # Events, identity, schemas (shared)
├── api/            # HTTP API (Hono + tRPC)
├── channel-sdk/    # Plugin SDK for channels
├── channel-*/      # Channel implementations
├── cli/            # LLM-optimized CLI
└── mcp/            # MCP Server

.claude/            # AI workflow (agents, commands, hooks)
.wishes/            # Wish documents
```

## Never Do

- Use npm/yarn/pnpm (use `bun`)
- Skip events for state changes
- Mix channel logic in core
- Use `any` types
- Commit without running `make check`
