/**
 * pgserve transport discovery — Unix-socket first, TCP fallback.
 *
 * Mirror of `resolvePgserveTransport()` from
 * `automagik-dev/genie:src/lib/db.ts` — keeps the byte-identical contract
 * documented in `.genie/wishes/pgserve-singleton-no-proxy/SHARED-DESIGN.md`
 * (§4.6 transport-discovery).
 *
 * Why this exists
 * ---------------
 * Phase 2 of the canonical-pgserve cutover (omni#595/#596/#597) flipped
 * `useCanonicalPgserve` to true by default and pointed `DATABASE_URL` at
 * the pm2-supervised pgserve instance on **TCP 8432** (the bun-bridge
 * default). Phase 3 (this wish, `pgserve-singleton-no-proxy`) lands the
 * canonical socket at `$XDG_RUNTIME_DIR/pgserve/.s.PGSQL.5432` and tells
 * every consumer to prefer it, with TCP `localhost:5432` as the fallback.
 *
 * This module provides the discovery primitives. `runtime-env.ts` consumes
 * them to compute the effective `DATABASE_URL` for the omni-api process.
 *
 * Force-flag overrides (matches genie's contract):
 *   - `OMNI_PG_FORCE_TCP=1`     skips the UDS probe entirely.
 *   - `OMNI_PG_FORCE_SOCKET=1`  inverts: skip TCP fallback, require UDS.
 *   - `OMNI_PG_PORT=<n>`        legacy escape hatch — bypasses the
 *                               `pgserve port` discovery and dials
 *                               `127.0.0.1:<n>` directly. Pairs with
 *                               `OMNI_PG_FORCE_TCP=1` for hosts that
 *                               don't have `pgserve` on PATH.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { resolvePgserveBinary } from './canonical-pgserve-binary.js';

/** Canonical postgres port the postmaster binds when pgserve@>=2.3 runs in singleton mode. */
export const CANONICAL_PG_PORT = 5432;

/** Default TCP host for the localhost-fallback path. */
const DEFAULT_HOST = '127.0.0.1';

/** Postgres SSLRequest message code; used by the UDS-greet liveness probe. */
const PG_SSL_REQUEST_CODE = 80877103;

/** UDS-greet timeout (ms). */
const PGSERVE_GREET_TIMEOUT_MS = 1000;

/** `pgserve port` discovery timeout (ms). */
const TCP_DISCOVERY_TIMEOUT_MS = 5_000;

/**
 * Discriminated union returned by {@link resolvePgserveTransport}.
 *
 *   - `unix`: postgres.js dials the Unix socket at
 *     `<socketDir>/.s.PGSQL.<port>`. `host` is the `socketDir`.
 *   - `tcp`: postgres.js dials `<host>:<port>` over TCP loopback.
 */
export type PgserveTransport =
  | { kind: 'unix'; socketDir: string; port: number }
  | { kind: 'tcp'; host: string; port: number };

/**
 * Resolve the directory holding pgserve's libpq-compat socket.
 *
 * Honors `$XDG_RUNTIME_DIR` (systemd / freedesktop convention) and falls
 * back to `/tmp/pgserve` on hosts without XDG. Mirrors `resolveControlSocketDir`
 * in pgserve/src/daemon.js so both ends agree on the path.
 */
export function resolvePgserveSocketDir(): string {
  const xdg = process.env.XDG_RUNTIME_DIR;
  const base = xdg && xdg.length > 0 ? xdg : '/tmp';
  return join(base, 'pgserve');
}

/**
 * Path to the libpq-compat socket file. Postgres' libpq dials a socket file
 * named `.s.PGSQL.<port>` inside the configured socket directory.
 */
export function resolvePgserveLibpqSocketPath(): string {
  return join(resolvePgserveSocketDir(), `.s.PGSQL.${CANONICAL_PG_PORT}`);
}

/**
 * Path to pgserve v2's primary control socket (used by daemon-mode flows
 * that route through SO_PEERCRED). Kept here so a future doctor probe can
 * surface the file's presence without re-implementing the path.
 */
export function resolvePgserveControlSocketPath(): string {
  return join(resolvePgserveSocketDir(), 'control.sock');
}

