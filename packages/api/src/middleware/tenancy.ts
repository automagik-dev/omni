/**
 * The tenancy edge — where a request becomes tenant-scoped, or stays legacy
 * (wish: omni-full-multitenancy, Group G4; ADR-0003, ADR-0004).
 *
 * This runs FIRST in the protected chain, ahead of `authMiddleware`, and it is
 * the only place in the request path that decides which of the two worlds a
 * request belongs to.
 *
 * THE DECISION
 * ------------
 * The presented secret is offered to the auth plane exactly once. The auth
 * plane knows only tenant- and platform-class credentials (`auth_credentials`);
 * a legacy API key is not in that table and comes back `not_found`. So:
 *
 *   * **Recognised as a tenant credential** → the immutable context is
 *     constructed here, ONCE (ADR-0003), and the entire downstream handler runs
 *     inside a tenant-stamped transaction. Nothing downstream can re-tenant it.
 *
 *   * **Not recognised** → the middleware sets nothing and calls `next()`.
 *     `authMiddleware` then validates the legacy key exactly as it did before
 *     G4 existed. This is the default world, and its behaviour is unchanged.
 *
 * WHY THE FLAG IS NOT CONSULTED HERE
 * ----------------------------------
 * Application-layer scoping for a tenant credential is UNCONDITIONAL. The
 * feature flag gates whether the control plane that ISSUES tenant credentials
 * is mounted at all, and the enforcement state gates the DB/RLS layer. A tenant
 * credential that exists must therefore always be scoped — making that
 * conditional would create a configuration in which a real tenant key runs
 * unscoped, which is precisely the failure this wish exists to prevent.
 *
 * WHY AN AUTH-PLANE ERROR DOES NOT FAIL THE REQUEST
 * -------------------------------------------------
 * `auth_plane_error` here means "could not determine whether this is a tenant
 * credential". In the flag-off world that is every request on a deployment with
 * no control plane, and failing them would make an auth-plane blip an outage
 * for legacy traffic. The request continues as legacy and `authMiddleware`
 * decides. Note the asymmetry that keeps this safe: this path can only ever
 * DECLINE to establish a tenant scope, never establish the wrong one. Once a
 * credential IS recognised as tenant-class, every failure below is fatal.
 *
 * UNIFORM REJECTION
 * -----------------
 * Every recognised-but-rejected outcome collapses to one 401 with one body.
 * The typed reasons (`tenant_selection_rejected`, `membership_disabled`,
 * `credential_expired`, …) are deliberately NOT surfaced: distinguishing them
 * would turn the edge into an oracle for foreign tenant existence, membership,
 * and credential state.
 */

import { createMiddleware } from 'hono/factory';
import type { AuthContext, TenantAuthContext } from '../tenancy/auth-context';
import { isMultitenancyEnabled } from '../tenancy/feature-flag';
import { runInTenantScope, scopedHandle } from '../tenancy/tenant-scope';
import type { ApiKeyData, AppVariables } from '../types';

/**
 * Advisory tenant hint. Per WISH "Compatibility" this exists for humans who
 * hold memberships in several tenants; it may only ever CONFIRM the tenant the
 * credential is already bound to. `RequestAuthenticator` enforces that — the
 * edge just forwards it verbatim and never interprets it.
 */
const TENANT_HINT_HEADER = 'x-omni-tenant-id';

function presentedSecret(header: (name: string) => string | undefined, query: (name: string) => string | undefined) {
  // Same three transports `authMiddleware` accepts, read the same way, so a
  // credential cannot be tenant-class on one transport and legacy on another.
  return header('x-api-key') ?? query('api_key') ?? header('authorization')?.replace(/^Bearer\s+/i, '');
}

/**
 * Present a tenant context to the legacy authorization middlewares.
 *
 * `scope-enforcer`, `requireAnyScope`, and the rate limiter all read
 * `c.get('apiKey')`. Rather than fork every one of them, the tenant context is
 * projected into that shape — a translation, not a second source of authority:
 * every field is derived from the frozen context, and nothing here can widen it.
 *
 * `instanceIds` is `null` (= "no legacy instance restriction") because for a
 * tenant credential the tenant boundary IS the restriction, and it is enforced
 * below this layer by RLS and the tenant transaction. A legacy allowlist is
 * honoured transitionally where one is carried in `resourceConstraints`, but it
 * can only ever NARROW: it is intersected into a boundary it cannot widen,
 * since a legacy allowlist naming another tenant's instance still cannot read
 * that instance through the scoped transaction.
 */
