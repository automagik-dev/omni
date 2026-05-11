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
import { CANONICAL_PG_PORT, probeCanonicalSocketSync } from './lib/pgserve-transport.js';

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

/** Legacy default — pre-singleton phase-2 url, points at the bun-bridge TCP listener. */
const LEGACY_PHASE2_DATABASE_URL = 'postgresql://postgres:postgres@localhost:8432/omni';

/**
 * Default pgserve port when none is set explicitly.
 *
 * Phase 2 of the canonical-pgserve cutover (omni#595/#596/#597) used the
 * bun-bridge port `8432`. Phase 3 (`pgserve-singleton-no-proxy`) lands the
 * postmaster directly on **5432** (canonical postgres port) and listens
 * on the canonical UDS at `$XDG_RUNTIME_DIR/pgserve/.s.PGSQL.5432`.
 *
 * Kept as the module-level default for backwards compatibility with the
 * stored `~/.omni/config.json` entries that still record `8432`. Use
 * {@link resolveDatabaseUrl} as the entry point — it prefers the canonical
 * UDS when available and falls back to the legacy port only when the
 * socket is missing AND the operator hasn't migrated their config.
 */
export const DEFAULT_PGSERVE_PORT = 8432;

/** Canonical postgres TCP port the postmaster binds in singleton mode. */
export { CANONICAL_PG_PORT } from './lib/pgserve-transport.js';

/**
 * Build the canonical embedded-mode `DATABASE_URL` from the configured
 * pgserve port. Used when the stored `server.databaseUrl` is empty or is
 * the legacy 5432 default.
 */
export function buildEmbeddedDatabaseUrl(pgservePort: number = DEFAULT_PGSERVE_PORT): string {
  return `postgresql://postgres:postgres@localhost:${pgservePort}/omni`;
}

/**
 * Build the TCP-form `DATABASE_URL` that points at the canonical singleton
 * postmaster's loopback listener (`127.0.0.1:5432`). Emitted by
 * {@link resolveDatabaseUrl} when {@link probeCanonicalSocketSync} confirms
 * a live pgserve postmaster.
 *
 * Why TCP instead of the libpq UDS shape (`postgresql://...@/db?host=...`):
 *   1. The empty-host UDS form is **not** accepted by the WHATWG `new URL()`
 *      parser — bun (and node) throw `TypeError [ERR_INVALID_URL]`. Several
 *      api-startup paths run the URL through `new URL()` for redaction /
 *      logging before postgres.js ever sees it, so the api crash-loops on
 *      startup and the operator sees `<redacted> cannot be parsed as a URL`.
 *   2. `postgres@^3` (the api's driver) does not honor `?host=<dir>` in the
 *      URL query string — its parser only reads `url.hostname`, falls back
 *      to `env.PGHOST`, and treats values containing `/` as Unix-socket
 *      directories. A URL with the libpq query shape silently routes back
 *      to TCP `localhost:<port>` anyway. Emitting TCP up-front keeps
 *      behavior predictable and parseable.
 *
 * Singleton-mode pgserve binds BOTH the libpq UDS (used by `psql` /
 * `pg`-style clients) and a TCP listener on the canonical port — see
 * `.genie/wishes/pgserve-singleton-no-proxy/SHARED-DESIGN.md` §5.3 — so
 * dialing TCP loopback when the UDS file is present is contractually
 * equivalent. UDS-only consumers can still use {@link buildDatabaseUrlForTransport}
 * directly when they're known to drive a libpq-aware client.
 */
