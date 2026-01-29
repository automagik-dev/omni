/**
 * Omni v2 Database Schema (Drizzle ORM)
 *
 * This schema is derived from v1 SQLAlchemy models with enhancements:
 * - Users → Persons + PlatformIdentities (identity graph)
 * - Message traces → OmniEvents (event sourcing)
 * - Full TypeScript type safety
 *
 * @see /home/cezar/dev/omni/src/db/models.py (v1 reference)
 */

import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  uuid,
  varchar,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ============================================================================
// ENUMS
// ============================================================================

export const channelTypes = ['whatsapp-baileys', 'whatsapp-cloud', 'discord', 'slack', 'telegram'] as const;
export type ChannelType = (typeof channelTypes)[number];

export const agentTypes = ['agent', 'team'] as const;
export type AgentType = (typeof agentTypes)[number];

export const debounceMode = ['disabled', 'fixed', 'randomized'] as const;
export type DebounceMode = (typeof debounceMode)[number];

export const splitDelayMode = ['disabled', 'fixed', 'randomized'] as const;
export type SplitDelayMode = (typeof splitDelayMode)[number];

export const ruleTypes = ['allow', 'deny'] as const;
export type RuleType = (typeof ruleTypes)[number];

export const settingValueTypes = ['string', 'integer', 'boolean', 'json', 'secret'] as const;
export type SettingValueType = (typeof settingValueTypes)[number];

export const eventTypes = [
  'message.received',
  'message.sent',
  'message.delivered',
  'message.read',
  'message.failed',
  'media.received',
  'media.processed',
  'identity.created',
  'identity.linked',
  'identity.unlinked',
  'instance.connected',
  'instance.disconnected',
  'access.allowed',
  'access.denied',
] as const;
export type EventType = (typeof eventTypes)[number];

export const contentTypes = ['text', 'audio', 'image', 'video', 'document', 'sticker', 'contact', 'location', 'reaction'] as const;
export type ContentType = (typeof contentTypes)[number];

export const jobStatuses = ['pending', 'running', 'completed', 'failed', 'cancelled'] as const;
export type JobStatus = (typeof jobStatuses)[number];

// ============================================================================
// AGENT PROVIDERS
// ============================================================================

export const providerSchemas = ['openai', 'anthropic', 'agno', 'custom'] as const;
export type ProviderSchema = (typeof providerSchemas)[number];

/**
 * Reusable agent provider configurations.
 * Supports multiple API schemas: OpenAI, Anthropic, Agno, and custom.
 *
 * @see v1: omni_agent_providers table
 * @see docs/architecture/provider-system.md
 */
export const agentProviders = pgTable('agent_providers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull().unique(),

  // Schema type determines how to communicate with the provider
  schema: varchar('schema', { length: 20 }).notNull().default('agno').$type<ProviderSchema>(),

  // Connection settings
  baseUrl: text('base_url').notNull(),
  apiKey: text('api_key'),

  // Schema-specific configuration (JSON)
  // For OpenAI: { model, systemPrompt, maxTokens, temperature }
  // For Anthropic: { model, systemPrompt, maxTokens }
  // For Agno: { agentId, teamId, timeout }
  // For Custom: { full CustomProviderConfig }
  schemaConfig: jsonb('schema_config').$type<Record<string, unknown>>(),

  // Default settings
  defaultStream: boolean('default_stream').notNull().default(true),
  defaultTimeout: integer('default_timeout').notNull().default(60),

  // Capabilities (auto-detected or manually set)
  supportsStreaming: boolean('supports_streaming').notNull().default(true),
  supportsImages: boolean('supports_images').notNull().default(false),
  supportsAudio: boolean('supports_audio').notNull().default(false),
  supportsDocuments: boolean('supports_documents').notNull().default(false),

  // Metadata
  description: text('description'),
  tags: text('tags').array(),

  // Health tracking
  isActive: boolean('is_active').notNull().default(true),
  lastHealthCheck: timestamp('last_health_check'),
  lastHealthStatus: varchar('last_health_status', { length: 20 }), // 'healthy' | 'unhealthy' | 'error'
  lastHealthError: text('last_health_error'),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  nameIdx: index('agent_providers_name_idx').on(table.name),
  schemaIdx: index('agent_providers_schema_idx').on(table.schema),
  activeIdx: index('agent_providers_active_idx').on(table.isActive),
}));

// ============================================================================
// INSTANCES
// ============================================================================

/**
 * Channel instance configurations.
 * Each instance represents a connection to a messaging platform.
 *
 * @see v1: omni_instance_configs table
 */
