#!/usr/bin/env bun
/**
 * Disposable PostgreSQL cluster harness
 * (wish: omni-full-multitenancy, Group G3).
 *
 * G1 and G2 each stood a throwaway cluster up by hand before running their
 * `*-postgres.test.ts` suites. That worked, but it left the single most
 * important precondition of the real-PostgreSQL gate — "there is a server, and
 * it is NOT a shared or production one" — as tribal knowledge. This script is
 * that precondition, committed.
 *
 * Guarantees, in the order they matter:
 *
 *   1. NEVER touches an existing server. The cluster is `initdb`-ed into a
 *      fresh directory under the system temp dir and listens on a RANDOM
 *      loopback port. Port 5432 is refused outright.
 *   2. NEVER reads an ambient `DATABASE_URL`, `.env*`, Vault, or any other
 *      credential store. The superuser password is generated here, from
 *      `crypto.getRandomValues`, and exists only for this cluster's lifetime.
 *   3. Listens on 127.0.0.1 only, with `scram-sha-256` for host connections.
 *      `fsync=off` because the data is disposable by construction.
 *   4. `destroy` stops the postmaster and removes the data directory, taking
 *      the generated credential with it.
 *
 * Usage:
 *   bun scripts/disposable-pg-cluster.ts create     # prints the URL on stdout
 *   bun scripts/disposable-pg-cluster.ts destroy <dataDir>
 *
 * `scripts/pg-gate.ts` drives it; a human can too.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** postgres binaries this harness needs. Overridable for unusual installs. */
export interface PgBinaries {
  readonly initdb: string;
  readonly pgCtl: string;
  readonly psql: string;
}

/**
 * Directories that plausibly hold a postgres SERVER build.
 *
 * `initdb` alone is not enough: a client-only distribution (homebrew `libpq`,
 * for one) ships `initdb` and `psql` but no `postgres`, and `initdb` then fails
 * halfway through with a confusing "program postgres is needed" error. So a
 * candidate directory counts only when `postgres` sits next to `initdb`.
 */
const SERVER_BIN_CANDIDATES = [
  join(process.env.HOME ?? '', '.embedded-postgres-go', 'extracted', 'bin'),
  '/usr/lib/postgresql/18/bin',
  '/usr/lib/postgresql/17/bin',
  '/usr/lib/postgresql/16/bin',
  '/usr/local/pgsql/bin',
];

function findServerBinDir(): string | null {
  for (const dir of SERVER_BIN_CANDIDATES) {
    if (dir && existsSync(join(dir, 'postgres')) && existsSync(join(dir, 'initdb'))) return dir;
  }
  return null;
}

export function resolvePgBinaries(env: Record<string, string | undefined> = process.env): PgBinaries {
  const dir = env.OMNI_PG_BIN_DIR ?? findServerBinDir();
  const at = (name: string): string => (dir ? join(dir, name) : name);
  // `psql` is a client tool and may legitimately live elsewhere than the
  // server build, so it falls back to PATH rather than to the server dir.
  const psqlDir = env.OMNI_PG_BIN_DIR ?? (dir && existsSync(join(dir, 'psql')) ? dir : null);
  return {
    initdb: env.OMNI_PG_INITDB_BIN ?? at('initdb'),
    pgCtl: env.OMNI_PG_CTL_BIN ?? at('pg_ctl'),
    psql: env.OMNI_PG_PSQL_BIN ?? (psqlDir ? join(psqlDir, 'psql') : 'psql'),
  };
}

/**
 * A loopback TCP port nobody is listening on.
 *
 * Binding port 0 and reading back the assignment is the only race-free way to
 * ask the kernel for a free port. There is still a window between close and
 * postmaster start, so the caller retries.
 */
async function randomFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('could not resolve an ephemeral port'));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