/**
 * Synchronous probe: does the canonical libpq socket file exist?
 *
 * Used by the synchronous {@link buildRuntimeEnv} path in `runtime-env.ts`
 * to pick UDS vs TCP without paying the cost of an async greet. The greet
 * variant ({@link resolvePgserveTransport}) is reserved for boot-time and
 * doctor flows that can afford the round trip.
 */
export function probeCanonicalSocketSync(): boolean {
  return existsSync(resolvePgserveLibpqSocketPath());
}

/**
 * Build a `postgresql://` URL pointing at the given transport, using the
 * supplied database name.
 *
 * UDS shape: `postgresql://postgres:postgres@localhost/omni` (plain — no
 *   libpq `?host=` query param). Socket routing happens via the
 *   PGHOST/PGPORT env vars `buildRuntimeEnv` publishes alongside this URL.
 * TCP shape: `postgresql://postgres:postgres@127.0.0.1:5432/omni`
 *
 * Why no `?host=` for UDS: postgres.js (omni-api's client) rejects URLs
 * carrying the libpq `?host=` query parameter with the error
 * `unrecognized configuration parameter "host"`. That parameter is a
 * libpq-only convention; postgres.js parses URL query params strictly as
 * connection options and bails. Earlier iterations of this helper tried
 * three shapes that all failed for postgres.js:
 *   - `postgresql://user:pass@/db?host=/sock` → Node WHATWG URL: Invalid URL
 *   - `postgresql://user:pass@localhost/db?host=/sock` → postgres.js:
 *     "unrecognized configuration parameter host"
 * The working shape is the plain `@localhost/db` form, with the actual
 * socket path supplied to postgres.js via PGHOST/PGPORT env vars (which
 * postgres.js inherits as connection defaults).
 *
 * The username/password pair is preserved (not derived from the transport)
 * because omni's pgserve consumer keeps libpq peer-auth via password —
 * pgserve@>=2.3 issues a per-fingerprint role credential and the API
 * stores that credential in `serverConfig.databaseUrl`. When stored, the
 * caller passes their own URL through verbatim and never touches this
 * helper.
 */
export function buildDatabaseUrlForTransport(
  transport: PgserveTransport,
  database: string,
  options: { username?: string; password?: string } = {},
): string {
  const username = options.username ?? 'postgres';
  const password = options.password ?? 'postgres';
  const auth = `${encodeURIComponent(username)}:${encodeURIComponent(password)}`;
  if (transport.kind === 'unix') {
    // Plain `@localhost/db` form — postgres.js parses cleanly; PGHOST/PGPORT
    // env vars (set by buildRuntimeEnv) route the actual connection to the
    // canonical Unix socket. See doc comment above.
    return `postgresql://${auth}@localhost/${encodeURIComponent(database)}`;
  }
  return `postgresql://${auth}@${transport.host}:${transport.port}/${encodeURIComponent(database)}`;
}

/**
 * Resolve the active pgserve transport with UDS preference and TCP fallback.
 *
 * Probe order:
 *   1. **Canonical UDS** — `$XDG_RUNTIME_DIR/pgserve/.s.PGSQL.5432`. Confirm
 *      liveness by completing a Postgres greet (SSLRequest → server replies
 *      'N' or 'S'). Use it if reachable.
 *   2. **Explicit TCP port** (`OMNI_PG_PORT`) — legacy escape hatch. Bypasses
 *      `pgserve port` discovery and dials `127.0.0.1:<port>` directly.
 *   3. **TCP via `pgserve port`** — shells out to the pgserve CLI's published
 *      discovery primitive. Emits `127.0.0.1:<discovered-port>`.
 *   4. Throw with a hint that lists every probe attempt.
 *
 * Force-flag overrides:
 *   - `OMNI_PG_FORCE_SOCKET=1` skips steps 2 + 3 (UDS-only).
 *   - `OMNI_PG_FORCE_TCP=1` skips step 1 (TCP-only).
 */