export const instances = pgTable('instances', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  channel: varchar('channel', { length: 50 }).notNull().$type<ChannelType>(),

  // ---- WhatsApp Configuration ----
  // Note: In v2, we use Baileys directly, no Evolution API
  sessionPath: text('session_path'), // Path to Baileys auth state
  sessionIdPrefix: varchar('session_id_prefix', { length: 50 }),

  // ---- Discord Configuration ----
  discordBotToken: text('discord_bot_token'),
  discordClientId: varchar('discord_client_id', { length: 50 }),
  discordGuildIds: text('discord_guild_ids').array(), // Multi-server support
  discordDefaultChannelId: varchar('discord_default_channel_id', { length: 50 }),
  discordVoiceEnabled: boolean('discord_voice_enabled').default(false),
  discordSlashCommandsEnabled: boolean('discord_slash_commands_enabled').default(true),
  discordWebhookUrl: text('discord_webhook_url'),
  discordPermissions: integer('discord_permissions'),

  // ---- Slack Configuration ----
  slackBotToken: text('slack_bot_token'),
  slackAppToken: text('slack_app_token'),
  slackSigningSecret: text('slack_signing_secret'),
  slackTeamId: varchar('slack_team_id', { length: 50 }),

  // ---- Telegram Configuration ----
  telegramBotToken: text('telegram_bot_token'),

  // ---- Agent Provider Reference ----
  agentProviderId: uuid('agent_provider_id').references(() => agentProviders.id, { onDelete: 'set null' }),

  // ---- Agent Configuration (Instance Override) ----
  agentApiUrl: text('agent_api_url'),
  agentApiKey: text('agent_api_key'),
  agentId: varchar('agent_id', { length: 255 }).default('default'),
  agentType: varchar('agent_type', { length: 20 }).notNull().default('agent').$type<AgentType>(),
  agentTimeout: integer('agent_timeout').notNull().default(60),
  agentStreamMode: boolean('agent_stream_mode').notNull().default(false),

  // ---- Profile Information (populated from channel) ----
  profileName: varchar('profile_name', { length: 255 }),
  profilePicUrl: text('profile_pic_url'),
  ownerIdentifier: varchar('owner_identifier', { length: 255 }), // JID for WhatsApp, user ID for Discord, etc.

  // ---- Instance Status ----
  isDefault: boolean('is_default').notNull().default(false),
  isActive: boolean('is_active').notNull().default(false),

  // ---- Message Processing Config ----
  enableAutoSplit: boolean('enable_auto_split').notNull().default(true),
  disableUsernamePrefix: boolean('disable_username_prefix').notNull().default(false),
  processMediaOnBlocked: boolean('process_media_on_blocked').notNull().default(true),

  // ---- Message Debounce ----
  messageDebounceMode: varchar('message_debounce_mode', { length: 20 }).notNull().default('disabled').$type<DebounceMode>(),
  messageDebounceMinMs: integer('message_debounce_min_ms').notNull().default(0),
  messageDebounceMaxMs: integer('message_debounce_max_ms').notNull().default(0),

  // ---- Message Split Delay ----
  messageSplitDelayMode: varchar('message_split_delay_mode', { length: 20 }).notNull().default('randomized').$type<SplitDelayMode>(),
  messageSplitDelayFixedMs: integer('message_split_delay_fixed_ms').notNull().default(0),
  messageSplitDelayMinMs: integer('message_split_delay_min_ms').notNull().default(300),
  messageSplitDelayMaxMs: integer('message_split_delay_max_ms').notNull().default(1000),

  // ---- Media Processing ----
  processAudio: boolean('process_audio').notNull().default(true),
  processImages: boolean('process_images').notNull().default(true),
  processVideo: boolean('process_video').notNull().default(true),
  processDocuments: boolean('process_documents').notNull().default(true),

  // ---- Timestamps ----
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  nameIdx: uniqueIndex('instances_name_idx').on(table.name),
  channelIdx: index('instances_channel_idx').on(table.channel),
  isActiveIdx: index('instances_is_active_idx').on(table.isActive),
  isDefaultIdx: index('instances_is_default_idx').on(table.isDefault),
}));

// ============================================================================
// PERSONS (Identity Graph Root)
// ============================================================================

/**
 * Person entity - represents a real-world person.
 * Each person can have multiple platform identities (WhatsApp, Discord, etc.).
 *
 * @see v1: omni_users table (enhanced with identity graph)
 */
