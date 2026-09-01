# Omni v2 - Technical Reference

> Code patterns, refactoring guidelines, and distributed documentation standards.
> For workflow, agents, and commands see @AGENTS.md.

## Code Patterns

### Event Publishing

```typescript
// Always publish events for state changes
await eventBus.publish({
  type: 'message.received',
  payload: {
    instanceId,
    channelType: 'whatsapp',
    message,
  },
  metadata: {
    correlationId: generateId(),
    timestamp: Date.now(),
  },
});
```

### Zod Schema First

```typescript
// Define schema once, derive types
export const MessageSchema = z.object({
  id: z.string().uuid(),
  content: z.string(),
  sender: PersonReferenceSchema,
  timestamp: z.number(),
});

export type Message = z.infer<typeof MessageSchema>;
```

### Channel Plugin Pattern

```typescript
// Channel plugins implement the ChannelPlugin interface
export const whatsappPlugin: ChannelPlugin = {
  id: 'whatsapp-baileys',
  name: 'WhatsApp (Baileys)',

  async initialize(config) { /* ... */ },
  async sendMessage(instanceId, message) { /* ... */ },
  async handleWebhook(req) { /* ... */ },

  events: {
    'message.received': handleIncoming,
    'message.sent': handleOutgoing,
  },
};
```

### Error Handling

```typescript
// Use typed errors with context
import { OmniError, ErrorCode } from '@omni/core';

throw new OmniError({
  code: ErrorCode.CHANNEL_NOT_CONNECTED,
  message: 'WhatsApp instance not connected',
  context: { instanceId },
  recoverable: true,
});
```

## Database Schema Changes

**The API auto-migrates on startup.** Schema changes use Drizzle migrations, not push.

```bash
# 1. Edit schema
vim packages/db/src/schema.ts

# 2. Generate migration
cd packages/db && bunx drizzle-kit generate

# 3. Commit migration + schema together
git add packages/db/drizzle/ packages/db/src/schema.ts
```

**CRITICAL: `drizzle-kit push` and `migrateDb()` are incompatible.**
Push creates tables without journal entries. The API's auto-migrate then crashes
with "relation already exists". Never use push in CI or production.

**Never:**
- Delete deployed migration files
- Hand-edit migration SQL (hash must match)
- Squash migrations without a journal fix script
- Use `drizzle-kit push` in CI (use `pg_isready` for readiness)

## Refactoring Guidelines

When Biome reports `noExcessiveCognitiveComplexity` or suggests extracting helpers:

### Before Creating New Helpers

**ALWAYS search for existing utilities first:**

```bash
rg "function (format|parse|transform|validate|convert)" packages/
rg "export (function|const)" packages/*/src/utils/
rg "export" packages/core/src/utils/
```

### Common Utility Locations

| Type | Check Here First |
|------|------------------|
| String/formatting | `packages/core/src/utils/` |
| Validation helpers | `packages/core/src/schemas/` |
| Date/time utilities | `packages/core/src/utils/` |
| ID generation | `packages/core/src/identity/` |
| Error helpers | `packages/core/src/errors/` |
| Channel-specific | `packages/channel-*/src/utils/` |

### When Extracting Functions

1. **Search first** - grep/glob for similar existing functions
2. **Reuse if exists** - Import and use the existing helper
3. **Extend if close** - If a helper does 80% of what you need, extend it
4. **Create if truly new** - Only create new helpers when no suitable option exists
5. **Place correctly** - Shared in `@omni/core`, package-specific in local `utils/`

### Refactoring Strategies

- **Early returns** - Reduce nesting by returning early for edge cases
- **Guard clauses** - Handle invalid states at the top of functions
- **Compose small functions** - Prefer many small functions over one large one
- **Single responsibility** - Each function should do one thing well

## Distributed Documentation

Each package/directory should have its own CLAUDE.md with package-specific patterns, local conventions, and integration notes.

```
packages/core/CLAUDE.md      # Core package patterns
packages/api/CLAUDE.md       # API conventions
packages/channel-*/CLAUDE.md # Channel-specific notes
```

---

## Bun Ecosystem (Mandatory Compliance)

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

---

## Project Structure

```
omni-v2/
├── packages/
│   ├── core/           # Events, identity, schemas (shared)
│   ├── api/            # HTTP API (Hono + tRPC + OpenAPI)
│   ├── channel-sdk/    # Plugin SDK for channel developers
│   ├── channel-*/      # Official channel implementations
│   ├── cli/            # LLM-optimized CLI
│   └── sdk/            # Auto-generated TypeScript SDK
├── apps/
│   └── ui/             # React dashboard
├── docs/               # Documentation
├── scripts/            # Build, deploy, SDK generation
├── .claude/            # AI workflow (agents, commands, hooks, skills)
└── .genie/             # Genie workspace (wishes, brainstorms, state)
```

---

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

---

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

### SDK

```bash
make sdk-generate   # Generate SDK from OpenAPI spec
```

**When to use raw commands:** Only for edge cases not covered by make targets (e.g., specific bun flags, one-off debugging).

---

## Database & Migrations (Comprehensive Reference)

**The API auto-migrates on startup** via `migrateDb()` in `packages/api/src/index.ts`.
Schema changes flow through Drizzle migrations, NOT `drizzle-kit push`.

**`drizzle-kit push` and `migrateDb()` are INCOMPATIBLE.** Push creates tables without
migration journal entries. Migrate then crashes with "relation already exists". NEVER
use `drizzle-kit push` in CI, production, or any pipeline that also runs `migrateDb()`.
`db-push` is a local dev convenience ONLY.

