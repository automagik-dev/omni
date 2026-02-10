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

import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// ============================================================================
// ENUMS
// ============================================================================

export const channelTypes = ['whatsapp-baileys', 'whatsapp-cloud', 'discord', 'slack', 'telegram'] as const;
export type ChannelType = (typeof channelTypes)[number];

export const agentTypes = ['agent', 'team', 'workflow'] as const;
export type AgentType = (typeof agentTypes)[number];

export const debounceMode = ['disabled', 'fixed', 'randomized'] as const;
export type DebounceMode = (typeof debounceMode)[number];

export const splitDelayMode = ['disabled', 'fixed', 'randomized'] as const;
export type SplitDelayMode = (typeof splitDelayMode)[number];

export const replyFilterMode = ['all', 'filtered'] as const;
export type ReplyFilterMode = (typeof replyFilterMode)[number];

/** When agent should reply to messages */
export interface AgentReplyFilter {
  mode: ReplyFilterMode;
  conditions: {
    /** Reply if message is a DM (not in group/channel) */
    onDm: boolean;
    /** Reply if bot is @mentioned */
    onMention: boolean;
    /** Reply if message is a reply to bot's message */
    onReply: boolean;
    /** Reply if bot name appears in text */
    onNameMatch: boolean;
    /** Custom patterns for name matching */
    namePatterns?: string[];
  };
}

/**
 * Session strategy for agent memory
 * - per_user: Same session across all chats for this user
 * - per_chat: All users in a chat share the session (group memory)
 * - per_user_per_chat: Each user has own session per chat (most isolated)
 */
export const agentSessionStrategies = ['per_user', 'per_chat', 'per_user_per_chat'] as const;
export type AgentSessionStrategy = (typeof agentSessionStrategies)[number];

export const ruleTypes = ['allow', 'deny'] as const;
export type RuleType = (typeof ruleTypes)[number];

export const accessModes = ['disabled', 'blocklist', 'allowlist'] as const;
export type AccessMode = (typeof accessModes)[number];

export const settingValueTypes = ['string', 'integer', 'boolean', 'json', 'secret'] as const;
export type SettingValueType = (typeof settingValueTypes)[number];

export const apiKeyStatuses = ['active', 'revoked', 'expired'] as const;
export type ApiKeyStatus = (typeof apiKeyStatuses)[number];

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

export const contentTypes = [
  'text',
  'audio',
  'image',
  'video',
  'document',
  'sticker',
  'contact',
  'location',
  'reaction',
] as const;
export type ContentType = (typeof contentTypes)[number];

// ============================================================================
// UNIFIED MESSAGES ENUMS
// ============================================================================

export const chatTypes = [
  // Common across platforms
  'dm', // Direct message (1:1)
  'group', // Multi-party chat (WhatsApp group, Discord group DM)

  // Channel-oriented (Discord, Slack)
  'channel', // Public/private channel in a server
  'thread', // Thread within a channel
  'forum', // Forum channel with thread-per-post
  'voice', // Voice channel (can have text)

  // Platform-specific
  'broadcast', // WhatsApp broadcast list
  'community', // WhatsApp community
  'announcement', // Discord announcement channel
  'stage', // Discord stage channel
] as const;
export type ChatType = (typeof chatTypes)[number];

export const messageSources = [
  'realtime', // Received via webhook (has event)
  'sync', // Fetched via history sync (NO event)
  'api', // Sent via our API
  'import', // Bulk imported
] as const;
export type MessageSource = (typeof messageSources)[number];

export const messageTypes = [
  'text',
  'audio',
  'image',
  'video',
  'document',
  'sticker',
  'contact',
  'location',
  'poll',
  'system', // System messages (join, leave, etc.)
] as const;
export type MessageType = (typeof messageTypes)[number];

export const messageStatuses = ['active', 'edited', 'deleted', 'expired'] as const;
export type MessageStatus = (typeof messageStatuses)[number];

export const deliveryStatuses = ['pending', 'sent', 'delivered', 'read', 'failed'] as const;
export type DeliveryStatus = (typeof deliveryStatuses)[number];

// ============================================================================
// UNIFIED MESSAGES JSONB TYPES
// ============================================================================

export interface EditHistoryEntry {
  text: string;
  at: string; // ISO timestamp
  by?: string; // Platform user ID who edited (if available)
}

export interface ReactionInfo {
  emoji: string;
  platformUserId: string;
  personId?: string; // If resolved to Omni person
  displayName?: string;
  at: string; // ISO timestamp
  isCustomEmoji?: boolean;
  customEmojiId?: string; // Discord custom emoji
}

export interface MentionInfo {
  platformUserId: string;
  personId?: string;
  displayName?: string;
  startIndex?: number;
  length?: number;
  type: 'user' | 'role' | 'channel' | 'everyone' | 'here';
}

export interface MediaMetadata {
  width?: number;
  height?: number;
  durationSeconds?: number;
  fileName?: string;
  fileSize?: number;
  isVoiceNote?: boolean;
  waveform?: number[];
  isGif?: boolean;
  processingCostUsd?: number;
  processingModel?: string;
}

export interface ChatSettings {
  muted?: boolean;
  muteUntil?: string; // ISO timestamp
  pinned?: boolean;
  archived?: boolean;
  readOnly?: boolean;
  slowMode?: number; // seconds
  agentPaused?: boolean; // Pause AI agent responses for this chat
  [key: string]: unknown;
}

export const jobStatuses = ['pending', 'running', 'completed', 'failed', 'cancelled'] as const;
export type JobStatus = (typeof jobStatuses)[number];

// ============================================================================
// AGENT PROVIDERS
// ============================================================================

export const providerSchemas = [
  'agnoos',
  'agno',
  'a2a',
  'openai',
  'anthropic',
  'webhook',
  'openclaw',
  'custom',
] as const;
export type ProviderSchema = (typeof providerSchemas)[number];

/**
 * Reusable agent provider configurations.
 * Supports multiple API schemas: AgnoOS, A2A, OpenAI, Anthropic, and custom.
 *
 * @see v1: omni_agent_providers table
 * @see docs/architecture/provider-system.md
 */
export const agentProviders = pgTable(
  'agent_providers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull().unique(),

    // Schema type determines how to communicate with the provider
    schema: varchar('schema', { length: 20 }).notNull().default('agnoos').$type<ProviderSchema>(),

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
  },
  (table) => ({
    nameIdx: index('agent_providers_name_idx').on(table.name),
    schemaIdx: index('agent_providers_schema_idx').on(table.schema),
    activeIdx: index('agent_providers_active_idx').on(table.isActive),
  }),
);

// ============================================================================
// API KEYS
// ============================================================================

