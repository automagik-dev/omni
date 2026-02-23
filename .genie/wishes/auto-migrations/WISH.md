# Wish: Auto-Migrations on API Startup

**Status:** IN_PROGRESS
**Slug:** `auto-migrations`
**Created:** 2026-02-23

---

## Summary

Add automatic Drizzle migration execution to the API startup sequence so that both embedded pgserve (PostgreSQL 17) and external PostgreSQL instances always have the correct schema — zero manual intervention. Reset the migration baseline to a single clean file matching the current schema.

---

## Scope

### IN
- Reset migration baseline: delete 9 broken files, generate one `0000_initial.sql`
- Rewrite `packages/db/src/migrate.ts` to export a programmatic `migrateDb(db)` function
- Export `migrateDb` from `@omni/db` package index
- Call `migrateDb(db)` in `packages/api/src/index.ts` between pgserve start and NATS connect
- Hard crash (exit 1) on migration failure — PM2 handles retry
- Add migration timing log
- Fix pgserve.ts comments (remove incorrect PGlite references)

### OUT
- `db-push` at runtime (stays as dev-only CLI tool)
- Rollback / down migrations (Drizzle doesn't support natively)
- Multi-tenant migration isolation
- Changes to the Drizzle schema itself
- Changes to ecosystem.config.cjs or PM2 config

---

## Decisions

- **DEC-1:** Use `migrate()` not `push()` at startup — `migrate()` is idempotent (tracks state in `__drizzle_migrations` table), `push()` is not (diffs live schema, no tracking, "already exists" failures).
- **DEC-2:** Fresh single-file baseline — all 9 existing migration files are broken/conflicting. Since data was just wiped, generate one clean `0000_initial.sql` from `schema.ts`.
- **DEC-3:** Hard crash on failure — a broken schema means nothing works. Better to fail loud and let PM2 exponential backoff handle retry than run degraded.
- **DEC-4:** Resolve migration folder via `import.meta.dirname` — avoids CWD-relative path bugs that plagued the old `migrate.ts`.

---

## Success Criteria

- [ ] Fresh pgserve start (empty `~/data/omni/`) → API boots with all tables, zero manual steps
- [ ] Second boot on existing data → migrations skipped ("already applied"), no errors
- [ ] `pm2 logs omni-v2-api` shows "Running database migrations" + "Database migrations complete" on every boot
- [ ] `make check` passes (typecheck + lint + test)
- [ ] No `db-push` required in any startup path

---

## Assumptions

- **ASM-1:** The current `packages/db/src/schema.ts` is the authoritative source of truth for the DB schema
- **ASM-2:** No existing production database needs to preserve migration history (data was wiped today)
- **ASM-3:** pgserve is full PostgreSQL 17 (native binaries, not WASM) — standard `drizzle-orm/postgres-js/migrator` works without compatibility concerns

## Risks

- **RISK-1:** `import.meta.dirname` may not resolve correctly in Bun — Mitigation: use `resolve(import.meta.dirname, '../drizzle')` and validate path exists before calling migrate
- **RISK-2:** Concurrent API instances could race on migrations — Mitigation: Drizzle uses DB advisory locks in `__drizzle_migrations` table. Standard PostgreSQL locking applies.

---

## Execution Groups

### Group A: Reset Migration Baseline

**Goal:** Replace 9 broken migration files with one clean baseline matching schema.ts.

**Deliverables:**
- Delete `packages/db/drizzle/` directory entirely
- Run `bunx drizzle-kit generate` to produce a single `0000_*.sql`
- Verify the generated SQL creates all tables from schema.ts

**Acceptance Criteria:**
- [ ] `packages/db/drizzle/` contains exactly one migration file + meta journal
- [ ] The SQL in the migration file creates all tables defined in `schema.ts`
- [ ] `ls packages/db/drizzle/meta/_journal.json` exists with one entry

**Validation:** `ls packages/db/drizzle/*.sql | wc -l` → outputs `1`

---

### Group B: Programmatic migrateDb() Function

**Goal:** Export a reusable `migrateDb(db)` function from `@omni/db` that runs all pending migrations.

**Deliverables:**
- Rewrite `packages/db/src/migrate.ts` — export `migrateDb(db: Database)` using absolute path resolution
- Export `migrateDb` from `packages/db/src/index.ts`
- Remove standalone `runMigrations()` / `process.exit()` logic (or keep as thin wrapper)

**Acceptance Criteria:**
- [ ] `migrateDb` is exported from `@omni/db`
- [ ] Uses `resolve(import.meta.dirname, '../drizzle')` for migration folder path
- [ ] No `process.exit()` in the exported function (caller controls lifecycle)

**Validation:** `grep 'export.*migrateDb' packages/db/src/index.ts` → matches

---

### Group C: Wire into API Startup + Fix pgserve Comments

**Goal:** Call `migrateDb(db)` on every API boot, between pgserve start and NATS connect. Fix incorrect PGlite references in pgserve.ts and ecosystem.config.cjs comments.

**Deliverables:**
- Import `migrateDb` from `@omni/db` in `packages/api/src/index.ts`
- Add migration call with timing log after `createDb()`, before `connectToNats()`
- Let migration errors propagate to top-level catch (hard crash)
- Fix comments in `packages/api/src/pgserve.ts` — pgserve is PostgreSQL 17, not PGlite
- Fix comments in `ecosystem.config.cjs` — same correction

**Acceptance Criteria:**
- [ ] API startup logs show "Running database migrations" and "Database migrations complete"
- [ ] Fresh pgserve (empty data dir) → API boots fully, health returns `healthy`
- [ ] Migration failure → API exits with code 1
- [ ] No references to "PGlite" in pgserve.ts or ecosystem.config.cjs
- [ ] `make check` passes

**Validation:** `pm2 delete omni-v2-api && set -a && . ./.env && set +a && pm2 start ecosystem.config.cjs && sleep 10 && curl -s http://localhost:8882/api/v2/health | grep healthy`

---

## Review Results

_Populated by `/review` after execution completes._

---

## Files to Create/Modify

```
packages/db/drizzle/           # DELETE all, regenerate via drizzle-kit
packages/db/src/migrate.ts     # REWRITE — export migrateDb()
packages/db/src/index.ts       # MODIFY — add migrateDb export
packages/api/src/index.ts      # MODIFY — add migrateDb() call in main()
packages/api/src/pgserve.ts    # MODIFY — fix PGlite → pgserve (PostgreSQL 17) in comments
ecosystem.config.cjs           # MODIFY — fix PGlite → pgserve (PostgreSQL 17) in comments
```
