/**
 * Agent entity schemas
 */

import { z } from 'zod';
import { MetadataSchema, UuidSchema } from './common';

export const AgentSystemSchema = z.enum(['claude', 'agno', 'openai', 'gemini', 'custom', 'omni-internal']);
export type AgentSystem = z.infer<typeof AgentSystemSchema>;

export const AgentEntityTypeSchema = z.enum(['assistant', 'workflow', 'team', 'tool']);
export type AgentEntityType = z.infer<typeof AgentEntityTypeSchema>;

/**
 * Full agent object (matches DB row)
 */
export const AgentSchema = z.object({
  id: UuidSchema,
  name: z.string().max(255),
  provider: AgentSystemSchema,
  model: z.string().max(120).nullable(),
  agentType: AgentEntityTypeSchema,
  capabilities: z.array(z.string()),
  ownerId: UuidSchema.nullable(),
  agentProviderId: UuidSchema.nullable(),
  configPath: z.string().nullable(),
  isInternal: z.boolean(),
  isActive: z.boolean(),
  metadata: MetadataSchema.nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Agent = z.infer<typeof AgentSchema>;

/**
 * Create agent input
 */
export const CreateAgentSchema = z.object({
  name: z.string().min(1).max(255),
  provider: AgentSystemSchema,
  model: z.string().max(120).optional(),
  agentType: AgentEntityTypeSchema.default('assistant'),
  capabilities: z.array(z.string()).default([]),
  ownerId: UuidSchema.optional(),
  agentProviderId: UuidSchema.optional(),
  configPath: z.string().optional(),
  isInternal: z.boolean().default(false),
  isActive: z.boolean().default(true),
  metadata: MetadataSchema.optional(),
});

export type CreateAgentInput = z.infer<typeof CreateAgentSchema>;

/**
 * Update agent input
 */
export const UpdateAgentSchema = CreateAgentSchema.partial();

export type UpdateAgentInput = z.infer<typeof UpdateAgentSchema>;
