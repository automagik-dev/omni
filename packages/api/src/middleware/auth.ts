/**
 * Authentication middleware - validates API keys against database
 */

import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { ApiKeyService } from '../services/api-keys';
import { currentTenantScope, runDetachedFromTenantScope } from '../tenancy/tenant-scope';
import { runTenantWorkDb } from '../tenancy/worker-tenant-context';
import type { ApiKeyData, AppVariables } from '../types';

/**
 * Authentication middleware
 *
 * Validates API keys from x-api-key header, api_key query parameter, or
 * Authorization: Bearer <omni-api-key>.
 */
export const authMiddleware = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  // The tenancy edge (wish: omni-full-multitenancy, G4) already authenticated
  // this request against the auth plane and projected the tenant context into
  // `apiKey` for the authorization middlewares downstream. Re-validating the
  // secret here would look it up in `api_keys`, where a tenant credential does
  // not exist, and 401 a legitimately authenticated request.
  //
  // In the default (flag-off) world `authContext` is never set, so this branch
  // is unreachable and the legacy path below is entered on every request
  // exactly as it was before G4.
  if (c.get('authContext')) return next();

  const apiKey =
    c.req.header('x-api-key') ?? c.req.query('api_key') ?? c.req.header('authorization')?.replace(/^Bearer\s+/i, '');

  if (!apiKey) {
    return c.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'API key required. Provide via x-api-key header or api_key query parameter.',
        },
      },
      401,
    );
  }

  // Get the API key service from context
  const services = c.get('services');
  if (!services?.apiKeys) {
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'API key service not available',
        },
      },
      500,
    );
  }

  // Capture request metadata for audit
  const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
  const userAgent = c.req.header('user-agent');
  const startTime = Date.now();

  // Validate the API key against database
  const validatedKey = await services.apiKeys.validate(apiKey, ip);

  if (!validatedKey) {
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

  // Set validated key data in context
  const keyData: ApiKeyData = {
    id: validatedKey.id,
    name: validatedKey.name,
    scopes: validatedKey.scopes,
    instanceIds: validatedKey.instanceIds,
    expiresAt: null, // Already validated by service
    profile: (validatedKey.profile as ApiKeyData['profile']) ?? null,
    chatAllowlist: validatedKey.chatAllowlist ?? [],
    instanceAllowlist: validatedKey.instanceAllowlist ?? [],
    outboundRecipientAllowlist: validatedKey.outboundRecipientAllowlist ?? [],
    profileOverrides: validatedKey.profileOverrides ?? null,
  };

  c.set('apiKey', keyData);

  // Fire-and-forget: track turn activity if this key has an open turn.
  // Any API call from a scoped key automatically extends the turn's activity timer.
  //
  // G5 (ADR-0008) — the G4 leg-2 use-after-commit trap, closed. This is started
  // from a REQUEST and its continuations resolve on later microtasks, so they can
  // run after the request's tenant transaction has committed and its pooled
  // connection has been released. Left attached, `scopedHandle` would still hand
  // them that transaction through the ALS.
  //
  // The fix is the `batch-jobs.create` shape: CAPTURE the trusted tenant as a
  // VALUE first — the edge-derived `authContext`, or the active scope read for
  // its identity only — then run the whole thing DETACHED, opening its own short
  // worker transaction for the tenant it captured.
  //
  // Reachability, stated plainly: under flag-on this block is not reached at all
  // (the `authContext` early-return at the top of this middleware fires first),
  // and flag-off there is no transaction to outlive — `runTenantWorkDb(pool,
  // null, …)` runs `fn()` directly and `runDetachedFromTenantScope` is a no-op on
  // an empty ALS, so the two queries issued are byte-for-byte the pre-G5 ones.
  // The trap is latent, and this is what keeps it that way.
  if (services.turns) {
    const turnsService = services.turns;
    const activityTenantId = c.get('authContext')?.tenantId ?? currentTenantScope()?.tenantId ?? null;
    const pool = services.db;
    void runDetachedFromTenantScope(async () =>
      runTenantWorkDb(pool, activityTenantId, async () => {
        const turn = await turnsService.getOpenByApiKey(validatedKey.id);
        if (turn) await turnsService.recordActivity(turn.id);
      }),
    ).catch(() => {});
  }

  await next();

  // Fire-and-forget audit log after response
  if (services.audit) {
    services.audit.log({
      apiKeyId: validatedKey.id,
      method: c.req.method,
      path: c.req.path,
      statusCode: c.res.status,
      ipAddress: ip,
      userAgent,
      responseTimeMs: Date.now() - startTime,
    });
  }
});

export function requireAnyScope(requiredScopes: string[]) {
  return createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
    const apiKey = c.get('apiKey');
    if (!apiKey) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401);
    }

    const allowed = requiredScopes.some((scope) => ApiKeyService.scopeAllows(apiKey.scopes, scope));
    if (!allowed) {
      return c.json(
        {
          error: {
            code: 'FORBIDDEN',
            message: `Insufficient permissions. Required one of: ${requiredScopes.join(', ')}`,
          },
        },
        403,
      );
    }

    return next();
  });
}

/**
 * Check if API key has access to a specific instance.
 * Use on routes with :id param for instance-scoped access control.
 */
export function requireInstanceAccess(instanceIdGetter: (c: Context<{ Variables: AppVariables }>) => string) {
  return createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
    const apiKey = c.get('apiKey');

    if (!apiKey) {
      return c.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        },
        401,
      );
    }

    const instanceId = instanceIdGetter(c);
    if (!ApiKeyService.instanceAllowed(apiKey.instanceIds, instanceId)) {
      return c.json(
        {
          error: {
            code: 'FORBIDDEN',
            message: 'API key does not have access to this instance',
          },
        },
        403,
      );
    }

    return next();
  });
}

/**
 * Filter a list of items by instance access.
 * For list endpoints where we filter results rather than returning 403.
 */
export function filterByInstanceAccess<T>(items: T[], getInstanceId: (item: T) => string, apiKey: ApiKeyData): T[] {
  if (!apiKey.instanceIds) return items; // null = all instances
  return items.filter((item) => apiKey.instanceIds?.includes(getInstanceId(item)));
}