/**
 * API keys for authentication.
 * Each key has scopes that control access to resources.
 *
 * Key format: omni_sk_{32-char-random}
 * Hash: SHA-256 of the full key (we only store the hash)
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),

    // Security - store hash of key, not the key itself
    // Key prefix stored for identification (first 8 chars after omni_sk_)
    keyPrefix: varchar('key_prefix', { length: 12 }).notNull(),
    keyHash: varchar('key_hash', { length: 64 }).notNull(), // SHA-256 hex

    // Scopes define what the key can access
    // Examples: ['*'], ['messages:read', 'messages:write'], ['instances:read']
    scopes: text('scopes').array().notNull(),

    // Instance restrictions (null = all instances)
    instanceIds: uuid('instance_ids').array(),

    // Status
    status: varchar('status', { length: 20 }).notNull().default('active').$type<ApiKeyStatus>(),

    // Rate limiting (requests per minute, null = default)
    rateLimit: integer('rate_limit'),

    // Expiration (null = never expires)
    expiresAt: timestamp('expires_at'),

    // Audit
    lastUsedAt: timestamp('last_used_at'),
    lastUsedIp: varchar('last_used_ip', { length: 45 }), // IPv6 max length
    usageCount: integer('usage_count').notNull().default(0),

    // Revocation
    revokedAt: timestamp('revoked_at'),
    revokedBy: varchar('revoked_by', { length: 255 }),
    revokeReason: text('revoke_reason'),

    // Timestamps
    createdAt: timestamp('created_at').notNull().defaultNow(),
    createdBy: varchar('created_by', { length: 255 }),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    keyPrefixIdx: index('api_keys_key_prefix_idx').on(table.keyPrefix),
    keyHashIdx: uniqueIndex('api_keys_key_hash_idx').on(table.keyHash),
    statusIdx: index('api_keys_status_idx').on(table.status),
    expiresAtIdx: index('api_keys_expires_at_idx').on(table.expiresAt),
  }),
);

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;

// ============================================================================
// API KEY AUDIT LOGS
// ============================================================================

/**
 * Audit trail for API key usage.
 * Logs every authenticated API request for security monitoring.
 */
export const apiKeyAuditLogs = pgTable(
  'api_key_audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    apiKeyId: uuid('api_key_id')
      .notNull()
      .references(() => apiKeys.id, { onDelete: 'cascade' }),
    method: varchar('method', { length: 10 }).notNull(),
    path: varchar('path', { length: 500 }).notNull(),
    statusCode: integer('status_code').notNull(),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),
    responseTimeMs: integer('response_time_ms'),
    timestamp: timestamp('timestamp').notNull().defaultNow(),
  },
  (table) => ({
    apiKeyIdx: index('api_key_audit_logs_api_key_idx').on(table.apiKeyId),
    timestampIdx: index('api_key_audit_logs_timestamp_idx').on(table.timestamp),
    pathIdx: index('api_key_audit_logs_path_idx').on(table.path),
  }),
);

export type ApiKeyAuditLog = typeof apiKeyAuditLogs.$inferSelect;
export type NewApiKeyAuditLog = typeof apiKeyAuditLogs.$inferInsert;

export const apiKeysRelations = relations(apiKeys, ({ many }) => ({
  auditLogs: many(apiKeyAuditLogs),
}));

