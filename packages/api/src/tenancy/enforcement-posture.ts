/**
 * Boot-time posture check for the isolation-free mixed state
 * (wish: omni-full-multitenancy, Group G4; ADR-0003, ADR-0004).
 *
 * THE STATE THIS NAMES
 * --------------------
 * Two independent switches decide how much of the wish is actually live:
 *
 *   * `OMNI_MULTITENANCY_ENABLED=true` mounts the control plane, so tenants and
 *     tenant credentials can be created and a tenant-class key can authenticate
 *     against the whole `/api/v2` surface.
 *   * `OMNI_DB_ENFORCEMENT=on` installs the identity split and forced RLS, which
 *     is what makes a tenant's rows actually unreachable from another tenant's
 *     transaction.
 *
 * Turn the first on without the second and the deployment issues credentials
 * that CLAIM a tenant boundary while the database enforces none. The tenant
 * transaction still stamps its tenant id, but nothing forces a policy on the
 * read: the isolation is advisory. Every containment argument in this wish
 * rests on RLS being installed — the application layer decides which verb on
 * which resource KIND, never whose rows — so in this combination the second
 * half of that sentence has no enforcer.
 *
 * WHY WARN RATHER THAN REFUSE
 * ---------------------------
 * Because the combination is the documented migration path, not an error. The
 * RLS cutover needs the control plane up first: tenants have to exist and rows
 * have to be backfilled and verified before `NOT NULL` and forced policies can
 * be applied. Refusing to boot here would make the intended rollout order
 * impossible to execute, and operators would route around the refusal.
 *
 * What was actually wrong was that the state was SILENT. It is not any more:
 * the warning names both variables, says what is not enforced, and says what to
 * do about it, so an operator who reaches production still in this state cannot
 * claim the deployment never said so.
 */

import { isMultitenancyEnabled } from './feature-flag';

export type DbEnforcementPosture = 'legacy' | 'enforced';

/**
 * The warning to emit, or `null` when the combination is coherent.
 *
 * Returned rather than logged so it can be asserted on directly; the caller
 * (`index.ts` boot) does the logging.
 *
 * Three of the four combinations are coherent and silent:
 *   * flag off + legacy  — the default, pre-wish deployment.
 *   * flag off + enforced — RLS installed with no tenant credentials issued yet;
 *     the correct order to arrive in, and strictly safer than the default.
 *   * flag on + enforced — the finished state.
 */
export function mixedTenancyStateWarning(
  enforcement: DbEnforcementPosture,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (!isMultitenancyEnabled(env)) return null;
  if (enforcement === 'enforced') return null;

  return (
    'ISOLATION NOT ENFORCED: OMNI_MULTITENANCY_ENABLED=true with OMNI_DB_ENFORCEMENT unset (legacy mode). ' +
    'Tenant credentials can be issued and will authenticate, but the database has no forced row-level ' +
    'security and the application runs on an identity that can bypass it, so the tenant boundary those ' +
    'credentials imply is ADVISORY ONLY — a defect in any query that forgets its tenant predicate is a ' +
    'cross-tenant read, not a bug caught by the database. This combination is the migration path, not a ' +
    'production posture: complete the cutover and set OMNI_DB_ENFORCEMENT=on before serving real tenants.'
  );
}

/**
 * Emit the warning if there is one.
 *
 * The branch lives here rather than at the call site so the boot function does
 * not grow a conditional for it — and so the "warn exactly once, at boot, on
 * this combination and no other" rule has one home.
 */
export function warnOnMixedTenancyState(
  enforcement: DbEnforcementPosture,
  warn: (message: string) => void,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const message = mixedTenancyStateWarning(enforcement, env);
  if (message) warn(message);
}