export const persons = pgTable('persons', {
  id: uuid('id').primaryKey().defaultRandom(),
  displayName: varchar('display_name', { length: 255 }),
  primaryPhone: varchar('primary_phone', { length: 50 }), // E.164 format
  primaryEmail: varchar('primary_email', { length: 255 }),
  avatarUrl: text('avatar_url'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  phoneIdx: index('persons_phone_idx').on(table.primaryPhone),
  emailIdx: index('persons_email_idx').on(table.primaryEmail),
  nameIdx: index('persons_name_idx').on(table.displayName),
}));

// ============================================================================
// PLATFORM IDENTITIES
// ============================================================================

/**
 * Platform identity - a person's presence on a specific channel.
 * Links to Person for cross-channel identity unification.
 *
 * @see v1: omni_users + omni_user_external_ids (combined and enhanced)
 */
export const platformIdentities = pgTable('platform_identities', {
  id: uuid('id').primaryKey().defaultRandom(),
  personId: uuid('person_id').references(() => persons.id, { onDelete: 'cascade' }),
  channel: varchar('channel', { length: 50 }).notNull().$type<ChannelType>(),
  instanceId: uuid('instance_id').references(() => instances.id, { onDelete: 'cascade' }),
  platformUserId: varchar('platform_user_id', { length: 255 }).notNull(), // JID, Discord ID, etc.
  platformUsername: varchar('platform_username', { length: 255 }),
  profilePicUrl: text('profile_pic_url'),
  profileData: jsonb('profile_data').$type<Record<string, unknown>>(),

  // ---- Activity Tracking ----
  messageCount: integer('message_count').notNull().default(0),
  lastSeenAt: timestamp('last_seen_at'),
  firstSeenAt: timestamp('first_seen_at').notNull().defaultNow(),

  // ---- Linking Metadata ----
  linkedBy: varchar('linked_by', { length: 50 }), // 'auto' | 'manual' | 'phone_match' | 'initial'
  confidence: integer('confidence').notNull().default(100), // 0-100
  linkReason: text('link_reason'),

  // ---- Timestamps ----
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  personIdx: index('platform_identities_person_idx').on(table.personId),
  channelIdx: index('platform_identities_channel_idx').on(table.channel),
  instanceIdx: index('platform_identities_instance_idx').on(table.instanceId),
  platformUserIdx: index('platform_identities_platform_user_idx').on(table.platformUserId),
  channelUserIdx: uniqueIndex('platform_identities_channel_user_idx').on(table.channel, table.instanceId, table.platformUserId),
}));

// ============================================================================
// OMNI EVENTS (Event Sourcing)
// ============================================================================

/**
 * Event record - captures all message and system events.
 * Replaces v1's message_traces with full event sourcing.
 *
 * @see v1: message_traces (enhanced to full events)
 */
