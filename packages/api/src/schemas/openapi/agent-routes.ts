/**
 * OpenAPI schemas for agent routing endpoints
 */

import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from '../../lib/zod-openapi';
import { ErrorSchema } from './common';

// Agent route scope enum
export const AgentRouteScopeOpenAPISchema = z.enum(['chat', 'user']).openapi({
  description: 'Route scope: chat (specific chat) or user (specific person)',
});

// Agent type enum
export const AgentTypeOpenAPISchema = z.enum(['agent', 'team', 'workflow']).openapi({
  description: 'Agent type: agent (single agent), team (multi-agent), or workflow (agentic workflow)',
});

// Agent session strategy enum
export const AgentSessionStrategyOpenAPISchema = z.enum(['per_user', 'per_chat', 'per_user_per_chat']).openapi({
  description:
    'Session strategy for agent memory:\n' +
    '- **per_user**: Same session across all chats for this user\n' +
    '- **per_chat**: All users in a chat share the session (group memory)\n' +
    '- **per_user_per_chat**: Each user has own session per chat (most isolated)',
});

// Reply filter schema
export const AgentReplyFilterOpenAPISchema = z
  .object({
    mode: z
      .enum(['all', 'filtered'])
      .openapi({ description: 'Reply mode: all = reply to everything, filtered = check conditions' }),
    conditions: z.object({
      onDm: z.boolean().openapi({ description: 'Reply if message is a DM' }),
      onMention: z.boolean().openapi({ description: 'Reply if bot is @mentioned' }),
      onReply: z.boolean().openapi({ description: 'Reply if message is a reply to bot' }),
      onNameMatch: z.boolean().openapi({ description: 'Reply if bot name appears in text' }),
      namePatterns: z.array(z.string()).optional().openapi({ description: 'Custom patterns for name matching' }),
    }),
  })
  .openapi({ description: 'Agent reply filter configuration' });

// Full agent route schema
export const AgentRouteSchema = z.object({
  id: z.string().uuid().openapi({ description: 'Route UUID' }),
  instanceId: z.string().uuid().openapi({ description: 'Instance UUID' }),
  scope: AgentRouteScopeOpenAPISchema,
  chatId: z.string().uuid().nullable().openapi({ description: 'Chat UUID (required when scope=chat)' }),
  personId: z.string().uuid().nullable().openapi({ description: 'Person UUID (required when scope=user)' }),

  agentProviderId: z.string().uuid().openapi({ description: 'Agent provider UUID' }),
  agentId: z.string().min(1).max(255).openapi({ description: 'Agent ID within the provider' }),
  agentType: AgentTypeOpenAPISchema,

  // Behavior overrides (null = inherit from instance)
  agentTimeout: z.number().int().positive().nullable().openapi({ description: 'Agent timeout override (seconds)' }),
  agentStreamMode: z.boolean().nullable().openapi({ description: 'Stream mode override' }),
  agentReplyFilter: AgentReplyFilterOpenAPISchema.nullable().openapi({ description: 'Reply filter override' }),
  agentSessionStrategy: AgentSessionStrategyOpenAPISchema.nullable().openapi({
    description: 'Session strategy override',
  }),
  agentPrefixSenderName: z.boolean().nullable().openapi({ description: 'Prefix sender name override' }),
  agentWaitForMedia: z.boolean().nullable().openapi({ description: 'Wait for media override' }),
  agentSendMediaPath: z.boolean().nullable().openapi({ description: 'Send media path override' }),
  agentGateEnabled: z.boolean().nullable().openapi({ description: 'Response gate enabled override' }),
  agentGateModel: z.string().nullable().openapi({ description: 'Response gate model override' }),
  agentGatePrompt: z.string().nullable().openapi({ description: 'Response gate prompt override' }),

  // Metadata
  label: z.string().nullable().openapi({ description: 'Human-readable label for this route (e.g., "VIP Support")' }),
  priority: z.number().int().openapi({ description: 'Priority (higher = higher priority, default: 0)' }),
  isActive: z.boolean().openapi({ description: 'Whether this route is active' }),

  createdAt: z.string().datetime().openapi({ description: 'Creation timestamp' }),
  updatedAt: z.string().datetime().openapi({ description: 'Last update timestamp' }),
});

