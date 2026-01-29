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
