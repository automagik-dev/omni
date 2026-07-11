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

const log = createLogger('db:migrate');

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
 */
export async function applyMigrations(db: Database, migrationsFolder: string): Promise<void> {
  const fileCount = countMigrationFiles(migrationsFolder);

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
