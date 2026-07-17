/**
 * OpenAPI schemas for auth endpoints
 */

import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from '../../lib/zod-openapi';

/**
 * Auth validation response schema
 */
export const AuthValidateResponseSchema = z.object({
  data: z.object({
    valid: z.boolean().openapi({ description: 'Whether the API key is valid' }),
    keyPrefix: z
      .string()
      .openapi({ description: 'Truncated key prefix for identification', example: 'omni_sk_abc12345...' }),
    keyName: z.string().openapi({ description: 'Key name (primary or custom name)', example: 'primary' }),
    scopes: z.array(z.string()).openapi({ description: 'Scopes granted to this key', example: ['*'] }),
  }),
});

/**
 * Register auth schemas and paths with the given registry
 */
export function registerAuthSchemas(registry: OpenAPIRegistry): void {
  registry.register('AuthValidateResponse', AuthValidateResponseSchema);

  // Register paths
  registry.registerPath({
    method: 'post',
    // Register relative to the `/api/v2` server URL, consistent with every other
    // route. The prior absolute form baked in the prefix, which (a) produced a
    // double-prefixed documented path and (b) kept annotateScopes from matching the
    // SCOPE_MAP key `POST /auth/validate`, so x-omni-scope was never emitted here.
    path: '/auth/validate',
    operationId: 'validateApiKey',
    tags: ['Auth'],
    summary: 'Validate API key',
    description: 'Validate the provided API key and return key information. Used by CLI login flow.',
    security: [{ ApiKeyAuth: [] }],
    responses: {
      200: {
        description: 'API key is valid',
        content: {
          'application/json': { schema: AuthValidateResponseSchema },
        },
      },
      401: {
        description: 'Invalid API key',
        content: {
          'application/json': {
            schema: z.object({
              error: z.object({
                code: z.string(),
                message: z.string(),
              }),
            }),
          },
        },
      },
    },
  });
}