// Create agent route request
export const CreateAgentRouteRequestSchema = z.object({
  scope: AgentRouteScopeOpenAPISchema,
  chatId: z.string().uuid().optional().openapi({ description: 'Chat UUID (required when scope=chat)' }),
  personId: z.string().uuid().optional().openapi({ description: 'Person UUID (required when scope=user)' }),

  agentProviderId: z.string().uuid().openapi({ description: 'Agent provider UUID' }),
  agentId: z.string().min(1).max(255).openapi({ description: 'Agent ID within the provider' }),
  agentType: AgentTypeOpenAPISchema.default('agent'),

  // Optional overrides
  agentTimeout: z.number().int().positive().optional().openapi({ description: 'Agent timeout (seconds)' }),
  agentStreamMode: z.boolean().optional().openapi({ description: 'Enable streaming responses' }),
  agentReplyFilter: AgentReplyFilterOpenAPISchema.optional().openapi({ description: 'Reply filter configuration' }),
  agentSessionStrategy: AgentSessionStrategyOpenAPISchema.optional().openapi({ description: 'Session strategy' }),
  agentPrefixSenderName: z.boolean().optional().openapi({ description: 'Prefix sender name' }),
  agentWaitForMedia: z.boolean().optional().openapi({ description: 'Wait for media processing' }),
  agentSendMediaPath: z.boolean().optional().openapi({ description: 'Include file path in media text' }),
  agentGateEnabled: z.boolean().optional().openapi({ description: 'Enable LLM response gate' }),
  agentGateModel: z.string().max(120).optional().openapi({ description: 'Response gate model' }),
  agentGatePrompt: z.string().optional().openapi({ description: 'Response gate prompt' }),

  label: z.string().max(255).optional().openapi({ description: 'Human-readable label' }),
  priority: z.number().int().default(0).openapi({ description: 'Priority (higher = higher priority)' }),
  isActive: z.boolean().default(true).openapi({ description: 'Whether active' }),
});

// Update agent route request
export const UpdateAgentRouteRequestSchema = z.object({
  agentId: z.string().min(1).max(255).optional().openapi({ description: 'Agent ID within the provider' }),
  agentType: AgentTypeOpenAPISchema.optional(),

  // Optional overrides (nullable to clear)
  agentTimeout: z.number().int().positive().nullable().optional().openapi({ description: 'Agent timeout (seconds)' }),
  agentStreamMode: z.boolean().nullable().optional().openapi({ description: 'Enable streaming responses' }),
  agentReplyFilter: AgentReplyFilterOpenAPISchema.nullable()
    .optional()
    .openapi({ description: 'Reply filter configuration' }),
  agentSessionStrategy: AgentSessionStrategyOpenAPISchema.nullable()
    .optional()
    .openapi({ description: 'Session strategy' }),
  agentPrefixSenderName: z.boolean().nullable().optional().openapi({ description: 'Prefix sender name' }),
  agentWaitForMedia: z.boolean().nullable().optional().openapi({ description: 'Wait for media processing' }),
  agentSendMediaPath: z.boolean().nullable().optional().openapi({ description: 'Include file path in media text' }),
  agentGateEnabled: z.boolean().nullable().optional().openapi({ description: 'Enable LLM response gate' }),
  agentGateModel: z.string().max(120).nullable().optional().openapi({ description: 'Response gate model' }),
  agentGatePrompt: z.string().nullable().optional().openapi({ description: 'Response gate prompt' }),

  label: z.string().max(255).nullable().optional().openapi({ description: 'Human-readable label' }),
  priority: z.number().int().optional().openapi({ description: 'Priority (higher = higher priority)' }),
  isActive: z.boolean().optional().openapi({ description: 'Whether active' }),
});

// Cache metrics response
export const CacheMetricsSchema = z.object({
  cache: z.object({
    hits: z.number().int().openapi({ description: 'Cache hits count' }),
    misses: z.number().int().openapi({ description: 'Cache misses count' }),
    sets: z.number().int().openapi({ description: 'Cache sets count' }),
    invalidations: z.number().int().openapi({ description: 'Cache invalidation count' }),
    lastQueryMs: z.number().openapi({ description: 'Last query time in milliseconds' }),
    cacheSize: z.number().int().openapi({ description: 'Current cache size (entries)' }),
    hitRate: z.number().openapi({ description: 'Cache hit rate percentage' }),
  }),
  timestamp: z.string().datetime().openapi({ description: 'Metrics timestamp' }),
});

