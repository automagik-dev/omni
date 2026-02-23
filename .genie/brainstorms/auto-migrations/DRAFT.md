# Brainstorm: Auto-Migrations on API Startup

## Problem
The Omni API has zero schema management at startup. Embedded pgserve creates a fresh PGlite database, but the API never applies the Drizzle schema — it crashes at runtime when tables/columns are missing. Manual `db-push` or `migrate` is required every time, and the migrate script itself has multiple failure modes (relative paths, missing env vars, "relation already exists" on fresh DBs).

## Current Architecture
- `packages/db/` — Drizzle schema + client + broken migrate.ts
- `packages/api/src/pgserve.ts` — starts embedded PGlite, returns DATABASE_URL
- `packages/api/src/index.ts` — calls `startEmbeddedPgserve()` then `createDb()`, NO migration step
- `packages/db/drizzle/` — 9 migration files (0000-0008), journal tracks them
- `drizzle.config.ts` — uses `db-push` paradigm (schema-first, not migration-first)

## Gap
Between lines 293 and 297 of `packages/api/src/index.ts`:
```
const databaseUrl = await startEmbeddedPgserve(pgserveConfig);
// ← MISSING: ensure schema is applied
const db = createDb({ url: databaseUrl });
```

## WRS Dimensions
- Problem: ✅ (clear)
- Scope: ░ (push vs migrate? dev-only vs prod?)
- Decisions: ░ (strategy TBD)
- Risks: ░ (data loss, perf, PGlite compat)
- Criteria: ░ (what "works" means)
