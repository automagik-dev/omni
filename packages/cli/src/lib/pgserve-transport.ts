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
import { existsSync, lstatSync, readFileSync, statSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';

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

/** Pid file pgserve@>=2.3 drops next to the libpq socket — used by the sync liveness probe. */
const PGSERVE_PID_FILENAME = 'pgserve.pid';

/**
 * Synchronous liveness probe for the canonical pgserve postmaster.
 *
 * Returns true only when ALL of the following hold:
 *   1. `.s.PGSQL.<port>` exists in the canonical socket directory, AND
 *   2. it is **not a symbolic link** (singleton-mode pgserve creates the
 *      socket inode directly; a symlink is the pgserve@1.x daemon-mode
 *      shim that points at `control.sock`, which speaks the admin
 *      protocol — not the postgres wire protocol), AND
 *   3. the path resolves to a real Unix domain socket (rules out a stale
 *      regular file left behind by a partial cleanup), AND
 *   4. `<socketDir>/pgserve.pid` references a process still alive on
 *      this host (verified via `process.kill(pid, 0)`).
 *
 * Why each gate matters:
 *   - File-existence alone is the original bug — a previous pgserve
 *     daemon that died uncleanly leaves the inode behind, every
 *     consumer downstream is handed a `DATABASE_URL` pointing at a
 *     dead UDS, and the libpq-style URL shape
 *     (`postgresql://...@/db?host=...`) is rejected by the WHATWG
 *     `new URL()` parser used inside the api startup wrapper, so the
 *     api crash-loops on `TypeError [ERR_INVALID_URL]` before any
 *     connect attempt.
 *   - The symlink gate catches the wild case observed on hosts that
 *     ran pgserve@1.x at some point: the daemon publishes the admin
 *     socket as `control.sock` and aliases `.s.PGSQL.5432` to it via
 *     symlink. The pid file points at a live `bun` process (the
 *     daemon supervisor), but speaking postgres protocol to that
 *     socket gets you EPROTOTYPE / nothing. Stat-with-symlink-follow
 *     would happily report `isSocket() === true` and miss the trap.
 *   - The S_IFSOCK gate rules out the rare case of a regular file at
 *     the canonical path (test fixtures, broken cleanup scripts,
 *     filesystem-level corruption).
 *   - The pid-liveness gate catches the inverse: a real socket file
 *     left over from a postmaster that crashed without unlinking. The
 *     pid file is the strongest cross-process liveness signal we have
 *     without paying the cost of an async greet.
 *
 * Used by the synchronous {@link buildRuntimeEnv} path in `runtime-env.ts`
 * to pick UDS vs TCP without paying the cost of an async greet. The greet
 * variant ({@link resolvePgserveTransport}) is reserved for boot-time and
 * doctor flows that can afford the round trip.
 */
export function probeCanonicalSocketSync(): boolean {
  const socketPath = resolvePgserveLibpqSocketPath();
  let lstat: ReturnType<typeof lstatSync>;
  try {
    lstat = lstatSync(socketPath);
  } catch {
    return false;
  }
  // Symlink → almost certainly the pgserve@1.x admin-socket alias. Reject.
  if (lstat.isSymbolicLink()) return false;
  // Real path must be a Unix domain socket. statSync follows symlinks
  // (already excluded above) so this just guards against regular files.
  try {
    if (!statSync(socketPath).isSocket()) return false;
  } catch {
    return false;
  }
  return isCanonicalPostmasterAliveSync();
}

/**
 * Read `<socketDir>/pgserve.pid` and confirm the recorded pid is still a
 * live process on this host. Returns false on any I/O error, parse error,
 * or `process.kill(pid, 0)` rejection (ESRCH/EPERM).
 */
function isCanonicalPostmasterAliveSync(): boolean {
  const pidPath = join(resolvePgserveSocketDir(), PGSERVE_PID_FILENAME);
  if (!existsSync(pidPath)) return false;
  try {
    const pid = Number.parseInt(readFileSync(pidPath, 'utf-8').trim(), 10);
    if (!Number.isFinite(pid) || pid <= 0) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build a `postgresql://` URL pointing at the given transport, using the
 * supplied database name. Mirrors the URL shapes documented in
 * SHARED-DESIGN.md §5.3 (omni-side scope).
 *
 * UDS shape: `postgresql://postgres:postgres@/omni?host=/run/user/1000/pgserve&port=5432`
 * TCP shape: `postgresql://postgres:postgres@127.0.0.1:5432/omni`
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
    const params = new URLSearchParams({
      host: transport.socketDir,
      port: String(transport.port),
    });
    return `postgresql://${auth}@/${encodeURIComponent(database)}?${params.toString()}`;
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
  return new Promise((resolve) => {
    let settled = false;
    let stdout = '';
    const proc = spawn('pgserve', ['port'], { stdio: ['ignore', 'pipe', 'ignore'] });
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
