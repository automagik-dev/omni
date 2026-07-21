/**
 * Online DDL phase for the G2 additive ownership schema
 * (wish: omni-full-multitenancy, Group G2).
 *
 * WHY THIS EXISTS
 * ---------------
 * `applyMigrations()` runs the whole drizzle migrator inside ONE transaction
 * under an advisory lock, and API startup times migrations out after 60 seconds.
 * `CREATE INDEX CONCURRENTLY` cannot run inside a transaction block, and a
 * blocking index build on a table the size of `messages` would hold a write lock
 * well past that timeout. So the index builds get their own phase, outside the
 * migration runner, on a connection that never opens a transaction.
 *
 * WHAT IT DOES
 * ------------
 * Exactly the statements migration 0041 also contains, in their CONCURRENTLY
 * form, plus the `ADD COLUMN` statements they depend on:
 *
 *   1. `ALTER TABLE ... ADD COLUMN IF NOT EXISTS "tenant_id" uuid` — nullable,
 *      no default, so PostgreSQL 11+ records a catalog change and never
 *      rewrites the table. Milliseconds even on the largest table.
 *   2. every G2 index, with `CREATE INDEX CONCURRENTLY IF NOT EXISTS`.
 *
 * It adds NO constraint and NO trigger: those are metadata-only in 0041 and
 * belong in the transactional migration where they can be rolled back together.
 *
 * RECOVERY
 * --------
 * An interrupted `CREATE INDEX CONCURRENTLY` leaves an INVALID index behind that
 * `IF NOT EXISTS` will happily skip forever, and a composite foreign key cannot
 * reference it. Before building, this runner finds any INVALID/not-ready index
 * it owns, drops it with `DROP INDEX CONCURRENTLY`, and rebuilds. That makes the
 * phase safely re-runnable after any failure.
 *
 * ORDERING
 * --------
 * Both orders converge, because every statement in both phases is idempotent:
 *   * fresh/small install: `db:migrate` alone is sufficient; running this phase
 *     afterwards is a no-op.
 *   * large install: run this phase FIRST, then `db:migrate` — the migration
 *     finds every column and index present and only adds `NOT VALID`
 *     constraints and triggers, taking no long lock.
 *
 * This is a repository-local, non-production mechanism. It reads no ambient
 * `DATABASE_URL`; the caller passes the target explicitly.
 */

import { sql } from 'drizzle-orm';
import type { Database } from './client';
import { addColumnStatements, allIndexStatements } from './tenancy-ownership';

export interface OnlineDdlStep {
  readonly kind: 'column' | 'index' | 'repair';
  readonly name: string;
  readonly statement: string;
  readonly skipped: boolean;
}

export interface OnlineDdlReport {
  readonly steps: OnlineDdlStep[];
  readonly repaired: string[];
  readonly built: string[];
}

/** Indexes this phase owns, in dependency-free order. */
export function onlineIndexStatements(): { name: string; table: string; statement: string }[] {
  return allIndexStatements().map(({ statement }) => ({
    name: statement.name,
    table: statement.table,
    statement: statement.concurrent,
  }));
}

/**
 * Names of G2 indexes that exist but are INVALID or not ready — the residue of
 * an interrupted concurrent build. They must be dropped before a rebuild.
 */
export async function findBrokenIndexes(db: Database, names: readonly string[]): Promise<string[]> {
  if (names.length === 0) return [];
  const rows = await db.execute<{ relname: string }>(sql`
    SELECT c.relname
    FROM pg_class c
    JOIN pg_index i ON i.indexrelid = c.oid
    WHERE c.relkind = 'i'
      AND (NOT i.indisvalid OR NOT i.indisready)
      AND c.relname IN (${sql.join(
        names.map((n) => sql`${n}`),
        sql`, `,
      )})
  `);
  return (rows as unknown as { relname: string }[]).map((r) => r.relname);
}

/**
 * Apply the online phase.
 *
 * Every statement runs on its own, never inside a transaction — the caller must
 * pass a `Database` whose driver does not wrap statements implicitly (the
 * postgres-js client used here does not).
 *
 * @param db - target database. NEVER an ambient production connection.
 * @param onProgress - optional per-statement callback for operator output.
 */
export async function applyOnlineTenantDdl(
  db: Database,
  onProgress?: (step: OnlineDdlStep) => void,
): Promise<OnlineDdlReport> {
  const steps: OnlineDdlStep[] = [];
  const repaired: string[] = [];
  const built: string[] = [];

  const record = (step: OnlineDdlStep): void => {
    steps.push(step);
    onProgress?.(step);
  };

  // 1. Nullable columns. Catalog-only; no table rewrite.
  for (const statement of addColumnStatements()) {
    await db.execute(sql.raw(statement));
    record({ kind: 'column', name: statement, statement, skipped: false });
  }

  const indexes = onlineIndexStatements();

  // 2. Repair the residue of any interrupted concurrent build.
  const broken = await findBrokenIndexes(
    db,
    indexes.map((i) => i.name),
  );
  for (const name of broken) {
    const statement = `DROP INDEX CONCURRENTLY IF EXISTS "${name}";`;
    await db.execute(sql.raw(statement));
    repaired.push(name);
    record({ kind: 'repair', name, statement, skipped: false });
  }

  // 3. Build concurrently. `IF NOT EXISTS` makes a re-run cheap.
  for (const index of indexes) {
    await db.execute(sql.raw(index.statement));
    built.push(index.name);
    record({ kind: 'index', name: index.name, statement: index.statement, skipped: false });
  }

  return { steps, repaired, built };
}
