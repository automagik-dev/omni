/**
 * Programmatic database migration runner
 *
 * Runs all pending Drizzle migrations. Safe to call on every startup —
 * already-applied migrations are tracked in __drizzle_migrations and skipped.
 */

import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { Database } from './client';

/**
 * Run all pending Drizzle migrations.
 * Safe to call on every startup — already-applied migrations are skipped.
 */
export async function migrateDb(db: Database): Promise<void> {
  const migrationsFolder = resolve(import.meta.dirname, '../drizzle');
  await migrate(db, { migrationsFolder });
}
