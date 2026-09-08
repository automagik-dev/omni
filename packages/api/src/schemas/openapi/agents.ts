/**
 * OpenAPI schemas for agent endpoints
 */

import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from '../../lib/zod-openapi';
import { ErrorSchema, SuccessSchema } from './common';

/**
 * Agent event manifest (RFC #925 G4a, #985) — OpenAPI mirror of
 * `AgentEventManifestSchema` in @omni/core (the boundary validator on the
 * route). `filter` uses the same payload-field matcher semantics as
 * automation conditions: dot-notation payload path → expected value.
 */
export const AgentEventManifestSchema = z.object({
  accepts: z
    .array(
      z.object({
        event: z.string().openapi({
          description: 'Event type consumed (core type, custom.*, or system.*)',
          example: 'custom.clickup.task.status_changed',
        }),
        filter: z
          .record(z.string(), z.unknown())
          .optional()
          .openapi({
            description:
              'Payload filter: dot-notation payload path → expected value (equals semantics, ' +
              'shared with automation conditions). All entries must match.',
          }),
      }),
    )
    .default([])
    .openapi({ description: 'Event types this agent consumes' }),
  publishes: z
    .array(
      z.object({
        event: z.string().openapi({
          description: 'Event type this agent may emit',
          example: 'custom.review.parecer.ready',
        }),
      }),
    )
    .default([])
    .openapi({ description: 'Event types this agent declares it may emit' }),
});

// Agent schema
export const AgentSchema = z.object({
  id: z.string().uuid().openapi({ description: 'Agent UUID' }),
  name: z.string().openapi({ description: 'Agent name' }),
  provider: z
    .enum(['claude', 'agno', 'openai', 'gemini', 'custom', 'omni-internal'])
    .openapi({ description: 'AI system powering the agent' }),
  model: z.string().nullable().openapi({ description: 'Model identifier (optional)' }),
  agentType: z.enum(['assistant', 'workflow', 'team', 'tool']).openapi({ description: 'Role of the agent entity' }),
  capabilities: z.array(z.string()).openapi({ description: 'Agent capabilities' }),
  ownerId: z.string().uuid().nullable().openapi({ description: 'Owner person UUID' }),
  agentProviderId: z.string().uuid().nullable().openapi({ description: 'Linked agent provider UUID' }),
  configPath: z.string().nullable().openapi({ description: 'Path to agent config file' }),
  isInternal: z.boolean().openapi({ description: 'Whether this is an internal system agent' }),
  isActive: z.boolean().openapi({ description: 'Whether agent is active' }),
  metadata: z.record(z.string(), z.unknown()).nullable().openapi({ description: 'Arbitrary metadata' }),
  agentCard: z.record(z.string(), z.unknown()).nullable().openapi({ description: 'A2A Agent Card overrides' }),
  eventManifest: AgentEventManifestSchema.nullable()
    .optional()
    .openapi({ description: 'Declarative accepts/publishes event manifest (RFC #925 G4a)' }),
  createdAt: z.string().datetime().openapi({ description: 'Creation timestamp' }),
  updatedAt: z.string().datetime().openapi({ description: 'Last update timestamp' }),
});

// Create agent request
export const CreateAgentSchema = z.object({
  name: z.string().min(1).max(255).openapi({ description: 'Agent name' }),
  provider: z
    .enum(['claude', 'agno', 'openai', 'gemini', 'custom', 'omni-internal'])
    .openapi({ description: 'AI system powering the agent' }),
  model: z.string().max(120).optional().openapi({ description: 'Model identifier' }),
  agentType: z
    .enum(['assistant', 'workflow', 'team', 'tool'])
    .default('assistant')
    .openapi({ description: 'Role of the agent entity' }),
  capabilities: z.array(z.string()).default([]).openapi({ description: 'Agent capabilities' }),
  ownerId: z.string().uuid().optional().openapi({ description: 'Owner person UUID' }),
  agentProviderId: z.string().uuid().optional().openapi({ description: 'Linked agent provider UUID' }),
  configPath: z.string().optional().openapi({ description: 'Path to agent config file' }),
  isInternal: z.boolean().default(false).openapi({ description: 'Whether this is an internal system agent' }),
  isActive: z.boolean().default(true).openapi({ description: 'Whether agent is active' }),
  metadata: z.record(z.string(), z.unknown()).optional().openapi({ description: 'Arbitrary metadata' }),
  agentCard: z.record(z.string(), z.unknown()).optional().openapi({ description: 'A2A Agent Card overrides' }),
});