export const apiKeyAuditLogsRelations = relations(apiKeyAuditLogs, ({ one }) => ({
  apiKey: one(apiKeys, {
    fields: [apiKeyAuditLogs.apiKeyId],
    references: [apiKeys.id],
  }),
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
export const instances = pgTable(
  'instances',
  {
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
    /** When agent should reply to messages */
    agentReplyFilter: jsonb('agent_reply_filter').$type<AgentReplyFilter>(),
    /** Session strategy for agent memory */
    agentSessionStrategy: varchar('agent_session_strategy', { length: 20 })
      .notNull()
      .default('per_user_per_chat')
      .$type<AgentSessionStrategy>(),
    /** Prefix messages with sender name: [Name]: message */
    agentPrefixSenderName: boolean('agent_prefix_sender_name').notNull().default(true),

    // ---- Trigger Configuration (what events activate the agent) ----
    /** Which event types trigger the agent (default: message.received only) */
    triggerEvents: jsonb('trigger_events').$type<string[]>().default(['message.received']),
    /** Which reaction emojis trigger the agent (null = all emojis when reaction.received is in triggerEvents) */
    triggerReactions: jsonb('trigger_reactions').$type<string[]>(),
    /** Custom mention patterns for trigger matching */
    triggerMentionPatterns: jsonb('trigger_mention_patterns').$type<string[]>(),
    /** Agent trigger mode: round-trip (wait for response) or fire-and-forget */
    triggerMode: varchar('trigger_mode', { length: 20 }).notNull().default('round-trip'),
    /** Max triggers per user per channel per minute (rate limiting) */
    triggerRateLimit: integer('trigger_rate_limit').notNull().default(5),

    // ---- Profile Information (populated from channel) ----
    profileName: varchar('profile_name', { length: 255 }),
    profilePicUrl: text('profile_pic_url'),
    profileBio: text('profile_bio'),
    profileMetadata: jsonb('profile_metadata').$type<Record<string, unknown>>(), // Platform-specific: phone, isBusiness, etc.
    profileSyncedAt: timestamp('profile_synced_at'),
    ownerIdentifier: varchar('owner_identifier', { length: 255 }), // JID for WhatsApp, user ID for Discord, etc.

    // ---- Sync Settings ----
    downloadMediaOnSync: boolean('download_media_on_sync').notNull().default(false),

    // ---- Instance Status ----
    isDefault: boolean('is_default').notNull().default(false),
    isActive: boolean('is_active').notNull().default(false),

    // ---- Message Processing Config ----
    enableAutoSplit: boolean('enable_auto_split').notNull().default(true),
    disableUsernamePrefix: boolean('disable_username_prefix').notNull().default(false),
    processMediaOnBlocked: boolean('process_media_on_blocked').notNull().default(true),
    accessMode: varchar('access_mode', { length: 20 }).notNull().default('blocklist').$type<AccessMode>(),

    // ---- Message Debounce ----
    messageDebounceMode: varchar('message_debounce_mode', { length: 20 })
      .notNull()
      .default('disabled')
      .$type<DebounceMode>(),
    messageDebounceMinMs: integer('message_debounce_min_ms').notNull().default(0),
    messageDebounceMaxMs: integer('message_debounce_max_ms').notNull().default(0),
    /** Restart debounce timer when user is typing (requires channel support) */
    messageDebounceRestartOnTyping: boolean('message_debounce_restart_on_typing').notNull().default(false),

    // ---- Message Split Delay ----
    messageSplitDelayMode: varchar('message_split_delay_mode', { length: 20 })
      .notNull()
      .default('randomized')
      .$type<SplitDelayMode>(),
    messageSplitDelayFixedMs: integer('message_split_delay_fixed_ms').notNull().default(0),
    messageSplitDelayMinMs: integer('message_split_delay_min_ms').notNull().default(300),
    messageSplitDelayMaxMs: integer('message_split_delay_max_ms').notNull().default(1000),

    // ---- TTS Configuration ----
    ttsVoiceId: text('tts_voice_id'), // ElevenLabs voice ID override
    ttsModelId: text('tts_model_id'), // ElevenLabs model override

    // ---- Media Processing ----
    processAudio: boolean('process_audio').notNull().default(true),
    processImages: boolean('process_images').notNull().default(true),
    processVideo: boolean('process_video').notNull().default(true),
    processDocuments: boolean('process_documents').notNull().default(true),

    // ---- Agent Media Preprocessing ----
    /** Wait for media processing (transcription/vision) before dispatching to agent */
    agentWaitForMedia: boolean('agent_wait_for_media').notNull().default(true),
    /** Include the full file path in formatted text sent to agent */
    agentSendMediaPath: boolean('agent_send_media_path').notNull().default(true),

    // ---- Message Tracking ----
    /** Timestamp of last processed message (for reconnect gap detection) */
    lastMessageAt: timestamp('last_message_at'),

    // ---- Timestamps ----
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    nameIdx: uniqueIndex('instances_name_idx').on(table.name),
    channelIdx: index('instances_channel_idx').on(table.channel),
    isActiveIdx: index('instances_is_active_idx').on(table.isActive),
    isDefaultIdx: index('instances_is_default_idx').on(table.isDefault),
  }),
);

// ============================================================================
// PERSONS (Identity Graph Root)
// ============================================================================

/**
 * Person entity - represents a real-world person.
 * Each person can have multiple platform identities (WhatsApp, Discord, etc.).
 *
 * @see v1: omni_users table (enhanced with identity graph)
 */
export const persons = pgTable(
  'persons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    displayName: varchar('display_name', { length: 255 }),
    primaryPhone: varchar('primary_phone', { length: 50 }), // E.164 format
    primaryEmail: varchar('primary_email', { length: 255 }),
    avatarUrl: text('avatar_url'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    phoneIdx: index('persons_phone_idx').on(table.primaryPhone),
    emailIdx: index('persons_email_idx').on(table.primaryEmail),
    nameIdx: index('persons_name_idx').on(table.displayName),
  }),
);

// ============================================================================
// PLATFORM IDENTITIES
// ============================================================================

/**
 * Platform identity - a person's presence on a specific channel.
 * Links to Person for cross-channel identity unification.
 *
 * @see v1: omni_users + omni_user_external_ids (combined and enhanced)
 */
export const platformIdentities = pgTable(
  'platform_identities',
  {
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
  },
  (table) => ({
    personIdx: index('platform_identities_person_idx').on(table.personId),
    channelIdx: index('platform_identities_channel_idx').on(table.channel),
    instanceIdx: index('platform_identities_instance_idx').on(table.instanceId),
    platformUserIdx: index('platform_identities_platform_user_idx').on(table.platformUserId),
    channelUserIdx: uniqueIndex('platform_identities_channel_user_idx').on(
      table.channel,
      table.instanceId,
      table.platformUserId,
    ),
  }),
);

// ============================================================================
// CHATS (Unified Chat Model)
// ============================================================================

/**
 * Chat entity - represents a conversation/chat room.
 * Unified model for DMs, groups, channels, threads, etc.
 * Works across all platforms (WhatsApp, Discord, Slack, Telegram).
 *
 * @see unified-messages wish
 */
export const chats = pgTable(
  'chats',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instanceId: uuid('instance_id').references(() => instances.id, { onDelete: 'cascade' }),

    // ---- Identity ----
    externalId: varchar('external_id', { length: 255 }).notNull(), // Platform chat ID
    canonicalId: varchar('canonical_id', { length: 255 }), // Normalized ID (e.g., phone instead of @lid)

    // ---- Classification ----
    chatType: varchar('chat_type', { length: 50 }).notNull().$type<ChatType>(),
    channel: varchar('channel', { length: 50 }).notNull().$type<ChannelType>(),

    // ---- Metadata ----
    name: varchar('name', { length: 255 }),
    description: text('description'),
    avatarUrl: text('avatar_url'),

    // ---- Hierarchy (for threads, forums) ----
    parentChatId: uuid('parent_chat_id'),

    // ---- Stats (denormalized for performance) ----
    participantCount: integer('participant_count').notNull().default(0),
    messageCount: integer('message_count').notNull().default(0),
    unreadCount: integer('unread_count').notNull().default(0),

    // ---- Activity ----
    lastMessageAt: timestamp('last_message_at'),
    lastMessagePreview: text('last_message_preview'),

    // ---- Settings ----
    settings: jsonb('settings').$type<ChatSettings>(),

    // ---- Platform metadata ----
    platformMetadata: jsonb('platform_metadata').$type<Record<string, unknown>>(),

    // ---- Timestamps ----
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    archivedAt: timestamp('archived_at'),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => ({
    instanceExternalIdx: uniqueIndex('chats_instance_external_idx').on(table.instanceId, table.externalId),
    canonicalIdIdx: index('chats_canonical_id_idx').on(table.canonicalId),
    chatTypeIdx: index('chats_type_idx').on(table.chatType),
    channelIdx: index('chats_channel_idx').on(table.channel),
    parentIdx: index('chats_parent_idx').on(table.parentChatId),
    lastMessageIdx: index('chats_last_message_idx').on(table.lastMessageAt),
  }),
);

// ============================================================================
// CHAT PARTICIPANTS
// ============================================================================

/**
 * Chat participant - tracks who is in a chat.
 * Links to Person and PlatformIdentity for cross-platform identity.
 *
 * @see unified-messages wish
 */
export const chatParticipants = pgTable(
  'chat_participants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    personId: uuid('person_id').references(() => persons.id, { onDelete: 'set null' }),
    platformIdentityId: uuid('platform_identity_id').references(() => platformIdentities.id, { onDelete: 'set null' }),

    // ---- Platform identity ----
    platformUserId: varchar('platform_user_id', { length: 255 }).notNull(),
    displayName: varchar('display_name', { length: 255 }),
    avatarUrl: text('avatar_url'),

    // ---- Role (varies by platform) ----
    role: varchar('role', { length: 50 }), // 'owner', 'admin', 'member', 'guest'

    // ---- Status ----
    isActive: boolean('is_active').notNull().default(true),
    joinedAt: timestamp('joined_at').notNull().defaultNow(),
    leftAt: timestamp('left_at'),

    // ---- Activity ----
    lastSeenAt: timestamp('last_seen_at'),
    messageCount: integer('message_count').notNull().default(0),

    // ---- Platform metadata ----
    platformMetadata: jsonb('platform_metadata').$type<Record<string, unknown>>(),

    // ---- Timestamps ----
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    chatUserIdx: uniqueIndex('chat_participants_chat_user_idx').on(table.chatId, table.platformUserId),
    chatIdx: index('chat_participants_chat_idx').on(table.chatId),
    personIdx: index('chat_participants_person_idx').on(table.personId),
    platformIdentityIdx: index('chat_participants_platform_identity_idx').on(table.platformIdentityId),
    roleIdx: index('chat_participants_role_idx').on(table.role),
  }),
);