### Schema Change Workflow

```bash
# 1. Edit schema source of truth
vim packages/db/src/schema.ts

# 2. Generate migration (creates SQL + updates journal)
cd packages/db && bunx drizzle-kit generate

# 3. Review generated SQL
cat packages/db/drizzle/NNNN_<name>.sql

# 4. Test — restart API (auto-migrates on boot)
pm2 restart omni-v2-api

# 5. Commit migration + schema together
git add packages/db/drizzle/ packages/db/src/schema.ts
git commit -m "feat(db): add <description>"
```

### Make Targets

```bash
make db-push          # Push schema directly (DEV ONLY, no journal)
make db-studio        # Open Drizzle Studio
make db-fix-journal   # Fix journal after migration consolidation
```

### Key Files

| File | Role |
|------|------|
| `packages/db/src/schema.ts` | Schema source of truth |
| `packages/db/drizzle/*.sql` | Migration SQL files |
| `packages/db/drizzle/meta/_journal.json` | Migration journal |
| `packages/db/src/migrate.ts` | Programmatic runner |
| `packages/api/src/index.ts:302` | Auto-migrate on startup |

### NEVER

- Use `drizzle-kit push` in CI or production
- Delete migration files that have been deployed
- Hand-edit migration SQL without recomputing the SHA256 hash
- Squash migrations without a journal fix script
- Mix push and migrate in the same environment

### Data Migrations

```bash
make migrate-messages-dry  # Dry run: events → messages
make migrate-messages      # Live migration
```

---

## Git Workflow — AI-First with Public Verification

### The Simple Rule

> **New work = PR to dev. Fixes = direct commit to dev.**

```
main (public verification) <── dev <── feature PRs (auto-merge)
              ▲               |
          human PR             └── direct commits (fixes/hotfixes)
```

Promotion is a carry-exact, direct `dev` → `main` PR that a human merges. `dev`
is the integration branch; `main` is the protected public verification branch,
and the version is never re-bumped during promotion.

The `main` workflow is verification-only and checks the already-published
immutable candidate without building, publishing, retagging, or changing a
runtime. `hml.omni.khal.ai` is the legacy HML endpoint.
This change neither mutates nor cleans it up. The endpoint and its HML runtime
and configuration files remain legacy/reference-only, not an active public
branch, tag, channel, or gate. Production authority is separate/private and
lives outside this public repository.

### Branch Roles

| Branch | Purpose | Who commits | Protection |
|--------|---------|-------------|------------|
| `main` | Read-only verification of the reviewed public candidate | Human merges `dev → main` promotion PR | PR-only, all checks required |
| `dev` | Integration | Agent + PRs | Direct commits OK, PRs need checks |
| `feat/*` | New features | Worktrees, PR to `dev` | Auto-merge when green |
| `fix/*` | Bug fixes | Direct on `dev` or worktree | — |

### Promotion (dev → main)

Open when `dev` is ahead of `main` and green. Carry-exact (no version re-bump).
A human merges after CI passes; the protected `main` path then verifies the
fixed candidate and existing public artifacts without publishing anything.

### Conventional Commits (Required)

All commits must follow the format: `type(scope): description`

| Type | When |
|------|------|
| `feat` | New feature |
| `fix` | Bug fix |
| `chore` | Maintenance, deps, config |
| `docs` | Documentation only |
| `refactor` | Code restructuring |
| `test` | Adding/fixing tests |
| `ci` | CI/CD changes |

**Examples:**
```
feat(api): add batch message endpoint
fix(lint): resolve biome warnings in channel-telegram
chore(merge): resolve conflicts with main
ci(rolling-pr): update workflow permissions
```

**Enforcement:** commitlint via husky (local) + GitHub Actions (CI gate)

### Zero-Tolerance Quality

- **No warnings** — biome strict mode, `--error-on-warnings`
- **No skips** — monitor test output for `.skip` patterns
- **No failures** — CI must be green; fix red states immediately

### Agent Responsibilities

1. **Monitor all gates** — zero tolerance for warnings/skips/failures
2. **Fix issues** — direct commit to dev with conventional format
3. **Resolve conflicts** — `git merge origin/main` (merge commits, not rebase)
4. **Notify human** — label + channel message when rolling PR is green

### Public Release Boundary

- Integration versioning happens on `dev`.
- The reviewed version carries unchanged into `main`.
- The public `main` path only verifies existing immutable artifacts.
- Production release and runtime decisions belong to the separate/private
  authority.

---

## Technical Never Do

- **Don't code on main** — it is the protected public verification branch,
  rolling PR only. Use `dev` for development, `feat/*` for features. If
  `git branch --show-current` returns `main`, STOP immediately.
- Don't use non-conventional commit messages (all commits must be `type(scope): description`)
- Don't create nightly branches (deprecated — use feature PR to dev flow)
- Don't use npm/yarn/pnpm (use Bun exclusively)
- Don't mix channel logic in core (channels are plugins)
- Don't skip event publishing for state changes
- Don't use raw SQL (use Drizzle)
- Don't create REST endpoints without OpenAPI docs
- Don't skip Zod validation on external inputs
- Don't hardcode channel-specific behavior in core
- Don't use `any` types
- Don't leave uncommitted work
- Don't stop without pushing
- Don't bypass make commands for common tasks
