/**
 * Authentication middleware - validates API keys against database
 */

import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { ApiKeyService } from '../services/api-keys';
import type { ApiKeyData, AppVariables } from '../types';

/**
 * Authentication middleware
 *
 * Validates API key from x-api-key header or query parameter.
 * Looks up the key in the database and validates its status, expiration, and scopes.
 */
export const authMiddleware = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  // Get API key from header or query
  const apiKey = c.req.header('x-api-key') ?? c.req.query('api_key');

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
  };

  c.set('apiKey', keyData);
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

/**
 * Create a scope-checking middleware
 */
export function requireScope(scope: string) {
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

    if (!ApiKeyService.scopeAllows(apiKey.scopes, scope)) {
      return c.json(
        {
          error: {
            code: 'FORBIDDEN',
            message: `Insufficient permissions. Required scope: ${scope}`,
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
