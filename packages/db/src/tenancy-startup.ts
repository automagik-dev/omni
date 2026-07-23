/**
 * Enforcement-mode boot contract
 * (wish: omni-full-multitenancy, Group G3; ADR-0004).
 *
 * Two startup worlds, selected by ONE variable:
 *
 *   * `OMNI_DB_ENFORCEMENT` unset / `off` (**default**) — legacy. This module
 *     contributes nothing: `resolveEnforcementMode` returns `legacy`, the boot
 *     path takes no new branch, and `role-cutover.ts` keeps its documented
 *     best-effort `postgres:postgres` fallback. A legacy deployment's reads,
 *     writes, startup, and connection handling are contract-identical to G2.
 *
 *   * `OMNI_DB_ENFORCEMENT=on` — enforced. Startup FAILS CLOSED unless the
 *     three identities of ADR-0004 are present and correctly attributed. There
 *     is no superuser fallback on this path, by construction: the enforced
 *     branch never consults the legacy credential resolver at all.
 *
 * Boot-sequence change (enforced only): migrations run under the DDL identity,
 * on a connection opened for that purpose and closed before the server listens.
 * The runtime identity — which holds no CREATE and owns nothing — could not run
 * them, which is exactly the point: after boot the app process holds no
 * credential capable of DDL.
 */

import { sql } from 'drizzle-orm';
import type { Database } from './client';
import { type EnforcementStateReport, readEnforcementState } from './tenancy-rls';
import { type RoleAttributes, readRoleAttributes, roleAttributeViolations } from './tenancy-roles';

export type DbEnforcementMode = 'legacy' | 'enforced';

export const ENFORCEMENT_ENV_VAR = 'OMNI_DB_ENFORCEMENT';
export const RUNTIME_URL_ENV_VAR = 'OMNI_DB_RUNTIME_URL';
export const DDL_URL_ENV_VAR = 'OMNI_DB_DDL_URL';
/** Consumed by the G5 auth-plane connection wiring. @public */
export const AUTH_PLANE_URL_ENV_VAR = 'OMNI_DB_AUTH_PLANE_URL';

/**
 * Anything other than a literal `on` is legacy.
 *
 * Deliberately not truthy-ish: `1`, `true`, and `yes` are all rejected, so a
 * stray environment variable cannot half-activate a security boundary, and the
 * activation appears verbatim in a deployment manifest.
 */
export function resolveEnforcementMode(env: Record<string, string | undefined> = process.env): DbEnforcementMode {
  return env[ENFORCEMENT_ENV_VAR] === 'on' ? 'enforced' : 'legacy';
}

export class EnforcementStartupError extends Error {
  readonly code = 'enforcement_startup_failed';
  constructor(message: string) {
    super(`omni: enforcement-mode startup refused — ${message}`);
    this.name = 'EnforcementStartupError';
  }
}

export interface EnforcedBootIdentities {
  /** Connection string for the non-owning NOBYPASSRLS role that serves traffic. */
  readonly runtimeUrl: string;
  /** Connection string for the owning role that runs migrations, then is dropped. */
  readonly ddlUrl: string;
  /** ADR-0003 isolated auth plane. Optional: absent means the auth plane shares runtime. */
  readonly authPlaneUrl: string | null;
}

/**
 * Resolve the enforced-mode identities.
 *
 * `DATABASE_URL` is NOT consulted here. In enforced mode the identities are
 * explicit and separate; silently reusing whatever `DATABASE_URL` happens to
 * hold is how a superuser ends up serving traffic.
 */
export function resolveEnforcedBootIdentities(
  env: Record<string, string | undefined> = process.env,
): EnforcedBootIdentities {
  const runtimeUrl = env[RUNTIME_URL_ENV_VAR];
  const ddlUrl = env[DDL_URL_ENV_VAR];
  if (!runtimeUrl) throw new EnforcementStartupError(`${RUNTIME_URL_ENV_VAR} is required and unset`);
  if (!ddlUrl) throw new EnforcementStartupError(`${DDL_URL_ENV_VAR} is required and unset`);
  if (runtimeUrl === ddlUrl) {
    throw new EnforcementStartupError(
      `${RUNTIME_URL_ENV_VAR} and ${DDL_URL_ENV_VAR} are identical; migration and runtime credentials must differ`,
    );
  }
  return { runtimeUrl, ddlUrl, authPlaneUrl: env[AUTH_PLANE_URL_ENV_VAR] ?? null };
}

