/**
 * Embedded pgserve lifecycle
 *
 * Starts an embedded PostgreSQL 17 server (via pgserve) in-process so the API owns the database.
 * Eliminates orphan-process / EADDRINUSE issues from running pgserve as a
 * separate PM2 service.
 *
 * Controlled by env vars:
 *   PGSERVE_EMBEDDED  — 'true' (default) to start in-process, 'false' to skip
 *   PGSERVE_PORT      — port for the embedded PostgreSQL proxy (default 8432)
 *   PGSERVE_DATA      — data directory path; defaults to ~/.omni/data/pgserve (set to empty string for memory mode)
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '@omni/core';
import { getDefaultDatabaseUrl } from '@omni/db';

const log = createLogger('api:pgserve');

const MAX_PORT_RETRIES = 10;

export interface PgserveConfig {
  enabled: boolean;
  port: number;
  dataDir: string | null;
}

/** Minimal shape of the pgserve server instance (pgserve ships no type declarations). */
interface PgserveInstance {
  stop(): Promise<void>;
}

let serverInstance: PgserveInstance | null = null;

/**
 * Read pgserve-related env vars and return a typed config object.
 */
export function resolvePgserveConfig(): PgserveConfig {
  const enabled = (process.env.PGSERVE_EMBEDDED ?? 'true') === 'true';
  const port = Number.parseInt(process.env.PGSERVE_PORT ?? '8432', 10);
  const raw = process.env.PGSERVE_DATA;
  // Default to persistent storage inside ~/.omni/data/pgserve — never memory mode unless explicitly empty
  const defaultDataDir = join(homedir(), '.omni', 'data', 'pgserve');
  const dataDir = raw !== undefined && raw.trim().length === 0 ? null : raw?.trim() || defaultDataDir;

  return { enabled, port, dataDir };
}

function isAddressInUse(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  // pgserve throws "Failed to listen on 0.0.0.0:<port>" when the proxy port is taken
  return msg.includes('EADDRINUSE') || msg.includes('address already in use') || msg.includes('Failed to listen on');
}

function buildDatabaseUrl(port: number): string {
  return `postgresql://postgres:postgres@localhost:${port}/omni`;
}

type StartServerFn = (opts: Record<string, unknown>) => Promise<PgserveInstance>;

async function tryStartOnPort(startFn: StartServerFn, port: number, config: PgserveConfig): Promise<string | null> {
  try {
    serverInstance = await startFn({
      port,
      baseDir: config.dataDir,
      autoProvision: true,
      enablePgvector: true,
      logLevel: 'warn',
    });
    return buildDatabaseUrl(port);
  } catch (error: unknown) {
    if (isAddressInUse(error)) return null;
    throw error;
  }
}

/**
 * Kill any orphaned postgres process left over from a previous run.
 *
 * When bun crashes hard (OOM, uncaught throw before signal handlers register,
 * or --watch-triggered internal restart) the postgres child process survives
 * because it is owned by the OS-level bun process. On the next run pgserve
 * creates a new socket directory, but postgres is still listening on the old
 * one → every proxy connection fails with "Failed to connect".
 *
 * Reading postmaster.pid from the data directory lets us find and terminate
 * the orphan before pgserve tries to start a fresh instance.
 */
async function killOrphanedPostgres(dataDir: string): Promise<void> {
  const pidFile = join(dataDir, 'postmaster.pid');
  if (!existsSync(pidFile)) return;

  let pid: number;
  try {
    pid = Number.parseInt(readFileSync(pidFile, 'utf-8').trim().split('\n')[0] ?? '', 10);
    if (Number.isNaN(pid) || pid <= 0) return;
    process.kill(pid, 0); // throws ESRCH if not running — nothing to do
  } catch {
    return; // process not running or file unreadable — clean state
  }

  // Validate the PID actually belongs to a postgres process to avoid killing
  // an unrelated process if the OS recycled the PID after a crash/reboot.
  try {
    const cmd = execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf-8' }).trim();
    if (!/\bpostgres\b/i.test(cmd)) {
      log.warn('PID from postmaster.pid is not a postgres process, skipping kill', {
        pid,
        dataDir,
        cmd: cmd.slice(0, 80),
      });
      return;
    }
  } catch {
    // ps failed — process may have just exited, safe to return
    return;
  }

  log.info('Killing orphaned postgres from previous run', { pid, dataDir });
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return;
  }

  // Wait up to 5 s for graceful exit, then SIGKILL
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      process.kill(pid, 0);
    } catch {
      return; // exited cleanly
    }
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // already dead
  }
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

  // Terminate any orphaned postgres left by a previous unclean shutdown before
  // pgserve tries to start (avoids the socket-dir mismatch crash loop).
  if (config.dataDir) {
    await killOrphanedPostgres(config.dataDir);
  }

  const { startMultiTenantServer } = await import('pgserve');

  // Try the configured port first, then increment up to MAX_PORT_RETRIES times
  for (let offset = 0; offset <= MAX_PORT_RETRIES; offset++) {
    const port = config.port + offset;
    const result = await tryStartOnPort(startMultiTenantServer, port, config);

    if (result) {
      if (offset > 0) {
        log.info('Embedded pgserve ready on alternate port', { originalPort: config.port, port });
      } else {
        log.info('Embedded pgserve ready', { port, databaseUrl: result.replace(/\/\/.*@/, '//***@') });
      }
      return result;
    }

    log.warn('Port already in use, trying next', { port, nextPort: port + 1 });
  }

  // All ports exhausted — fall back to assuming external pgserve on original port
  log.warn('All port attempts exhausted, assuming external pgserve', { port: config.port });
  return buildDatabaseUrl(config.port);
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
