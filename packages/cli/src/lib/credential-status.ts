/**
 * Operator-facing rendering of the caller's credential context
 * (wish: omni-full-multitenancy, Group G4; WISH "Compatibility").
 *
 * `omni status` and `omni auth status` both have to answer the same question —
 * "which world is this key in, and what may it reach?" — so the projection
 * lives here once rather than being written twice and drifting.
 *
 * THE EMPTY OBJECT IS THE POINT
 * -----------------------------
 * A legacy credential returns `{}`, and callers spread the result. That is what
 * makes the dual-world invariant hold at the CLI layer: for a legacy key the
 * printed object is field-for-field what it was before G4, not "the same plus
 * some nulls". A test pins the empty case for exactly that reason.
 *
 * Nothing here can print key material: the input is the API's already-filtered
 * `credential` block, which carries no secret, hash, or credential id.
 */

import type { AuthValidateResponse } from '@omni/sdk';

/**
 * Project the validate response into display fields.
 *
 * Field names are deliberately distinct from the legacy ones (`tenantScopes`,
 * not `scopes`) so the tenant credential's own scopes cannot be confused with
 * the legacy projection the surrounding output already prints.
 */
export function credentialStatusFields(auth: AuthValidateResponse): Record<string, unknown> {
  const credential = auth.credential;
  if (!credential) return {};

  return {
    credentialClass: credential.class,
    // Slug first because that is how humans name a tenant, with the id kept
    // alongside it because that is what support and audit trails need. An
    // unresolved slug degrades to the id alone rather than to a guess.
    tenant: credential.tenantSlug ? `${credential.tenantSlug} (${credential.tenantId})` : credential.tenantId,
    role: credential.role,
    tenantScopes: credential.scopes,
    constraints: credential.constraints,
    expiresAt: credential.expiresAt ?? 'never',
    delegationDepth: credential.delegationDepth,
  };
}

/**
 * Project the server's tenancy posture into display fields (issue #982).
 *
 * Same empty-object contract as above, for the same reason: a server that does
 * not report posture — any server predating it — must add NOTHING, so output
 * against an old server stays field-for-field what it is today. "Absent" is
 * itself the operator's signal that the server predates the control plane.
 *
 * Field names are prefixed `server*` so they cannot collide with the
 * credential projection or the existing status fields (`omni auth status`
 * already prints a `server` key naming the config entry).
 *
 * The `tenancyWarning` field mirrors `mixedTenancyStateWarning` semantics on
 * the API side: it appears exactly when the flag is on but the database is in
 * legacy enforcement — the advisory-only migration state — and never in the
 * three coherent combinations.
 */
export function serverPostureFields(auth: AuthValidateResponse): Record<string, unknown> {
  const posture = auth.server;
  if (!posture) return {};

  const fields: Record<string, unknown> = {
    serverMultitenancy: posture.multitenancyEnabled ? 'enabled' : 'disabled',
    serverControlPlane: posture.controlPlaneMounted ? 'mounted' : 'not mounted',
    serverDbEnforcement: posture.dbEnforcement,
  };

  if (posture.multitenancyEnabled && posture.dbEnforcement === 'legacy') {
    fields.tenancyWarning =
      'isolation not enforced: multitenancy is enabled but DB enforcement is legacy — the tenant boundary is advisory only (migration state)';
  }

  return fields;
}
