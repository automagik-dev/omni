/**
 * Auth routes - API key validation
 *
 * Provides endpoint for validating API keys (used by CLI login flow).
 *
 * This is also the ONE authenticated surface that tells a caller which world it
 * is in (wish: omni-full-multitenancy, Group G4; WISH "Compatibility"). A
 * tenant-class credential gets a `credential` block naming its class, tenant id
 * and slug, role, scopes, resource constraints, and expiry — the facts an SDK
 * or CLI needs to render "you are acting as tenant X in role Y" without any
 * other request. `route-ownership.ts` declares this route `control-plane` on
 * exactly that basis.
 *
 * TWO RULES GOVERN THE BLOCK
 * --------------------------
 *   1. It appears only when a tenant auth context exists. A legacy credential
 *      never has one, so a legacy caller's body is byte-for-byte its pre-G4
 *      body — the dual-world invariant, asserted by exact equality in
 *      `__tests__/auth-credential-exposure.test.ts`.
 *   2. It carries only facts about the CALLER'S OWN context, and never a
 *      secret, a hash, key material, the full credential id, or anything about
 *      another principal or tenant. It reads no tenant business data, so it
 *      cannot become an inventory oracle.
 */

import { Hono } from 'hono';
import type { TenantAuthContext } from '../../tenancy/auth-context';
import type { AppVariables } from '../../types';

const authRoutes = new Hono<{ Variables: AppVariables }>();

/**
 * Project the frozen context down to the publishable facts.
 *
 * An explicit field list rather than a spread-and-redact: a spread would
 * publish every field a future context gains, and the failure mode of that
 * mistake is disclosing auth-plane internals. Everything omitted is omitted on
 * purpose — `credentialId`, `principalId`, `membershipId`, `rootKeyId`,
 * `tenantKeyLineageId` are auth-plane primary keys, and `policyVersion` /
 * `revocationEpoch` are freshness internals with no caller meaning.
 */
function publishableCredential(context: TenantAuthContext) {
  return {
    class: context.credentialClass,
    tenantId: context.tenantId,
    // Null rather than a fallback: the slug is either resolved from the auth
    // plane or unknown, and a guessed one would be worse than none.
    tenantSlug: context.tenantSlug ?? null,
    role: context.actorRole,
    scopes: [...context.scopes],
    constraints: context.resourceConstraints,
    expiresAt: context.expiresAt ? context.expiresAt.toISOString() : null,
    delegationDepth: context.delegationDepth,
  };
}

/**
 * POST /auth/validate - Validate API key
 *
 * Returns key info if valid, 401 if invalid.
 * The x-api-key header is validated by the auth middleware.
 */
authRoutes.post('/validate', async (c) => {
  // If we reach here, auth middleware already validated the key
  const apiKey = c.get('apiKey');

  if (!apiKey) {
    // Should not happen - auth middleware would have rejected
    return c.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid API key',
        },
      },
      401,
    );
  }

  const context = c.get('authContext');

  return c.json({
    data: {
      valid: true,
      keyPrefix: `omni_sk_${apiKey.id.substring(0, 8)}...`,
      keyName: apiKey.name === '__primary__' ? 'primary' : apiKey.name,
      scopes: apiKey.scopes,
      ...(context ? { credential: publishableCredential(context) } : {}),
    },
  });
});

export { authRoutes };
