/**
 * Dedicated-role cutover — omni-side scoped non-superuser identity.
 *
 * Wish parity: mirrors genie's `src/lib/role-cutover.ts` (the
 * `genie-dedicated-role-cutover` wish). Omni historically connected to
 * canonical pgserve/autopg as the cluster superuser `postgres:postgres`.
 * A bad omni migration or a compromised omni-api could therefore
 * `DROP DATABASE genie`, exhaust the cluster, create roles, etc. —
 * the same blast-radius problem genie solved with role-cutover.
 *
 * This module provisions a dedicated NON-superuser role scoped to omni's
 * own `omni` database, persists the credential in a sentinel file, and
 * is consumed by `buildRuntimeEnv` to rewrite `DATABASE_URL` to the
 * scoped role at omni-api startup.
 *
 * Scope (MVP):
 *   - Provision `pgserve_omni_<fp12>_role` with grants scoped to `omni` DB
 *   - Generate a random password at provisioning, persist in sentinel
 *   - Idempotent: existing role → refresh grants, regenerate sentinel from
 *     password (preserves the operator-visible role identifier)
 *   - Kill switch: `OMNI_ROLE_CUTOVER=0` forces legacy `postgres`/`postgres`
 *   - Best-effort: any failure logs a warning and falls back to legacy creds
 *
 * Out of scope (deferred to a follow-up wish, matching genie's groups):
 *   - Advisory-lock concurrency guards (multi-host simultaneous installs)
 *   - Full event sink with audit log + sentinel rotation
 *   - Per-tenant fingerprint stability handling beyond package.json
 *   - doctor.ts validation that the scoped role is in active use
 *   - Migration of pre-cutover objects' ownership to the scoped role
 */

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';

// ============================================================================
// Naming
// ============================================================================

const NAME_PREFIX = 'pgserve_';
const ROLE_SUFFIX = '_role';
const POSTGRES_MAX_IDENT = 63;
const FINGERPRINT_HEX_LEN = 12;
const OMNI_PUBLISHER = 'omni';

const SAFE_IDENT = /^[a-z_][a-z0-9_]*$/;

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function sanitizeSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/__+/g, '_');
}

/**
 * Compute the scoped role name for an omni install. Deterministic — same
 * install always produces the same role name across reruns. Internal
 * helper; consumers route through ensureOmniScopedRole + sentinel reads.
 */
function deriveOmniScopedRoleName(): string {
  // Stable fingerprint: sha256 of the @automagik/omni package name. omni is
  // single-publisher (unlike genie which can be installed in multiple
  // workspace contexts), so we don't need to walk to find a package dir.
  // If multi-install support is needed later, hash the install dir too.
  const fp = sha256Hex('@automagik/omni').slice(0, FINGERPRINT_HEX_LEN);
  const slug = sanitizeSlug(OMNI_PUBLISHER);
  const budget = POSTGRES_MAX_IDENT - NAME_PREFIX.length - 1 - fp.length - ROLE_SUFFIX.length;
  const truncated = slug.slice(0, Math.max(0, budget));
  return `${NAME_PREFIX}${truncated}_${fp}${ROLE_SUFFIX}`;
}

function assertSafeIdent(label: string, value: string): void {
  if (!SAFE_IDENT.test(value)) {
    throw new Error(`role-cutover: unsafe ${label} identifier: ${JSON.stringify(value)}`);
  }
}

function assertSafePassword(value: string): void {
  // Lock down to alphanumeric only — we generate the password ourselves,
  // so this is a defense-in-depth check before string-interpolating into
  // SQL. Real-world the regex matches base64url-without-padding.
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('role-cutover: generated password contains unsafe characters');
  }
}

// ============================================================================
// Sentinel: persist the provisioned credential for buildRuntimeEnv
// ============================================================================

export interface OmniRoleCutoverSentinel {
  /** The provisioned role name (matches deriveOmniScopedRoleName output). */
  roleName: string;
  /** Database the role is scoped to (always `omni`). */
  database: string;
  /** Generated password (alphanumeric). */
  password: string;
  /** ISO timestamp of provisioning. */
  provisionedAt: string;
}