/** Synthetic, single-use, alphanumeric. Never derived from an existing secret. */
function generatePassword(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

export interface DisposableCluster {
  readonly dataDir: string;
  readonly port: number;
  readonly superuser: string;
  readonly url: string;
}

function run(cmd: string, args: string[], label: string): void {
  const result = spawnSync(cmd, args, { encoding: 'utf-8' });
  if (result.error) {
    throw new Error(`${label}: could not execute ${cmd} (${result.error.message})`);
  }
  if (result.status !== 0) {
    throw new Error(`${label}: ${cmd} exited ${result.status}\n${result.stderr ?? ''}${result.stdout ?? ''}`);
  }
}

/**
 * `initdb` + start, on a random loopback port, with a freshly generated
 * superuser password. Returns everything needed to connect and to destroy.
 */
export async function createDisposableCluster(bins: PgBinaries = resolvePgBinaries()): Promise<DisposableCluster> {
  const dataDir = mkdtempSync(join(tmpdir(), 'omni-g3-pg-'));
  const superuser = 'omni_disposable_superuser';
  const password = generatePassword();
  const pwFile = join(dataDir, '.initdb-pw');

  try {
    writeFileSync(pwFile, password, { mode: 0o600 });
    run(
      bins.initdb,
      [
        '--pgdata',
        join(dataDir, 'data'),
        '--username',
        superuser,
        '--pwfile',
        pwFile,
        '--auth-local',
        'trust',
        '--auth-host',
        'scram-sha-256',
        '--encoding',
        'UTF8',
        '--no-sync',
      ],
      'disposable-pg initdb',
    );
  } finally {
    rmSync(pwFile, { force: true });
  }

  const pgData = join(dataDir, 'data');
  // Loopback only. An `initdb` default already omits listen_addresses, but
  // being explicit means a stray postgresql.conf template cannot widen it.
  // The socket lives in the data dir: distribution builds (Debian/Ubuntu
  // pgdg) default unix_socket_directories to /var/run/postgresql, which an
  // unprivileged CI runner cannot write — the postmaster then dies on its
  // lock file before ever listening.
  writeFileSync(
    join(pgData, 'postgresql.auto.conf'),
    [
      "listen_addresses = '127.0.0.1'",
      `unix_socket_directories = '${pgData}'`,
      'fsync = off',
      'synchronous_commit = off',
      'full_page_writes = off',
      '',
    ].join('\n'),
  );

  let started: { port: number } | null = null;
  let lastError = '';
  for (let attempt = 0; attempt < 8 && started === null; attempt += 1) {
    const port = await randomFreePort();
    if (port === 5432) continue; // never impersonate the shared cluster
    const result = spawnSync(
      bins.pgCtl,
      ['-D', pgData, '-l', join(dataDir, 'server.log'), '-w', '-o', `-p ${port}`, 'start'],
      { encoding: 'utf-8' },
    );
    if (result.status === 0) {
      started = { port };
    } else {
      lastError = `${result.stderr ?? ''}${result.stdout ?? ''}`;
    }
  }
  if (started === null) {
    // pg_ctl's stderr only says "could not start server" — the reason lives
    // in server.log, so capture it before the data dir is destroyed.
    let serverLog = '';
    try {
      serverLog = readFileSync(join(dataDir, 'server.log'), 'utf-8');
    } catch {
      serverLog = '(no server.log was written)';
    }
    rmSync(dataDir, { recursive: true, force: true });
    throw new Error(`disposable-pg: postmaster would not start after 8 attempts\n${lastError}\n${serverLog}`);
  }

  const url = `postgres://${superuser}:${encodeURIComponent(password)}@127.0.0.1:${started.port}/postgres`;
  return { dataDir, port: started.port, superuser, url };
}

/** Stop the postmaster and remove the data directory (and its credential). */
export function destroyDisposableCluster(dataDir: string, bins: PgBinaries = resolvePgBinaries()): void {
  const pgData = join(dataDir, 'data');
  if (existsSync(join(pgData, 'postmaster.pid'))) {
    spawnSync(bins.pgCtl, ['-D', pgData, '-m', 'immediate', '-w', 'stop'], { encoding: 'utf-8' });
  }
  rmSync(dataDir, { recursive: true, force: true });
}

if (import.meta.main) {
  const [command, argument] = process.argv.slice(2);
  if (command === 'create') {
    const cluster = await createDisposableCluster();
    process.stdout.write(`${JSON.stringify({ url: cluster.url, dataDir: cluster.dataDir })}\n`);
  } else if (command === 'destroy') {
    if (!argument) {
      process.stderr.write('usage: disposable-pg-cluster.ts destroy <dataDir>\n');
      process.exit(2);
    }
    destroyDisposableCluster(argument);
  } else if (command === 'log') {
    if (!argument) process.exit(2);
    process.stdout.write(readFileSync(join(argument, 'server.log'), 'utf-8'));
  } else {
    process.stderr.write('usage: disposable-pg-cluster.ts create | destroy <dataDir>\n');
    process.exit(2);
  }
}
