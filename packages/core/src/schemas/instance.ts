/**
 * Instance configuration schemas
 */

import { z } from 'zod';
import { ChannelTypeSchema, MetadataSchema, ProviderSchemaEnum, UuidSchema } from './common';

/**
 * Debounce mode enum
 */
export const DebounceModeSchema = z.enum(['disabled', 'fixed', 'randomized']);

/**
 * Split delay mode enum
 */
export const SplitDelayModeSchema = z.enum(['disabled', 'fixed', 'randomized']);

/**
 * Stale-reply (supersede) mode enum — what to do with an agent reply when
 * newer inbound arrived while the agent was still running: 'off' delivers it
 * (legacy behavior), 'discard' drops it so the debounced re-flush answers
 * with full context.
 */
export const SupersedeModeSchema = z.enum(['off', 'discard']);

/**
 * Agent type enum
 */
export const AgentTypeSchema = z.enum(['agent', 'team', 'workflow']);

/**
 * Agent provider schema
 */
export const AgentProviderSchema = z.object({
  id: UuidSchema,
  name: z.string().max(255),
  schema: ProviderSchemaEnum,
  baseUrl: z.string().url(),
  apiKey: z.string().nullable(),
  schemaConfig: MetadataSchema.nullable(),
  defaultStream: z.boolean(),
  defaultTimeout: z.number().int().positive(),
  supportsStreaming: z.boolean(),
  supportsImages: z.boolean(),
  supportsAudio: z.boolean(),
  supportsDocuments: z.boolean(),
  description: z.string().nullable(),
  tags: z.array(z.string()).nullable(),
  isActive: z.boolean(),
  lastHealthCheck: z.date().nullable(),
  lastHealthStatus: z.enum(['healthy', 'unhealthy', 'error']).nullable(),
  lastHealthError: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type AgentProvider = z.infer<typeof AgentProviderSchema>;

/**
 * Create agent provider input
 */
export const CreateAgentProviderSchema = z.object({
  name: z.string().max(255),
  schema: ProviderSchemaEnum.default('agno'),
  baseUrl: z.string().url(),
  apiKey: z.string().optional(),
  schemaConfig: MetadataSchema.optional(),
  defaultStream: z.boolean().default(true),
  defaultTimeout: z.number().int().positive().default(600),
  supportsStreaming: z.boolean().default(true),
  supportsImages: z.boolean().default(false),
  supportsAudio: z.boolean().default(false),
  supportsDocuments: z.boolean().default(false),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export type CreateAgentProviderInput = z.infer<typeof CreateAgentProviderSchema>;

/**
 * Instance schema
 */
export const InstanceSchema = z.object({
  id: UuidSchema,
  name: z.string().max(255),
  channel: ChannelTypeSchema,

  // WhatsApp config
  sessionPath: z.string().nullable(),
  sessionIdPrefix: z.string().max(50).nullable(),

  // Discord config
  discordBotToken: z.string().nullable(),

  // Slack config
  slackBotToken: z.string().nullable(),
  slackAppToken: z.string().nullable(),
  slackSigningSecret: z.string().nullable(),

  // Telegram config
  telegramBotToken: z.string().nullable(),

  // Twilio WhatsApp config
  twilioAccountSid: z.string().nullable().optional(),
  twilioAuthToken: z.string().nullable().optional(),
  twilioFrom: z.string().nullable().optional(),
  twilioMessagingServiceSid: z.string().nullable().optional(),
  twilioStatusCallbackUrl: z.string().nullable().optional(),
  twilioWebhookUrl: z.string().nullable().optional(),
  twilioValidateSignature: z.boolean().optional(),

  // Agent config
  agentId: z.string().uuid().nullable().optional(),
  agentTimeout: z.number().int().positive(),
  agentStreamMode: z.boolean(),

  // Profile
  profileName: z.string().max(255).nullable(),
  profilePicUrl: z.string().url().nullable(),
  ownerIdentifier: z.string().max(255).nullable(),

  // Status
  isDefault: z.boolean(),
  isActive: z.boolean(),

  // Message processing
  enableAutoSplit: z.boolean(),
  messageFormatMode: z.enum(['convert', 'passthrough']),
  disableUsernamePrefix: z.boolean(),
  processMediaOnBlocked: z.boolean(),

  // Debounce
  messageDebounceMode: DebounceModeSchema,
  messageDebounceMinMs: z.number().int().min(0),
  messageDebounceMaxMs: z.number().int().min(0),

  // Stale-reply policy (see SupersedeModeSchema)
  messageSupersedeMode: SupersedeModeSchema,

  // Split delay
  messageSplitDelayMode: SplitDelayModeSchema,
  messageSplitDelayFixedMs: z.number().int().min(0),
  messageSplitDelayMinMs: z.number().int().min(0),
  messageSplitDelayMaxMs: z.number().int().min(0),

  // Media processing
  processAudio: z.boolean(),
  processImages: z.boolean(),
  processVideo: z.boolean(),
  processDocuments: z.boolean(),

  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Instance = z.infer<typeof InstanceSchema>;

/**
 * Create instance input (simplified - channel specific fields handled separately)
 */
export const CreateInstanceSchema = z.object({
  name: z.string().max(255),
  channel: ChannelTypeSchema,
  agentId: z.string().uuid().nullable().optional(),
  agentTimeout: z.number().int().positive().default(600),
  agentStreamMode: z.boolean().default(false),
  isDefault: z.boolean().default(false),
});

export type CreateInstanceInput = z.infer<typeof CreateInstanceSchema>;

/**
 * Instance status (runtime info)
 */
export const InstanceStatusSchema = z.object({
  instanceId: UuidSchema,
  isConnected: z.boolean(),
  connectedAt: z.date().nullable(),
  profileName: z.string().nullable(),
  profilePicUrl: z.string().url().nullable(),
  ownerIdentifier: z.string().nullable(),
  lastError: z.string().nullable(),
  lastErrorAt: z.date().nullable(),
});

export type InstanceStatus = z.infer<typeof InstanceStatusSchema>;
