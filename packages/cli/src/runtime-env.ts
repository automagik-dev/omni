/**
 * Runtime Environment Builder (hermetic)
 *
 * Single source of truth for the environment variables passed to the
 * omni-api process when it is started/restarted via PM2 (or any other
 * process manager). All values are derived from configuration files
 * (`~/.omni/config.json`) — NEVER from the calling shell's environment.
 *
 * Why this exists
 * ---------------
 * A 2026-04-06 live-debug incident found that `omni install` was reading
 * `process.env.DATABASE_URL` at module-load time and baking whatever the
 * calling shell had set into pm2's stored env AND `~/.omni/config.json`.
 * When an unrelated tool had exported a `DATABASE_URL` pointing to a
 * different database, omni-api ended up writing to the wrong DB.
 *
 * Rules for this module
 * ---------------------
 *   1. NEVER read `process.env.DATABASE_URL`.
 *   2. NEVER read other shell variables that exist as first-class config
 *      fields (API_PORT, OMNI_API_KEY, PGSERVE_DATA, etc.).
 *   3. Always derive `DATABASE_URL` from `ServerConfig.databaseUrl`; fall
 *      back to the canonical embedded URL on the configured `PGSERVE_PORT`
 *      when the stored value is the legacy 5432 default.
 *   4. Always include `OMNI_PACKAGES_DIR` (drift-fix between install.ts and
 *      restart.ts) and honor the dynamic `nodeEnv` / `logLevel` from config.
 */

import { join } from 'node:path';
import type { Config, ServerConfig } from './config.js';

/**
 * Environment object suitable for passing to `runPm2` as `envOverrides`
 * (and onward to the managed omni-api process).
 */
export type RuntimeEnv = {
  API_PORT: string;
  DATABASE_URL: string;
  OMNI_API_KEY: string;
  MEDIA_STORAGE_PATH: string;
  OMNI_PACKAGES_DIR: string;
  PGSERVE_EMBEDDED: string;
  PGSERVE_DATA: string;
  PGSERVE_PORT: string;
  NATS_URL: string;
  NODE_ENV: string;
  LOG_LEVEL: string;
};

/** Legacy default — anything pointing at this was inherited from pre-embedded pgserve days. */
const LEGACY_DEFAULT_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/omni';

/** Default pgserve port when none is set explicitly. */
export const DEFAULT_PGSERVE_PORT = 8432;

/**
 * Build the canonical embedded-mode `DATABASE_URL` from the configured
 * pgserve port. Used when the stored `server.databaseUrl` is empty or is
 * the legacy 5432 default.
 */
export function buildEmbeddedDatabaseUrl(pgservePort: number = DEFAULT_PGSERVE_PORT): string {
  return `postgresql://postgres:postgres@localhost:${pgservePort}/omni`;
}

/**
 * Extract the effective pgserve port. Honors an explicit override on the
 * server config first (`server.pgservePort`, if ever added), then the
 * hard-coded default. This function intentionally does NOT read
 * `process.env.PGSERVE_PORT` — env pollution is the bug we're fixing.
 */
export function resolvePgservePort(serverConfig: ServerConfig): number {
  const maybe = (serverConfig as ServerConfig & { pgservePort?: number }).pgservePort;
  if (typeof maybe === 'number' && Number.isFinite(maybe) && maybe > 0) {
    return maybe;
  }
  return DEFAULT_PGSERVE_PORT;
}

/**
 * Resolve the effective `DATABASE_URL` for the omni-api process.
 *
 * Precedence:
 *   1. `serverConfig.databaseUrl`, if it's a non-empty, non-legacy value.
 *   2. Otherwise, the canonical embedded URL on the configured pgserve port.
 *
 * This function never reads `process.env.DATABASE_URL`.
 */
export function resolveDatabaseUrl(serverConfig: ServerConfig): string {
  const stored = serverConfig.databaseUrl?.trim() ?? '';
  if (stored && stored !== LEGACY_DEFAULT_DATABASE_URL) {
    return stored;
  }
  return buildEmbeddedDatabaseUrl(resolvePgservePort(serverConfig));
}

/**
 * Build the complete runtime env for the omni-api process.
 *
 * All values come from `serverConfig` / `cliConfig`. No shell env reads.
 */
export function buildRuntimeEnv(serverConfig: ServerConfig, cliConfig: Config): RuntimeEnv {
  const pgservePort = resolvePgservePort(serverConfig);
  return {
    API_PORT: String(serverConfig.port),
    DATABASE_URL: resolveDatabaseUrl(serverConfig),
    OMNI_API_KEY: cliConfig.apiKey ?? '',
    MEDIA_STORAGE_PATH: join(serverConfig.dataDir, 'media'),
    OMNI_PACKAGES_DIR: join(serverConfig.dataDir, 'packages'),
    PGSERVE_EMBEDDED: 'true',
    PGSERVE_DATA: join(serverConfig.dataDir, 'pgserve'),
    PGSERVE_PORT: String(pgservePort),
    NATS_URL: 'nats://localhost:4222',
    NODE_ENV: serverConfig.nodeEnv,
    LOG_LEVEL: serverConfig.logLevel,
  };
}
