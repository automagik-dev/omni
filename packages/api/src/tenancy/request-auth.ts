/**
 * The single construction point for a request's auth context
 * (wish: omni-full-multitenancy, Group G3; ADR-0003).
 *
 * G1 built the pieces: `auth-context.ts` defines the frozen record and
 * `auth-bootstrap.ts` resolves one from the isolated credential index. What was
 * missing is the rule that ties them to a request: the context is constructed
 * ONCE per authenticated operation, from the auth plane only, and nothing
 * downstream can re-tenant it.
 *
 * TENANT SELECTION
 * ----------------
 * A caller may send a tenant hint — a header, a path segment, a body field, a
 * query parameter. That hint is ADVISORY, and this module is where that word is
 * given teeth:
 *
 *   * A tenant-class credential is bound to exactly one tenant by
 *     `auth_credentials.tenant_id`, and its lineage, scopes, and role ceiling
 *     are bound to that same tenant. A hint naming a DIFFERENT tenant is
 *     rejected outright — not ignored, rejected — even when the authenticated
 *     principal holds an active membership in the tenant it names. Multi-
 *     membership widens which credentials a human may hold; it never widens
 *     what one credential may reach. This is the `tenant_selection_rejected`
 *     path and it is the property the header/body/query confusion tests probe.
 *
 *   * A hint naming the credential's OWN tenant is where the selection is
 *     validated rather than assumed: the membership is re-read from the auth
 *     plane at selection time, so a membership disabled or removed between
 *     credential issuance and this request is rejected here even though the
 *     credential itself is still active.
 *
 *   * A platform-class credential's target tenant comes from the route via
 *     `bindPlatformOperation` (ADR-0005). A caller hint can never set it.
 *
 * CONSTRUCTED ONCE
 * ----------------
 * `RequestAuthenticator` refuses a second construction for the same request id.
 * Two constructions would mean two contexts for one operation, and the second
 * one is the interesting one for an attacker: it is the one that could carry a
 * different tenant into a transaction opened by the first.
 */

import type { Database } from '@omni/db';
import { principals, tenantMemberships } from '@omni/db';
import { and, eq } from 'drizzle-orm';
import type { AuthBootstrapService } from '../services/auth-bootstrap';
import { type AuthContext, type AuthFailureReason, freezeContext } from './auth-context';

export type RequestAuthFailure =
  | AuthFailureReason
  /** A caller hint tried to move the request to a tenant the credential does not hold. */
  | 'tenant_selection_rejected'
  /** A second context construction was attempted for one request. */
  | 'context_already_constructed';

export type TenantSelectionSource = 'credential' | 'validated_membership';

export interface RequestAuthSuccess {
  readonly ok: true;
  readonly context: AuthContext;
  /** How the tenant was established. Never `header`, `body`, `path`, or `query`. */
  readonly tenantSource: TenantSelectionSource;
}

export type RequestAuthResult = RequestAuthSuccess | { ok: false; reason: RequestAuthFailure };

export interface RequestAuthInput {
  readonly requestId: string;
  readonly secret: string;
  /**
   * Caller-supplied tenant hint, from wherever the transport found it.
   * Advisory: it may confirm, it may be rejected, it can never select.
   */
  readonly requestedTenantId?: string | null;
}

/**
 * Auth-plane membership re-validation.
 *
 * Deliberately narrow: one indexed lookup keyed by (tenant, principal), never a
 * list of the principal's memberships. A tenant-scoped path calling this cannot
 * discover which OTHER tenants a principal belongs to.
 */
export class MembershipSelectionService {
  constructor(private readonly db: Database) {}

  async isActiveMembership(tenantId: string, principalId: string, membershipId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: tenantMemberships.id, status: tenantMemberships.status })
      .from(tenantMemberships)
      .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.principalId, principalId)))
      .limit(1);
    // Identity as well as status: a membership row replaced by a new one is a
    // different grant, and the context's `membershipId` must still name it.
    return row?.status === 'active' && row.id === membershipId;
  }

  async isHumanPrincipal(principalId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ type: principals.type })
      .from(principals)
      .where(eq(principals.id, principalId))
      .limit(1);
    return row?.type === 'human';
  }
}

export class RequestAuthenticator {
  private readonly constructed = new Set<string>();

  constructor(
    private readonly authBootstrap: AuthBootstrapService,
    private readonly memberships: MembershipSelectionService,
  ) {}

  /**
   * Resolve the one immutable context for this request.
   *
   * Failures are typed; the transport maps ALL of them to one uniform,
   * non-enumerating 401/403 so this cannot be used as an existence oracle.
   */
  async authenticate(input: RequestAuthInput): Promise<RequestAuthResult> {
    if (this.constructed.has(input.requestId)) {
      return { ok: false, reason: 'context_already_constructed' };
    }

    const looked = await this.authBootstrap.lookupBySecret(input.secret, input.requestId);
    if (!looked.ok) return { ok: false, reason: looked.reason };
    const { context } = looked;

    const hint = normalizeHint(input.requestedTenantId);

    if (context.credentialClass === 'platform') {
      // ADR-0005: the target tenant is route-bound, never caller-bound. A hint
      // on a platform credential is an attempt to pick a victim tenant.
      if (hint !== null) return { ok: false, reason: 'tenant_selection_rejected' };
      this.constructed.add(input.requestId);
      return { ok: true, context, tenantSource: 'credential' };
    }

    if (hint === null) {
      this.constructed.add(input.requestId);
      return { ok: true, context, tenantSource: 'credential' };
    }

    // A hint that names another tenant is rejected regardless of what
    // memberships the principal holds elsewhere.
    if (hint !== context.tenantId) {
      return { ok: false, reason: 'tenant_selection_rejected' };
    }

    // Confirming hint: re-validate the membership at selection time.
    let active: boolean;
    try {
      active = await this.memberships.isActiveMembership(context.tenantId, context.principalId, context.membershipId);
    } catch {
      // The data plane never proceeds on an unvalidatable auth plane.
      return { ok: false, reason: 'auth_plane_error' };
    }
    if (!active) return { ok: false, reason: 'membership_disabled' };

    this.constructed.add(input.requestId);
    // Re-frozen so the returned object is a fresh immutable value even though
    // its fields are unchanged — the caller never holds a mutable alias.
    return { ok: true, context: freezeContext({ ...context }), tenantSource: 'validated_membership' };
  }

  /** Test/lifecycle helper: forget a completed request id. */
  release(requestId: string): void {
    this.constructed.delete(requestId);
  }
}

function normalizeHint(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
