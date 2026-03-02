/**
 * Conversation entity schemas
 */

import { z } from 'zod';
import { MetadataSchema, UuidSchema } from './common';

/**
 * Full conversation object (matches DB row)
 */
export const ConversationSchema = z.object({
  id: UuidSchema,
  title: z.string().max(500).nullable(),
  summary: z.string().nullable(),
  state: MetadataSchema.nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Conversation = z.infer<typeof ConversationSchema>;

/**
 * Create conversation input
 */
export const CreateConversationSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  summary: z.string().optional(),
  state: MetadataSchema.optional(),
});

export type CreateConversationInput = z.infer<typeof CreateConversationSchema>;

/**
 * Update conversation input
 */
export const UpdateConversationSchema = z.object({
  title: z.string().min(1).max(500).nullable().optional(),
  summary: z.string().nullable().optional(),
  state: MetadataSchema.nullable().optional(),
});

export type UpdateConversationInput = z.infer<typeof UpdateConversationSchema>;