function sentinelDir(): string {
  return join(homedir(), '.omni');
}

function sentinelPath(): string {
  return join(sentinelDir(), 'scoped-role.json');
}

function readOmniCutoverSentinel(): OmniRoleCutoverSentinel | null {
  const path = sentinelPath();
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as OmniRoleCutoverSentinel;
    if (
      typeof parsed.roleName === 'string' &&
      typeof parsed.database === 'string' &&
      typeof parsed.password === 'string' &&
      typeof parsed.provisionedAt === 'string'
    ) {
      return parsed;
    }
  } catch {
    // Malformed sentinel — treat as missing.
  }
  return null;
}

function writeOmniCutoverSentinel(data: OmniRoleCutoverSentinel): void {
  const dir = sentinelDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = sentinelPath();
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
}

// biome-ignore lint/correctness/noUnusedVariables: reserved for `omni doctor --reset-cutover` (follow-up wish)
function clearOmniCutoverSentinel(): void {
  try {
    unlinkSync(sentinelPath());
  } catch {
    // Already gone — nothing to clear.
  }
}

// ============================================================================
// Kill-switch
// ============================================================================

function isOmniRoleCutoverEnabled(): boolean {
  return process.env.OMNI_ROLE_CUTOVER !== '0';
}

// ============================================================================
// Provisioning
// ============================================================================

