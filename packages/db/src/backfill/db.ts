/**
 * Tooling-only PostgreSQL connection helper
 * (wish: omni-full-multitenancy, Group G6).
 *
 * G6 ships MIGRATION TOOLING that operates on a DISPOSABLE rehearsal cluster and
 * never on the running application. Two hard boundaries are enforced here, at the
 * one place a connection is opened, rather than trusted to every call site:
 *
 *   1. **Explicit `--url` only, never ambient.** The URL must be passed in. This
 *      helper never reads `DATABASE_URL`, `.env*`, Vault, or any other ambient
 *      credential store, and it refuses a URL that is byte-identical to an
 *      ambient `DATABASE_URL` so an operator cannot smuggle the live database in
 *      by exporting it into `--url`.
 *   2. **Never the shared cluster.** A URL on port 5432 — the conventional shared
 *      Postgres — is refused outright. Rehearsal clusters come from
 *      `scripts/disposable-pg-cluster.ts`, which listens on a random high port.
 *
 * This module deliberately does NOT call `createDb`/`getDb`/`createDbHandle`/
 * `createPostgresClient` (the singletons the db-access guard tracks): the guard's
 * whole point is that a tenant-scoped request path can only reach the database
 * through the tenant boundary, and this tooling is not a request path. It opens
 * its own throwaway pool with `postgres` directly, keyed to a disposable URL an
 * operator typed, and closes it when the run ends.
 *
 * NOT on the runtime import graph. Imported by direct path from G6 scripts and
 * tests only; never barrelled through `packages/db/src/index.ts`. See
 * `runtime-isolation.test.ts`.
 */

import postgres from 'postgres';

/** A minimal structural view of the `postgres` tagged-template client. */
export type ToolingSql = postgres.Sql<Record<string, never>>;

export class ToolingConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolingConnectionError';
  }
}

/** The conventional shared-Postgres port. G6 tooling must never touch it. */
export const FORBIDDEN_SHARED_PORT = 5432;

/**
 * Validate that `url` is an explicit, disposable-cluster URL — never ambient,
 * never the shared cluster. Throws `ToolingConnectionError` otherwise.
 *
 * `env` is injectable so the guard is unit-testable without mutating the real
 * process environment.
 */
export function assertDisposableUrl(url: string, env: Record<string, string | undefined> = process.env): void {
  if (!url || url.trim().length === 0) {
    throw new ToolingConnectionError('a disposable-cluster --url is required; G6 tooling never reads an ambient URL');
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ToolingConnectionError('--url is not a valid PostgreSQL connection URL');
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new ToolingConnectionError(`--url must be a postgres:// URL, got ${parsed.protocol}`);
  }

  // Default port is 5432 when the URL omits one, so an omitted port is refused
  // too: a bare `postgres://host/db` is exactly the shared-cluster shape.
  const port = parsed.port === '' ? FORBIDDEN_SHARED_PORT : Number(parsed.port);
  if (port === FORBIDDEN_SHARED_PORT) {
    throw new ToolingConnectionError(
      `--url points at port ${FORBIDDEN_SHARED_PORT}, the shared cluster; G6 runs only against a disposable cluster on a random high port`,
    );
  }

  const ambient = env.DATABASE_URL;
  if (ambient && ambient.trim() === url.trim()) {
    throw new ToolingConnectionError('--url is identical to the ambient DATABASE_URL; refusing to run tooling on it');
  }
}

export interface OpenToolingConnectionOptions {
  /** Statement/idle timeouts and pool size are deliberately small for tooling. */
  readonly maxConnections?: number;
  /** Override the environment consulted for the ambient-URL check (tests). */
  readonly env?: Record<string, string | undefined>;
}

/**
 * Open a throwaway pool against an explicit disposable URL.
 *
 * The caller owns the returned handle and MUST `await sql.end()` when done —
 * every G6 script and test does so in a `finally`, so a run leaves no live
 * connection and no lingering credential.
 */
export function openToolingConnection(url: string, options: OpenToolingConnectionOptions = {}): ToolingSql {
  assertDisposableUrl(url, options.env ?? process.env);
  return postgres(url, {
    max: options.maxConnections ?? 4,
    // Tooling connects to a throwaway server it created; no TLS material exists
    // to verify, and none is read from the ambient environment.
    ssl: false,
    // Keep tooling identifiable in pg_stat_activity on the rehearsal cluster.
    connection: { application_name: 'omni-g6-backfill-tooling' },
    onnotice: () => {},
  }) as ToolingSql;
}