// ============================================================================
// GROUPS (Synced Groups/Guilds)
// ============================================================================

/**
 * Group entity - represents a WhatsApp group or Discord guild.
 * Synced from channel plugins via fetchGroups()/fetchGuilds().
 *
 * @see contacts-groups-sync wish
 */
export const omniGroups = pgTable(
  'omni_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => instances.id, { onDelete: 'cascade' }),

    // ---- Identity ----
    externalId: varchar('external_id', { length: 255 }).notNull(), // Group JID or Guild ID
    channel: varchar('channel', { length: 50 }).notNull().$type<ChannelType>(),

    // ---- Metadata ----
    name: varchar('name', { length: 255 }),
    description: text('description'),
    iconUrl: text('icon_url'),
    memberCount: integer('member_count'),

    // ---- Ownership ----
    ownerId: varchar('owner_id', { length: 255 }), // Platform user ID of owner
    createdBy: varchar('created_by', { length: 255 }), // Platform user ID of creator

    // ---- Settings ----
    isReadOnly: boolean('is_read_only').notNull().default(false),
    isCommunity: boolean('is_community').notNull().default(false),

    // ---- Platform-specific metadata ----
    platformMetadata: jsonb('platform_metadata').$type<Record<string, unknown>>(),

    // ---- Sync tracking ----
    syncedAt: timestamp('synced_at').notNull().defaultNow(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    instanceExternalIdx: uniqueIndex('omni_groups_instance_external_idx').on(table.instanceId, table.externalId),
    instanceIdx: index('omni_groups_instance_idx').on(table.instanceId),
    channelIdx: index('omni_groups_channel_idx').on(table.channel),
    nameIdx: index('omni_groups_name_idx').on(table.name),
  }),
);

// ============================================================================
// MESSAGES (Source of Truth)
// ============================================================================

/**
 * Message entity - the source of truth for all messages.
 * Works for both real-time (via webhook) and synced (via API) messages.
 * Event links are OPTIONAL - synced messages have no events.
 *
 * Uses JSONB for reactions and edit history to simplify schema.
 *
 * @see unified-messages wish
 */
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),

    // === IDENTITY ===
    externalId: varchar('external_id', { length: 255 }).notNull(), // Platform message ID

    // === SOURCE TRACKING ===
    source: varchar('source', { length: 20 }).notNull().$type<MessageSource>(),
    // 'realtime' | 'sync' | 'api' | 'import'

    // === SENDER ===
    senderPersonId: uuid('sender_person_id').references(() => persons.id, { onDelete: 'set null' }),
    senderPlatformIdentityId: uuid('sender_platform_identity_id').references(() => platformIdentities.id, {
      onDelete: 'set null',
    }),
    senderPlatformUserId: varchar('sender_platform_user_id', { length: 255 }),
    senderDisplayName: varchar('sender_display_name', { length: 255 }),
    isFromMe: boolean('is_from_me').notNull().default(false),

    // === CONTENT (CURRENT STATE) ===
    messageType: varchar('message_type', { length: 50 }).notNull().$type<MessageType>(),
    textContent: text('text_content'),

    // === LLM-READY PRE-PROCESSED CONTENT ===
    transcription: text('transcription'), // Audio → text (Whisper)
    imageDescription: text('image_description'), // Image → description (Vision)
    videoDescription: text('video_description'), // Video → description
    documentExtraction: text('document_extraction'), // Document → text (PyMuPDF/Vision)

    // === MEDIA ===
    hasMedia: boolean('has_media').notNull().default(false),
    mediaMimeType: varchar('media_mime_type', { length: 100 }),
    mediaUrl: text('media_url'),
    mediaLocalPath: text('media_local_path'),
    mediaMetadata: jsonb('media_metadata').$type<MediaMetadata>(),

    // === MESSAGE LINKING ===
    // Reply/Quote
    replyToMessageId: uuid('reply_to_message_id'),
    replyToExternalId: varchar('reply_to_external_id', { length: 255 }),
    quotedText: text('quoted_text'),
    quotedSenderName: varchar('quoted_sender_name', { length: 255 }),

    // Forward
    forwardedFromMessageId: uuid('forwarded_from_message_id'),
    forwardedFromExternalId: varchar('forwarded_from_external_id', { length: 255 }),
    forwardCount: integer('forward_count').notNull().default(0),
    isForwarded: boolean('is_forwarded').notNull().default(false),

    // Mentions (JSONB array)
    mentions: jsonb('mentions').$type<MentionInfo[]>(),

    // === MESSAGE STATE ===
    status: varchar('status', { length: 20 }).notNull().default('active').$type<MessageStatus>(),
    // 'active' | 'edited' | 'deleted' | 'expired'

    deliveryStatus: varchar('delivery_status', { length: 20 }).default('sent').$type<DeliveryStatus>(),
    // 'pending' | 'sent' | 'delivered' | 'read' | 'failed'

    // === EDIT TRACKING (JSONB - no separate table) ===
    editCount: integer('edit_count').notNull().default(0),
    originalText: text('original_text'), // First version (for quick access)
    editHistory: jsonb('edit_history').$type<EditHistoryEntry[]>(),
    // [{ text: "Hello!", at: "2024-01-01T12:00:00Z" }, ...]
    editedAt: timestamp('edited_at'),
    deletedAt: timestamp('deleted_at'),

    // === REACTIONS (JSONB - no separate table) ===
    reactions: jsonb('reactions').$type<ReactionInfo[]>(),
    // [{ emoji: "👍", platformUserId: "...", personId: "...", at: "..." }, ...]
    reactionCounts: jsonb('reaction_counts').$type<Record<string, number>>(),
    // { "👍": 5, "❤️": 3 } - denormalized for quick display

    // === RAW DATA (stored here, not just event link) ===
    rawPayload: jsonb('raw_payload').$type<Record<string, unknown>>(),
    // Full platform message object - essential for synced messages!

    // === EVENT LINKS (OPTIONAL - only for realtime) ===
    originalEventId: uuid('original_event_id'),
    latestEventId: uuid('latest_event_id'),
    // NULL for synced messages - they have no events!

    // === TIMESTAMPS ===
    platformTimestamp: timestamp('platform_timestamp').notNull(), // When platform says sent
    receivedAt: timestamp('received_at').notNull().defaultNow(), // When we got it
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    chatExternalIdx: uniqueIndex('messages_chat_external_idx').on(table.chatId, table.externalId),
    chatIdx: index('messages_chat_idx').on(table.chatId),
    senderPersonIdx: index('messages_sender_person_idx').on(table.senderPersonId),
    senderPlatformIdentityIdx: index('messages_sender_platform_identity_idx').on(table.senderPlatformIdentityId),
    sourceIdx: index('messages_source_idx').on(table.source),
    typeIdx: index('messages_type_idx').on(table.messageType),
    statusIdx: index('messages_status_idx').on(table.status),
    platformTimestampIdx: index('messages_platform_timestamp_idx').on(table.platformTimestamp),
    replyToIdx: index('messages_reply_to_idx').on(table.replyToMessageId),
    hasMediaIdx: index('messages_has_media_idx').on(table.hasMedia),
    originalEventIdx: index('messages_original_event_idx').on(table.originalEventId),
  }),
);

