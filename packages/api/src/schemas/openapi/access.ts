/**
 * OpenAPI schemas for access rule endpoints
 */

import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from '../../lib/zod-openapi';
import { ErrorSchema, SuccessSchema } from './common';

// Access rule schema
export const AccessRuleSchema = z.object({
  id: z.string().uuid().openapi({ description: 'Rule UUID' }),
  instanceId: z.string().uuid().nullable().openapi({ description: 'Instance UUID (null for global)' }),
  ruleType: z.enum(['allow', 'deny']).openapi({ description: 'Rule type' }),
  phonePattern: z.string().nullable().openapi({ description: 'Phone pattern' }),
  platformUserId: z.string().nullable().openapi({ description: 'Platform user ID' }),
  personId: z.string().uuid().nullable().openapi({ description: 'Person UUID' }),
  priority: z.number().int().openapi({ description: 'Priority (higher = checked first)' }),
  enabled: z.boolean().openapi({ description: 'Whether enabled' }),
  reason: z.string().nullable().openapi({ description: 'Reason' }),
  expiresAt: z.string().datetime().nullable().openapi({ description: 'Expiration' }),
  action: z.enum(['block', 'allow', 'silent_block']).openapi({ description: 'Action' }),
  blockMessage: z.string().nullable().openapi({ description: 'Custom block message' }),
  createdAt: z.string().datetime().openapi({ description: 'Creation timestamp' }),
  updatedAt: z.string().datetime().openapi({ description: 'Last update timestamp' }),
});

// Create rule request
export const CreateAccessRuleSchema = z.object({
  instanceId: z.string().uuid().optional().nullable().openapi({ description: 'Instance ID (null for global)' }),
  ruleType: z.enum(['allow', 'deny']).openapi({ description: 'Rule type' }),
  phonePattern: z.string().optional().openapi({ description: 'Phone pattern with wildcards' }),
  platformUserId: z.string().optional().openapi({ description: 'Exact platform user ID' }),
  personId: z.string().uuid().optional().openapi({ description: 'Person ID' }),
  priority: z.number().int().default(0).openapi({ description: 'Priority' }),
  enabled: z.boolean().default(true).openapi({ description: 'Whether enabled' }),
  reason: z.string().optional().openapi({ description: 'Reason' }),
  expiresAt: z.string().datetime().optional().openapi({ description: 'Expiration' }),
  action: z.enum(['block', 'allow', 'silent_block']).default('block').openapi({ description: 'Action' }),
  blockMessage: z.string().optional().openapi({ description: 'Custom block message' }),
});

// Check access request
export const CheckAccessSchema = z.object({
  instanceId: z.string().uuid().openapi({ description: 'Instance ID' }),
  platformUserId: z.string().openapi({ description: 'Platform user ID' }),
  channel: z.string().openapi({ description: 'Channel type' }),
});

// Check access response
export const CheckAccessResponseSchema = z.object({
  allowed: z.boolean().openapi({ description: 'Whether access is allowed' }),
  rule: AccessRuleSchema.nullable().openapi({ description: 'Matching rule if any' }),
  reason: z.string().nullable().openapi({ description: 'Reason for decision' }),
});

export function registerAccessSchemas(registry: OpenAPIRegistry): void {
  registry.register('AccessRule', AccessRuleSchema);
  registry.register('CreateAccessRuleRequest', CreateAccessRuleSchema);
  registry.register('CheckAccessRequest', CheckAccessSchema);
  registry.register('CheckAccessResponse', CheckAccessResponseSchema);

  registry.registerPath({
    method: 'get',
    path: '/access/rules',
    tags: ['Access'],
    summary: 'List access rules',
    description: 'Get all access rules with optional filtering.',
    request: {
      query: z.object({
        instanceId: z.string().uuid().optional().openapi({ description: 'Filter by instance' }),
        type: z.enum(['allow', 'deny']).optional().openapi({ description: 'Filter by type' }),
      }),
    },
    responses: {
      200: {
        description: 'List of rules',
        content: { 'application/json': { schema: z.object({ items: z.array(AccessRuleSchema) }) } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/access/rules/{id}',
    tags: ['Access'],
    summary: 'Get access rule',
    description: 'Get details of a specific access rule.',
    request: { params: z.object({ id: z.string().uuid().openapi({ description: 'Rule UUID' }) }) },
    responses: {
      200: {
        description: 'Rule details',
        content: { 'application/json': { schema: z.object({ data: AccessRuleSchema }) } },
      },
      404: { description: 'Rule not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/access/rules',
    tags: ['Access'],
    summary: 'Create access rule',
    description: 'Create a new access rule.',
    request: { body: { content: { 'application/json': { schema: CreateAccessRuleSchema } } } },
    responses: {
      201: {
        description: 'Rule created',
        content: { 'application/json': { schema: z.object({ data: AccessRuleSchema }) } },
      },
      400: { description: 'Validation error', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/access/rules/{id}',
    tags: ['Access'],
    summary: 'Update access rule',
    description: 'Update an existing access rule.',
    request: {
      params: z.object({ id: z.string().uuid().openapi({ description: 'Rule UUID' }) }),
      body: { content: { 'application/json': { schema: CreateAccessRuleSchema.partial() } } },
    },
    responses: {
      200: {
        description: 'Rule updated',
        content: { 'application/json': { schema: z.object({ data: AccessRuleSchema }) } },
      },
      404: { description: 'Rule not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/access/rules/{id}',
    tags: ['Access'],
    summary: 'Delete access rule',
    description: 'Delete an access rule.',
    request: { params: z.object({ id: z.string().uuid().openapi({ description: 'Rule UUID' }) }) },
    responses: {
      200: { description: 'Rule deleted', content: { 'application/json': { schema: SuccessSchema } } },
      404: { description: 'Rule not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/access/check',
    tags: ['Access'],
    summary: 'Check access',
    description: 'Check if access is allowed for a user.',
    request: { body: { content: { 'application/json': { schema: CheckAccessSchema } } } },
    responses: {
      200: {
        description: 'Access check result',
        content: { 'application/json': { schema: z.object({ data: CheckAccessResponseSchema }) } },
      },
    },
  });
}
