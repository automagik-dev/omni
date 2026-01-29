/**
 * Message and event schemas
 */

import { z } from 'zod';
import { ChannelTypeSchema, ContentTypeSchema, EventTypeSchema, MetadataSchema, UuidSchema } from './common';

/**
 * Event direction
 */
export const DirectionSchema = z.enum(['inbound', 'outbound']);

/**
 * Event status
 */
export const EventStatusSchema = z.enum(['received', 'processing', 'completed', 'failed']);

/**
 * OmniEventRecord schema (main event record)
 */
export const OmniEventRecordSchema = z.object({
  id: UuidSchema,
  externalId: z.string().max(255).nullable(),
  channel: ChannelTypeSchema,
  instanceId: UuidSchema.nullable(),
  personId: UuidSchema.nullable(),
  platformIdentityId: UuidSchema.nullable(),

  // Classification
  eventType: EventTypeSchema,
  direction: DirectionSchema,
  contentType: ContentTypeSchema.nullable(),

  // Content
  textContent: z.string().nullable(),
  transcription: z.string().nullable(),
  imageDescription: z.string().nullable(),
  documentExtraction: z.string().nullable(),

  // Media
  mediaId: UuidSchema.nullable(),
  mediaMimeType: z.string().max(100).nullable(),
  mediaSize: z.number().int().nullable(),
  mediaDuration: z.number().int().nullable(),
  mediaUrl: z.string().url().nullable(),

  // Context
  replyToEventId: UuidSchema.nullable(),
  replyToExternalId: z.string().max(255).nullable(),
  chatId: z.string().max(255).nullable(),
  canonicalChatId: z.string().max(255).nullable(),

  // Status
  status: EventStatusSchema,
  errorMessage: z.string().nullable(),
  errorStage: z.string().max(50).nullable(),

  // Timing
  receivedAt: z.date(),
  processedAt: z.date().nullable(),
  deliveredAt: z.date().nullable(),
  readAt: z.date().nullable(),

  // Metrics
  processingTimeMs: z.number().int().nullable(),
  agentLatencyMs: z.number().int().nullable(),
  totalLatencyMs: z.number().int().nullable(),

  // Raw data
  rawPayload: MetadataSchema.nullable(),
  agentRequest: MetadataSchema.nullable(),
  agentResponse: MetadataSchema.nullable(),

  metadata: MetadataSchema.nullable(),
  createdAt: z.date(),
});

export type OmniEventRecord = z.infer<typeof OmniEventRecordSchema>;

/**
 * Incoming message schema (from channel)
 */
export const IncomingMessageSchema = z.object({
  externalId: z.string(),
  chatId: z.string(),
  from: z.string(),
  content: z.object({
    type: ContentTypeSchema,
    text: z.string().optional(),
    mediaUrl: z.string().url().optional(),
    mimeType: z.string().optional(),
    filename: z.string().optional(),
    duration: z.number().int().optional(),
  }),
  replyToId: z.string().optional(),
  timestamp: z.number().int(),
  rawPayload: MetadataSchema.optional(),
});

export type IncomingMessage = z.infer<typeof IncomingMessageSchema>;

/**
 * Outgoing message schema (to channel)
 */
export const OutgoingMessageSchema = z.object({
  to: z.string(),
  content: z.object({
    type: ContentTypeSchema,
    text: z.string().optional(),
    mediaUrl: z.string().url().optional(),
    mimeType: z.string().optional(),
    filename: z.string().optional(),
    caption: z.string().optional(),
  }),
  replyToId: z.string().optional(),
  metadata: MetadataSchema.optional(),
});

export type OutgoingMessage = z.infer<typeof OutgoingMessageSchema>;

/**
 * Send message result
 */
export const SendResultSchema = z.object({
  success: z.boolean(),
  messageId: z.string().optional(),
  error: z.string().optional(),
  timestamp: z.number().int(),
});

export type SendResult = z.infer<typeof SendResultSchema>;

/**
 * Event query filters
 */
export const EventQuerySchema = z.object({
  instanceId: UuidSchema.optional(),
  personId: UuidSchema.optional(),
  chatId: z.string().optional(),
  eventType: EventTypeSchema.optional(),
  direction: DirectionSchema.optional(),
  status: EventStatusSchema.optional(),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});

export type EventQuery = z.infer<typeof EventQuerySchema>;