/**
 * Remove the DDL connection string from the process environment once enforced
 * boot has finished with it (G3 review carry-forward L3).
 *
 * G3 already closed the DDL connection before the server listened, so the
 * process held no OPEN handle capable of DDL. What it still held was the
 * credential itself, sitting in `process.env` where any later code path — a
 * plugin, a diagnostic endpoint, an error reporter serializing the environment
 * — could read or forward it. ADR-0004's "migration credentials are unavailable
 * to the application process after boot" reads more strictly than "the socket is
 * shut": this closes the gap.
 *
 * Legacy mode is untouched. There is no DDL identity on that path, nothing is
 * deleted, and the function is never called.
 *
 * @returns whether a value was actually removed, so the caller can log/assert.
 */
export function scrubDdlCredential(env: Record<string, string | undefined> = process.env): boolean {
  if (env[DDL_URL_ENV_VAR] === undefined) return false;
  delete env[DDL_URL_ENV_VAR];
  return true;
}

export interface RuntimeIdentityReport {
  readonly currentUser: string;
  readonly attributes: RoleAttributes;
  /** Tables in `public` owned by the connected role. Must be empty. */
  readonly ownedTables: string[];
  /** True when the role holds CREATE on schema `public`. Must be false. */
  readonly hasSchemaCreate: boolean;
  readonly enforcement: EnforcementStateReport;
}

/**
 * Probe the connected identity and refuse to boot unless it matches ADR-0004.
 *
 * Every check is a live catalog probe rather than a claim about configuration:
 * the question is not "was the runtime role provisioned correctly six months
 * ago" but "is the role this process is connected as, right now, incapable of
 * bypassing RLS".
 */
export async function assertEnforcedRuntimeIdentity(db: Database): Promise<RuntimeIdentityReport> {
  const userRows = (await db.execute(sql`SELECT current_user::text AS name`)) as unknown as { name: string }[];
  const currentUser = userRows[0]?.name ?? '';
  if (!currentUser) throw new EnforcementStartupError('could not determine current_user');

  const attributes = await readRoleAttributes(db, currentUser);
  if (!attributes) {
    throw new EnforcementStartupError(`runtime role ${currentUser} is absent from pg_roles`);
  }
  const violations = roleAttributeViolations(attributes);
  if (violations.length > 0) {
    throw new EnforcementStartupError(`runtime role ${currentUser}: ${violations.join(', ')}`);
  }

  const ownedRows = (await db.execute(sql`
    SELECT c.relname::text AS relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relowner = current_user::regrole::oid
    ORDER BY 1
  `)) as unknown as { relname: string }[];
  const ownedTables = ownedRows.map((r) => r.relname);
  if (ownedTables.length > 0) {
    throw new EnforcementStartupError(
      `runtime role ${currentUser} owns ${ownedTables.length} table(s) in public (first: ${ownedTables[0]}); an owner can ALTER TABLE ... NO FORCE ROW LEVEL SECURITY`,
    );
  }

  const createRows = (await db.execute(sql`
    SELECT pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE') AS has_create
  `)) as unknown as { has_create: boolean }[];
  const hasSchemaCreate = createRows[0]?.has_create === true;
  if (hasSchemaCreate) {
    throw new EnforcementStartupError(`runtime role ${currentUser} holds CREATE on schema public`);
  }

  const enforcement = await readEnforcementState(db);
  if (enforcement.state !== 'enforced') {
    throw new EnforcementStartupError(
      `row-level security is ${enforcement.state}: ${enforcement.missing.length} table(s) not forced, ` +
        `${enforcement.missingPolicies.length} table(s) missing policies`,
    );
  }

  return { currentUser, attributes, ownedTables, hasSchemaCreate, enforcement };
}
