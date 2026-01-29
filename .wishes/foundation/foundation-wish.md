# WISH: Project Foundation

> Initialize Bun monorepo with core packages and local dev infrastructure

**Status:** SHIPPED
**Created:** 2026-01-29
**Author:** WISH Agent

---

## Problem Statement

The project has planning docs and a database schema, but no runnable code. Can't install dependencies, run tests, or start development. Need foundation before parallelizing work across agents.

## Alignment

| ID | Type | Description |
|----|------|-------------|
| **ASM-1** | Assumption | Bun installed and available globally |
| **DEC-1** | Decision | Bun workspaces for monorepo structure |
| **DEC-2** | Decision | PM2 for local service management (pgserve, nats-server) |
| **DEC-3** | Decision | pgserve for PostgreSQL (`bunx pgserve`) |
| **DEC-4** | Decision | NATS binary auto-download on first use |
| **DEC-5** | Decision | Turborepo for build orchestration |
| **DEC-6** | Decision | Per-service `*_MANAGED=true` flags for PM2 control |
| **DEC-7** | Decision | Biome for linting/formatting (fast, Rust-based) |

## Scope

### IN SCOPE

- Root `package.json` with Bun workspaces
- Root `turbo.json` for build orchestration
- `packages/core/` - shared events, types, Zod schemas
- `packages/db/` - Drizzle ORM setup, migrations
- `.env.example` with documented variables
- `ecosystem.config.cjs` for PM2
- `scripts/ensure-nats.sh` - downloads NATS binary if missing
- Updated `Makefile` with service management
- Biome configuration for lint/format
- TypeScript project references
- `make check` passes
- `make dev` starts all required services

### OUT OF SCOPE

- `packages/api/` - HTTP server (next wish)
- `packages/channel-sdk/` - plugin SDK
- `packages/channel-*/` - channel implementations
- `packages/cli/` - CLI tool
- `packages/sdk/` - generated SDK
- `packages/mcp/` - MCP server
- UI migration
- Any feature development

---

## Execution Group A: Monorepo Structure

**Goal:** Initialize Bun workspace with proper package structure

**Deliverables:**
- [ ] Root `package.json` with workspaces config
- [ ] Root `turbo.json` for task orchestration
- [ ] Root `tsconfig.json` with project references
- [ ] `biome.json` for linting/formatting
- [ ] `.gitignore` updates (node_modules, .env, etc.)

**Files to create:**
```
package.json
turbo.json
tsconfig.json
biome.json
```

**Acceptance Criteria:**
- [ ] `bun install` completes without errors
- [ ] Workspace packages are linked correctly

**Validation:**
```bash
bun install
bun pm ls
```

---

## Execution Group B: Core Package

**Goal:** Create shared package with events, types, and Zod schemas

**Deliverables:**
- [ ] `packages/core/package.json`
- [ ] `packages/core/tsconfig.json`
- [ ] `packages/core/src/index.ts` - main exports
- [ ] `packages/core/src/events/` - event type definitions
- [ ] `packages/core/src/schemas/` - Zod schemas (matching DB schema)
- [ ] `packages/core/src/types/` - shared TypeScript types
- [ ] `packages/core/src/errors.ts` - typed error classes
- [ ] `packages/core/src/ids.ts` - ID generation utilities

**Package structure:**
```
packages/core/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── errors.ts
    ├── ids.ts
    ├── events/
    │   ├── index.ts
    │   ├── types.ts
    │   └── bus.ts (interface only)
    ├── schemas/
    │   ├── index.ts
    │   ├── message.ts
    │   ├── person.ts
    │   ├── instance.ts
    │   └── common.ts
    └── types/
        ├── index.ts
        ├── channel.ts
        └── agent.ts
```

**Acceptance Criteria:**
- [ ] Package builds without errors
- [ ] Types can be imported from `@omni/core`
- [ ] Zod schemas validate correctly
- [ ] Event types match DB schema event types

**Validation:**
```bash
bun run --filter @omni/core typecheck
```

---

## Execution Group C: Database Package & Dev Infrastructure

**Goal:** Proper Drizzle setup and local service management

**Deliverables:**
- [ ] `packages/db/package.json`
- [ ] `packages/db/tsconfig.json`
- [ ] `packages/db/drizzle.config.ts`
- [ ] `packages/db/src/index.ts` - connection + schema exports
- [ ] `packages/db/src/client.ts` - database client
- [ ] `packages/db/src/migrate.ts` - migration runner
- [ ] `.env.example` with all required variables
- [ ] `ecosystem.config.cjs` for PM2
- [ ] `scripts/ensure-nats.sh` - NATS binary installer
- [ ] Updated `Makefile` with working targets

