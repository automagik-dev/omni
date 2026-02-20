/**
 * Embedded pgserve lifecycle
 *
 * Starts PGlite (via pgserve) in-process so the API owns the database.
 * Eliminates orphan-process / EADDRINUSE issues from running pgserve as a
 * separate PM2 service.
 *
 * Controlled by env vars:
 *   PGSERVE_EMBEDDED  — 'true' (default) to start in-process, 'false' to skip
 *   PGSERVE_PORT      — port for the embedded PostgreSQL proxy (default 8432)
 *   PGSERVE_DATA      — data directory path; omit or empty for memory mode
 */

import { createLogger } from '@omni/core';
import { getDefaultDatabaseUrl } from '@omni/db';

const log = createLogger('api:pgserve');

export interface PgserveConfig {
  enabled: boolean;
  port: number;
  dataDir: string | null;
}

// biome-ignore lint/suspicious/noExplicitAny: pgserve has no type declarations
let serverInstance: any | null = null;

/**
 * Read pgserve-related env vars and return a typed config object.
 */
export function resolvePgserveConfig(): PgserveConfig {
  const enabled = (process.env.PGSERVE_EMBEDDED ?? 'true') === 'true';
  const port = Number.parseInt(process.env.PGSERVE_PORT ?? '8432', 10);
  const raw = process.env.PGSERVE_DATA;
  const dataDir = raw && raw.trim().length > 0 ? raw.trim() : null;

  return { enabled, port, dataDir };
}

/**
 * Start the embedded pgserve server.
 *
 * Returns the DATABASE_URL to use for connections.
 * If PGSERVE_EMBEDDED is false, returns the existing DATABASE_URL / default.
 */
export async function startEmbeddedPgserve(config: PgserveConfig): Promise<string> {
  if (!config.enabled) {
    const url = process.env.DATABASE_URL ?? getDefaultDatabaseUrl();
    log.info('Embedded pgserve disabled, using external database', { url: url.replace(/\/\/.*@/, '//***@') });
    return url;
  }

  log.info('Starting embedded pgserve', {
    port: config.port,
    mode: config.dataDir ? 'persistent' : 'memory',
    dataDir: config.dataDir ?? '(in-memory)',
  });

  try {
    const { startMultiTenantServer } = await import('pgserve');

    serverInstance = await startMultiTenantServer({
      port: config.port,
      baseDir: config.dataDir,
      autoProvision: true,
      enablePgvector: true,
      logLevel: 'warn',
    });

    const databaseUrl = `postgresql://postgres:postgres@localhost:${config.port}/omni`;
    log.info('Embedded pgserve ready', { port: config.port, databaseUrl: databaseUrl.replace(/\/\/.*@/, '//***@') });
    return databaseUrl;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);

    // EADDRINUSE — another process already holds the port; fall through
    if (msg.includes('EADDRINUSE') || msg.includes('address already in use')) {
      log.warn('Port already in use, assuming external pgserve is running', { port: config.port });
      const databaseUrl = `postgresql://postgres:postgres@localhost:${config.port}/omni`;
      return databaseUrl;
    }

    throw error;
  }
}

/**
 * Stop the embedded pgserve server (safe to call if never started).
 */
export async function stopEmbeddedPgserve(): Promise<void> {
  if (!serverInstance) return;

  log.info('Stopping embedded pgserve');
  try {
    await serverInstance.stop();
    log.info('Embedded pgserve stopped');
  } catch (error) {
    log.warn('Error stopping pgserve (non-fatal)', { error: String(error) });
  } finally {
    serverInstance = null;
  }
}