// ============================================================================
// OMNI EVENTS (Event Sourcing)
// ============================================================================

/**
 * Event record - captures all message and system events.
 * Replaces v1's message_traces with full event sourcing.
 *
 * @see v1: message_traces (enhanced to full events)
 */
export const omniEvents = pgTable(
  'omni_events',
  {
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
  },
  (table) => ({
    externalIdIdx: index('omni_events_external_id_idx').on(table.externalId),
    channelIdx: index('omni_events_channel_idx').on(table.channel),
    instanceIdx: index('omni_events_instance_idx').on(table.instanceId),
    personIdx: index('omni_events_person_idx').on(table.personId),
    eventTypeIdx: index('omni_events_type_idx').on(table.eventType),
    statusIdx: index('omni_events_status_idx').on(table.status),
    receivedAtIdx: index('omni_events_received_at_idx').on(table.receivedAt),
    chatIdIdx: index('omni_events_chat_id_idx').on(table.chatId),
    canonicalChatIdx: index('omni_events_canonical_chat_idx').on(table.canonicalChatId),
  }),
);

// ============================================================================
// ACCESS RULES
// ============================================================================

/**
 * Access control rules for allow/deny lists.
 *
 * @see v1: omni_access_rules table
 */
export const accessRules = pgTable(
  'access_rules',
  {
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
  },
  (table) => ({
    instanceIdx: index('access_rules_instance_idx').on(table.instanceId),
    phoneIdx: index('access_rules_phone_idx').on(table.phonePattern),
    ruleTypeIdx: index('access_rules_type_idx').on(table.ruleType),
    uniqueRule: uniqueIndex('access_rules_unique_idx').on(table.instanceId, table.phonePattern, table.ruleType),
  }),
);

// ============================================================================
// GLOBAL SETTINGS
// ============================================================================

/**
 * Application-wide settings with typed values.
 *
 * @see v1: omni_global_settings table
 */
export const globalSettings = pgTable(
  'global_settings',
  {
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
  },
  (table) => ({
    keyIdx: uniqueIndex('global_settings_key_idx').on(table.key),
    categoryIdx: index('global_settings_category_idx').on(table.category),
  }),
);

/**
 * Setting change history for audit trail.
 *
 * @see v1: omni_setting_change_history table
 */
export const settingChangeHistory = pgTable(
  'setting_change_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    settingId: uuid('setting_id')
      .notNull()
      .references(() => globalSettings.id, { onDelete: 'cascade' }),
    oldValue: text('old_value'),
    newValue: text('new_value'),
    changedBy: varchar('changed_by', { length: 255 }),
    changedAt: timestamp('changed_at').notNull().defaultNow(),
    changeReason: text('change_reason'),
  },
  (table) => ({
    settingIdx: index('setting_change_history_setting_idx').on(table.settingId),
    changedAtIdx: index('setting_change_history_changed_at_idx').on(table.changedAt),
  }),
);

// ============================================================================
// BATCH JOBS
// ============================================================================

/**
 * Batch processing jobs (media reprocessing, imports, etc.).
 *
 * @see v1: batch_jobs (implicit in v1, explicit table in v2)
 */
export const batchJobs = pgTable(
  'batch_jobs',
  {
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
  },
  (table) => ({
    statusIdx: index('batch_jobs_status_idx').on(table.status),
    instanceIdx: index('batch_jobs_instance_idx').on(table.instanceId),
    createdAtIdx: index('batch_jobs_created_at_idx').on(table.createdAt),
  }),
);

// ============================================================================
// SYNC JOBS
// ============================================================================

export const syncJobTypes = ['profile', 'messages', 'contacts', 'groups', 'all'] as const;
export type SyncJobType = (typeof syncJobTypes)[number];

/**
 * Sync job configuration stored in JSONB.
 */
export interface SyncJobConfig {
  depth?: '7d' | '30d' | '90d' | '1y' | 'all';
  channelId?: string; // For Discord channel-specific sync
  downloadMedia?: boolean;
  /** Explicit since timestamp (ISO string) — takes precedence over depth */
  since?: string;
  /** Explicit until timestamp (ISO string) */
  until?: string;
}

/**
 * Sync job progress tracking.
 */
export interface SyncJobProgress {
  fetched: number;
  stored: number;
  duplicates: number;
  mediaDownloaded: number;
  totalEstimated?: number;
}

/**
 * Sync jobs track async sync operations.
 * Used for profile, message history, contacts, and groups sync.
 *
 * @see history-sync wish
 */
export const syncJobs = pgTable(
  'sync_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => instances.id, { onDelete: 'cascade' }),
    channel: varchar('channel', { length: 50 }).notNull().$type<ChannelType>(),

    // ---- Job Type ----
    type: varchar('type', { length: 50 }).notNull().$type<SyncJobType>(),
    status: varchar('status', { length: 20 }).notNull().default('pending').$type<JobStatus>(),

    // ---- Configuration ----
    config: jsonb('config').notNull().default('{}').$type<SyncJobConfig>(),

    // ---- Progress ----
    progress: jsonb('progress').notNull().default('{}').$type<SyncJobProgress>(),

    // ---- Error Handling ----
    errorMessage: text('error_message'),

    // ---- Timing ----
    createdAt: timestamp('created_at').notNull().defaultNow(),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
  },
  (table) => ({
    instanceIdx: index('sync_jobs_instance_idx').on(table.instanceId),
    statusIdx: index('sync_jobs_status_idx').on(table.status),
    typeIdx: index('sync_jobs_type_idx').on(table.type),
    createdAtIdx: index('sync_jobs_created_at_idx').on(table.createdAt),
  }),
);

export type SyncJob = typeof syncJobs.$inferSelect;
export type NewSyncJob = typeof syncJobs.$inferInsert;

// ============================================================================
// MEDIA CONTENT
// ============================================================================

/**
 * Processed media content (transcriptions, descriptions).
 */
export const mediaContent = pgTable(
  'media_content',
  {
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
  },
  (table) => ({
    eventIdx: index('media_content_event_idx').on(table.eventId),
    mediaIdx: index('media_content_media_idx').on(table.mediaId),
    batchJobIdx: index('media_content_batch_job_idx').on(table.batchJobId),
  }),
);

// ============================================================================
// CHAT ID MAPPINGS (WhatsApp-specific)
// ============================================================================

/**
 * Maps WhatsApp @lid format to canonical @s.whatsapp.net format.
 * Critical for unified conversations.
 */
