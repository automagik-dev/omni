/**
 * Database migration runner
 *
 * Usage: bun run packages/db/src/migrate.ts
 *        or import { applyMigrations } from '@omni/db' for programmatic use.
 *
 * Validates that all migration files were applied after running.
 * Throws if there is a count mismatch — Drizzle can silently skip migrations
 * when journal timestamps are out-of-order relative to applied timestamps.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createLogger } from '@omni/core';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './client';
import type { Database } from './client';
import { DEFAULT_LARGE_TABLE_ROWS, checkOnlineDdlPreflight, onlineDdlPreflightMessage } from './online-ddl';

const log = createLogger('db:migrate');

/** Escape hatch for an operator who has accepted the blocking-build downtime. */
export const BLOCKING_INDEX_OVERRIDE_ENV_VAR = 'OMNI_ALLOW_BLOCKING_INDEX_BUILD';

export interface ApplyMigrationsOptions {
  /**
   * Refuse to start a blocking 0041 index build on a table too large to finish
   * inside the boot migration budget. Defaults to on; a no-op on every install
   * that is small, fresh, or already migrated.
   */
  readonly onlineDdlPreflight?: boolean;
  /** Row count that makes a blocking build unsafe. */
  readonly largeTableRows?: number;
  /** Environment consulted for the override. Injectable for tests. */
  readonly env?: Record<string, string | undefined>;
}

/**
 * Fail loudly, once, instead of crash-looping on a timed-out index build.
 *
 * Exported so a deployment can run the same check before rolling a new binary.
 */
export async function assertOnlineDdlPreflight(db: Database, options: ApplyMigrationsOptions = {}): Promise<void> {
  if (options.onlineDdlPreflight === false) return;
  const env = options.env ?? process.env;
  if (env[BLOCKING_INDEX_OVERRIDE_ENV_VAR] === 'on') {
    log.warn('Blocking index build explicitly allowed; skipping online-DDL preflight');
    return;
  }
  const preflight = await checkOnlineDdlPreflight(db, options.largeTableRows ?? DEFAULT_LARGE_TABLE_ROWS);
  if (!preflight.blocked) return;
  throw new Error(onlineDdlPreflightMessage(preflight));
}

/**
 * Advisory lock key serializing migrate-on-boot across concurrent processes
 * (e.g. multiple k8s replicas booting at once). Arbitrary constant — must be
 * unique among any advisory locks this application ever takes.
 */
const MIGRATION_LOCK_ID = 772_005_770;

function countMigrationFiles(migrationsFolder: string): number {
  const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8'));
  return (journal.entries as unknown[]).length;
}

/**
 * Apply pending migrations and validate that all files are applied.
 *
 * The whole run is serialized under a Postgres advisory lock: the drizzle
 * postgres-js migrator takes no lock of its own, so two pods booting
 * concurrently would race `CREATE ... IF NOT EXISTS` on drizzle's bookkeeping
 * catalog (not concurrency-safe → unique violations / transient CrashLoop).
 * `pg_advisory_xact_lock` is acquired inside a wrapper transaction — a single
 * dedicated connection holds it and it is released automatically on
 * commit/rollback (even if the process dies mid-migration), so concurrent
 * boots queue up and then find the work already done.
 *
 * @param db - Drizzle database instance
 * @param migrationsFolder - Path to the drizzle migrations folder
 * @throws if the applied count in DB is less than the number of migration files
 * @throws if a pending 0041 index build would block a table too large to finish
 *   inside the boot budget — see {@link assertOnlineDdlPreflight}
 */
export async function applyMigrations(
  db: Database,
  migrationsFolder: string,
  options: ApplyMigrationsOptions = {},
): Promise<void> {
  const fileCount = countMigrationFiles(migrationsFolder);

  // Outside the wrapper transaction: a refusal must not hold the advisory lock,
  // and the check reads only catalog views.
  await assertOnlineDdlPreflight(db, options);

  await db.transaction(async (tx) => {
    log.info('Acquiring migration advisory lock', { lockId: MIGRATION_LOCK_ID });
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_ID})`);
    log.info('Migration advisory lock acquired');

    await migrate(db, { migrationsFolder });

    // Guard: Drizzle silently skips migrations whose journal 'when' timestamp
    // is earlier than the last applied migration's created_at.
    // Detect this by comparing file count against applied row count.
    const result = await db.execute(sql`SELECT count(*) AS count FROM drizzle.__drizzle_migrations`);
    const appliedCount = Number((result[0] as { count: string }).count);

    if (appliedCount < fileCount) {
      throw new Error(
        `Migration count mismatch: ${appliedCount} applied, ${fileCount} files. ${fileCount - appliedCount} migration(s) were silently skipped. Ensure _journal.json "when" timestamps are strictly increasing.`,
      );
    }

    log.info('All migrations applied', { appliedCount, fileCount });
  });
}

// Script entry point (bun run src/migrate.ts)
if (import.meta.main) {
  const log2 = createLogger('db:migrate:cli');
  log2.info('Running migrations');

  const db = createDb();
  const migrationsFolder = './drizzle';

  applyMigrations(db, migrationsFolder)
    .then(() => {
      log2.info('Migrations completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      log2.error('Migration failed', { error: String(error) });
      process.exit(1);
    });
}