export const omniEvents = pgTable('omni_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  externalId: varchar('external_id', { length: 255 }), // Platform message ID
  channel: varchar('channel', { length: 50 }).notNull().$type<ChannelType>(),
  instanceId: uuid('instance_id').references(() => instances.id, { onDelete: 'set null' }),
  personId: uuid('person_id').references(() => persons.id, { onDelete: 'set null' }),
  platformIdentityId: uuid('platform_identity_id').references(() => platformIdentities.id, { onDelete: 'set null' }),

  // ---- Event Classification ----
  eventType: varchar('event_type', { length: 50 }).notNull().$type<EventType>(),
  direction: varchar('direction', { length: 10 }).notNull().default('inbound'), // 'inbound' | 'outbound'
  contentType: varchar('content_type', { length: 20 }).$type<ContentType>(),

  // ---- Content ----
  textContent: text('text_content'),
  transcription: text('transcription'), // Audio transcription
  imageDescription: text('image_description'), // Image/video description
  documentExtraction: text('document_extraction'), // Document text extraction

  // ---- Media Reference ----
  mediaId: uuid('media_id'),
  mediaMimeType: varchar('media_mime_type', { length: 100 }),
  mediaSize: integer('media_size'),
  mediaDuration: integer('media_duration'), // seconds for audio/video
  mediaUrl: text('media_url'),

  // ---- Context ----
  replyToEventId: uuid('reply_to_event_id'),
  replyToExternalId: varchar('reply_to_external_id', { length: 255 }),
  chatId: varchar('chat_id', { length: 255 }), // Chat/conversation ID
  canonicalChatId: varchar('canonical_chat_id', { length: 255 }), // Resolved @lid → phone

  // ---- Processing Status ----
  status: varchar('status', { length: 20 }).notNull().default('received'), // 'received' | 'processing' | 'completed' | 'failed'
  errorMessage: text('error_message'),
  errorStage: varchar('error_stage', { length: 50 }),

  // ---- Timing ----
  receivedAt: timestamp('received_at').notNull().defaultNow(),
  processedAt: timestamp('processed_at'),
  deliveredAt: timestamp('delivered_at'),
  readAt: timestamp('read_at'),

  // ---- Processing Metrics ----
  processingTimeMs: integer('processing_time_ms'),
  agentLatencyMs: integer('agent_latency_ms'),
  totalLatencyMs: integer('total_latency_ms'),

  // ---- Raw Data ----
  rawPayload: jsonb('raw_payload').$type<Record<string, unknown>>(),
  agentRequest: jsonb('agent_request').$type<Record<string, unknown>>(),
  agentResponse: jsonb('agent_response').$type<Record<string, unknown>>(),

  // ---- Metadata ----
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  externalIdIdx: index('omni_events_external_id_idx').on(table.externalId),
  channelIdx: index('omni_events_channel_idx').on(table.channel),
  instanceIdx: index('omni_events_instance_idx').on(table.instanceId),
  personIdx: index('omni_events_person_idx').on(table.personId),
  eventTypeIdx: index('omni_events_type_idx').on(table.eventType),
  statusIdx: index('omni_events_status_idx').on(table.status),
  receivedAtIdx: index('omni_events_received_at_idx').on(table.receivedAt),
  chatIdIdx: index('omni_events_chat_id_idx').on(table.chatId),
  canonicalChatIdx: index('omni_events_canonical_chat_idx').on(table.canonicalChatId),
}));

// ============================================================================
// ACCESS RULES
// ============================================================================

/**
 * Access control rules for allow/deny lists.
 *
 * @see v1: omni_access_rules table
 */
export const accessRules = pgTable('access_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  instanceId: uuid('instance_id').references(() => instances.id, { onDelete: 'cascade' }),
  ruleType: varchar('rule_type', { length: 10 }).notNull().$type<RuleType>(),

  // ---- Matching Criteria ----
  phonePattern: varchar('phone_pattern', { length: 50 }), // E.164 with optional wildcard
  platformUserId: varchar('platform_user_id', { length: 255 }),
  personId: uuid('person_id').references(() => persons.id, { onDelete: 'cascade' }),

  // ---- Rule Settings ----
  priority: integer('priority').notNull().default(0),
  enabled: boolean('enabled').notNull().default(true),
  reason: text('reason'),
  expiresAt: timestamp('expires_at'),

  // ---- Action ----
  action: varchar('action', { length: 20 }).notNull().default('block'), // 'block' | 'allow' | 'silent_block'
  blockMessage: text('block_message'),

  // ---- Timestamps ----
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  instanceIdx: index('access_rules_instance_idx').on(table.instanceId),
  phoneIdx: index('access_rules_phone_idx').on(table.phonePattern),
  ruleTypeIdx: index('access_rules_type_idx').on(table.ruleType),
  uniqueRule: uniqueIndex('access_rules_unique_idx').on(table.instanceId, table.phonePattern, table.ruleType),
}));

// ============================================================================
// GLOBAL SETTINGS
// ============================================================================

/**
 * Application-wide settings with typed values.
 *
 * @see v1: omni_global_settings table
 */
export const globalSettings = pgTable('global_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: varchar('key', { length: 255 }).notNull().unique(),
  value: text('value'),
  valueType: varchar('value_type', { length: 20 }).notNull().default('string').$type<SettingValueType>(),
  category: varchar('category', { length: 50 }),
  description: text('description'),
  isSecret: boolean('is_secret').notNull().default(false),
  isRequired: boolean('is_required').notNull().default(false),
  defaultValue: text('default_value'),
  validationRules: jsonb('validation_rules').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  createdBy: varchar('created_by', { length: 255 }),
  updatedBy: varchar('updated_by', { length: 255 }),
}, (table) => ({
  keyIdx: uniqueIndex('global_settings_key_idx').on(table.key),
  categoryIdx: index('global_settings_category_idx').on(table.category),
}));

/**
 * Setting change history for audit trail.
 *
 * @see v1: omni_setting_change_history table
 */