function generatePassword(): string {
  // 32 bytes → 43 chars base64url (no padding). Always alphanumeric + `_-`.
  return randomBytes(32).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface EnsureOmniScopedRoleOptions {
  /** Path to autopg's canonical Unix socket dir (e.g. /run/user/1000/pgserve). */
  socketDir: string;
  /** Canonical port (default 5432). */
  port?: number;
  /** Database to scope grants to (default 'omni'). */
  database?: string;
  /** Force-enable bypassing the OMNI_ROLE_CUTOVER kill switch (tests). */
  enabled?: boolean;
}

export type EnsureOmniScopedRoleResult =
  | { status: 'provisioned' | 'refreshed'; roleName: string }
  | { status: 'skipped'; reason: string };

/**
 * Idempotently provision omni's scoped role + grants on canonical pgserve.
 *
 * Side effects:
 *   - CREATE ROLE if not exists (or ALTER PASSWORD if exists to keep sentinel in sync)
 *   - GRANTs scoped to the omni database
 *   - Sentinel written at ~/.omni/scoped-role.json
 *
 * Failure mode: best-effort. Any psql / spawn failure returns
 * `{ status: 'skipped', reason }` and emits a stderr warn. omni-api
 * continues with the legacy `postgres:postgres` path.
 */
export async function ensureOmniScopedRole(opts: EnsureOmniScopedRoleOptions): Promise<EnsureOmniScopedRoleResult> {
  const enabled = opts.enabled ?? isOmniRoleCutoverEnabled();
  if (!enabled) {
    return { status: 'skipped', reason: 'disabled' };
  }
  const database = opts.database ?? 'omni';
  const port = opts.port ?? 5432;
  const roleName = deriveOmniScopedRoleName();
  try {
    assertSafeIdent('role', roleName);
    assertSafeIdent('database', database);
  } catch (err) {
    return { status: 'skipped', reason: (err as Error).message };
  }
  // Reuse existing sentinel password when the role already exists, so we
  // don't have to ALTER PASSWORD every install (less log noise, no race
  // window where the sentinel and server are out of sync).
  const existing = readOmniCutoverSentinel();
  const password =
    existing && existing.roleName === roleName && existing.database === database
      ? existing.password
      : generatePassword();
  try {
    assertSafePassword(password);
  } catch (err) {
    return { status: 'skipped', reason: (err as Error).message };
  }
  const sqlScript = [
    // Idempotent role creation with password set inline. ALTER ROLE updates
    // the password when the role already exists — keeps sentinel + server
    // synchronized even if the operator regenerated the sentinel.
    `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${roleName}') THEN
    CREATE ROLE "${roleName}" WITH LOGIN PASSWORD '${password}'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  ELSE
    ALTER ROLE "${roleName}" WITH LOGIN PASSWORD '${password}'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;`,
    // Database-level grants. CREATE on the database is required so Drizzle
    // migrations can `CREATE SCHEMA "drizzle"` (the migration-tracker schema)
    // and `CREATE EXTENSION IF NOT EXISTS pgcrypto` from non-superuser. Without
    // this, omni-api boots, passes waitForDatabaseReady (SELECT 1 succeeds),
    // and then crashes with `PostgresError: permission denied for database
    // omni` on the first Drizzle migrate call. Mirror of genie's
    // `ensurePrivilegedBootstrapObjects` pattern.
    `GRANT CONNECT, TEMPORARY, CREATE ON DATABASE "${database}" TO "${roleName}";`,
  ];
  // Run the role + database-grants script on the postgres database.
  const dbCreateOk = await runProvisioningSql(sqlScript.join('\n'), {
    socketDir: opts.socketDir,
    port,
    database: 'postgres',
  });
  if (!dbCreateOk) {
    return { status: 'skipped', reason: 'psql role provisioning failed' };
  }
  // Schema/object grants must be applied inside the target database.
  // ALTER SCHEMA public OWNER mirrors genie's pattern: the scoped role
  // owns the public schema so it can do schema DDL (ALTER TABLE, CREATE
  // INDEX, etc.) in Drizzle migrations. pgcrypto pre-create lets a
  // non-superuser migration that calls CREATE EXTENSION IF NOT EXISTS
  // pgcrypto succeed as a no-op (untrusted extensions = superuser-only).
  //
  // Drizzle's migrator creates its OWN schema (`drizzle`) the first time
  // it runs, with `__drizzle_migrations` tracking inside. If that schema
  // pre-exists from a superuser-owned earlier run, the scoped role hits
  // `permission denied for schema drizzle`. The grants below:
  //   1. CREATE the schema if missing (AUTHORIZATION to scoped role)
  //   2. ALTER ownership when it pre-exists from postgres superuser
  //   3. Refresh GRANTs on the existing table inside
  // Idempotent — re-runs converge.
  const grantsScript = [
    'CREATE EXTENSION IF NOT EXISTS pgcrypto;',
    `ALTER SCHEMA public OWNER TO "${roleName}";`,
    `GRANT USAGE, CREATE ON SCHEMA public TO "${roleName}";`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${roleName}";`,
    `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO "${roleName}";`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${roleName}";`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO "${roleName}";`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE "${roleName}" IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${roleName}";`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE "${roleName}" IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO "${roleName}";`,
    // Drizzle migrator schema. CREATE-IF-NOT-EXISTS handles fresh installs;
    // ALTER OWNER + REASSIGN cover hosts where postgres superuser created
    // it on a prior migrator run. GRANT ALL covers any tables already
    // inside the schema (e.g. __drizzle_migrations).
    `CREATE SCHEMA IF NOT EXISTS drizzle AUTHORIZATION "${roleName}";`,
    `ALTER SCHEMA drizzle OWNER TO "${roleName}";`,
    `GRANT ALL ON SCHEMA drizzle TO "${roleName}";`,
    `GRANT ALL ON ALL TABLES IN SCHEMA drizzle TO "${roleName}";`,
    `GRANT ALL ON ALL SEQUENCES IN SCHEMA drizzle TO "${roleName}";`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA drizzle GRANT ALL ON TABLES TO "${roleName}";`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA drizzle GRANT ALL ON SEQUENCES TO "${roleName}";`,
  ].join('\n');
  const grantsOk = await runProvisioningSql(grantsScript, { socketDir: opts.socketDir, port, database });
  if (!grantsOk) {
    return { status: 'skipped', reason: 'psql grant step failed' };
  }
  writeOmniCutoverSentinel({
    roleName,
    database,
    password,
    provisionedAt: new Date().toISOString(),
  });
  return existing && existing.roleName === roleName
    ? { status: 'refreshed', roleName }
    : { status: 'provisioned', roleName };
}

interface ProvisioningSqlOptions {
  socketDir: string;
  port: number;
  database: string;
}

/**
 * Run a (possibly multi-statement) provisioning script over the wire via
 * postgres.js — NOT `psql`. The autopg/pgserve postmaster ships only the
 * server trio (no client tools), so `psql` is frequently absent on a fresh
 * host; shelling to it aborted role/grant provisioning. postgres.js runs the
 * script as a simple query, which fails-fast on the first error (the
 * `ON_ERROR_STOP=1` equivalent). Connects on the local unix socket as the
 * `postgres` superuser. Best-effort: returns false on any failure.
 */
async function runProvisioningSql(script: string, opts: ProvisioningSqlOptions): Promise<boolean> {
  const sql = postgres({
    host: opts.socketDir, // absolute path → unix socket
    port: opts.port,
    user: 'postgres',
    password: 'postgres',
    database: opts.database,
    max: 1,
    idle_timeout: 5,
    connect_timeout: 30,
    onnotice: () => {},
    prepare: false,
  });
  try {
    await sql.unsafe(script);
    return true;
  } catch (err) {
    process.stderr.write(
      `role-cutover: provisioning SQL failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return false;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// ============================================================================
// Runtime credential resolution (consumed by buildRuntimeEnv)
// ============================================================================

export interface ScopedCredentialOverride {
  username: string;
  password: string;
  roleName: string;
}

/**
 * Returns the scoped-role credentials to override `postgres:postgres` with
 * at runtime, or null when cutover is disabled / sentinel missing / kill
 * switch active. Pure: no DB roundtrip.
 *
 * Consumed by buildRuntimeEnv when constructing DATABASE_URL.
 */
export function resolveOmniScopedCredentials(): ScopedCredentialOverride | null {
  if (!isOmniRoleCutoverEnabled()) return null;
  const sentinel = readOmniCutoverSentinel();
  if (!sentinel) return null;
  const expected = deriveOmniScopedRoleName();
  if (sentinel.roleName !== expected) {
    // Stale sentinel from an old install — ignore until next provisioning.
    return null;
  }
  return {
    username: sentinel.roleName,
    password: sentinel.password,
    roleName: sentinel.roleName,
  };
}

/**
 * Enforcement-mode credential resolution — the fail-closed twin of
 * {@link resolveOmniScopedCredentials} (wish: omni-full-multitenancy, G3; ADR-0004).
 *
 * `resolveOmniScopedCredentials` returns `null` when the sentinel is missing or
 * the kill switch is set, and the caller then falls back to
 * `postgres:postgres`. That fallback is a documented, deliberate convenience
 * while the scoped role is only a blast-radius reduction. It becomes a
 * vulnerability the moment RLS is the security boundary: falling back to the
 * cluster superuser silently restores the ability to read every tenant.
 *
 * So under `OMNI_DB_ENFORCEMENT=on` this function THROWS instead of returning
 * null. There is no path from here to a superuser credential.
 *
 * The legacy resolver is untouched, and a deployment that has not set the
 * variable never reaches this code.
 */
export function resolveOmniEnforcedCredentials(
  env: Record<string, string | undefined> = process.env,
): ScopedCredentialOverride {
  if (env.OMNI_DB_ENFORCEMENT !== 'on') {
    throw new Error('role-cutover: resolveOmniEnforcedCredentials called outside enforcement mode');
  }
  if (env.OMNI_ROLE_CUTOVER === '0') {
    throw new Error(
      'role-cutover: OMNI_ROLE_CUTOVER=0 disables the scoped role, which is not permitted under ' +
        'OMNI_DB_ENFORCEMENT=on — enforcement has no legacy superuser fallback',
    );
  }
  const sentinel = readOmniCutoverSentinel();
  if (!sentinel) {
    throw new Error(
      'role-cutover: no scoped-role sentinel found and enforcement mode forbids the postgres:postgres ' +
        'fallback — provision the runtime role before starting',
    );
  }
  const expected = deriveOmniScopedRoleName();
  if (sentinel.roleName !== expected) {
    throw new Error(
      `role-cutover: sentinel names role ${sentinel.roleName} but this install expects ${expected}; refusing to start rather than falling back`,
    );
  }
  return { username: sentinel.roleName, password: sentinel.password, roleName: sentinel.roleName };
}
