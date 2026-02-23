# Design: Auto-Migrations on API Startup

## Problem
The Omni API has zero schema management at startup. Embedded pgserve (PostgreSQL 17 native binaries) creates a fresh database, but the API never applies the Drizzle schema — it crashes at runtime when tables/columns are missing. Manual `db-push` or `migrate` is required every time.

## Context: What is pgserve?
pgserve (`@namastexlabs/pgserve`) is an **embedded PostgreSQL 17 server** using native binaries — NOT PGlite/WASM. It provides:
- Real PostgreSQL 17 with full extension support (including pgvector)
- Zero-config auto-provisioning of databases
- Memory, RAM (`/dev/shm`), or persistent storage modes
- `startMultiTenantServer()` API for programmatic embedding

Since pgserve IS real PostgreSQL, there are zero compatibility concerns with standard Drizzle migrations.

## Scope

### IN
- Auto-run `migrate()` on every API startup (between pgserve init and DB consumer init)
- Fresh single-file migration baseline (delete 0000-0008, generate one `0000_initial`)
- Export `migrateDb()` from `@omni/db` for programmatic use
- Hard crash on migration failure (exit 1, let PM2 restart with backoff)
- Works seamlessly for both embedded pgserve and external PostgreSQL
- Fix incorrect PGlite references in codebase comments

### OUT
- `db-push` at runtime (keep as dev-only CLI convenience, not startup path)
- Rollback/down migrations (Drizzle doesn't natively support them; out of scope)
- Multi-tenant migration isolation (single database, single schema)

## Decision: `migrate()` at startup, always

**Why not `push`?**
- `push` is NOT idempotent — it diffs live schema vs code and generates ALTER statements
- On a DB created with `push`, there's no `__drizzle_migrations` table, so `migrate()` replays everything and gets "already exists" errors
- `push` is designed for prototyping, not production

**Why `migrate()`?**
- Idempotent — tracks applied migrations in `__drizzle_migrations` table
- Works on fresh DB (applies all) and existing DB (applies only new)
- Standard production pattern per Drizzle docs
- Audit trail of schema changes in git
- Full PostgreSQL compatibility guaranteed (pgserve = PG17)

## Implementation

### 1. Reset migration baseline
```bash
rm -rf packages/db/drizzle/
cd packages/db && bunx drizzle-kit generate
```
Produces one clean `0000_*.sql` file matching the current schema.

### 2. Export `migrateDb()` from `@omni/db`

```typescript
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { resolve } from 'node:path';
import type { Database } from './client';

export async function migrateDb(db: Database): Promise<void> {
  const migrationsFolder = resolve(import.meta.dirname, '../drizzle');
  await migrate(db, { migrationsFolder });
}
```

### 3. Call `migrateDb()` in API startup

Between pgserve start and NATS connect:
```typescript
const databaseUrl = await startEmbeddedPgserve(pgserveConfig);
const db = createDb({ url: databaseUrl });

log.info('Running database migrations');
await migrateDb(db);
log.info('Database migrations complete');
```

### 4. Hard crash on failure
Let errors propagate. PM2 exponential backoff handles retry.

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| `import.meta.dirname` resolution in Bun | Use `resolve()` with known relative path, validate existence |
| Migration path differs from push-created DB | Fresh baseline eliminates this — all DBs start from `0000_initial` |
| Concurrent API instances racing on migrations | Standard PostgreSQL advisory locks via Drizzle's `__drizzle_migrations` table |

## Acceptance Criteria

1. Fresh pgserve start → API boots with all tables, zero manual steps
2. External PostgreSQL → `migrate()` applies pending migrations, skips applied
3. Migration failure → API exits(1), PM2 restarts with backoff
4. `pm2 logs` shows migration log lines on every boot
5. No `db-push` required in any startup flow

## Sources
- [pgserve — namastexlabs/pgserve](https://github.com/namastexlabs/pgserve)
- [Drizzle Migrations Docs](https://orm.drizzle.team/docs/migrations)
- [Drizzle `migrate()` API](https://orm.drizzle.team/docs/drizzle-kit-migrate)
