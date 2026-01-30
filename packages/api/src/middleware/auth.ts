/**
 * Authentication middleware - validates API keys
 */

import { createMiddleware } from 'hono/factory';
import type { ApiKeyData, AppVariables } from '../types';

/**
 * API key patterns for validation
 */
const API_KEY_PREFIX = 'omni_sk_';

/**
 * Check if a scope allows the requested action
 */
function scopeAllows(scopes: string[], requiredScope: string): boolean {
  // Wildcard access
  if (scopes.includes('*')) return true;

  // Exact match
  if (scopes.includes(requiredScope)) return true;

  // Namespace wildcard (e.g., "instances:*" allows "instances:read")
  const [namespace] = requiredScope.split(':');
  if (scopes.includes(`${namespace}:*`)) return true;

  return false;
}

/**
 * Authentication middleware
 *
 * Validates API key from x-api-key header or query parameter.
 * For now uses a test key; will be replaced with database lookup.
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

  // For development: accept test key
  // TODO: Replace with database lookup for production
  if (apiKey === 'test-key' || apiKey.startsWith(API_KEY_PREFIX)) {
    const keyData: ApiKeyData = {
      id: 'test-key-id',
      name: 'Test Key',
      scopes: ['*'], // Full access for test key
      instanceIds: null, // All instances
      expiresAt: null,
    };

    c.set('apiKey', keyData);
    return next();
  }

  return c.json(
    {
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid API key',
      },
    },
    401,
  );
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

    if (!scopeAllows(apiKey.scopes, scope)) {
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

    // Null instanceIds means access to all instances
    if (apiKey.instanceIds === null) {
      return next();
    }

    const instanceId = instanceIdGetter(c);
    if (!apiKey.instanceIds.includes(instanceId)) {
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