export const chatIdMappings = pgTable(
  'chat_id_mappings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => instances.id, { onDelete: 'cascade' }),
    lidId: varchar('lid_id', { length: 255 }).notNull(), // @lid format
    phoneId: varchar('phone_id', { length: 255 }).notNull(), // @s.whatsapp.net format
    discoveredAt: timestamp('discovered_at').notNull().defaultNow(),
    discoveredFrom: varchar('discovered_from', { length: 50 }), // 'message_key' | 'sender_match' | 'manual'
  },
  (table) => ({
    instanceLidIdx: uniqueIndex('chat_id_mappings_instance_lid_idx').on(table.instanceId, table.lidId),
    instancePhoneIdx: index('chat_id_mappings_instance_phone_idx').on(table.instanceId, table.phoneId),
  }),
);

// ============================================================================
// PLUGIN STORAGE
// ============================================================================

/**
 * Key-value storage for plugin data (auth state, credentials, etc.).
 * Persists across API restarts.
 */
export const pluginStorage = pgTable(
  'plugin_storage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pluginId: varchar('plugin_id', { length: 100 }).notNull(),
    key: varchar('key', { length: 500 }).notNull(),
    value: text('value').notNull(), // JSON serialized
    expiresAt: timestamp('expires_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    pluginKeyIdx: uniqueIndex('plugin_storage_plugin_key_idx').on(table.pluginId, table.key),
    pluginIdx: index('plugin_storage_plugin_idx').on(table.pluginId),
    expiresAtIdx: index('plugin_storage_expires_at_idx').on(table.expiresAt),
  }),
);

export type PluginStorageRow = typeof pluginStorage.$inferSelect;
export type NewPluginStorageRow = typeof pluginStorage.$inferInsert;

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
  syncJobs: many(syncJobs),
  chatIdMappings: many(chatIdMappings),
  chats: many(chats),
}));

export const syncJobsRelations = relations(syncJobs, ({ one }) => ({
  instance: one(instances, {
    fields: [syncJobs.instanceId],
    references: [instances.id],
  }),
}));

export const personsRelations = relations(persons, ({ many }) => ({
  platformIdentities: many(platformIdentities),
  accessRules: many(accessRules),
  omniEvents: many(omniEvents),
  chatParticipants: many(chatParticipants),
  sentMessages: many(messages),
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
  chatParticipants: many(chatParticipants),
  sentMessages: many(messages),
}));

export const chatsRelations = relations(chats, ({ one, many }) => ({
  instance: one(instances, {
    fields: [chats.instanceId],
    references: [instances.id],
  }),
  parentChat: one(chats, {
    fields: [chats.parentChatId],
    references: [chats.id],
    relationName: 'parentChild',
  }),
  childChats: many(chats, {
    relationName: 'parentChild',
  }),
  participants: many(chatParticipants),
  messages: many(messages),
}));

export const chatParticipantsRelations = relations(chatParticipants, ({ one }) => ({
  chat: one(chats, {
    fields: [chatParticipants.chatId],
    references: [chats.id],
  }),
  person: one(persons, {
    fields: [chatParticipants.personId],
    references: [persons.id],
  }),
  platformIdentity: one(platformIdentities, {
    fields: [chatParticipants.platformIdentityId],
    references: [platformIdentities.id],
  }),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  chat: one(chats, {
    fields: [messages.chatId],
    references: [chats.id],
  }),
  senderPerson: one(persons, {
    fields: [messages.senderPersonId],
    references: [persons.id],
  }),
  senderPlatformIdentity: one(platformIdentities, {
    fields: [messages.senderPlatformIdentityId],
    references: [platformIdentities.id],
  }),
  replyToMessage: one(messages, {
    fields: [messages.replyToMessageId],
    references: [messages.id],
    relationName: 'replyTo',
  }),
  forwardedFromMessage: one(messages, {
    fields: [messages.forwardedFromMessageId],
    references: [messages.id],
    relationName: 'forwardedFrom',
  }),
  originalEvent: one(omniEvents, {
    fields: [messages.originalEventId],
    references: [omniEvents.id],
  }),
  latestEvent: one(omniEvents, {
    fields: [messages.latestEventId],
    references: [omniEvents.id],
  }),
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

export type Chat = typeof chats.$inferSelect;
export type NewChat = typeof chats.$inferInsert;

export type ChatParticipant = typeof chatParticipants.$inferSelect;
export type NewChatParticipant = typeof chatParticipants.$inferInsert;

export type OmniGroup = typeof omniGroups.$inferSelect;
export type NewOmniGroup = typeof omniGroups.$inferInsert;

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;

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

// ============================================================================
// DEAD LETTER EVENTS (Event Ops)
// ============================================================================

/**
 * Dead letter event storage.
 * Captures events that failed processing after max retries.
 * Supports auto-retry with backoff (1h → 6h → 24h).
 *
 * @see events-ops wish
 */
export const deadLetterStatuses = ['pending', 'retrying', 'resolved', 'abandoned'] as const;
export type DeadLetterStatus = (typeof deadLetterStatuses)[number];

export const deadLetterEvents = pgTable(
  'dead_letter_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: varchar('event_id', { length: 36 }).notNull(),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    subject: varchar('subject', { length: 255 }).notNull(),
    payload: jsonb('payload').notNull().$type<Record<string, unknown>>(),
    error: text('error').notNull(),
    stack: text('stack'),

    // Retry tracking
    autoRetryCount: integer('auto_retry_count').notNull().default(0),
    manualRetryCount: integer('manual_retry_count').notNull().default(0),
    nextAutoRetryAt: timestamp('next_auto_retry_at'), // null = no more auto-retries

    // Status tracking
    status: varchar('status', { length: 20 }).notNull().default('pending').$type<DeadLetterStatus>(),

    // Timestamps
    createdAt: timestamp('created_at').notNull().defaultNow(),
    lastRetryAt: timestamp('last_retry_at'),
    resolvedAt: timestamp('resolved_at'),
    resolvedBy: varchar('resolved_by', { length: 100 }), // manual resolution note
  },
  (table) => ({
    eventIdIdx: index('dead_letter_events_event_id_idx').on(table.eventId),
    eventTypeIdx: index('dead_letter_events_event_type_idx').on(table.eventType),
    statusIdx: index('dead_letter_events_status_idx').on(table.status),
    createdAtIdx: index('dead_letter_events_created_at_idx').on(table.createdAt),
    nextAutoRetryAtIdx: index('dead_letter_events_next_retry_idx').on(table.nextAutoRetryAt),
  }),
);

export type DeadLetterEvent = typeof deadLetterEvents.$inferSelect;
export type NewDeadLetterEvent = typeof deadLetterEvents.$inferInsert;

// ============================================================================
// PAYLOAD STORAGE (Event Ops)
// ============================================================================

/**
 * Payload storage configuration per event type.
 * Controls what payloads are stored and for how long.
 *
 * @see events-ops wish
 */
export const payloadStorageConfig = pgTable(
  'payload_storage_config',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventType: varchar('event_type', { length: 100 }).notNull().unique(),
    // '*' = default for all types

    storeWebhookRaw: boolean('store_webhook_raw').notNull().default(true),
    storeAgentRequest: boolean('store_agent_request').notNull().default(true),
    storeAgentResponse: boolean('store_agent_response').notNull().default(true),
    storeChannelSend: boolean('store_channel_send').notNull().default(true),
    storeError: boolean('store_error').notNull().default(true),

    retentionDays: integer('retention_days').notNull().default(14),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    eventTypeIdx: uniqueIndex('payload_storage_config_event_type_idx').on(table.eventType),
  }),
);

