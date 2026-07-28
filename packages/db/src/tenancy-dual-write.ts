/**
 * Trusted dual-write ownership propagation (wish: omni-full-multitenancy, G2).
 *
 * WHERE OWNERSHIP COMES FROM
 * --------------------------
 * Tenant identity is established from trusted SERVER-SIDE sources only. It is
 * never read from a request body, header, query parameter, person metadata, the
 * quarantined `OmniCustomerContext.tenantId`, or `OMNI_TENANT_ID` — G0
 * classifies that whole surface `quarantine`, and it can never establish
 * authority (`OWNERSHIP_MANIFEST.yaml`, `caller_adjacent_tenant_context`).
 *
 * There are exactly two trusted sources, and this module is the only place
 * either is turned into a persisted `tenant_id`:
 *
 *   1. DERIVED — for a row with one or more owning parents covered by a G2
 *      composite foreign key. Every parent's CURRENTLY PERSISTED tenant id is
 *      loaded in the same transaction as the write. This is enforced in the
 *      database by the BEFORE INSERT triggers migration 0041 installs, so no
 *      writer — existing, future, operational script, or pre-G2 binary — can
 *      bypass it. `deriveTenantOwnership()` below is the executable statement of
 *      that same rule, used to test and to explain it.
 *
 *   2. ROOT — for an ownership-root row with no FK-covered tenant parent AND an
 *      explicit G0 derivation rule. `instances` is the only such table: G0 says
 *      "tenant_id assigned at instance creation from authenticated tenant
 *      context; the ownership root all descendants derive from". Root ownership
 *      travels through `trustedInstanceOwnership()`, which accepts ONLY a
 *      validated server-side auth context.
 *
 * NOT GATED BY THE FEATURE FLAG
 * -----------------------------
 * `OMNI_MULTITENANCY_ENABLED` does not gate this. With tenant mode off,
 * old-shaped writes stay valid and simply leave ownership NULL, while a trusted
 * root write or a write beneath fully-owned parents still persists derived
 * ownership. That asymmetry is the point: it stops a pre-G2 binary in a
 * mixed-version fleet from creating an unowned row underneath an owned parent
 * (ADR-0007, WISH mixed-version state 1).
 *
 * G2 changes NO read, query, or authorization behavior. This module only decides
 * what a write persists into the new nullable column.
 */

import { type OwningParent, getOwnershipSpec } from './tenancy-ownership';

/**
 * The minimal trusted, server-side authenticated context that may establish
 * ownership on an ownership-root row.
 *
 * This is deliberately a narrow structural type rather than a re-export of the
 * G1 auth context: it makes it impossible to pass a request-shaped object, and
 * it keeps G2 free of any dependency on the request/authorization boundary,
 * which G3 owns.
 */
export interface TrustedTenantContext {
  /** Tenant resolved by the auth plane from a credential, never from the caller. */
  readonly tenantId: string;
  /** Proof of where the tenant came from. Only `auth-plane` may establish ownership. */
  readonly source: 'auth-plane';
}

/** Sources that are explicitly NOT authoritative, kept here so tests can name them. */
export const UNTRUSTED_TENANT_SOURCES = [
  'request.body.tenantId',
  'request.headers.x-tenant-id',
  'request.query.tenantId',
  'person.metadata.tenantId',
  'OmniCustomerContext.tenantId',
  'OMNI_TENANT_ID',
] as const;

export class CrossTenantOwnershipError extends Error {
  constructor(
    readonly table: string,
    readonly column: string,
  ) {
    super(`cross-tenant ownership conflict on ${table}."${column}": owning parents disagree`);
    this.name = 'CrossTenantOwnershipError';
  }
}

/** A parent's persisted ownership, as read inside the writing transaction. */
export interface ParentOwnership {
  readonly column: string;
  /** The parent row's id on the child being written, or null when not set. */
  readonly parentId: string | null;
  /** The parent's CURRENTLY PERSISTED tenant id. Null when still unowned. */
  readonly tenantId: string | null;
}

/**
 * The G2 derivation precedence, in one place.
 *
 * Rules, in order:
 *   * A parent is APPLICABLE only when its FK column on this row is non-null.
 *   * Two applicable parents with different non-null tenant ids -> reject.
 *   * Any applicable parent still NULL-owner -> persist NULL. A non-null child
 *     tenant id is never written above a NULL-owner parent.
 *   * All applicable parents non-null and equal -> persist that tenant id.
 *   * No applicable parents at all -> persist NULL.
 *
 * @throws CrossTenantOwnershipError when non-null parents disagree.
 */
export function deriveTenantOwnership(table: string, parents: readonly ParentOwnership[]): string | null {
  let resolved: string | null = null;
  let seen = false;
  let sawNullOwnerParent = false;

  for (const parent of parents) {
    if (parent.parentId === null) continue; // not applicable to this row
    if (parent.tenantId === null) {
      sawNullOwnerParent = true;
      continue;
    }
    if (seen && resolved !== parent.tenantId) {
      throw new CrossTenantOwnershipError(table, parent.column);
    }
    resolved = parent.tenantId;
    seen = true;
  }

  return sawNullOwnerParent ? null : resolved;
}

/** The FK-covered owning parents G2 derives `table` from. */
export function owningParentsOf(table: string): readonly OwningParent[] {
  return getOwnershipSpec(table)?.parents ?? [];
}

/**
 * Ownership for an ownership-root `instances` row.
 *
 * Returns the tenant id only when the caller supplies a context the auth plane
 * produced. Anything else — including `undefined`, which is what every current
 * caller passes because the request auth boundary is G3's work — yields
 * `undefined`, so the insert leaves ownership NULL and behaves exactly as it
 * does at HEAD.
 *
 * @throws TypeError when handed a context that did not come from the auth plane.
 */
export function trustedInstanceOwnership(context?: TrustedTenantContext): { tenantId: string } | undefined {
  if (context === undefined) return undefined;
  if (context.source !== 'auth-plane') {
    throw new TypeError('tenant ownership may only be established from an auth-plane context');
  }
  if (typeof context.tenantId !== 'string' || context.tenantId.length === 0) {
    throw new TypeError('trusted tenant context must carry a tenant id');
  }
  return { tenantId: context.tenantId };
}

/**
 * True when `table` may accept a caller-provided tenant id at all.
 *
 * Only the ownership root may. Every other tenant table derives ownership in the
 * database, and its trigger discards any supplied value.
 */
export function acceptsTrustedOwnership(table: string): boolean {
  return getOwnershipSpec(table)?.derivation === 'root';
}
