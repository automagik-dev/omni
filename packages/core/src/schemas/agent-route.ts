/**
 * Agent route configuration schemas
 */

import { z } from 'zod';
import { UuidSchema } from './common';
import { AgentTypeSchema } from './instance';

/**
 * Route scope enum
 */
export const AgentRouteScopeSchema = z.enum(['chat', 'user']);
export type AgentRouteScope = z.infer<typeof AgentRouteScopeSchema>;

/**
 * Agent session strategy enum
 * Note: AgentSessionStrategy type is defined in automations/types.ts
 */
export const AgentSessionStrategySchema = z.enum(['per_user', 'per_chat', 'per_user_per_chat']);

/**
 * Reply filter mode
 */
export const ReplyFilterModeSchema = z.enum(['all', 'filtered']);
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
  chatId: UuidSchema.nullable(),
  personId: UuidSchema.nullable(),

  agentProviderId: UuidSchema,
  agentId: z.string().min(1).max(255),
  agentType: AgentTypeSchema,

  // Behavior overrides (null = inherit from instance)
  agentTimeout: z.number().int().positive().nullable(),
  agentStreamMode: z.boolean().nullable(),
  agentReplyFilter: AgentReplyFilterSchema.nullable(),
  agentSessionStrategy: AgentSessionStrategySchema.nullable(),
  agentPrefixSenderName: z.boolean().nullable(),
  agentWaitForMedia: z.boolean().nullable(),
  agentSendMediaPath: z.boolean().nullable(),
  agentGateEnabled: z.boolean().nullable(),
  agentGateModel: z.string().max(120).nullable(),
  agentGatePrompt: z.string().nullable(),

  // Metadata
  label: z.string().max(255).nullable(),
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
  // Custom transform to handle "false" string correctly (z.coerce.boolean would make "false" → true)
  isActive: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .transform((val) => {
      if (typeof val === 'boolean') return val;
      return val === 'true' || val === '1';
    })
    .optional(),
});
export type ListAgentRoutesQuery = z.infer<typeof ListAgentRoutesQuerySchema>;
