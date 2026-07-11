/**
 * Database client configuration
 */

import { readFileSync } from 'node:fs';
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
  /** Path to a PEM CA bundle; enables full TLS server verification (verify-full). */
  sslCaFile?: string;
}

/**
 * TLS options for postgres.js, derived from config or environment.
 *
 * When a CA bundle path is provided (DbConfig.sslCaFile or the
 * DATABASE_SSL_CA_FILE env var), the connection verifies the server
 * certificate chain against that bundle AND the hostname — the
 * sslmode=verify-full semantics that a bare `?sslmode=require` URL cannot
 * provide (managed-Postgres CAs like RDS are not in the system trust store).
 * Explicit options here override any sslmode query parameter in the URL, so
 * `require` in the URL stays a safe fallback when no bundle is mounted.
 *
 * Deliberately NOT honoring libpq's PGSSLROOTCERT: an ambient shell variable
 * would force TLS onto sslmode=disable deployments (the CLI spreads
 * process.env into PM2-started servers). Only the omni-specific opt-ins count.
 */
export function resolveSslConfig(
  caFile?: string,
  env: Record<string, string | undefined> = process.env,
): { ca: string; rejectUnauthorized: true } | undefined {
  const path = caFile || env.DATABASE_SSL_CA_FILE;
  if (!path) {
    return undefined;
  }
  return { ca: readFileSync(path, 'utf8'), rejectUnauthorized: true };
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
  const ssl = resolveSslConfig(config?.sslCaFile);

  const client = postgres(url, {
    max: config?.maxConnections ?? 10,
    idle_timeout: config?.idleTimeout ?? 20,
    connect_timeout: config?.connectTimeout ?? 10,
    ...(ssl ? { ssl } : {}),
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