export function registerRouteSchemas(registry: OpenAPIRegistry): void {
  registry.register('AgentRoute', AgentRouteSchema);
  registry.register('CreateAgentRouteRequest', CreateAgentRouteRequestSchema);
  registry.register('UpdateAgentRouteRequest', UpdateAgentRouteRequestSchema);
  registry.register('CacheMetrics', CacheMetricsSchema);

  // List routes
  registry.registerPath({
    method: 'get',
    path: '/instances/{instanceId}/routes',
    operationId: 'listAgentRoutes',
    tags: ['Agent Routing'],
    summary: 'List agent routes',
    description: 'List all agent routes for an instance, optionally filtered by scope and active status.',
    request: {
      params: z.object({ instanceId: z.string().uuid().openapi({ description: 'Instance UUID' }) }),
      query: z.object({
        scope: AgentRouteScopeOpenAPISchema.optional().openapi({ description: 'Filter by scope' }),
        isActive: z.coerce.boolean().optional().openapi({ description: 'Filter by active status' }),
      }),
    },
    responses: {
      200: {
        description: 'List of agent routes',
        content: { 'application/json': { schema: z.object({ items: z.array(AgentRouteSchema) }) } },
      },
      403: { description: 'Access denied', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  // Get route
  registry.registerPath({
    method: 'get',
    path: '/instances/{instanceId}/routes/{id}',
    operationId: 'getAgentRoute',
    tags: ['Agent Routing'],
    summary: 'Get agent route',
    description: 'Get details of a specific agent route.',
    request: {
      params: z.object({
        instanceId: z.string().uuid().openapi({ description: 'Instance UUID' }),
        id: z.string().uuid().openapi({ description: 'Route UUID' }),
      }),
    },
    responses: {
      200: {
        description: 'Route details',
        content: { 'application/json': { schema: z.object({ data: AgentRouteSchema }) } },
      },
      403: { description: 'Access denied', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'Route not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  // Create route
  registry.registerPath({
    method: 'post',
    path: '/instances/{instanceId}/routes',
    operationId: 'createAgentRoute',
    tags: ['Agent Routing'],
    summary: 'Create agent route',
    description:
      'Create a new agent route for an instance. Routes allow per-chat or per-user agent customization.\n\n' +
      '**Resolution priority:** chat routes > user routes > instance default\n\n' +
      '**Note:** Only one route per chat/person allowed per instance.',
    request: {
      params: z.object({ instanceId: z.string().uuid().openapi({ description: 'Instance UUID' }) }),
      body: { content: { 'application/json': { schema: CreateAgentRouteRequestSchema } } },
    },
    responses: {
      201: {
        description: 'Route created',
        content: { 'application/json': { schema: z.object({ data: AgentRouteSchema }) } },
      },
      400: { description: 'Validation error', content: { 'application/json': { schema: ErrorSchema } } },
      403: { description: 'Access denied', content: { 'application/json': { schema: ErrorSchema } } },
      409: { description: 'Route already exists', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  // Update route
  registry.registerPath({
    method: 'patch',
    path: '/instances/{instanceId}/routes/{id}',
    operationId: 'updateAgentRoute',
    tags: ['Agent Routing'],
    summary: 'Update agent route',
    description: 'Update an existing agent route. Set nullable fields to null to inherit from instance.',
    request: {
      params: z.object({
        instanceId: z.string().uuid().openapi({ description: 'Instance UUID' }),
        id: z.string().uuid().openapi({ description: 'Route UUID' }),
      }),
      body: { content: { 'application/json': { schema: UpdateAgentRouteRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Route updated',
        content: { 'application/json': { schema: z.object({ data: AgentRouteSchema }) } },
      },
      400: { description: 'Validation error', content: { 'application/json': { schema: ErrorSchema } } },
      403: { description: 'Access denied', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'Route not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  // Delete route
  registry.registerPath({
    method: 'delete',
    path: '/instances/{instanceId}/routes/{id}',
    operationId: 'deleteAgentRoute',
    tags: ['Agent Routing'],
    summary: 'Delete agent route',
    description: 'Delete an agent route. The instance will fallback to its default agent configuration.',
    request: {
      params: z.object({
        instanceId: z.string().uuid().openapi({ description: 'Instance UUID' }),
        id: z.string().uuid().openapi({ description: 'Route UUID' }),
      }),
    },
    responses: {
      200: {
        description: 'Route deleted',
        content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
      },
      403: { description: 'Access denied', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'Route not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  // Cache metrics
  registry.registerPath({
    method: 'get',
    path: '/routes/metrics',
    operationId: 'getRouteCacheMetrics',
    tags: ['Agent Routing'],
    summary: 'Get route cache metrics',
    description: 'Get performance metrics for the route resolution cache.',
    responses: {
      200: {
        description: 'Cache metrics',
        content: { 'application/json': { schema: z.object({ data: CacheMetricsSchema }) } },
      },
      403: { description: 'Access denied', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });
}