export function registerAgentSchemas(registry: OpenAPIRegistry): void {
  registry.register('Agent', AgentSchema);
  registry.register('CreateAgentRequest', CreateAgentSchema);
  registry.register('AgentEventManifest', AgentEventManifestSchema);

  registry.registerPath({
    method: 'get',
    path: '/agents',
    operationId: 'listAgents',
    tags: ['Agents'],
    summary: 'List agents',
    description: 'Get all agent entities with optional filters.',
    request: {
      query: z.object({
        ownerId: z.string().uuid().optional().openapi({ description: 'Filter by owner person UUID' }),
        provider: z
          .enum(['claude', 'agno', 'openai', 'gemini', 'custom', 'omni-internal'])
          .optional()
          .openapi({ description: 'Filter by AI system' }),
        isActive: z.boolean().optional().openapi({ description: 'Filter by active status' }),
        limit: z.number().int().optional().openapi({ description: 'Max results (default 50)' }),
      }),
    },
    responses: {
      200: {
        description: 'List of agents',
        content: { 'application/json': { schema: z.object({ items: z.array(AgentSchema) }) } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/agents/{id}',
    operationId: 'getAgent',
    tags: ['Agents'],
    summary: 'Get agent',
    description: 'Get details of a specific agent.',
    request: { params: z.object({ id: z.string().uuid().openapi({ description: 'Agent UUID' }) }) },
    responses: {
      200: {
        description: 'Agent details',
        content: { 'application/json': { schema: z.object({ data: AgentSchema }) } },
      },
      404: { description: 'Agent not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/agents',
    operationId: 'createAgent',
    tags: ['Agents'],
    summary: 'Create agent',
    description: 'Register a new agent entity.',
    request: { body: { content: { 'application/json': { schema: CreateAgentSchema } } } },
    responses: {
      201: {
        description: 'Agent created',
        content: { 'application/json': { schema: z.object({ data: AgentSchema }) } },
      },
      400: { description: 'Validation error', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/agents/{id}',
    operationId: 'updateAgent',
    tags: ['Agents'],
    summary: 'Update agent',
    description: 'Update an existing agent.',
    request: {
      params: z.object({ id: z.string().uuid().openapi({ description: 'Agent UUID' }) }),
      body: { content: { 'application/json': { schema: CreateAgentSchema.partial() } } },
    },
    responses: {
      200: {
        description: 'Agent updated',
        content: { 'application/json': { schema: z.object({ data: AgentSchema }) } },
      },
      404: { description: 'Agent not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/agents/{id}/manifest',
    operationId: 'getAgentManifest',
    tags: ['Agents'],
    summary: 'Get agent event manifest',
    description:
      "Read the agent's declarative accepts/publishes event manifest (RFC #925 G4a). " +
      'Returns null when the agent has never declared one.',
    request: { params: z.object({ id: z.string().uuid().openapi({ description: 'Agent UUID' }) }) },
    responses: {
      200: {
        description: 'Agent event manifest (null when undeclared)',
        content: { 'application/json': { schema: z.object({ data: AgentEventManifestSchema.nullable() }) } },
      },
      404: { description: 'Agent not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'put',
    path: '/agents/{id}/manifest',
    operationId: 'updateAgentManifest',
    tags: ['Agents'],
    summary: 'Replace agent event manifest',
    description:
      "Replace the agent's declarative accepts/publishes event manifest (full replacement, apply semantics). " +
      'Event types must be core types or namespaced custom.*/system.* tokens. ' +
      'Storage only in this slice: accepts is compiled into automations by G4b, publishes enforced by G4c.',
    request: {
      params: z.object({ id: z.string().uuid().openapi({ description: 'Agent UUID' }) }),
      body: { content: { 'application/json': { schema: AgentEventManifestSchema } } },
    },
    responses: {
      200: {
        description: 'Stored manifest after replacement',
        content: { 'application/json': { schema: z.object({ data: AgentEventManifestSchema.nullable() }) } },
      },
      400: { description: 'Validation error', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'Agent not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/agents/{id}',
    operationId: 'deleteAgent',
    tags: ['Agents'],
    summary: 'Delete agent',
    description: 'Soft-delete an agent (sets isActive = false).',
    request: { params: z.object({ id: z.string().uuid().openapi({ description: 'Agent UUID' }) }) },
    responses: {
      200: { description: 'Agent deleted', content: { 'application/json': { schema: SuccessSchema } } },
      404: { description: 'Agent not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });
}
