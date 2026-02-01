/**
 * Authentication middleware - validates API keys against database
 */

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

  // Validate the API key against database
  const validatedKey = await services.apiKeys.validate(apiKey);

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
  return next();
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
 * Check if API key has access to a specific instance
 */
export function requireInstanceAccess(instanceIdGetter: (c: unknown) => string) {
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
