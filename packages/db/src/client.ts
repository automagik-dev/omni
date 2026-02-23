/**
 * Database client configuration
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * Database configuration options
 */
export interface DbConfig {
  url: string;
  maxConnections?: number;
  idleTimeout?: number;
  connectTimeout?: number;
}

/**
 * Get default database URL from environment
 */
export function getDefaultDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  return url;
}

/**
 * Raw postgres.js connection pool — stored so closeDb() can call .end()
 */
let sqlClient: postgres.Sql | null = null;

/**
 * Create a postgres client
 */
export function createPostgresClient(config?: Partial<DbConfig>) {
  const url = config?.url ?? getDefaultDatabaseUrl();

  const client = postgres(url, {
    max: config?.maxConnections ?? 10,
    idle_timeout: config?.idleTimeout ?? 20,
    connect_timeout: config?.connectTimeout ?? 10,
  });
  sqlClient = client;
  return client;
}

/**
 * Create a Drizzle database instance
 */
export function createDb(config?: Partial<DbConfig>) {
  const client = createPostgresClient(config);
  return drizzle(client, { schema });
}

/**
 * Database type for use in other packages
 */
export type Database = ReturnType<typeof createDb>;

/**
 * Singleton database instance
 */
let dbInstance: Database | null = null;

/**
 * Get or create the database instance
 */
export function getDb(config?: Partial<DbConfig>): Database {
  if (!dbInstance) {
    dbInstance = createDb(config);
  }
  return dbInstance;
}

/**
 * Close the database connection
 * Drains all postgres.js pooled connections so transaction locks are released.
 */
export async function closeDb(): Promise<void> {
  if (sqlClient) {
    await sqlClient.end({ timeout: 5 });
    sqlClient = null;
  }
  dbInstance = null;
}
