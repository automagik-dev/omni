/**
 * Auth routes - API key validation
 *
 * Provides endpoint for validating API keys (used by CLI login flow).
 */

import { Hono } from 'hono';
import type { AppVariables } from '../../types';

const authRoutes = new Hono<{ Variables: AppVariables }>();

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

  return c.json({
    data: {
      valid: true,
      keyPrefix: `omni_sk_${apiKey.id.substring(0, 8)}...`,
      keyName: apiKey.name === '__primary__' ? 'primary' : apiKey.name,
      scopes: apiKey.scopes,
    },
  });
});

export { authRoutes };
