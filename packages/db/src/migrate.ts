/**
 * Database migration runner
 *
 * Usage: bun run packages/db/src/migrate.ts
 */

import { createLogger } from '@omni/core';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './client';

const log = createLogger('db:migrate');

async function runMigrations() {
  log.info('Running migrations');

  const db = createDb();

  try {
    await migrate(db, { migrationsFolder: './drizzle' });
    log.info('Migrations completed successfully');
  } catch (error) {
    log.error('Migration failed', { error: String(error) });
    process.exit(1);
  }

  process.exit(0);
}

runMigrations();