**Environment variables (.env.example):**
```env
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:8432/omni
PGSERVE_MANAGED=true
PGSERVE_PORT=8432
PGSERVE_DATA=./.pgserve-data

# NATS
NATS_URL=nats://localhost:4222
NATS_MANAGED=true

# General
NODE_ENV=development
LOG_LEVEL=debug
```

**PM2 ecosystem (ecosystem.config.cjs):**
```javascript
module.exports = {
  apps: [
    {
      name: 'pgserve',
      script: 'bunx',
      args: 'pgserve --port 8432 --data ./.pgserve-data',
      env: { /* ... */ }
    },
    {
      name: 'nats',
      script: './bin/nats-server',
      args: '-js', // JetStream enabled
    }
  ]
}
```

**Makefile targets:**
```makefile
dev           # Start services + watch mode
dev-services  # Start pgserve + nats via PM2
dev-stop      # Stop PM2 services
db-push       # Push schema to database
db-migrate    # Run migrations
db-studio     # Open Drizzle Studio
check         # typecheck + lint + test
typecheck     # bun run typecheck
lint          # biome check
test          # bun test
ensure-nats   # Download NATS binary if missing
```

**Acceptance Criteria:**
- [ ] `make dev-services` starts pgserve and nats (when MANAGED=true)
- [ ] `make dev-stop` stops services cleanly
- [ ] `make db-push` pushes schema to database
- [ ] `make check` runs all quality gates
- [ ] Database connection works
- [ ] NATS connection works

**Validation:**
```bash
cp .env.example .env
make ensure-nats
make dev-services
make db-push
make check
make dev-stop
```

---

## Technical Notes

### pgserve
- Source: https://github.com/namastexlabs/pgserve
- Run with: `bunx pgserve --port 8432 --data ./.pgserve-data`
- Default creates databases on demand
- Has pgvector built-in

### NATS Server
- Docs: https://docs.nats.io/running-a-nats-service/introduction/installation
- Download: `curl -fsSL https://binaries.nats.dev/nats-io/nats-server/v2@latest | sh`
- Run with JetStream: `./nats-server -js`
- Default port: 4222

### Package naming
- Scope: `@omni/`
- Packages: `@omni/core`, `@omni/db`

---

## Success Criteria

After this wish is forged:

1. **Developer can start working:**
   ```bash
   git clone <repo>
   cp .env.example .env
   bun install
   make dev
   ```

2. **Quality gates work:**
   ```bash
   make check  # All pass
   ```

3. **Parallel work enabled:**
   - Other agents can create `packages/api/`
   - Other agents can create `packages/channel-sdk/`
   - All can import from `@omni/core`

---

## Beads Tracking

```bash
bd add "feat: project foundation setup"
```

---

## Next Wishes (Out of Scope)

1. **api-setup** - Hono + tRPC HTTP server
2. **channel-sdk** - Plugin SDK for channels
3. **nats-integration** - Event bus implementation
4. **cli-setup** - LLM-optimized CLI

---

## Review Verdict

**Verdict:** SHIP
**Date:** 2026-01-29

### Acceptance Criteria

| Criterion | Status | Evidence |
|-----------|--------|----------|
| `bun install` completes | PASS | 91 packages installed |
| Workspace packages linked | PASS | `@omni/core`, `@omni/db` in `bun pm ls` |
| Core package typechecks | PASS | `tsc --noEmit` exit 0 |
| Core exports work | PASS | events, schemas, types, errors, ids present |
| DB package typechecks | PASS | `tsc --noEmit` exit 0 |
| `.env.example` present | PASS | All variables documented |
| PM2 ecosystem works | PASS | pgserve + nats online |
| `make dev-services` works | PASS | Services start via PM2 |
| `make check` passes | PASS | typecheck + lint + test all pass |
| NATS binary installer | PASS | `scripts/ensure-nats.sh` downloads v2.10.24 |

### Findings

| Severity | Finding |
|----------|---------|
| LOW | Minor formatting in ecosystem.config.cjs (auto-fixed) |

### Recommendation

**SHIP** - All acceptance criteria pass. Foundation ready for parallel development.

**Next steps:**
1. Push to remote
2. Start next wish (api-setup or channel-sdk)
