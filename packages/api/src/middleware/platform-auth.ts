/**
 * Platform-admin authentication guard (wish: omni-full-multitenancy, Group G1; ADR-0003/0005).
 *
 * Guards the control-plane lifecycle routes. It authenticates the caller through
 * the ISOLATED auth-bootstrap service (never the legacy `api_keys` path) and
 * requires a PLATFORM-class credential holding an explicit scope.
 *
 * Fail-closed properties:
 *   - Legacy `omni_sk_` keys are absent from `auth_credentials`, so they resolve
 *     to a uniform 401 — a legacy god key can never reach this surface.
 *   - Tenant-class credentials authenticate but are denied (403): tenant keys,
 *     legacy tenant-like headers/body/path claims, and normal data-plane keys
 *     can never acquire platform authority.
 *   - Every failure is uniform and non-enumerating; unknown IDs disclose nothing.
 */

import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { ApiKeyService } from '../services/api-keys';
import { bindPlatformOperation } from '../tenancy/auth-context';
import type { AppVariables } from '../types';

function extractSecret(c: Context<{ Variables: AppVariables }>): string | null {
  return c.req.header('x-api-key') ?? c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
}

const UNAUTHORIZED = { error: { code: 'UNAUTHORIZED', message: 'Platform credential required' } } as const;
const FORBIDDEN = {
  error: { code: 'FORBIDDEN', message: 'Platform credential with required scope required' },
} as const;

/**
 * Require a platform-class credential that covers `requiredScope`.
 */
export function platformAuthMiddleware(requiredScope: string, platformAction: string) {
  return createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
    const secret = extractSecret(c);
    if (!secret) return c.json(UNAUTHORIZED, 401);

    const services = c.get('services');
    if (!services?.authBootstrap) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Auth plane unavailable' } }, 500);
    }

    const requestId = c.get('requestId');
    const result = await services.authBootstrap.lookupBySecret(secret, requestId);

    // Uniform, non-enumerating denial for every auth failure.
    if (!result.ok) return c.json(UNAUTHORIZED, 401);

    // Tenant-class (and any non-platform) credentials cannot reach this surface.
    if (result.context.credentialClass !== 'platform') return c.json(FORBIDDEN, 403);

    if (!ApiKeyService.scopeAllows([...result.context.scopes], requiredScope)) {
      return c.json(FORBIDDEN, 403);
    }

    c.set('platformAuth', bindPlatformOperation(result.context, platformAction));
    return next();
  });
}