function projectTenantApiKey(context: TenantAuthContext): ApiKeyData {
  const constraint = (name: string): string[] | undefined => {
    const value = context.resourceConstraints[name];
    return Array.isArray(value) ? [...value] : undefined;
  };

  return {
    id: context.credentialId,
    name: `tenant:${context.actorRole}`,
    scopes: [...context.scopes],
    instanceIds: constraint('instanceIds') ?? null,
    expiresAt: context.expiresAt,
    profile: null,
    chatAllowlist: constraint('chatAllowlist') ?? [],
    instanceAllowlist: constraint('instanceAllowlist') ?? [],
    outboundRecipientAllowlist: constraint('outboundRecipientAllowlist') ?? [],
    profileOverrides: null,
  };
}

export const tenancyMiddleware = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  const secret = presentedSecret(
    (name) => c.req.header(name),
    (name) => c.req.query(name),
  );
  // No credential at all: not our decision. `authMiddleware` returns the 401,
  // with the message it has always returned.
  if (!secret) return next();

  // Flag off: the tenant control plane that issues tenant credentials is not
  // mounted (feature-flag.ts / app.ts), so no tenant credential can exist and
  // the auth-plane lookup below could only ever return `not_found`. Skip it
  // entirely — a flag-off deployment must add ZERO database round-trips over
  // its pre-G4 behaviour, so legacy traffic stays byte-for-byte legacy. The
  // flag-on path is unchanged: enabling it is what makes tenant credentials
  // possible, and only then is the lookup meaningful.
  if (!isMultitenancyEnabled()) return next();

  const authenticator = c.get('services')?.requestAuthenticator;
  if (!authenticator) return next();

  // NOT `c.get('requestId')`. That value is caller-controlled — the context
  // middleware honours an inbound `x-request-id` header — and the authenticator
  // refuses a second context construction for a request id it has already seen.
  // Keying on it would let ANY caller pick the id of another tenant's in-flight
  // request and turn that tenant's request into a 401: a cross-tenant denial of
  // service with no credential needed. The single-construction rule is about
  // one request, so the token that identifies "one request" is minted here and
  // never leaves this function.
  const authRequestId = crypto.randomUUID();

  const result = await authenticator.authenticate({
    requestId: authRequestId,
    secret,
    requestedTenantId: c.req.header(TENANT_HINT_HEADER) ?? null,
  });

  if (!result.ok) {
    // Unrecognised, or undeterminable: fall through to the legacy world. These
    // are the only two reasons that are not fatal, and neither can result in a
    // tenant scope being established.
    if (result.reason === 'not_found' || result.reason === 'auth_plane_error') return next();

    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid API key' } }, 401);
  }

  const context: AuthContext = result.context;
  // Platform credentials reach the control plane through `platformAuthMiddleware`
  // and are never admissible on the tenant data-plane surface (ADR-0005): their
  // target tenant is route-bound, and no route under this chain binds one.
  if (context.credentialClass !== 'tenant') {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid API key' } }, 401);
  }

  c.set('authContext', context);
  c.set('tenantSource', result.tenantSource);
  c.set('apiKey', projectTenantApiKey(context));

  try {
    // The whole remaining chain — authorization, the handler, serialization —
    // runs inside ONE tenant-stamped transaction.
    await runInTenantScope(c.get('db'), context, async () => {
      // Route handlers that reach for the database directly read it from the
      // Hono context rather than from a service. Rebinding it here means those
      // handlers are scoped by the same act that scopes the services, instead
      // of each one having to remember to ask for the transaction — a rule that
      // would be enforced only by review, and only until someone forgot.
      // Legacy requests never reach this line, so `db` stays the ambient pool.
      c.set('db', scopedHandle(c.get('db')));
      await next();
    });
  } finally {
    // The authenticator refuses a second construction per request id; releasing
    // here keeps that guard from leaking memory across a long-lived process.
    authenticator.release(authRequestId);
  }
});
