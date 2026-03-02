/**
 * Agent Task entity schemas (omni-m7m)
 *
 * @see docs/architecture/actor-model.md — "Agent Task (persistent)"
 */

import { z } from 'zod';
import { MetadataSchema, UuidSchema } from './common';

/**
 * All valid task statuses
 */
export const AgentTaskStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
  'waiting_input',
]);

export type AgentTaskStatus = z.infer<typeof AgentTaskStatusSchema>;

/**
 * Full agent task object (matches DB row)
 */
export const AgentTaskSchema = z.object({
  id: UuidSchema,
  agentId: UuidSchema,
  chatId: UuidSchema,
  conversationId: UuidSchema.nullable(),
  messageId: UuidSchema.nullable(),

  type: z.string().max(100),
  title: z.string().max(500),
  description: z.string().nullable(),

  status: AgentTaskStatusSchema,
  progress: z.number().int().min(0).max(100),
  priority: z.number().int(),

  metadata: MetadataSchema,
  result: MetadataSchema.nullable(),
  error: z.string().nullable(),

  parentTaskId: UuidSchema.nullable(),
  subtaskCount: z.number().int().min(0),
  completedSubtaskCount: z.number().int().min(0),

  createdAt: z.date(),
  startedAt: z.date().nullable(),
  completedAt: z.date().nullable(),
  updatedAt: z.date(),
});

export type AgentTask = z.infer<typeof AgentTaskSchema>;

/**
 * Create agent task input
 * Required: agentId, chatId, type, title
 * Optional: everything else
 */
export const CreateAgentTaskSchema = z.object({
  agentId: UuidSchema,
  chatId: UuidSchema,
  conversationId: UuidSchema.optional(),
  messageId: UuidSchema.optional(),

  type: z.string().min(1).max(100),
  title: z.string().min(1).max(500),
  description: z.string().optional(),

  status: AgentTaskStatusSchema.default('pending').optional(),
  progress: z.number().int().min(0).max(100).default(0).optional(),
  priority: z.number().int().default(0).optional(),

  metadata: MetadataSchema.default({}).optional(),
  result: MetadataSchema.optional(),
  error: z.string().optional(),

  parentTaskId: UuidSchema.optional(),
});

export type CreateAgentTaskInput = z.infer<typeof CreateAgentTaskSchema>;

/**
 * Update agent task input — partial update
 * Covers status transitions, progress, metadata, result, error, timing
 */
export const UpdateAgentTaskSchema = z.object({
  status: AgentTaskStatusSchema.optional(),
  progress: z.number().int().min(0).max(100).optional(),
  metadata: MetadataSchema.optional(),
  result: MetadataSchema.nullable().optional(),
  error: z.string().nullable().optional(),
  startedAt: z.date().nullable().optional(),
  completedAt: z.date().nullable().optional(),
});

export type UpdateAgentTaskInput = z.infer<typeof UpdateAgentTaskSchema>;

/**
 * List agent tasks query parameters
 */
export const ListAgentTasksQuerySchema = z.object({
  agentId: UuidSchema.optional(),
  chatId: UuidSchema.optional(),
  conversationId: UuidSchema.optional(),
  status: AgentTaskStatusSchema.optional(),
  type: z.string().max(100).optional(),
  parentTaskId: UuidSchema.optional(),
  limit: z.number().int().positive().max(200).default(50),
  cursor: z.string().optional(),
});

export type ListAgentTasksQuery = z.infer<typeof ListAgentTasksQuerySchema>;