export const settingChangeHistory = pgTable('setting_change_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  settingId: uuid('setting_id').notNull().references(() => globalSettings.id, { onDelete: 'cascade' }),
  oldValue: text('old_value'),
  newValue: text('new_value'),
  changedBy: varchar('changed_by', { length: 255 }),
  changedAt: timestamp('changed_at').notNull().defaultNow(),
  changeReason: text('change_reason'),
}, (table) => ({
  settingIdx: index('setting_change_history_setting_idx').on(table.settingId),
  changedAtIdx: index('setting_change_history_changed_at_idx').on(table.changedAt),
}));

// ============================================================================
// BATCH JOBS
// ============================================================================

/**
 * Batch processing jobs (media reprocessing, imports, etc.).
 *
 * @see v1: batch_jobs (implicit in v1, explicit table in v2)
 */
export const batchJobs = pgTable('batch_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobType: varchar('job_type', { length: 50 }).notNull(), // 'media_reprocess' | 'import' | 'sync'
  instanceId: uuid('instance_id').references(() => instances.id, { onDelete: 'set null' }),
  status: varchar('status', { length: 20 }).notNull().default('pending').$type<JobStatus>(),

  // ---- Request Parameters ----
  requestParams: jsonb('request_params').$type<Record<string, unknown>>(),

  // ---- Progress ----
  totalItems: integer('total_items').notNull().default(0),
  processedItems: integer('processed_items').notNull().default(0),
  failedItems: integer('failed_items').notNull().default(0),
  currentItem: varchar('current_item', { length: 255 }),
  progressPercent: integer('progress_percent').notNull().default(0),

  // ---- Cost Tracking ----
  totalCostUsd: integer('total_cost_usd'), // Stored as cents
  totalTokens: integer('total_tokens'),

  // ---- Error Handling ----
  errorMessage: text('error_message'),
  errors: jsonb('errors').$type<Array<{ itemId: string; error: string }>>(),

  // ---- Timing ----
  createdAt: timestamp('created_at').notNull().defaultNow(),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
}, (table) => ({
  statusIdx: index('batch_jobs_status_idx').on(table.status),
  instanceIdx: index('batch_jobs_instance_idx').on(table.instanceId),
  createdAtIdx: index('batch_jobs_created_at_idx').on(table.createdAt),
}));

// ============================================================================
// MEDIA CONTENT
// ============================================================================

/**
 * Processed media content (transcriptions, descriptions).
 */
export const mediaContent = pgTable('media_content', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id').references(() => omniEvents.id, { onDelete: 'cascade' }),
  mediaId: uuid('media_id'),

  // ---- Processing Result ----
  processingType: varchar('processing_type', { length: 20 }).notNull(), // 'transcription' | 'description' | 'extraction'
  content: text('content').notNull(),
  model: varchar('model', { length: 100 }),
  provider: varchar('provider', { length: 50 }), // 'groq' | 'openai' | 'gemini'

  // ---- Metadata ----
  language: varchar('language', { length: 10 }),
  duration: integer('duration'), // For audio/video
  tokensUsed: integer('tokens_used'),
  costUsd: integer('cost_usd'), // Stored as cents

  // ---- Source Info ----
  batchJobId: uuid('batch_job_id').references(() => batchJobs.id, { onDelete: 'set null' }),
  processingTimeMs: integer('processing_time_ms'),

  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  eventIdx: index('media_content_event_idx').on(table.eventId),
  mediaIdx: index('media_content_media_idx').on(table.mediaId),
  batchJobIdx: index('media_content_batch_job_idx').on(table.batchJobId),
}));

// ============================================================================
// CHAT ID MAPPINGS (WhatsApp-specific)
// ============================================================================

/**
 * Maps WhatsApp @lid format to canonical @s.whatsapp.net format.
 * Critical for unified conversations.
 */
export const chatIdMappings = pgTable('chat_id_mappings', {
  id: uuid('id').primaryKey().defaultRandom(),
  instanceId: uuid('instance_id').notNull().references(() => instances.id, { onDelete: 'cascade' }),
  lidId: varchar('lid_id', { length: 255 }).notNull(), // @lid format
  phoneId: varchar('phone_id', { length: 255 }).notNull(), // @s.whatsapp.net format
  discoveredAt: timestamp('discovered_at').notNull().defaultNow(),
  discoveredFrom: varchar('discovered_from', { length: 50 }), // 'message_key' | 'sender_match' | 'manual'
}, (table) => ({
  instanceLidIdx: uniqueIndex('chat_id_mappings_instance_lid_idx').on(table.instanceId, table.lidId),
  instancePhoneIdx: index('chat_id_mappings_instance_phone_idx').on(table.instanceId, table.phoneId),
}));

