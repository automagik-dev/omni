/**
 * OpenAPI schemas for the config-mutation audit log (issue #1152)
 */

import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from '../../lib/zod-openapi';
import { ErrorSchema } from './common';

export const ConfigAuditLogSchema = z.object({
  id: z.string().uuid(),
  apiKeyId: z.string().nullable().openapi({ description: 'Acting API key id' }),
  apiKeyName: z.string().nullable().openapi({ description: 'Acting API key name' }),
  actor: z.string().nullable().openapi({ description: 'X-Omni-Actor header, e.g. cli:alice or claude-session:<id>' }),
  requestId: z.string().nullable(),
  ipAddress: z.string().nullable().openapi({ description: 'Client IP (X-Forwarded-For / X-Real-IP / socket)' }),
  userAgent: z.string().nullable(),
  method: z.string(),
  path: z.string(),
  statusCode: z.number().int(),
  action: z.string().openapi({ description: 'e.g. instance.create, instance.update, instance.connect' }),
  targetType: z
    .string()
    .openapi({ description: 'instance | agent | provider | route | automation | api_key | setting' }),
  targetId: z.string().nullable(),
  changedFields: z.array(z.string()),
  changes: z.record(z.string(), z.object({ before: z.unknown(), after: z.unknown() })).openapi({
    description: 'Before/after per changed field. Secret-bearing values appear only as sha256:<prefix> fingerprints.',
  }),
  createdAt: z.string().datetime(),
});

export function registerAuditSchemas(registry: OpenAPIRegistry): void {
  registry.register('ConfigAuditLog', ConfigAuditLogSchema);

  registry.registerPath({
    method: 'get',
    path: '/audit',
    operationId: 'listConfigAudit',
    tags: ['Audit'],
    summary: 'List config-mutation audit entries',
    description:
      'One entry per POST/PATCH/PUT/DELETE on instances, agents, providers, routes, automations, API keys and settings. ' +
      'Reads are never recorded. Scope: `audit:read`.',
    request: {
      query: z.object({
        targetType: z.string().optional().openapi({ description: 'Resource type' }),
        target: z.string().optional().openapi({ description: 'Target id' }),
        actor: z.string().optional().openapi({ description: 'X-Omni-Actor or API key name' }),
        since: z.string().datetime().optional().openapi({ description: 'Only entries at or after this time' }),
        limit: z.number().int().min(1).max(200).default(50),
        cursor: z.string().optional().openapi({ description: 'meta.cursor from the previous page' }),
      }),
    },
    responses: {
      200: {
        description: 'Audit entries, newest first',
        content: {
          'application/json': {
            schema: z.object({
              items: z.array(ConfigAuditLogSchema),
              meta: z.object({ hasMore: z.boolean(), cursor: z.string().nullable() }),
            }),
          },
        },
      },
      400: { description: 'Invalid query', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/audit/{id}',
    operationId: 'getConfigAudit',
    tags: ['Audit'],
    summary: 'Get one config-mutation audit entry',
    description: 'Scope: `audit:read`.',
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: {
      200: {
        description: 'Audit entry',
        content: { 'application/json': { schema: z.object({ data: ConfigAuditLogSchema }) } },
      },
      404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });
}
