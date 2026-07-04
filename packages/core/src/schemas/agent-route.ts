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
 * Agent session strategy enum
 * Note: AgentSessionStrategy type is defined in automations/types.ts
 */
export const AgentSessionStrategySchema = z.enum(['per_user', 'per_chat']);

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

  /** FK to agents table. Null if no agent is explicitly assigned. */
  agentId: UuidSchema.nullable(),

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

  // Debounce overrides (null = inherit from instance)
  messageDebounceMode: z.enum(['disabled', 'fixed', 'randomized', 'presence']).nullable(),
  messageDebounceMinMs: z.number().int().nonnegative().nullable(),
  messageDebounceMaxMs: z.number().int().nonnegative().nullable(),
  messageDebounceGroupMs: z.number().int().nonnegative().nullable(),
  messageDebounceRestartOnTyping: z.boolean().nullable(),
  messageDebounceMaxWaitMs: z.number().int().nonnegative().nullable(),

  // Split delay overrides (null = inherit from instance)
  messageSplitDelayMode: z.enum(['disabled', 'fixed', 'randomized']).nullable(),
  messageSplitDelayFixedMs: z.number().int().nonnegative().nullable(),
  messageSplitDelayMinMs: z.number().int().nonnegative().nullable(),
  messageSplitDelayMaxMs: z.number().int().nonnegative().nullable(),
  enableAutoSplit: z.boolean().nullable(),

  // Ack overrides (null = inherit from instance)
  reactionAck: z.enum(['off', 'on']).nullable(),
  reactionAckEmoji: z.record(z.string()).nullable(),
  ackTimeoutMs: z.number().int().positive().nullable(),
  agentAckMessage: z.string().nullable(),

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

    /** FK to agents table. Required to assign an agent to this route. */
    agentId: UuidSchema,

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

    // Debounce overrides
    messageDebounceMode: z.enum(['disabled', 'fixed', 'randomized', 'presence']).optional(),
    messageDebounceMinMs: z.number().int().nonnegative().optional(),
    messageDebounceMaxMs: z.number().int().nonnegative().optional(),
    messageDebounceGroupMs: z.number().int().nonnegative().optional(),
    messageDebounceRestartOnTyping: z.boolean().optional(),
    messageDebounceMaxWaitMs: z.number().int().nonnegative().optional(),

    // Split delay overrides
    messageSplitDelayMode: z.enum(['disabled', 'fixed', 'randomized']).optional(),
    messageSplitDelayFixedMs: z.number().int().nonnegative().optional(),
    messageSplitDelayMinMs: z.number().int().nonnegative().optional(),
    messageSplitDelayMaxMs: z.number().int().nonnegative().optional(),
    enableAutoSplit: z.boolean().optional(),

    // Ack overrides
    reactionAck: z.enum(['off', 'on']).optional(),
    reactionAckEmoji: z.record(z.string()).optional(),
    ackTimeoutMs: z.number().int().positive().optional(),
    agentAckMessage: z.string().optional(),

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
  /** FK to agents table. Set to null to clear the agent assignment. */
  agentId: UuidSchema.optional().nullable(),

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

  // Debounce overrides
  messageDebounceMode: z.enum(['disabled', 'fixed', 'randomized', 'presence']).optional().nullable(),
  messageDebounceMinMs: z.number().int().nonnegative().optional().nullable(),
  messageDebounceMaxMs: z.number().int().nonnegative().optional().nullable(),
  messageDebounceGroupMs: z.number().int().nonnegative().optional().nullable(),
  messageDebounceRestartOnTyping: z.boolean().optional().nullable(),
  messageDebounceMaxWaitMs: z.number().int().nonnegative().optional().nullable(),

  // Split delay overrides
  messageSplitDelayMode: z.enum(['disabled', 'fixed', 'randomized']).optional().nullable(),
  messageSplitDelayFixedMs: z.number().int().nonnegative().optional().nullable(),
  messageSplitDelayMinMs: z.number().int().nonnegative().optional().nullable(),
  messageSplitDelayMaxMs: z.number().int().nonnegative().optional().nullable(),
  enableAutoSplit: z.boolean().optional().nullable(),

  // Ack overrides
  reactionAck: z.enum(['off', 'on']).optional().nullable(),
  reactionAckEmoji: z.record(z.string()).optional().nullable(),
  ackTimeoutMs: z.number().int().positive().optional().nullable(),
  agentAckMessage: z.string().optional().nullable(),

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
