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

/** Operator entry point named in the 0041 header and in the preflight error. */
export const ONLINE_DDL_COMMAND = 'bun run db:online-ddl --url <postgres-url>';

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

// ---------------------------------------------------------------------------
// Boot-path preflight
// ---------------------------------------------------------------------------

/**
 * Row count above which a blocking index build on a high-volume table is
 * treated as "will not finish inside the boot migration budget".
 *
 * `applyMigrations()` is raced against a 60s timeout at API boot
 * (`packages/api/src/index.ts`), and 0041 builds its indexes with the plain
 * (non-CONCURRENT) form. A million-row `messages` table therefore turns the
 * first boot of the G2 binary into a crash-loop: the transaction is killed,
 * rolled back, retried, killed again. The preflight converts that into ONE
 * actionable error naming the online-DDL phase.
 */
export const DEFAULT_LARGE_TABLE_ROWS = 1_000_000;

export interface OnlineDdlBlocker {
  readonly table: string;
  readonly estimatedRows: number;
  readonly missingIndexes: string[];
}

export interface OnlineDdlPreflight {
  /** True when at least one high-volume table would take a long blocking build. */
  readonly blocked: boolean;
  readonly threshold: number;
  readonly blockers: OnlineDdlBlocker[];
}

/** High-volume tables and the G2 indexes they need, from the single spec source. */
function highVolumeIndexPlan(): Map<string, string[]> {
  const plan = new Map<string, string[]>();
  for (const { statement, volume } of allIndexStatements()) {
    if (volume !== 'high') continue;
    const list = plan.get(statement.table) ?? [];
    list.push(statement.name);
    plan.set(statement.table, list);
  }
  return plan;
}

/** Index names that exist AND are valid/ready. An INVALID index does not count. */
async function readUsableIndexes(db: Database, names: readonly string[]): Promise<Set<string>> {
  if (names.length === 0) return new Set();
  const rows = (await db.execute(sql`
    SELECT c.relname::text AS relname
    FROM pg_class c
    JOIN pg_index i ON i.indexrelid = c.oid
    WHERE c.relkind = 'i'
      AND i.indisvalid
      AND i.indisready
      AND c.relname IN (${sql.join(
        names.map((n) => sql`${n}`),
        sql`, `,
      )})
  `)) as unknown as { relname: string }[];
  return new Set(rows.map((r) => r.relname));
}

/**
 * Estimated live-row counts for the named tables. `reltuples` is a planner
 * estimate — free to read, no scan. A table that does not exist yet (fresh
 * install) simply has no row here; a table that was never analyzed reports -1,
 * which this maps to `null` so the caller can decide.
 */
async function readRowEstimates(db: Database, tables: readonly string[]): Promise<Map<string, number | null>> {
  if (tables.length === 0) return new Map();
  const rows = (await db.execute(sql`
    SELECT c.relname::text AS relname, c.reltuples::float8 AS reltuples
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname IN (${sql.join(
        tables.map((t) => sql`${t}`),
        sql`, `,
      )})
  `)) as unknown as { relname: string; reltuples: number }[];
  return new Map(rows.map((r) => [r.relname, Number(r.reltuples) < 0 ? null : Number(r.reltuples)]));
}

/**
 * Bounded fallback for a table PostgreSQL has never analyzed: count at most
 * `limit` rows. Cheap on the case that matters (a fresh or small install stops
 * as soon as the table is exhausted) and capped on the case that does not.
 */
async function probeRowCount(db: Database, table: string, limit: number): Promise<number> {
  const rows = (await db.execute(
    sql.raw(`SELECT count(*)::int AS n FROM (SELECT 1 FROM "${table}" LIMIT ${limit}) probe`),
  )) as unknown as { n: number }[];
  return Number(rows[0]?.n ?? 0);
}

/**
 * Would running the transactional 0041 index builds right now block a large
 * table for longer than the boot budget?
 *
 * A NO-OP on every install that is small, fresh, or already migrated: it reads
 * two catalog views and returns `blocked: false`. It only reports a blocker when
 * a high-volume table both (a) is missing at least one G2 index and (b) holds at
 * least `threshold` rows.
 */
export async function checkOnlineDdlPreflight(
  db: Database,
  threshold: number = DEFAULT_LARGE_TABLE_ROWS,
): Promise<OnlineDdlPreflight> {
  const plan = highVolumeIndexPlan();
  const wantedIndexes = [...plan.values()].flat();
  const usable = await readUsableIndexes(db, wantedIndexes);

  const pending = [...plan.entries()]
    .map(([table, indexes]) => ({ table, missingIndexes: indexes.filter((name) => !usable.has(name)) }))
    .filter((entry) => entry.missingIndexes.length > 0);

  if (pending.length === 0) return { blocked: false, threshold, blockers: [] };

  const estimates = await readRowEstimates(
    db,
    pending.map((p) => p.table),
  );
  const blockers: OnlineDdlBlocker[] = [];

  for (const entry of pending) {
    const estimate = estimates.get(entry.table);
    // Absent from pg_class → the table does not exist yet (fresh install).
    if (estimate === undefined) continue;
    const rows = estimate ?? (await probeRowCount(db, entry.table, threshold));
    if (rows >= threshold) {
      blockers.push({ table: entry.table, estimatedRows: rows, missingIndexes: entry.missingIndexes });
    }
  }

  return { blocked: blockers.length > 0, threshold, blockers };
}

/** The operator-facing text for a blocked preflight. Exported so tests can pin it. */
export function onlineDdlPreflightMessage(preflight: OnlineDdlPreflight): string {
  const detail = preflight.blockers
    .map((b) => `  - ${b.table}: ~${Math.round(b.estimatedRows)} rows, missing ${b.missingIndexes.join(', ')}`)
    .join('\n');
  return [
    `Refusing to run migration 0041 in-band: it builds indexes with a blocking CREATE INDEX on table(s) holding at least ${preflight.threshold} rows, which will exceed the boot migration timeout and crash-loop this process.`,
    detail,
    'Run the online phase first (no long lock, resumable):',
    `  ${ONLINE_DDL_COMMAND}`,
    'then start again — the migration will find every index present and take no long lock. Set OMNI_ALLOW_BLOCKING_INDEX_BUILD=on to override (accepts the downtime).',
  ].join('\n');
}
