/**
 * @omni/db - Database package
 *
 * Provides Drizzle ORM schema and client for PostgreSQL.
 */

// Schema exports
export * from './schema';

// Client exports
export { createDb, createPostgresClient, getDb, closeDb, getDefaultDatabaseUrl } from './client';
export type { Database, DbConfig } from './client';

// Migration exports
export { applyMigrations } from './migrate';

// Schema drift verification
export {
  verifyCriticalColumns,
  formatDriftReport,
  API_CRITICAL_COLUMNS,
} from './verify-schema';
export type { ColumnExpectation, ColumnDrift, DriftReport } from './verify-schema';