export async function resolvePgserveTransport(): Promise<PgserveTransport> {
  const forceTcp = process.env.OMNI_PG_FORCE_TCP === '1';
  const forceSocket = process.env.OMNI_PG_FORCE_SOCKET === '1';

  if (!forceTcp) {
    const socketPath = resolvePgserveLibpqSocketPath();
    if (existsSync(socketPath) && (await canCompletePgserveGreet(socketPath))) {
      return {
        kind: 'unix',
        socketDir: resolvePgserveSocketDir(),
        port: CANONICAL_PG_PORT,
      };
    }
    if (forceSocket) {
      throw new Error(buildUdsUnavailableHint(socketPath));
    }
  }

  // Step 2: explicit TCP port via OMNI_PG_PORT env. Pre-discovery contract.
  const explicitPort = parseExplicitTcpPort(process.env.OMNI_PG_PORT);
  if (explicitPort !== null) {
    return { kind: 'tcp', host: DEFAULT_HOST, port: explicitPort };
  }

  // Step 3: discover the TCP port via `pgserve port` subcommand.
  const tcpPort = await discoverTcpPgservePort();
  if (tcpPort !== null) {
    return { kind: 'tcp', host: DEFAULT_HOST, port: tcpPort };
  }

  throw new Error(buildBothTransportsUnavailableHint(forceTcp, forceSocket));
}

function parseExplicitTcpPort(raw: string | undefined): number | null {
  if (raw === undefined || raw === '') return null;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) return null;
  return parsed;
}

async function discoverTcpPgservePort(): Promise<number | null> {
  const bin = resolvePgserveBinary();
  if (!bin) return null;
  return new Promise((resolve) => {
    let settled = false;
    let stdout = '';
    const proc = spawn(bin, ['port'], { stdio: ['ignore', 'pipe', 'ignore'] });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill('SIGTERM');
      resolve(null);
    }, TCP_DISCOVERY_TIMEOUT_MS);
    timer.unref();

    // setEncoding('utf8') guarantees stdout chunks arrive as already-decoded
    // strings — no risk of a multi-byte character splitting across two
    // chunks. `pgserve port` only emits ASCII (port + newline) but explicit
    // encoding documents intent and matches the genie-side convention.
    proc.stdout?.setEncoding('utf8');
    proc.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    proc.on('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(null);
    });
    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        resolve(null);
        return;
      }
      const parsed = Number.parseInt(stdout.trim(), 10);
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
        resolve(null);
        return;
      }
      resolve(parsed);
    });
  });
}

function canCompletePgserveGreet(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let socket: ReturnType<typeof createConnection> | null = null;

    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      socket?.removeAllListeners();
      socket?.destroy();
      resolve(ok);
    };

    const request = Buffer.alloc(8);
    request.writeUInt32BE(8, 0);
    request.writeUInt32BE(PG_SSL_REQUEST_CODE, 4);

    socket = createConnection(path);
    timer = setTimeout(() => finish(false), PGSERVE_GREET_TIMEOUT_MS);
    timer.unref();

    socket.once('connect', () => socket?.write(request));
    // Postgres replies 'N' (78) or 'S' (83) to SSLRequest; either confirms
    // a live postmaster on the other end of the socket.
    socket.once('data', (chunk) => finish(chunk[0] === 78 || chunk[0] === 83));
    socket.once('error', () => finish(false));
  });
}

function buildUdsUnavailableHint(socketPath: string): string {
  return [
    'pgserve canonical Unix socket is not reachable.',
    `  • Probed: ${socketPath} (missing or not responsive)`,
    'Recovery:',
    '  pm2 status              # is pgserve registered?',
    '  pgserve install         # register pgserve under pm2 (publishes the canonical UDS)',
    'Set OMNI_PG_FORCE_TCP=1 to bypass UDS and use TCP discovery.',
  ].join('\n');
}

function buildBothTransportsUnavailableHint(forceTcp: boolean, forceSocket: boolean): string {
  const lines = ['pgserve is not reachable on either transport.'];
  if (!forceTcp) {
    lines.push(`  • Unix socket probe: ${resolvePgserveLibpqSocketPath()} (not present or not responsive)`);
  } else {
    lines.push('  • Unix socket probe: skipped (OMNI_PG_FORCE_TCP=1)');
  }
  if (!forceSocket) {
    lines.push('  • TCP discovery via `pgserve port`: failed (binary missing or no daemon)');
  } else {
    lines.push('  • TCP discovery: skipped (OMNI_PG_FORCE_SOCKET=1)');
  }
  lines.push('Recovery:');
  lines.push('  pm2 status              # is pgserve registered?');
  lines.push('  pgserve install         # register pgserve under pm2');
  lines.push('Set OMNI_PG_PORT=<n> to pin a known TCP port without invoking the pgserve CLI.');
  return lines.join('\n');
}