export function buildCanonicalSocketDatabaseUrl(): string {
  return `postgresql://postgres:postgres@127.0.0.1:${CANONICAL_PG_PORT}/omni`;
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
 * Stored `databaseUrl` values that are recognized as legacy defaults and
 * therefore eligible for transport-aware re-resolution. An operator who
 * pinned a non-default URL (custom DB host, alternate port, external
 * postgres) is passed through verbatim — never silently rewritten.
 *
 * Phase-3 (`pgserve-singleton-no-proxy`) treats the phase-2 bridge URL
 * (`localhost:8432`) as legacy: the bridge is gone, the postmaster moves
 * to UDS + TCP 5432, and operators upgrading via `omni update` need their
 * baked-in config to roll forward without manual intervention. The actual
 * `~/.omni/config.json` rewrite is owned by `omni doctor --fix` (G2/G5).
 */
const LEGACY_DATABASE_URLS: readonly string[] = [LEGACY_DEFAULT_DATABASE_URL, LEGACY_PHASE2_DATABASE_URL];

/**
 * Resolve the effective `DATABASE_URL` for the omni-api process.
 *
 * Precedence:
 *   1. `serverConfig.databaseUrl`, if it's a non-empty, non-legacy value.
 *      Operator-provided URLs (external DB, custom port) pass through
 *      verbatim.
 *   2. Otherwise, prefer the canonical UDS at
 *      `$XDG_RUNTIME_DIR/pgserve/.s.PGSQL.5432` when the socket file is
 *      present (synchronous probe — see
 *      {@link probeCanonicalSocketSync}). UDS preference matches genie's
 *      `resolvePgserveTransport` contract documented in
 *      `.genie/wishes/pgserve-singleton-no-proxy/SHARED-DESIGN.md` §4.6.
 *   3. Otherwise, fall back to the configured TCP port (legacy phase-2
 *      bridge). Honors `serverConfig.pgservePort` when set.
 *
 * This function never reads `process.env.DATABASE_URL`.
 */
export function resolveDatabaseUrl(serverConfig: ServerConfig): string {
  const stored = serverConfig.databaseUrl?.trim() ?? '';
  if (stored && !LEGACY_DATABASE_URLS.includes(stored)) {
    return stored;
  }
  // Phase-3 default: prefer canonical UDS when the socket file is live.
  // The synchronous probe (file existsSync) is the right granularity for
  // env-build time — async greet would cascade buildRuntimeEnv to async
  // and ripple through install / update / doctor. The UDS file is created
  // by the postmaster itself, so its presence is a strong signal the
  // backend is up. A faulty postmaster (file present, server hung) shows
  // up at first-query time and is handled by the existing connect_timeout
  // contract in `packages/db/src/client.ts`.
  if (probeCanonicalSocketSync()) {
    return buildCanonicalSocketDatabaseUrl();
  }
  return buildEmbeddedDatabaseUrl(resolvePgservePort(serverConfig));
}

/**
 * Build the complete runtime env for the omni-api process.
 *
 * All values come from `serverConfig` / `cliConfig`. No shell env reads.
 *
 * Phase 3 (`pgserve-singleton-no-proxy` G2) deleted the embedded
 * pgserve code path entirely from `packages/api/`. omni-api connects
 * to a peer-supervised pgserve via `DATABASE_URL` only.
 * `PGSERVE_EMBEDDED` and `useCanonicalPgserve` are kept here for
 * back-compat with `~/.omni/config.json` files written by phase-2
 * installers, but the values no longer change runtime behavior:
 * `PGSERVE_EMBEDDED` is always `'false'`, and a legacy
 * `useCanonicalPgserve: false` triggers a one-shot warning surfaced by
 * `omni doctor --fix` (which rewrites the config). The env keys remain
 * in {@link RuntimeEnv} until a future major bumps the env contract.
 */
export function buildRuntimeEnv(serverConfig: ServerConfig, cliConfig: Config): RuntimeEnv {
  const pgservePort = resolvePgservePort(serverConfig);
  return {
    API_PORT: String(serverConfig.port),
    DATABASE_URL: resolveDatabaseUrl(serverConfig),
    OMNI_API_KEY: cliConfig.apiKey ?? '',
    MEDIA_STORAGE_PATH: join(serverConfig.dataDir, 'media'),
    OMNI_PACKAGES_DIR: join(serverConfig.dataDir, 'packages'),
    // Pinned to 'false' under the consumer-only model (G2 of
    // pgserve-singleton-no-proxy). Kept in env for back-compat: a stale
    // pm2 entry from a phase-1 install will now read 'false' and skip
    // the in-process spawn (which no longer exists anyway since the
    // API-side code was deleted). Operators upgrading should run
    // `omni doctor --fix` to clean their config + pm2 entry.
    PGSERVE_EMBEDDED: 'false',
    PGSERVE_DATA: join(serverConfig.dataDir, 'pgserve'),
    PGSERVE_PORT: String(pgservePort),
    NATS_URL: 'nats://localhost:4222',
    NODE_ENV: serverConfig.nodeEnv,
    LOG_LEVEL: serverConfig.logLevel,
  };
}
