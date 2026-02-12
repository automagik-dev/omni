/**
 * Agent route configuration schemas
 */

import { z } from 'zod';
import { UuidSchema } from './common';

/**
 * Route scope enum
 */
export const AgentRouteScopeSchema = z.enum(['chat', 'user']);
export type AgentRouteScope = z.infer<typeof AgentRouteScopeSchema>;

/**
 * Agent type enum
 */
export const AgentTypeSchema = z.enum(['agent', 'team', 'workflow']);
export type AgentType = z.infer<typeof AgentTypeSchema>;

/**
 * Agent session strategy enum
 */
export const AgentSessionStrategySchema = z.enum(['per_user', 'per_chat', 'per_user_per_chat']);
export type AgentSessionStrategy = z.infer<typeof AgentSessionStrategySchema>;

/**
 * Reply filter mode
 */
export const ReplyFilterModeSchema = z.enum(['always', 'conditional', 'never']);
export type ReplyFilterMode = z.infer<typeof ReplyFilterModeSchema>;

/**
 * Agent reply filter schema
 */
export const AgentReplyFilterSchema = z.object({
  mode: ReplyFilterModeSchema,
  conditions: z.object({
    onDm: z.boolean(),
    onMention: z.boolean(),
    onReply: z.boolean(),
    onNameMatch: z.boolean(),
    namePatterns: z.array(z.string()).optional(),
  }),
});
export type AgentReplyFilter = z.infer<typeof AgentReplyFilterSchema>;

/**
 * Agent route schema (full object)
 */
export const AgentRouteSchema = z.object({
  id: UuidSchema,
  instanceId: UuidSchema,
  scope: AgentRouteScopeSchema,
  chatId: UuidSchema.optional().nullable(),
  personId: UuidSchema.optional().nullable(),

  agentProviderId: UuidSchema,
  agentId: z.string().min(1).max(255),
  agentType: AgentTypeSchema,

  // Behavior overrides (null = inherit from instance)
  agentTimeout: z.number().int().positive().optional().nullable(),
  agentStreamMode: z.boolean().optional().nullable(),
  agentReplyFilter: AgentReplyFilterSchema.optional().nullable(),
  agentSessionStrategy: AgentSessionStrategySchema.optional().nullable(),
  agentPrefixSenderName: z.boolean().optional().nullable(),
  agentWaitForMedia: z.boolean().optional().nullable(),
  agentSendMediaPath: z.boolean().optional().nullable(),
  agentGateEnabled: z.boolean().optional().nullable(),
  agentGateModel: z.string().max(120).optional().nullable(),
  agentGatePrompt: z.string().optional().nullable(),

  // Metadata
  label: z.string().max(255).optional().nullable(),
  priority: z.number().int(),
  isActive: z.boolean(),

  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type AgentRoute = z.infer<typeof AgentRouteSchema>;

/**
 * Create agent route schema (for POST)
 */
export const CreateAgentRouteSchema = z
  .object({
    scope: AgentRouteScopeSchema,
    chatId: UuidSchema.optional(),
    personId: UuidSchema.optional(),

    agentProviderId: UuidSchema,
    agentId: z.string().min(1).max(255),
    agentType: AgentTypeSchema.default('agent'),

    // Optional overrides
    agentTimeout: z.number().int().positive().optional(),
    agentStreamMode: z.boolean().optional(),
    agentReplyFilter: AgentReplyFilterSchema.optional(),
    agentSessionStrategy: AgentSessionStrategySchema.optional(),
    agentPrefixSenderName: z.boolean().optional(),
    agentWaitForMedia: z.boolean().optional(),
    agentSendMediaPath: z.boolean().optional(),
    agentGateEnabled: z.boolean().optional(),
    agentGateModel: z.string().max(120).optional(),
    agentGatePrompt: z.string().optional(),

    label: z.string().max(255).optional(),
    priority: z.number().int().default(0),
    isActive: z.boolean().default(true),
  })
  .refine((data) => (data.scope === 'chat') === !!data.chatId, {
    message: 'chatId required (and only allowed) when scope is "chat"',
  })
  .refine((data) => (data.scope === 'user') === !!data.personId, {
    message: 'personId required (and only allowed) when scope is "user"',
  });
export type CreateAgentRoute = z.infer<typeof CreateAgentRouteSchema>;

/**
 * Update agent route schema (for PATCH)
 */
export const UpdateAgentRouteSchema = z.object({
  agentId: z.string().min(1).max(255).optional(),
  agentType: AgentTypeSchema.optional(),

  // Optional overrides
  agentTimeout: z.number().int().positive().optional().nullable(),
  agentStreamMode: z.boolean().optional().nullable(),
  agentReplyFilter: AgentReplyFilterSchema.optional().nullable(),
  agentSessionStrategy: AgentSessionStrategySchema.optional().nullable(),
  agentPrefixSenderName: z.boolean().optional().nullable(),
  agentWaitForMedia: z.boolean().optional().nullable(),
  agentSendMediaPath: z.boolean().optional().nullable(),
  agentGateEnabled: z.boolean().optional().nullable(),
  agentGateModel: z.string().max(120).optional().nullable(),
  agentGatePrompt: z.string().optional().nullable(),

  label: z.string().max(255).optional().nullable(),
  priority: z.number().int().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateAgentRoute = z.infer<typeof UpdateAgentRouteSchema>;

/**
 * List agent routes query schema
 */
export const ListAgentRoutesQuerySchema = z.object({
  scope: AgentRouteScopeSchema.optional(),
  isActive: z.coerce.boolean().optional(),
});
export type ListAgentRoutesQuery = z.infer<typeof ListAgentRoutesQuerySchema>;
