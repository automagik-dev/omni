/**
 * OpenAPI schemas for auth endpoints
 */

import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from '../../lib/zod-openapi';

/**
 * The caller's own tenant credential context
 * (wish: omni-full-multitenancy, Group G4; WISH "Compatibility").
 *
 * Present ONLY for a tenant-class credential. A legacy credential has no tenant
 * context, so the field is absent from its response and the object is optional
 * — a generated client must treat the legacy world as valid, not as a contract
 * violation.
 *
 * Every field here is a fact about the caller's own authenticated context.
 * Secrets, digests, key material, and auth-plane primary keys are excluded by
 * construction in `routes/v2/auth.ts` and pinned by
 * `__tests__/openapi-credential-exposure.test.ts`.
 */
export const AuthCredentialContextSchema = z.object({
  class: z.literal('tenant').openapi({ description: 'Credential class of the caller' }),
  tenantId: z.string().uuid().openapi({ description: 'Tenant this credential is bound to' }),
  tenantSlug: z
    .string()
    .nullable()
    .openapi({ description: 'Stable tenant slug, or null when unresolved', example: 'acme' }),
  role: z.string().openapi({ description: 'Tenant role the credential acts under', example: 'tenant-operator' }),
  scopes: z.array(z.string()).openapi({ description: 'Scopes carried by the tenant credential' }),
  constraints: z
    .record(z.array(z.string()))
    .openapi({ description: 'Immutable resource ceilings inherited from the key lineage' }),
  expiresAt: z
    .string()
    .datetime()
    .nullable()
    .openapi({ description: 'Credential expiry (ISO 8601), or null when it does not expire' }),
  delegationDepth: z.number().int().openapi({ description: 'Delegation depth: 0 = root key, 1 = child key' }),
});

/**
 * The exact field names `POST /auth/validate` may publish about the caller.
 *
 * Emitted as the `x-omni-credential-exposure` vendor extension so the exposure
 * is machine-checkable rather than merely described: the test suite compares it
 * against the schema above and against a "never key material" predicate.
 */
export const CREDENTIAL_EXPOSURE_FIELDS: readonly string[] = Object.keys(AuthCredentialContextSchema.shape);

/**
 * Deployment-level tenancy posture (issue #982).
 *
 * Present for EVERY authenticated caller — legacy and tenant alike — because
 * the operator who needs to distinguish "multitenancy flag off" from "server
 * predates the control plane" from "wrong credential class" is usually holding
 * a legacy key. Three deployment flags, nothing tenant-enumerating; the same
 * facts appear nowhere unauthenticated (health-route privacy contract).
 */
export const ServerTenancyPostureSchema = z.object({
  multitenancyEnabled: z
    .boolean()
    .openapi({ description: 'OMNI_MULTITENANCY_ENABLED flag state (exact-string "true" semantics)' }),
  controlPlaneMounted: z
    .boolean()
    .openapi({ description: 'Whether the /api/v2/platform control plane is mounted on this server' }),
  dbEnforcement: z.enum(['legacy', 'enforced']).openapi({
    description:
      'Database enforcement posture. "enforced" means forced row-level security is installed; ' +
      '"legacy" with multitenancy enabled means the tenant boundary is advisory only (migration state).',
  }),
});

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
    credential: AuthCredentialContextSchema.optional().openapi({
      description: 'Tenant credential context; absent for a legacy credential',
    }),
    server: ServerTenancyPostureSchema.openapi({
      description: 'Deployment tenancy posture; absent only on servers that predate it',
    }),
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
