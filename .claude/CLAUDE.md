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

**The API auto-migrates on startup.** Schema changes are **hand-written SQL
migrations** — do NOT run `drizzle-kit generate` (it is broken here; see the
comprehensive reference below for why).

```bash
# 1. Edit schema source of truth
vim packages/db/src/schema.ts

# 2. Hand-write an additive, idempotent migration with a header comment
#    (copy the style of 0043/0044/0052 in packages/db/drizzle/)
vim packages/db/drizzle/NNNN_short_name.sql

# 3. Append a journal entry by hand (idx = prev + 1, when = prev + 100000000)
vim packages/db/drizzle/meta/_journal.json

# 4. Verify against the contract gate
make verify-migrations

# 5. Commit migration + journal + schema together
git add packages/db/drizzle/ packages/db/src/schema.ts
```

**CRITICAL: `drizzle-kit push` and `migrateDb()` are incompatible.**
Push creates tables without journal entries. The API's auto-migrate then crashes
with "relation already exists". Never use push in CI or production.

**Never:**
- Edit, delete, or renumber a migration file that exists on the base branch
  (deployed migrations are immutable — the migrator tracks them by content hash)
- Add a migration without a journal entry, or vice versa
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

### Why migrations are hand-written (do not "fix" this)

`drizzle-kit generate` is **dead in this repo**: the `meta/*_snapshot.json`
files stop at `0026` while migrations continue past `0055`. Generate diffs
`schema.ts` against the LAST snapshot, so it compares against a ~30-migration-old
state and proposes recreating the world (or hangs on interactive rename
prompts). Regenerating snapshots is riskier than living without them — the API
auto-migrates on boot and is intolerant of journal drift, and 12+ deployed
migrations already follow the hand-written precedent. Do not attempt to
resurrect generate or add new snapshots.

### Schema Change Workflow (hand-written precedent — 0043/0044/0052)

```bash
# 1. Edit schema source of truth
vim packages/db/src/schema.ts

# 2. Hand-write the migration SQL (next free number, snake_case name)
vim packages/db/drizzle/0056_short_name.sql

# 3. Append a journal entry to packages/db/drizzle/meta/_journal.json:
#    {"idx": 56, "version": "7", "when": <prev when + 100000000>,
#     "tag": "0056_short_name", "breakpoints": true}

# 4. Verify against the contract gate (also runs in make check and CI)
make verify-migrations

# 5. Test — restart API (auto-migrates on boot)
pm2 restart omni-v2-api

# 6. Commit migration + journal + schema together
git add packages/db/drizzle/ packages/db/src/schema.ts
git commit -m "feat(db): add <description>"
```

**Migration SQL rules** (enforced by `scripts/verify-migration-contract.ts`):

- **Header comment first.** Open with a `--` comment block: what the migration
  adds, why, the issue/PR reference, and a line like
  `-- Hand-written following the 0043/0044/0052 precedent (additive, idempotent).`
- **Additive + idempotent.** `ADD COLUMN IF NOT EXISTS`,
  `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`. The boot migrator
  may race across replicas and re-run against half-migrated databases.
- **No destructive statements** — `DROP TABLE`, `DROP COLUMN`,
  `ALTER COLUMN ... TYPE`, `TRUNCATE` fail the gate. If one is genuinely
  required, add a header line `-- destructive: <justification>`; the gate then
  passes and the justification lands in the diff for review.
- **No explicit `BEGIN`/`COMMIT`.** The boot migrator runs each file on a
  pooled postgres-js connection that rejects raw transaction control.
- **`when` timestamps must strictly increase** — the migrator SILENTLY SKIPS
  entries whose `when` is out of order (see `packages/db/src/migrate.ts`).
- **schema.ts and the migration ship in the same PR.** Escape hatches for the
  rare exceptions: `// no-migration-needed: <why>` on a changed schema.ts line
  (type-only change), or `-- no-schema-change: <why>` in the migration header
  (data-only/backfill migration).

### Parallel-worktree numbering collisions

Multiple in-flight branches will often claim the same next number (e.g. two
PRs both adding `0056_*`). The contract gate fails the merge with a duplicate
`idx` / non-sequential journal. **Whoever merges second renumbers their OWN
migration**: rename the `.sql` file to the next free number, update the journal
entry's `tag` + `idx`, and bump `when` above the new previous entry. Never
renumber the migration that already landed.

### Make Targets

```bash
make verify-migrations  # Static migration contract gate (also in make check + CI)
make db-push            # Push schema directly (DEV ONLY, no journal)
make db-studio          # Open Drizzle Studio
make db-fix-journal     # Fix journal after migration consolidation
```

### Key Files

| File | Role |
|------|------|
| `packages/db/src/schema.ts` | Schema source of truth |
| `packages/db/drizzle/*.sql` | Migration SQL files |
| `packages/db/drizzle/meta/_journal.json` | Migration journal |
| `packages/db/src/migrate.ts` | Programmatic runner |
| `packages/api/src/index.ts:302` | Auto-migrate on startup |
| `scripts/verify-migration-contract.ts` | Static contract gate (make check + CI) |
| `scripts/verify-schema-drift.ts` | Live-DB drift audit — a DIFFERENT tool |

### NEVER

- Use `drizzle-kit push` in CI or production
- Edit, delete, or renumber migration files that have been deployed (they are
  immutable once on the base branch — the gate enforces byte-identity)
- Run `drizzle-kit generate` or regenerate `meta/` snapshots (frozen at 0026;
  see "Why migrations are hand-written")
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