// ============================================================================
// RELATIONS
// ============================================================================

export const agentProvidersRelations = relations(agentProviders, ({ many }) => ({
  instances: many(instances),
}));

export const instancesRelations = relations(instances, ({ one, many }) => ({
  agentProvider: one(agentProviders, {
    fields: [instances.agentProviderId],
    references: [agentProviders.id],
  }),
  platformIdentities: many(platformIdentities),
  accessRules: many(accessRules),
  omniEvents: many(omniEvents),
  batchJobs: many(batchJobs),
  chatIdMappings: many(chatIdMappings),
}));

export const personsRelations = relations(persons, ({ many }) => ({
  platformIdentities: many(platformIdentities),
  accessRules: many(accessRules),
  omniEvents: many(omniEvents),
}));

export const platformIdentitiesRelations = relations(platformIdentities, ({ one, many }) => ({
  person: one(persons, {
    fields: [platformIdentities.personId],
    references: [persons.id],
  }),
  instance: one(instances, {
    fields: [platformIdentities.instanceId],
    references: [instances.id],
  }),
  omniEvents: many(omniEvents),
}));

export const omniEventsRelations = relations(omniEvents, ({ one, many }) => ({
  instance: one(instances, {
    fields: [omniEvents.instanceId],
    references: [instances.id],
  }),
  person: one(persons, {
    fields: [omniEvents.personId],
    references: [persons.id],
  }),
  platformIdentity: one(platformIdentities, {
    fields: [omniEvents.platformIdentityId],
    references: [platformIdentities.id],
  }),
  mediaContent: many(mediaContent),
}));

export const accessRulesRelations = relations(accessRules, ({ one }) => ({
  instance: one(instances, {
    fields: [accessRules.instanceId],
    references: [instances.id],
  }),
  person: one(persons, {
    fields: [accessRules.personId],
    references: [persons.id],
  }),
}));

export const globalSettingsRelations = relations(globalSettings, ({ many }) => ({
  history: many(settingChangeHistory),
}));

export const settingChangeHistoryRelations = relations(settingChangeHistory, ({ one }) => ({
  setting: one(globalSettings, {
    fields: [settingChangeHistory.settingId],
    references: [globalSettings.id],
  }),
}));

export const batchJobsRelations = relations(batchJobs, ({ one, many }) => ({
  instance: one(instances, {
    fields: [batchJobs.instanceId],
    references: [instances.id],
  }),
  mediaContent: many(mediaContent),
}));

export const mediaContentRelations = relations(mediaContent, ({ one }) => ({
  event: one(omniEvents, {
    fields: [mediaContent.eventId],
    references: [omniEvents.id],
  }),
  batchJob: one(batchJobs, {
    fields: [mediaContent.batchJobId],
    references: [batchJobs.id],
  }),
}));

export const chatIdMappingsRelations = relations(chatIdMappings, ({ one }) => ({
  instance: one(instances, {
    fields: [chatIdMappings.instanceId],
    references: [instances.id],
  }),
}));

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type AgentProvider = typeof agentProviders.$inferSelect;
export type NewAgentProvider = typeof agentProviders.$inferInsert;

export type Instance = typeof instances.$inferSelect;
export type NewInstance = typeof instances.$inferInsert;

export type Person = typeof persons.$inferSelect;
export type NewPerson = typeof persons.$inferInsert;

export type PlatformIdentity = typeof platformIdentities.$inferSelect;
export type NewPlatformIdentity = typeof platformIdentities.$inferInsert;

export type OmniEvent = typeof omniEvents.$inferSelect;
export type NewOmniEvent = typeof omniEvents.$inferInsert;

export type AccessRule = typeof accessRules.$inferSelect;
export type NewAccessRule = typeof accessRules.$inferInsert;

export type GlobalSetting = typeof globalSettings.$inferSelect;
export type NewGlobalSetting = typeof globalSettings.$inferInsert;

export type SettingChange = typeof settingChangeHistory.$inferSelect;
export type NewSettingChange = typeof settingChangeHistory.$inferInsert;

export type BatchJob = typeof batchJobs.$inferSelect;
export type NewBatchJob = typeof batchJobs.$inferInsert;

export type MediaContent = typeof mediaContent.$inferSelect;
export type NewMediaContent = typeof mediaContent.$inferInsert;

export type ChatIdMapping = typeof chatIdMappings.$inferSelect;
export type NewChatIdMapping = typeof chatIdMappings.$inferInsert;
