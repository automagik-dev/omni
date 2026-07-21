/**
 * The connection the auth plane reads on
 * (wish: omni-full-multitenancy, Group G4; ADR-0003, ADR-0004).
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * G3 built the auth plane's LOGIC — `auth-bootstrap.ts` resolves a credential,
 * `MembershipSelectionService` re-validates a membership at tenant-selection
 * time — and wired both to the ordinary runtime `Database`. That is correct in
 * legacy mode and wrong under enforcement, in a way that is easy to miss because
 * it fails in the safe direction:
 *
 *   * `auth_credentials` is an RLS EXCLUSION. The runtime role receives zero
 *     privileges on it, so the credential lookup does not return the wrong row —
 *     it errors.
 *   * `tenant_memberships` is readable pre-context only through the
 *     `omni_auth_plane_row_visible` disjunct, which admits members of the
 *     `omni_auth_plane` marker role. The runtime role is not a member and never
 *     becomes one, so the CONFIRMING-hint path in `RequestAuthenticator` — the
 *     one that re-reads a membership when a caller's hint names its own tenant —
 *     finds nothing and returns `membership_disabled`.
 *
 * Failing closed is the right default, and it is still a bug: a caller sending
 * a correct, confirming tenant header would be rejected under enforcement while
 * the same caller sending no header at all succeeds. That is the G3 review's
 * residual item, and this module is where it is fixed.
 *
 * LEGACY IS UNTOUCHED
 * -------------------
 * In legacy mode this returns the runtime handle itself — the same object
 * `AuthBootstrapService` received before G4 — and opens nothing. There is no new
 * pool, no new environment variable read, and no behavioral difference of any
 * kind. The dual-world invariant is preserved by having exactly one branch, and
 * it is keyed on the same `OMNI_DB_ENFORCEMENT` variable that selects every
 * other enforcement behavior.
 */

import { type Database, createDbHandle, resolveEnforcementMode } from '@omni/db';

export const AUTH_PLANE_URL_ENV_VAR = 'OMNI_DB_AUTH_PLANE_URL';

export interface AuthPlaneConnection {
  readonly db: Database;
  /**
   * How the handle was obtained. Exported so startup can log it and the probe
   * can assert it rather than infer it from behavior.
   */
  readonly source: 'runtime-shared' | 'dedicated-auth-plane-role';
  /** No-op when the runtime handle is shared; drains the dedicated pool otherwise. */
  close(): Promise<void>;
}

/**
 * Resolve the handle the auth plane should read on.
 *
 * @param runtimeDb - the serving connection, returned as-is in legacy mode.
 *
 * Under enforcement with `OMNI_DB_AUTH_PLANE_URL` set, an INDEPENDENT pool is
 * opened for the auth-plane role — independent because it must outlive nothing
 * and be closable on its own, and because sharing the runtime pool would mean
 * sharing the runtime identity, which is the whole point of not doing this.
 *
 * Under enforcement WITHOUT that variable, G3's documented contract stands
 * (`resolveEnforcedBootIdentities` treats it as optional: "absent means the auth
 * plane shares runtime"). The shared handle is returned and `source` says so, so
 * an operator can see in one log line that the confirming-hint path will fail
 * closed on that deployment rather than discovering it from a support ticket.
 */
export function resolveAuthPlaneConnection(
  runtimeDb: Database,
  env: Record<string, string | undefined> = process.env,
): AuthPlaneConnection {
  const shared: AuthPlaneConnection = {
    db: runtimeDb,
    source: 'runtime-shared',
    close: async () => undefined,
  };

  if (resolveEnforcementMode(env) !== 'enforced') return shared;

  const url = env[AUTH_PLANE_URL_ENV_VAR];
  if (!url) return shared;

  // Small pool on purpose: the auth plane issues two narrow indexed lookups per
  // request and must never become a way to hold connections the serving path
  // needs.
  const handle = createDbHandle({ url, maxConnections: 4 });
  return { db: handle.db, source: 'dedicated-auth-plane-role', close: handle.close };
}