export type PayloadStorageConfig = typeof payloadStorageConfig.$inferSelect;
export type NewPayloadStorageConfig = typeof payloadStorageConfig.$inferInsert;

/**
 * Actual payload storage with compression.
 * Stores event payloads at different processing stages.
 *
 * @see events-ops wish
 */
export const payloadStages = ['webhook_raw', 'agent_request', 'agent_response', 'channel_send', 'error'] as const;
export type PayloadStage = (typeof payloadStages)[number];

export const eventPayloads = pgTable(
  'event_payloads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: varchar('event_id', { length: 36 }).notNull(),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    stage: varchar('stage', { length: 50 }).notNull().$type<PayloadStage>(),

    payloadCompressed: text('payload_compressed').notNull(),
    payloadSizeOriginal: integer('payload_size_original'),
    payloadSizeCompressed: integer('payload_size_compressed'),

    // Metadata
    timestamp: timestamp('timestamp').notNull().defaultNow(),
    containsMedia: boolean('contains_media').notNull().default(false),
    containsBase64: boolean('contains_base64').notNull().default(false),

    // Soft-delete for audit trail
    deletedAt: timestamp('deleted_at'),
    deletedBy: varchar('deleted_by', { length: 100 }),
    deleteReason: varchar('delete_reason', { length: 255 }),
  },
  (table) => ({
    eventIdIdx: index('event_payloads_event_id_idx').on(table.eventId),
    eventTypeIdx: index('event_payloads_event_type_idx').on(table.eventType),
    stageIdx: index('event_payloads_stage_idx').on(table.stage),
    timestampIdx: index('event_payloads_timestamp_idx').on(table.timestamp),
    deletedAtIdx: index('event_payloads_deleted_at_idx').on(table.deletedAt),
    eventStageIdx: index('event_payloads_event_stage_idx').on(table.eventId, table.stage),
  }),
);

export type EventPayload = typeof eventPayloads.$inferSelect;
export type NewEventPayload = typeof eventPayloads.$inferInsert;

// ============================================================================
// WEBHOOK SOURCES (Events Ext)
// ============================================================================

/**
 * Webhook source configurations.
 * External systems can trigger events in Omni via webhooks.
 *
 * @see events-ext wish
 */
export const webhookSources = pgTable(
  'webhook_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 100 }).notNull().unique(), // 'github', 'stripe', 'agno'
    description: text('description'),

    // Optional validation
    expectedHeaders: jsonb('expected_headers').$type<Record<string, boolean>>(), // { 'X-GitHub-Event': true }

    // State
    enabled: boolean('enabled').notNull().default(true),

    // Stats
    lastReceivedAt: timestamp('last_received_at'),
    totalReceived: integer('total_received').notNull().default(0),

    // Timestamps
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    nameIdx: uniqueIndex('webhook_sources_name_idx').on(table.name),
    enabledIdx: index('webhook_sources_enabled_idx').on(table.enabled),
  }),
);

export type WebhookSource = typeof webhookSources.$inferSelect;
export type NewWebhookSource = typeof webhookSources.$inferInsert;

// ============================================================================
// AUTOMATIONS (Events Ext)
// ============================================================================

/**
 * Condition operators for automation rules.
 */
export const conditionOperators = [
  'eq',
  'neq',
  'gt',
  'lt',
  'gte',
  'lte',
  'contains',
  'not_contains',
  'exists',
  'not_exists',
  'regex',
] as const;
export type ConditionOperator = (typeof conditionOperators)[number];

/**
 * Action types for automations.
 */
export const actionTypes = ['webhook', 'send_message', 'emit_event', 'log', 'call_agent'] as const;
export type ActionType = (typeof actionTypes)[number];

/**
 * Debounce modes for message grouping.
 */
export const automationDebounceModes = ['none', 'fixed', 'range', 'presence'] as const;
export type AutomationDebounceMode = (typeof automationDebounceModes)[number];

/**
 * Automation rule interface for trigger conditions.
 */
export interface AutomationCondition {
  field: string; // Dot notation: 'payload.from.isVIP'
  operator: ConditionOperator;
  value?: unknown; // Ignored for 'exists'/'not_exists'
}

/**
 * Webhook action configuration.
 */
export interface WebhookActionConfig {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  bodyTemplate?: string;
  waitForResponse?: boolean;
  timeoutMs?: number;
  responseAs?: string; // Store response as variable
}

/**
 * Send message action configuration.
 */
export interface SendMessageActionConfig {
  instanceId?: string; // Template: {{payload.instanceId}}
  to?: string; // Template: {{payload.from.id}}
  contentTemplate: string;
}

/**
 * Emit event action configuration.
 */
export interface EmitEventActionConfig {
  eventType: string;
  payloadTemplate?: Record<string, unknown>;
}

/**
 * Log action configuration.
 */
export interface LogActionConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
}

/**
 * Call agent action configuration.
 * Invokes an AI agent and returns the response for use in subsequent actions.
 * This is a composable building block - use send_message to actually send the response.
 */
export interface CallAgentActionConfig {
  /** Provider ID (template: {{instance.agentProviderId}}) */
  providerId?: string;
  /** Agent ID (required or template) */
  agentId: string;
  /** Agent type: agent, team, or workflow */
  agentType?: AgentType;
  /** Session strategy for agent memory */
  sessionStrategy?: AgentSessionStrategy;
  /** Prefix messages with sender name: [Name]: message */
  prefixSenderName?: boolean;
  /** Timeout in milliseconds */
  timeoutMs?: number;
  /** Store agent response as variable for chaining (e.g., "agentResponse") */
  responseAs?: string;
}

/**
 * Union type for action configurations.
 */
export type AutomationAction =
  | { type: 'webhook'; config: WebhookActionConfig }
  | { type: 'send_message'; config: SendMessageActionConfig }
  | { type: 'emit_event'; config: EmitEventActionConfig }
  | { type: 'log'; config: LogActionConfig }
  | { type: 'call_agent'; config: CallAgentActionConfig };

/**
 * Debounce configuration for message grouping.
 */
