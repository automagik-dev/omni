/**
 * Database migration runner
 *
 * Usage: bun run packages/db/src/migrate.ts
 */

import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './client';

async function runMigrations() {
  console.log('Running migrations...');

  const db = createDb();

  try {
    await migrate(db, { migrationsFolder: './drizzle' });
    console.log('Migrations completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }

  process.exit(0);
}

runMigrations();