export type DebounceConfig =
  | { mode: 'none' }
  | { mode: 'fixed'; delayMs: number }
  | { mode: 'range'; minMs: number; maxMs: number }
  | { mode: 'presence'; baseDelayMs: number; maxWaitMs?: number; extendOnEvents: string[] };

/**
 * Automation rules - "When event X with conditions Y, execute actions Z."
 *
 * @see events-ext wish
 */
export const automations = pgTable(
  'automations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),

    // Trigger
    triggerEventType: varchar('trigger_event_type', { length: 255 }).notNull(),
    triggerConditions: jsonb('trigger_conditions').$type<AutomationCondition[]>(),
    conditionLogic: varchar('condition_logic', { length: 10 }).default('and').$type<'and' | 'or'>(),

    // Actions (executed sequentially)
    actions: jsonb('actions').notNull().$type<AutomationAction[]>(),

    // Debounce configuration
    debounce: jsonb('debounce').$type<DebounceConfig>(),

    // State
    enabled: boolean('enabled').notNull().default(true),
    priority: integer('priority').notNull().default(0), // Higher = runs first

    // Timestamps
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    nameIdx: index('automations_name_idx').on(table.name),
    triggerIdx: index('automations_trigger_idx').on(table.triggerEventType),
    enabledIdx: index('automations_enabled_idx').on(table.enabled),
    priorityIdx: index('automations_priority_idx').on(table.priority),
  }),
);

export type Automation = typeof automations.$inferSelect;
export type NewAutomation = typeof automations.$inferInsert;

/**
 * Automation execution status.
 */
export const automationLogStatuses = ['success', 'failed', 'skipped'] as const;
export type AutomationLogStatus = (typeof automationLogStatuses)[number];

/**
 * Action execution result.
 */
export interface ActionExecutionResult {
  action: ActionType;
  status: 'success' | 'failed';
  result?: unknown;
  error?: string;
  durationMs: number;
}

/**
 * Automation execution logs.
 * Tracks each automation run with detailed action results.
 *
 * @see events-ext wish
 */
export const automationLogs = pgTable(
  'automation_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    automationId: uuid('automation_id')
      .notNull()
      .references(() => automations.id, { onDelete: 'cascade' }),
    eventId: varchar('event_id', { length: 36 }).notNull(),

    // Execution status
    status: varchar('status', { length: 20 }).notNull().$type<AutomationLogStatus>(),
    conditionsMatched: boolean('conditions_matched').notNull(),

    // Action results
    actionsExecuted: jsonb('actions_executed').$type<ActionExecutionResult[]>(),
    error: text('error'),

    // Performance
    executionTimeMs: integer('execution_time_ms'),

    // Timestamps
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    automationIdx: index('automation_logs_automation_idx').on(table.automationId),
    eventIdIdx: index('automation_logs_event_id_idx').on(table.eventId),
    statusIdx: index('automation_logs_status_idx').on(table.status),
    createdAtIdx: index('automation_logs_created_at_idx').on(table.createdAt),
  }),
);

export type AutomationLog = typeof automationLogs.$inferSelect;
export type NewAutomationLog = typeof automationLogs.$inferInsert;

// ============================================================================
// CONSUMER OFFSETS (NATS sequence tracking)
// ============================================================================

/**
 * Tracks the last processed NATS sequence per durable consumer.
 * Enables gap detection on startup and consumer lag monitoring.
 */
export const consumerOffsets = pgTable('consumer_offsets', {
  consumerName: varchar('consumer_name', { length: 100 }).primaryKey(),
  streamName: varchar('stream_name', { length: 50 }).notNull(),
  lastSequence: integer('last_sequence').notNull().default(0),
  lastEventId: uuid('last_event_id'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export type ConsumerOffset = typeof consumerOffsets.$inferSelect;
export type NewConsumerOffset = typeof consumerOffsets.$inferInsert;

// Relations for webhook sources and automations
export const automationsRelations = relations(automations, ({ many }) => ({
  logs: many(automationLogs),
}));

export const automationLogsRelations = relations(automationLogs, ({ one }) => ({
  automation: one(automations, {
    fields: [automationLogs.automationId],
    references: [automations.id],
  }),
}));

// ============================================================================
// TRIGGER LOGS (agent dispatch observability)
// ============================================================================

/**
 * Trigger logs track every agent dispatch for observability and cost tracking.
 * Each time the agent-dispatcher triggers an agent provider, a log entry is created.
 */
export const triggerLogs = pgTable(
  'trigger_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** End-to-end trace ID linking incoming event → dispatch → response */
    traceId: varchar('trace_id', { length: 255 }),
    /** Instance that triggered the agent */
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => instances.id, { onDelete: 'cascade' }),
    /** Provider that handled the trigger */
    providerId: uuid('provider_id').references(() => agentProviders.id, { onDelete: 'set null' }),
    /** Event type that triggered dispatch (e.g., message.received, reaction.received) */
    eventType: varchar('event_type', { length: 100 }).notNull(),
    /** Original event ID */
    eventId: varchar('event_id', { length: 255 }).notNull(),
    /** Classification of what triggered the agent */
    triggerType: varchar('trigger_type', { length: 50 }).notNull(), // mention, reaction, dm, reply, name_match, command
    /** Channel type */
    channelType: varchar('channel_type', { length: 50 }),
    /** Chat where trigger occurred */
    chatId: varchar('chat_id', { length: 255 }).notNull(),
    /** User who triggered the agent */
    senderId: varchar('sender_id', { length: 255 }),
    /** Provider mode: round-trip or fire-and-forget */
    mode: varchar('mode', { length: 20 }),
    /** When the trigger was dispatched */
    firedAt: timestamp('fired_at', { withTimezone: true }).notNull().defaultNow(),
    /** When the response was received (null for fire-and-forget) */
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    /** Whether a response was received */
    responded: boolean('responded').notNull().default(false),
    /** Total dispatch duration in milliseconds */
    durationMs: integer('duration_ms'),
    /** Input tokens used (if available from provider) */
    inputTokens: integer('input_tokens'),
    /** Output tokens used (if available from provider) */
    outputTokens: integer('output_tokens'),
    /** Error message if dispatch failed */
    error: text('error'),
    /** Additional metadata */
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    instanceIdx: index('trigger_logs_instance_idx').on(table.instanceId),
    traceIdx: index('trigger_logs_trace_idx').on(table.traceId),
    firedAtIdx: index('trigger_logs_fired_at_idx').on(table.firedAt),
    eventTypeIdx: index('trigger_logs_event_type_idx').on(table.eventType),
  }),
);

export type TriggerLog = typeof triggerLogs.$inferSelect;
export type NewTriggerLog = typeof triggerLogs.$inferInsert;

export const triggerLogsRelations = relations(triggerLogs, ({ one }) => ({
  instance: one(instances, {
    fields: [triggerLogs.instanceId],
    references: [instances.id],
  }),
  provider: one(agentProviders, {
    fields: [triggerLogs.providerId],
    references: [agentProviders.id],
  }),
}));
