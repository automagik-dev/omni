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

import type { ProviderSchema as CoreProviderSchema, FollowUpSequenceConfig } from '@omni/core';
import { CORE_EVENT_TYPES, type CoreEventType, type SyncJobConfig as CoreSyncJobConfig } from '@omni/core/events';
import { CONTENT_TYPES, type ContentType as CoreContentType } from '@omni/core/types';
import { relations, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// ============================================================================
// ENUMS
// ============================================================================

export const channelTypes = [
  'whatsapp-baileys',
  'whatsapp-business',
  'discord',
  'slack',
  'telegram',
  'a2a',
  'gupshup',
  'hermes',
  'twilio-whatsapp',
  'internal',
] as const;
export type ChannelType = (typeof channelTypes)[number];

export const agentTypes = ['agent', 'team', 'workflow'] as const;
export type AgentType = (typeof agentTypes)[number];

// What AI system powers the agent — distinct from AgentProvider (the table type)
export const agentSystems = ['claude', 'agno', 'openai', 'gemini', 'custom', 'omni-internal'] as const;
export type AgentSystem = (typeof agentSystems)[number];

// Role of the agent entity — distinct from existing agentTypes used on Instance/AgentRoute
export const agentEntityTypes = ['assistant', 'workflow', 'team', 'tool'] as const;
export type AgentEntityType = (typeof agentEntityTypes)[number];

export const debounceMode = ['disabled', 'fixed', 'randomized', 'presence'] as const;
export type DebounceMode = (typeof debounceMode)[number];

export const splitDelayMode = ['disabled', 'fixed', 'randomized'] as const;
export type SplitDelayMode = (typeof splitDelayMode)[number];

// Policy for agent replies whose input snapshot is stale (newer inbound arrived
// while the agent was running): 'off' delivers them (legacy behavior), 'discard'
// drops them so the debouncer re-flush answers with full context.
export const supersedeMode = ['off', 'discard'] as const;
export type SupersedeMode = (typeof supersedeMode)[number];

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
 * - per_user: Same session across all chats for this user (user continuity)
 * - per_chat: All users in a chat share the session (group memory)
 * - per_thread: Isolated session per thread/topic (lazy init, collaborative)
 */
export const agentSessionStrategies = ['per_user', 'per_chat', 'per_thread'] as const;
export type AgentSessionStrategy = (typeof agentSessionStrategies)[number];

export const ruleTypes = ['allow', 'deny', 'pending_pairing'] as const;
export type RuleType = (typeof ruleTypes)[number];

export const accessModes = ['disabled', 'blocklist', 'allowlist'] as const;
export type AccessMode = (typeof accessModes)[number];

export const settingValueTypes = ['string', 'integer', 'boolean', 'json', 'secret'] as const;
export type SettingValueType = (typeof settingValueTypes)[number];

export const apiKeyStatuses = ['active', 'revoked', 'expired'] as const;
export type ApiKeyStatus = (typeof apiKeyStatuses)[number];

// Profile templates that compose verb buckets + enforcement locks for API keys.
// `null` keeps pre-profile keys working with legacy empty-allowlist-as-no-lock semantics.
// The `console-*` profiles are lock-free platform-wide admin-console keys minted
// per user by the admin UI's BFF (see packages/api/src/constants/profiles.ts).
// The column is varchar(32), not a pg enum — widening this union needs no migration.
export const apiKeyProfiles = [
  'cs',
  'personal',
  'scout',
  'coworker',
  'admin',
  'console-viewer',
  'console-operator',
  'console-admin',
] as const;
export type ApiKeyProfile = (typeof apiKeyProfiles)[number];

// Tenant-editable overrides applied on top of a profile's bucket resolution.
// `add` / `remove` take verb names; `denylistPresetKey` swaps the outbound redactor
// preset; `denylistExtras` appends tenant-specific literal patterns on top of the
// resolved preset (no preset change required — the extras merge with the preset list).
export type ApiKeyProfileOverrides = {
  add?: string[];
  remove?: string[];
  denylistPresetKey?: string;
  denylistExtras?: string[];
};

export const eventTypes = CORE_EVENT_TYPES;
export type EventType = CoreEventType;

// Derived from core CONTENT_TYPES (same no-drift rule as eventTypes above) —
// this local tuple had fallen behind by ten content types.
export const contentTypes = CONTENT_TYPES;
export type ContentType = CoreContentType;

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
  'reaction', // Emoji reactions to messages
  'system', // System messages (join, leave, etc.)
] as const;
export type MessageType = (typeof messageTypes)[number];

export const messageStatuses = ['active', 'edited', 'deleted', 'expired'] as const;
export type MessageStatus = (typeof messageStatuses)[number];

export const deliveryStatuses = ['pending', 'sent', 'delivered', 'read', 'failed'] as const;
export type DeliveryStatus = (typeof deliveryStatuses)[number];

/**
 * Who holds the timer for a scheduled message (#889).
 * 'platform' = the channel schedules natively (Slack chat.scheduleMessage) and
 * delivery survives omni downtime. 'local' = omni sends it at send_at.
 */
export const scheduledMessageDeliveryModes = ['platform', 'local'] as const;
export type ScheduledMessageDeliveryMode = (typeof scheduledMessageDeliveryModes)[number];

export const scheduledMessageStatuses = ['pending', 'sent', 'canceled', 'failed'] as const;
export type ScheduledMessageStatus = (typeof scheduledMessageStatuses)[number];

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
  /** Idle-chat follow-up config at the chat scope (closest). @see issue #404 */
  followUpConfig?: FollowUpSequenceConfig | null;
  [key: string]: unknown;
}

export const jobStatuses = ['pending', 'running', 'completed', 'failed', 'cancelled'] as const;
export type JobStatus = (typeof jobStatuses)[number];

// ============================================================================
// AGENT PROVIDERS
// ============================================================================

export const providerSchemas = [
  'agno',
  'webhook',
  'openclaw',
  'ag-ui',
  'claude-code',
  'a2a',
  'nats-genie',
] as const satisfies readonly CoreProviderSchema[];
export type ProviderSchema = (typeof providerSchemas)[number];

/**
 * Reusable agent provider configurations.
 * Supports multiple API schemas: Agno, Webhook, OpenClaw, AG-UI, Claude Code.
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
    schema: varchar('schema', { length: 20 }).notNull().default('agno').$type<ProviderSchema>(),

    // Connection settings
    baseUrl: text('base_url').notNull(),
    apiKey: text('api_key'),

    // Schema-specific configuration (JSON)
    // For Agno: { agentId, teamId, timeout }
    // For OpenClaw: { defaultAgentId, agentTimeoutMs, origin }
    schemaConfig: jsonb('schema_config').$type<Record<string, unknown>>(),

    // Default settings
    defaultStream: boolean('default_stream').notNull().default(true),
    defaultTimeout: integer('default_timeout').notNull().default(600),

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
    lastHealthCheck: timestamp('last_health_check', { withTimezone: true }),
    lastHealthStatus: varchar('last_health_status', { length: 20 }), // 'healthy' | 'unhealthy' | 'error'
    lastHealthError: text('last_health_error'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    nameIdx: index('agent_providers_name_idx').on(table.name),
    schemaIdx: index('agent_providers_schema_idx').on(table.schema),
    activeIdx: index('agent_providers_active_idx').on(table.isActive),
  }),
);

// ============================================================================
// AGENTS
// ============================================================================

/**
 * First-class agent entities with persistent identity.
 * An agent is the AI actor that replies to messages. Previously agents existed
 * only as loose config fields on instances and agent_routes; this table gives
 * them a proper row in the database for observability and FK references.
 */
export const agents = pgTable(
  'agents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    provider: varchar('provider', { length: 50 }).notNull().$type<AgentSystem>(),
    model: varchar('model', { length: 120 }),
    agentType: varchar('agent_type', { length: 20 }).notNull().default('assistant').$type<AgentEntityType>(),
    capabilities: text('capabilities').array().notNull().default([]),
    ownerId: uuid('owner_id').references(() => persons.id, { onDelete: 'set null' }),
    agentProviderId: uuid('agent_provider_id').references(() => agentProviders.id, { onDelete: 'set null' }),
    configPath: text('config_path'),
    isInternal: boolean('is_internal').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    agentCard: jsonb('agent_card').$type<Record<string, unknown>>(),
    /** Idle-chat follow-up config at the agent scope (broadest). @see issue #404 */
    followUpConfig: jsonb('follow_up_config').$type<FollowUpSequenceConfig>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** G2 additive tenant ownership. Nullable through the additive phase. */
    tenantId: uuid('tenant_id').references((): AnyPgColumn => tenants.id, { onDelete: 'restrict' }),
  },
  (table) => ({
    tenantIdx: index('agents_tenant_idx').on(table.tenantId),
    tenantIdUq: uniqueIndex('agents_tenant_id_uq').on(table.tenantId, table.id),
    nameIdx: index('agents_name_idx').on(table.name),
    ownerIdx: index('agents_owner_idx').on(table.ownerId),
    providerIdx: index('agents_provider_idx').on(table.provider),
    activeIdx: index('agents_active_idx').on(table.isActive),
  }),
);

export type Agent = typeof agents.$inferSelect;
/**
 * Tenant ownership is NOT caller-settable. `tenant_id` is derived by the database
 * BEFORE INSERT triggers introduced in migration 0041, never accepted from a
 * caller, so it is omitted from every widened insert type below. The single
 * ownership-root path (`instances`) is stamped through `tenancy-dual-write.ts`.
 */
export type NewAgent = Omit<typeof agents.$inferInsert, 'tenantId'>;

// ============================================================================
// AGENT ROUTES
// ============================================================================

/**
 * Agent routing configuration - bind specific agents to chats or users.
 * Resolution order: chat route > user route > instance default
 *
 * @see agent-routing wish
 */
export const agentRoutes = pgTable(
  'agent_routes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => instances.id, { onDelete: 'cascade' }),

    // ---- Scope: what does this route match? ----
    scope: varchar('scope', { length: 20 }).notNull(), // 'chat' | 'user'
    chatId: uuid('chat_id').references(() => chats.id, { onDelete: 'cascade' }),
    personId: uuid('person_id').references(() => persons.id, { onDelete: 'cascade' }),

    // ---- Target: which agent handles it? ----
    /** FK to agents table (replaces legacy agentProviderId + agentId varchar + agentType). */
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),

    // ---- Behavior overrides (NULL = inherit from instance) ----
    agentTimeout: integer('agent_timeout'),
    agentStreamMode: boolean('agent_stream_mode'),
    agentReplyFilter: jsonb('agent_reply_filter').$type<AgentReplyFilter>(),
    agentSessionStrategy: varchar('agent_session_strategy', { length: 20 }).$type<AgentSessionStrategy>(),
    agentPrefixSenderName: boolean('agent_prefix_sender_name'),
    agentWaitForMedia: boolean('agent_wait_for_media'),
    agentSendMediaPath: boolean('agent_send_media_path'),
    agentSendMediaPathTypes: text('agent_send_media_path_types').array(),
    agentGateEnabled: boolean('agent_gate_enabled'),
    agentGateModel: varchar('agent_gate_model', { length: 120 }),
    agentGatePrompt: text('agent_gate_prompt'),

    // ---- Debounce overrides (NULL = inherit from instance) ----
    messageDebounceMode: varchar('message_debounce_mode', { length: 20 }).$type<DebounceMode>(),
    messageDebounceMinMs: integer('message_debounce_min_ms'),
    messageDebounceMaxMs: integer('message_debounce_max_ms'),
    messageDebounceGroupMs: integer('message_debounce_group_ms'),
    messageDebounceRestartOnTyping: boolean('message_debounce_restart_on_typing'),
    /** Hard cap (ms) for 'presence' mode — flush at firstBuffered + this even under continuous typing. NULL = no cap. */
    messageDebounceMaxWaitMs: integer('message_debounce_max_wait_ms'),

    // ---- Split delay overrides (NULL = inherit from instance) ----
    messageSplitDelayMode: varchar('message_split_delay_mode', { length: 20 }).$type<SplitDelayMode>(),
    messageSplitDelayFixedMs: integer('message_split_delay_fixed_ms'),
    messageSplitDelayMinMs: integer('message_split_delay_min_ms'),
    messageSplitDelayMaxMs: integer('message_split_delay_max_ms'),
    enableAutoSplit: boolean('enable_auto_split'),

    // ---- Ack overrides (NULL = inherit from instance) ----
    reactionAck: varchar('reaction_ack', { length: 10 }).$type<'off' | 'on'>(),
    reactionAckEmoji: jsonb('reaction_ack_emoji').$type<Record<string, string>>(),
    ackTimeoutMs: integer('ack_timeout_ms'),
    agentAckMessage: text('agent_ack_message'),

    // ---- Metadata ----
    label: varchar('label', { length: 255 }),
    priority: integer('priority').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),

    // ---- Timestamps ----
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** G2 additive tenant ownership. Nullable through the additive phase. */
    tenantId: uuid('tenant_id').references((): AnyPgColumn => tenants.id, { onDelete: 'restrict' }),
  },
  (table) => ({
    tenantIdx: index('agent_routes_tenant_idx').on(table.tenantId),
    tenantIdUq: uniqueIndex('agent_routes_tenant_id_uq').on(table.tenantId, table.id),
    tenantChatRouteUq: uniqueIndex('agent_routes_tenant_chat_route_uq')
      .on(table.tenantId, table.instanceId, table.chatId)
      .where(sql`${table.tenantId} IS NOT NULL`),
    tenantUserRouteUq: uniqueIndex('agent_routes_tenant_user_route_uq')
      .on(table.tenantId, table.instanceId, table.personId)
      .where(sql`${table.tenantId} IS NOT NULL`),
    // Constraints
    scopeCheck: check(
      'scope_check',
      sql`(scope = 'chat' AND chat_id IS NOT NULL AND person_id IS NULL) OR (scope = 'user' AND person_id IS NOT NULL AND chat_id IS NULL)`,
    ),
    uniqueChatRoute: uniqueIndex('agent_routes_unique_chat_route').on(table.instanceId, table.chatId),
    uniqueUserRoute: uniqueIndex('agent_routes_unique_user_route').on(table.instanceId, table.personId),

    // Indexes for performance
    instanceIdx: index('agent_routes_instance_idx').on(table.instanceId),
    chatIdx: index('agent_routes_chat_idx').on(table.chatId),
    personIdx: index('agent_routes_person_idx').on(table.personId),
    activeIdx: index('agent_routes_active_idx').on(table.instanceId, table.isActive),
    agentIdIdx: index('agent_routes_agent_id_idx').on(table.agentId),
  }),
);

// ============================================================================
// AGENT SESSIONS
// ============================================================================

/**
 * Persistent agent session storage for continuity across restarts.
 * Maps internal session keys to provider-specific session identifiers.
 *
 * Session keys are computed based on agentSessionStrategy:
 * - per_user: userId (e.g., "person-uuid")
 * - per_chat: chatId (e.g., "120363404569770073@g.us")
 *
 * Provider session data is JSON, format depends on provider:
 * - Claude Code: { uuid: "session-uuid" }
 * - Agno: { sessionId: "agno-session-id" }
 * - Custom: any JSON object
 */
export const agentSessions = pgTable(
  'agent_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Instance reference
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => instances.id, { onDelete: 'cascade' }),

    // Session key computed from strategy (userId or chatId)
    sessionKey: varchar('session_key', { length: 512 }).notNull(),

    // Provider-specific session data (JSON)
    providerSessionData: jsonb('provider_session_data').notNull().$type<Record<string, unknown>>(),

    // TTL management
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }), // null = never expires

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** G2 additive tenant ownership. Nullable through the additive phase. */
    tenantId: uuid('tenant_id').references((): AnyPgColumn => tenants.id, { onDelete: 'restrict' }),
  },
  (table) => ({
    tenantIdx: index('agent_sessions_tenant_idx').on(table.tenantId),
    tenantInstanceKeyUq: uniqueIndex('agent_sessions_tenant_instance_key_uq')
      .on(table.tenantId, table.instanceId, table.sessionKey)
      .where(sql`${table.tenantId} IS NOT NULL`),
    // Unique constraint: one session per instance+key
    uniqueSession: uniqueIndex('agent_sessions_instance_key_idx').on(table.instanceId, table.sessionKey),

    // Index for TTL cleanup
    expiresIdx: index('agent_sessions_expires_idx').on(table.expiresAt),
    lastUsedIdx: index('agent_sessions_last_used_idx').on(table.lastUsedAt),
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

    // Profile template used at key-creation time to resolve `scopes` and enforcement
    // locks. `null` for legacy / pre-profile keys — they keep their hand-authored scopes
    // and treat the allowlist columns as "no lock" instead of "deny all".
    profile: varchar('profile', { length: 32 }).$type<ApiKeyProfile>(),

    // Tenant-level overrides that add/remove verbs or swap the denylist preset on top
    // of the profile's bucket resolution. Empty `{}` means "profile defaults".
    profileOverrides: jsonb('profile_overrides').$type<ApiKeyProfileOverrides>().notNull().default(sql`'{}'::jsonb`),

    // Enforcement locks consumed by the scope-enforcer middleware.
    // Empty `[]` semantics depend on `profile`: NULL profile = "no lock" (backward
    // compat); profile that declares `requiresLocks` = "deny all".
    chatAllowlist: text('chat_allowlist').array().notNull().default(sql`ARRAY[]::text[]`),
    instanceAllowlist: uuid('instance_allowlist').array().notNull().default(sql`ARRAY[]::uuid[]`),
    outboundRecipientAllowlist: text('outbound_recipient_allowlist').array().notNull().default(sql`ARRAY[]::text[]`),

    // Instance restrictions (null = all instances)
    instanceIds: uuid('instance_ids').array(),

    // Status
    status: varchar('status', { length: 20 }).notNull().default('active').$type<ApiKeyStatus>(),

    // Rate limiting (requests per minute, null = default)
    rateLimit: integer('rate_limit'),

    // Expiration (null = never expires)
    expiresAt: timestamp('expires_at', { withTimezone: true }),

    // Audit
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    lastUsedIp: varchar('last_used_ip', { length: 45 }), // IPv6 max length
    usageCount: integer('usage_count').notNull().default(0),

    // Revocation
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: varchar('revoked_by', { length: 255 }),
    revokeReason: text('revoke_reason'),

    // Conversation context (for turn-based agents and CLI)
    activeInstanceId: uuid('active_instance_id'),
    contextInstanceId: uuid('context_instance_id'),
    contextChatId: uuid('context_chat_id'),
    contextMessageId: uuid('context_message_id'),
    contextUpdatedAt: timestamp('context_updated_at', { withTimezone: true }),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: varchar('created_by', { length: 255 }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
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
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
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
    /** Per-guild configuration overrides: Record<guildId, GuildConfigOverride> */
    guildConfigOverrides: jsonb('guild_config_overrides').$type<Record<string, unknown>>(),
    /** Persisted bot presence: survives reconnects by being passed as options.presence on connect */
    discordPresence: jsonb('discord_presence').$type<{
      status?: 'online' | 'dnd' | 'idle' | 'invisible';
      activityText?: string;
      activityType?: 'Playing' | 'Streaming' | 'Listening' | 'Watching' | 'Custom' | 'Competing';
    }>(),

    // ---- Slack Configuration ----
    slackBotToken: text('slack_bot_token'),
    /**
     * User OAuth token (xoxp) for authMode 'user' (#889). Sealed like the
     * other credential columns. Bound to a PERSON: it dies with their account.
     */
    slackUserToken: text('slack_user_token'),
    /** 'bot' (default) or 'user' — identity outbound actions are taken as. */
    slackAuthMode: varchar('slack_auth_mode', { length: 10 }),
    slackAppToken: text('slack_app_token'),
    slackSigningSecret: text('slack_signing_secret'),

    // ---- Telegram Configuration ----
    telegramBotToken: text('telegram_bot_token'),
    /** Telegram reaction level: off (default), ack, minimal, extensive */
    telegramReactionLevel: varchar('telegram_reaction_level', { length: 20 }).notNull().default('off'),

    // ---- Gupshup Configuration ----
    gupshupCallbackUrl: text('gupshup_callback_url'),
    gupshupAuthToken: text('gupshup_auth_token'),
    gupshupEventId: varchar('gupshup_event_id', { length: 255 }),
    webhookVerifyToken: text('webhook_verify_token'),

    // ---- Twilio WhatsApp Configuration ----
    twilioAccountSid: varchar('twilio_account_sid', { length: 34 }),
    twilioAuthToken: text('twilio_auth_token'),
    twilioFrom: varchar('twilio_from', { length: 64 }),
    twilioMessagingServiceSid: varchar('twilio_messaging_service_sid', { length: 34 }),
    twilioStatusCallbackUrl: text('twilio_status_callback_url'),
    twilioWebhookUrl: text('twilio_webhook_url'),
    twilioValidateSignature: boolean('twilio_validate_signature').notNull().default(true),

    // ---- WhatsApp Cloud (Meta Cloud API) Configuration ----
    // Per-instance values for the official Meta WhatsApp Cloud channel.
    // Global app-level config (META_APP_SECRET, META_VERIFY_TOKEN, etc.) lives in env.
    // metaAccessToken is stored plain text for parity with other channel tokens
    // (discord_bot_token, telegram_bot_token, gupshup_auth_token). Encryption at-rest
    // is tracked as cross-channel tech debt.
    metaPhoneNumberId: varchar('meta_phone_number_id', { length: 64 }),
    metaWabaId: varchar('meta_waba_id', { length: 64 }),
    metaAccessToken: text('meta_access_token'),
    metaAppId: varchar('meta_app_id', { length: 64 }),
    metaBusinessId: varchar('meta_business_id', { length: 64 }),
    /** Snapshot of Graph API version used at provisioning. Runtime uses META_GRAPH_API_VERSION env. */
    metaApiVersion: varchar('meta_api_version', { length: 16 }).notNull().default('v25.0'),
    /** 'manual' | 'embedded_signup' — provenance of the connection */
    metaConnectionMethod: varchar('meta_connection_method', { length: 32 }).default('manual'),
    metaDisplayPhoneNumber: varchar('meta_display_phone_number', { length: 32 }),
    metaConnectedAt: timestamp('meta_connected_at', { withTimezone: true }),

    // ---- Hermes (Mutant WhatsApp gateway) Configuration ----
    // Per-instance credentials for the H3rmes API (Brazilian BSP-style gateway).
    // hermesPassword is stored plain text for parity with the other channel
    // credentials above — same cross-channel encryption-at-rest tech debt.
    /** Customer-specific API base URL (each Hermes tenant gets its own host). */
    hermesBaseUrl: text('hermes_base_url'),
    hermesUsername: varchar('hermes_username', { length: 255 }),
    hermesPassword: text('hermes_password'),
    /** Hermes UUID of the WhatsApp LINE ("media_id" in their API) — webhook resolution key. */
    hermesMediaId: varchar('hermes_media_id', { length: 64 }),
    /** Meta template namespace required by Hermes template sends. */
    hermesTemplateNamespace: varchar('hermes_template_namespace', { length: 128 }),

    // ---- Agent Reference ----
    /** FK to agents table (phase 3: replaces legacy agentProviderId + agentId varchar). */
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),

    // ---- Agent Configuration (Instance Override) ----
    agentTimeout: integer('agent_timeout').notNull().default(600),
    agentStreamMode: boolean('agent_stream_mode').notNull().default(false),
    /** Customer-facing replies when agent dispatch fails; one is picked at random per failure (null/empty = OMNI_AGENT_DISPATCH_ERROR_MESSAGE env / built-in default, #737) */
    agentErrorMessages: jsonb('agent_error_messages').$type<string[]>(),
    /** When agent should reply to messages */
    agentReplyFilter: jsonb('agent_reply_filter').$type<AgentReplyFilter>(),
    /** Session strategy for agent memory */
    agentSessionStrategy: varchar('agent_session_strategy', { length: 20 })
      .notNull()
      .default('per_chat')
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
    /**
     * Drop inbound `message.received` events when the platform-native timestamp
     * (e.g. WhatsApp `messageTimestamp`) is older than this many minutes.
     * Guards the agent dispatcher against history-sync replays and NATS
     * redelivery of stale messages after reconnect/restart. Default: 10.
     */
    inboundMaxAgeMinutes: integer('inbound_max_age_minutes').notNull().default(10),

    // ---- Profile Information (populated from channel) ----
    profileName: varchar('profile_name', { length: 255 }),
    profilePicUrl: text('profile_pic_url'),
    profileBio: text('profile_bio'),
    profileMetadata: jsonb('profile_metadata').$type<Record<string, unknown>>(), // Platform-specific: phone, isBusiness, etc.
    profileSyncedAt: timestamp('profile_synced_at', { withTimezone: true }),
    ownerIdentifier: varchar('owner_identifier', { length: 255 }), // JID for WhatsApp, user ID for Discord, etc.

    // ---- Sync Settings ----
    downloadMediaOnSync: boolean('download_media_on_sync').notNull().default(false),

    // ---- Instance Status ----
    isDefault: boolean('is_default').notNull().default(false),
    isActive: boolean('is_active').notNull().default(false),

    // ---- Message Processing Config ----
    enableAutoSplit: boolean('enable_auto_split').notNull().default(true),
    /** Format conversion mode: 'convert' = markdown→native per channel, 'passthrough' = raw text */
    messageFormatMode: varchar('message_format_mode', { length: 20 })
      .notNull()
      .default('convert')
      .$type<'convert' | 'passthrough'>(),
    disableUsernamePrefix: boolean('disable_username_prefix').notNull().default(false),
    processMediaOnBlocked: boolean('process_media_on_blocked').notNull().default(true),
    accessMode: varchar('access_mode', { length: 20 }).notNull().default('blocklist').$type<AccessMode>(),

    // ---- Message Debounce ----
    messageDebounceMode: varchar('message_debounce_mode', { length: 20 })
      .notNull()
      .default('disabled')
      .$type<DebounceMode>(),
    messageDebounceMinMs: integer('message_debounce_min_ms').notNull().default(0),
    /** Optional debounce override for group chats (WhatsApp: @g.us). Null = use messageDebounceMinMs */
    messageDebounceGroupMs: integer('message_debounce_group_ms'),
    messageDebounceMaxMs: integer('message_debounce_max_ms').notNull().default(0),
    /** Restart debounce timer when user is typing (requires channel support) */
    messageDebounceRestartOnTyping: boolean('message_debounce_restart_on_typing').notNull().default(false),
    /** Hard cap (ms) for 'presence' mode — flush at firstBuffered + this even under continuous typing. NULL = no cap. */
    messageDebounceMaxWaitMs: integer('message_debounce_max_wait_ms'),
    /**
     * Stale-reply policy: what to do when newer inbound arrived while the agent
     * was still processing the previous batch. 'off' delivers the (stale) reply
     * as before; 'discard' drops it — the debouncer's re-flush then dispatches
     * the buffered messages and produces one reply with full context.
     */
    messageSupersedeMode: varchar('message_supersede_mode', { length: 20 })
      .notNull()
      .default('off')
      .$type<SupersedeMode>(),

    // ---- Smart Response Gate ----
    agentGateEnabled: boolean('agent_gate_enabled').notNull().default(false),
    agentGateModel: varchar('agent_gate_model', { length: 120 }),
    agentGatePrompt: text('agent_gate_prompt'),

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

    // ---- Reaction Acknowledgment ----
    /** Toggle reaction ack: 'off' (default) | 'on' */
    reactionAck: varchar('reaction_ack', { length: 10 }).notNull().default('off').$type<'off' | 'on'>(),
    /** Per-channel emoji overrides for ack reactions */
    reactionAckEmoji: jsonb('reaction_ack_emoji').$type<Record<string, string>>(),
    /** Timeout in ms before ack is auto-removed (hard cap 30s) */
    ackTimeoutMs: integer('ack_timeout_ms').notNull().default(30000),
    /** Auto-reply text sent before agent dispatch (null = disabled) */
    agentAckMessage: text('agent_ack_message'),

    // ---- Session Reset ----
    /** Session reset strategies: per chat-type configuration */
    sessionReset: jsonb('session_reset').$type<{
      default?: { mode: 'none' } | { mode: 'daily'; hour?: number } | { mode: 'idle'; minutes?: number };
      dm?: { mode: 'none' } | { mode: 'daily'; hour?: number } | { mode: 'idle'; minutes?: number };
      group?: { mode: 'none' } | { mode: 'daily'; hour?: number } | { mode: 'idle'; minutes?: number };
      thread?: { mode: 'none' } | { mode: 'daily'; hour?: number } | { mode: 'idle'; minutes?: number };
    }>(),

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
    /** Content types that receive the file path (e.g. image, video, document). Null = default (all except audio) */
    agentSendMediaPathTypes: text('agent_send_media_path_types').array(),

    // ---- WhatsApp Read Receipts ----
    /** Per-instance read receipt mode: 'on' (default), 'off', or 'exclude-self' */
    readReceipts: varchar('read_receipts', { length: 20 })
      .notNull()
      .default('on')
      .$type<'on' | 'off' | 'exclude-self'>(),

    // ---- WhatsApp Presence ----
    /** Mark the instance as "online" when connecting to WhatsApp (default: true) */
    markOnlineOnConnect: boolean('mark_online_on_connect').notNull().default(true),

    // ---- Group History Context ----
    /** Number of recent messages to fetch for group context (0 = disabled, max 200) */
    groupHistorySize: integer('group_history_size').notNull().default(50),

    // ---- Message Tracking ----
    /** Timestamp of last processed message (for reconnect gap detection) */
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),

    // ---- Agent Replay ----
    /** When true (default), automatically replay missed messages on reconnect */
    replayEnabled: boolean('replay_enabled').notNull().default(true),
    /** Timestamp of when the instance was last seen connected (used as replay window start) */
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),

    // ---- Agent Stalled-Turn Detection (internal event only — no channel message) ----
    /** Idle threshold in ms before a stalled turn emits the internal turn.stalled event */
    agentStalledTimeoutMs: integer('agent_stalled_timeout_ms').notNull().default(600000),

    // ---- Agent Chaining ----
    /** Target instance for agent-to-agent chaining */
    agentChainToInstanceId: uuid('agent_chain_to_instance_id').references((): AnyPgColumn => instances.id, {
      onDelete: 'set null',
    }),
    /** Chain mode: 'off' | 'forward' | 'bidirectional' */
    chainMode: varchar('chain_mode', { length: 20 }).notNull().default('off'),

    // ---- Idle-chat follow-up config (instance scope, beats agent scope) ----
    /** @see issue #404 */
    followUpConfig: jsonb('follow_up_config').$type<FollowUpSequenceConfig>(),

    // ---- Bridge Tmux Session (per-instance override for genie NATS provider) ----
    /**
     * Optional tmux session name the genie bridge will spawn into when this
     * instance dispatches. When set, the `nats-genie` provider propagates this
     * value via the NATS message env as `GENIE_TMUX_SESSION`; the consumer
     * genie bridge uses it as the highest-priority override in its three-layer
     * tmux-session resolution chain. When null, no override is emitted and
     * genie falls back to its agent-level or name-based default.
     *
     * Enables one-agent-many-instances fan-out: a single "scout" agent hooked
     * to N inbound numbers can land each instance's dispatches in its own
     * tmux session for isolation and live-intelligence observability.
     *
     * Consumer: `automagik/genie` commit 78027707 (`resolveBridgeTmuxSession`).
     */
    bridgeTmuxSession: text('bridge_tmux_session'),

    // ---- Per-instance signature enforcement (omni-host-fingerprint-trust, group 6) ----
    /**
     * When true, any request that targets this instance MUST carry a verified
     * `X-Genie-Signature` (see middleware/genie-signature.ts). Bearer-only
     * requests get 401 with code `GENIE_SIGNATURE_REQUIRED`.
     *
     * Default: false (additive rollout — existing bearer flows keep working
     * until an operator explicitly opts the instance in via
     * `omni instances update <id> --require-genie-signature`).
     *
     * Pairs with `genie_hosts.scopes` (group 5) to give operators a complete
     * per-host trust story: which hosts can talk to this instance, and what
     * each host is allowed to do.
     */
    requireGenieSignature: boolean('require_genie_signature').notNull().default(false),

    // ---- First-party cross-instance opt-in ----
    /**
     * When true, this instance PROCESSES (does not drop) inbound messages whose
     * sender phone matches ANOTHER active instance's owner. This lets a user run
     * instance A as an "assistant" number that replies to messages A receives
     * from their own personal number (which is instance B's owner).
     *
     * Default false preserves the loop-protection default: cross-instance
     * first-party senders are dropped (see `isFirstPartyInstanceSender` in
     * agent-dispatcher.ts). This does NOT affect the "message from self"
     * self-skip — an instance still never replies to its own outbound.
     */
    allowFirstParty: boolean('allow_first_party').notNull().default(false),

    // ---- Timestamps ----
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** G2 additive tenant ownership. Nullable through the additive phase. */
    tenantId: uuid('tenant_id').references((): AnyPgColumn => tenants.id, { onDelete: 'restrict' }),
  },
  (table) => ({
    tenantIdx: index('instances_tenant_idx').on(table.tenantId),
    tenantIdUq: uniqueIndex('instances_tenant_id_uq').on(table.tenantId, table.id),
    tenantNameUq: uniqueIndex('instances_tenant_name_uq')
      .on(table.tenantId, table.name)
      .where(sql`${table.tenantId} IS NOT NULL`),
    nameIdx: uniqueIndex('instances_name_idx').on(table.name),
    channelIdx: index('instances_channel_idx').on(table.channel),
    isActiveIdx: index('instances_is_active_idx').on(table.isActive),
    isDefaultIdx: index('instances_is_default_idx').on(table.isDefault),
    agentIdIdx: index('instances_agent_id_idx').on(table.agentId),
    metaPhoneNumberIdx: index('instances_meta_phone_number_idx').on(table.metaPhoneNumberId),
    chainModeCheck: check('instances_chain_mode_check', sql`${table.chainMode} IN ('off', 'forward', 'bidirectional')`),
  }),
);

// ============================================================================
// WHATSAPP TEMPLATES (Meta Cloud API HSM)
// ============================================================================

/**
 * High Structured Message (HSM) templates for WhatsApp Cloud API.
 * Stored locally, synchronized with Meta Graph API (POST /{waba_id}/message_templates).
 *
 * One template is uniquely identified by (instance_id, name, language).
 * Status mirrors Meta lifecycle: PENDING → APPROVED | REJECTED | PAUSED | DELETED.
 */
export const whatsappTemplates = pgTable(
  'whatsapp_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => instances.id, { onDelete: 'cascade' }),
    /** ID returned by Graph API after creation (null until first sync). */
    metaId: varchar('meta_id', { length: 64 }),
    wabaId: varchar('waba_id', { length: 64 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    language: varchar('language', { length: 16 }).notNull().default('pt_BR'),
    /** MARKETING | UTILITY | AUTHENTICATION */
    category: varchar('category', { length: 32 }).notNull(),
    /** APPROVED | PENDING | REJECTED | PAUSED | DELETED */
    status: varchar('status', { length: 32 }).notNull().default('PENDING'),
    /** HEADER / BODY / FOOTER / BUTTONS components — see WhatsAppTemplateComponent in @omni/core */
    components: jsonb('components').$type<unknown[]>(),
    /** Variable name → channel value mappings, indexed by component type. */
    variableMapping: jsonb('variable_mapping').$type<Record<string, Record<string, string>>>(),
    rejectionReason: text('rejection_reason'),
    /** GREEN | YELLOW | RED | UNKNOWN (Meta-side quality score) */
    qualityScore: varchar('quality_score', { length: 16 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    instanceIdx: index('idx_wa_tpl_instance').on(t.instanceId),
    instanceNameLangUnique: uniqueIndex('idx_wa_tpl_instance_name_lang').on(t.instanceId, t.name, t.language),
    statusIdx: index('idx_wa_tpl_status').on(t.status),
  }),
);

export type WhatsappTemplate = typeof whatsappTemplates.$inferSelect;
export type NewWhatsappTemplate = typeof whatsappTemplates.$inferInsert;

/**
 * WhatsApp Flows data-endpoint encryption keys (one active keypair per
 * instance). The public key is registered with Meta via
 * POST /{phone_number_id}/whatsapp_business_encryption; the private key
 * decrypts inbound data-exchange requests.
 *
 * `privateKeyPem` is sealed at rest via sealCredentialField (tenant-secret
 * envelope) under the owning instance's tenant when tenancy + master key are
 * configured; legacy plaintext otherwise — same codec as the credential
 * columns on `instances`. Tenancy derives via `instance_id` (the
 * whatsapp_templates precedent) — no denormalized tenant_id column.
 * Rotation replaces the row (upsert on instance_id).
 */
export const whatsappFlowKeys = pgTable(
  'whatsapp_flow_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => instances.id, { onDelete: 'cascade' }),
    privateKeyPem: text('private_key_pem').notNull(),
    publicKeyPem: text('public_key_pem').notNull(),
    /** Set when the public key was accepted by Meta; null = generated but not registered. */
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    instanceUnique: uniqueIndex('idx_wa_flow_keys_instance').on(t.instanceId),
  }),
);

export type WhatsappFlowKey = typeof whatsappFlowKeys.$inferSelect;
export type NewWhatsappFlowKey = typeof whatsappFlowKeys.$inferInsert;

/**
 * Scheduled outbound messages (#889).
 *
 * Two delivery modes, chosen per channel by the `canScheduleMessage`
 * capability:
 *
 * - `platform` — the channel schedules natively (Slack chat.scheduleMessage).
 *   Delivery survives omni being down. `externalScheduledId` holds the
 *   platform handle used to cancel.
 * - `local` — omni holds the message and sends it at `sendAt` itself, for
 *   channels with no native scheduling.
 *
 * This table exists even for `platform` mode, and that is deliberate: Slack's
 * chat.scheduledMessages.list only returns what the SAME token scheduled, so
 * the platform cannot be our source of truth for "what is pending". Anything
 * scheduled through omni is recorded here; reconciliation against the platform
 * is best-effort.
 *
 * Tenancy derives via `instance_id` (the whatsapp_templates / whatsapp_flow_keys
 * precedent) — no denormalized tenant_id column, so the table stays outside the
 * RLS tenant-table manifest by construction.
 */
export const scheduledMessages = pgTable(
  'scheduled_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => instances.id, { onDelete: 'cascade' }),
    /** Platform chat/channel id (not the internal chats.id — the target may not be known to us yet). */
    chatExternalId: varchar('chat_external_id', { length: 255 }).notNull(),
    /** Post into this thread when set (Slack thread_ts). */
    threadExternalId: varchar('thread_external_id', { length: 255 }),
    /** Slack reply_broadcast: post in the thread AND surface in the channel. */
    isThreadBroadcast: boolean('is_thread_broadcast').notNull().default(false),

    /** Serialized OutgoingContent — mirrors what sendMessage would receive. */
    content: jsonb('content').$type<Record<string, unknown>>().notNull(),

    /** When it should go out. Always stored UTC-aware. */
    sendAt: timestamp('send_at', { withTimezone: true }).notNull(),
    deliveryMode: varchar('delivery_mode', { length: 20 }).notNull().$type<ScheduledMessageDeliveryMode>(),
    status: varchar('status', { length: 20 }).notNull().default('pending').$type<ScheduledMessageStatus>(),

    /** Platform handle for cancellation (Slack scheduled_message_id). */
    externalScheduledId: varchar('external_scheduled_id', { length: 255 }),
    /** externalId of the message once it actually went out. */
    sentExternalId: varchar('sent_external_id', { length: 255 }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    lastError: text('last_error'),
    attemptCount: integer('attempt_count').notNull().default(0),

    /** Agent that scheduled it, when it came from a dispatch rather than a human. */
    createdByAgentId: uuid('created_by_agent_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /** The sweeper's hot path: pending rows whose time has come. */
    dueIdx: index('scheduled_messages_due_idx').on(t.status, t.sendAt),
    instanceIdx: index('scheduled_messages_instance_idx').on(t.instanceId, t.status),
    chatIdx: index('scheduled_messages_chat_idx').on(t.instanceId, t.chatExternalId),
  }),
);

export type ScheduledMessage = typeof scheduledMessages.$inferSelect;
export type NewScheduledMessage = typeof scheduledMessages.$inferInsert;

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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** G2 additive tenant ownership. Nullable through the additive phase. */
    tenantId: uuid('tenant_id').references((): AnyPgColumn => tenants.id, { onDelete: 'restrict' }),
  },
  (table) => ({
    tenantIdx: index('persons_tenant_idx').on(table.tenantId),
    tenantIdUq: uniqueIndex('persons_tenant_id_uq').on(table.tenantId, table.id),
    tenantPhoneUq: uniqueIndex('persons_tenant_phone_uq')
      .on(table.tenantId, table.primaryPhone)
      .where(sql`${table.tenantId} IS NOT NULL AND ${table.primaryPhone} IS NOT NULL`),
    phoneIdx: uniqueIndex('persons_phone_idx').on(table.primaryPhone),
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
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    channel: varchar('channel', { length: 50 }).notNull().$type<ChannelType>(),
    instanceId: uuid('instance_id').references(() => instances.id, { onDelete: 'cascade' }),
    platformUserId: varchar('platform_user_id', { length: 255 }).notNull(), // JID, Discord ID, etc.
    platformUsername: varchar('platform_username', { length: 255 }),
    profilePicUrl: text('profile_pic_url'),
    profileData: jsonb('profile_data').$type<Record<string, unknown>>(),

    // ---- Activity Tracking ----
    messageCount: integer('message_count').notNull().default(0),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),

    // ---- Linking Metadata ----
    linkedBy: varchar('linked_by', { length: 50 }), // 'auto' | 'manual' | 'phone_match' | 'initial'
    confidence: integer('confidence').notNull().default(100), // 0-100
    linkReason: text('link_reason'),

    // ---- Timestamps ----
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** G2 additive tenant ownership. Nullable through the additive phase. */
    tenantId: uuid('tenant_id').references((): AnyPgColumn => tenants.id, { onDelete: 'restrict' }),
  },
  (table) => ({
    tenantIdx: index('platform_identities_tenant_idx').on(table.tenantId),
    tenantIdUq: uniqueIndex('platform_identities_tenant_id_uq').on(table.tenantId, table.id),
    tenantChannelUserUq: uniqueIndex('platform_identities_tenant_channel_user_uq')
      .on(table.tenantId, table.channel, table.instanceId, table.platformUserId)
      .where(sql`${table.tenantId} IS NOT NULL`),
    personIdx: index('platform_identities_person_idx').on(table.personId),
    agentIdx: index('platform_identities_agent_idx').on(table.agentId),
    channelIdx: index('platform_identities_channel_idx').on(table.channel),
    instanceIdx: index('platform_identities_instance_idx').on(table.instanceId),
    platformUserIdx: index('platform_identities_platform_user_idx').on(table.platformUserId),
    channelUserIdx: uniqueIndex('platform_identities_channel_user_idx').on(
      table.channel,
      table.instanceId,
      table.platformUserId,
    ),
    actorXor: check('platform_identities_actor_xor', sql`NOT (person_id IS NOT NULL AND agent_id IS NOT NULL)`),
  }),
);

// ============================================================================
// CONVERSATIONS
// ============================================================================

/**
 * Channel-agnostic conversation container.
 * Groups multiple Chats (across channels) into a single thread of continuity.
 * @see docs/architecture/actor-model.md — omni-233
 */
export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: varchar('title', { length: 500 }),
    summary: text('summary'),
    state: jsonb('state').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** G2 additive tenant ownership. Nullable through the additive phase. */
    tenantId: uuid('tenant_id').references((): AnyPgColumn => tenants.id, { onDelete: 'restrict' }),
  },
  (table) => ({
    tenantIdx: index('conversations_tenant_idx').on(table.tenantId),
    tenantIdUq: uniqueIndex('conversations_tenant_id_uq').on(table.tenantId, table.id),
    createdAtIdx: index('conversations_created_at_idx').on(table.createdAt),
    updatedAtIdx: index('conversations_updated_at_idx').on(table.updatedAt),
  }),
);

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = Omit<typeof conversations.$inferInsert, 'tenantId'>;

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
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    lastMessagePreview: text('last_message_preview'),
    lastMessageFromMe: boolean('last_message_from_me'),
    visibility: varchar('visibility', { length: 20 }).notNull().default('visible'),
    labels: text('labels').array().notNull().default(sql`'{}'::text[]`),

    // ---- Settings ----
    settings: jsonb('settings').$type<ChatSettings>(),

    // ---- Platform metadata ----
    platformMetadata: jsonb('platform_metadata').$type<Record<string, unknown>>(),

    // ---- Conversation ----
    conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),

    // ---- Timestamps ----
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    /** G2 additive tenant ownership. Nullable through the additive phase. */
    tenantId: uuid('tenant_id').references((): AnyPgColumn => tenants.id, { onDelete: 'restrict' }),
  },
  (table) => ({
    tenantIdx: index('chats_tenant_idx').on(table.tenantId),
    tenantIdUq: uniqueIndex('chats_tenant_id_uq').on(table.tenantId, table.id),
    tenantInstanceExternalUq: uniqueIndex('chats_tenant_instance_external_uq')
      .on(table.tenantId, table.instanceId, table.externalId)
      .where(sql`${table.tenantId} IS NOT NULL`),
    instanceExternalIdx: uniqueIndex('chats_instance_external_idx').on(table.instanceId, table.externalId),
    canonicalIdIdx: index('chats_canonical_id_idx').on(table.canonicalId),
    // Prevents duplicate canonical chats within an instance
    instanceCanonicalIdx: uniqueIndex('chats_instance_canonical_unique_idx')
      .on(table.instanceId, table.canonicalId)
      .where(sql`${table.canonicalId} IS NOT NULL`),
    chatTypeIdx: index('chats_type_idx').on(table.chatType),
    channelIdx: index('chats_channel_idx').on(table.channel),
    parentIdx: index('chats_parent_idx').on(table.parentChatId),
    lastMessageIdx: index('chats_last_message_idx').on(table.lastMessageAt),
    conversationIdx: index('chats_conversation_id_idx').on(table.conversationId),
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
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp('left_at', { withTimezone: true }),

    // ---- Activity ----
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    messageCount: integer('message_count').notNull().default(0),

    // ---- Platform metadata ----
    platformMetadata: jsonb('platform_metadata').$type<Record<string, unknown>>(),

    // ---- Timestamps ----
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** G2 additive tenant ownership. Nullable through the additive phase. */
    tenantId: uuid('tenant_id').references((): AnyPgColumn => tenants.id, { onDelete: 'restrict' }),
  },
  (table) => ({
    tenantIdx: index('chat_participants_tenant_idx').on(table.tenantId),
    tenantChatUserUq: uniqueIndex('chat_participants_tenant_chat_user_uq')
      .on(table.tenantId, table.chatId, table.platformUserId)
      .where(sql`${table.tenantId} IS NOT NULL`),
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
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** G2 additive tenant ownership. Nullable through the additive phase. */
    tenantId: uuid('tenant_id').references((): AnyPgColumn => tenants.id, { onDelete: 'restrict' }),
  },
  (table) => ({
    tenantIdx: index('omni_groups_tenant_idx').on(table.tenantId),
    tenantInstanceExternalUq: uniqueIndex('omni_groups_tenant_instance_external_uq')
      .on(table.tenantId, table.instanceId, table.externalId)
      .where(sql`${table.tenantId} IS NOT NULL`),
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
    /** @deprecated Use senderAgentId IS NOT NULL. Kept for backward compat. */
    isFromMe: boolean('is_from_me').notNull().default(false),
    /** FK to agents.id — set when the sender is a registered AI agent */
    senderAgentId: uuid('sender_agent_id').references(() => agents.id, { onDelete: 'set null' }),

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

    // Thread (#889)
    // Distinct from reply/quote: a reply points at ONE message, a thread is a
    // sub-conversation every participant can post into. Slack models it with
    // `thread_ts` (the root message ts), Discord with a real sub-channel,
    // Telegram with forum `message_thread_id`. Before this, Slack collapsed
    // thread into `replyToExternalId`, making a thread reply indistinguishable
    // from a WhatsApp quote.
    threadExternalId: varchar('thread_external_id', { length: 255 }),
    threadRootMessageId: uuid('thread_root_message_id'),
    // Slack `reply_broadcast`: posted in the thread AND surfaced in the channel.
    // This is the "quote in thread vs quote in channel" distinction — it needs
    // its own field because it is orthogonal to threadExternalId.
    isThreadBroadcast: boolean('is_thread_broadcast').notNull().default(false),
    // Denormalized thread stats, maintained on the ROOT message.
    replyCount: integer('reply_count').notNull().default(0),
    latestReplyAt: timestamp('latest_reply_at', { withTimezone: true }),

    // Stable deep link to the message on the platform (Slack chat.getPermalink).
    permalink: text('permalink'),

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
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),

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
    platformTimestamp: timestamp('platform_timestamp', { withTimezone: true }).notNull(), // When platform says sent
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(), // When we got it
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** G2 additive tenant ownership. Nullable through the additive phase. */
    tenantId: uuid('tenant_id').references((): AnyPgColumn => tenants.id, { onDelete: 'restrict' }),
  },
  (table) => ({
    tenantIdx: index('messages_tenant_idx').on(table.tenantId),
    tenantIdUq: uniqueIndex('messages_tenant_id_uq').on(table.tenantId, table.id),
    tenantChatExternalUq: uniqueIndex('messages_tenant_chat_external_uq')
      .on(table.tenantId, table.chatId, table.externalId)
      .where(sql`${table.tenantId} IS NOT NULL`),
    chatExternalIdx: uniqueIndex('messages_chat_external_idx').on(table.chatId, table.externalId),
    chatIdx: index('messages_chat_idx').on(table.chatId),
    senderPersonIdx: index('messages_sender_person_idx').on(table.senderPersonId),
    senderPlatformIdentityIdx: index('messages_sender_platform_identity_idx').on(table.senderPlatformIdentityId),
    senderAgentIdx: index('messages_sender_agent_idx').on(table.senderAgentId),
    sourceIdx: index('messages_source_idx').on(table.source),
    typeIdx: index('messages_type_idx').on(table.messageType),
    statusIdx: index('messages_status_idx').on(table.status),
    platformTimestampIdx: index('messages_platform_timestamp_idx').on(table.platformTimestamp),
    replyToIdx: index('messages_reply_to_idx').on(table.replyToMessageId),
    replyToExternalIdx: index('messages_reply_to_external_idx').on(
      table.chatId,
      table.replyToExternalId,
      table.isFromMe,
    ),
    // Fetch a whole thread in platform order (#889).
    threadExternalIdx: index('messages_thread_external_idx').on(
      table.chatId,
      table.threadExternalId,
      table.platformTimestamp,
    ),
    threadRootIdx: index('messages_thread_root_idx').on(table.threadRootMessageId),
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
    chatId: varchar('chat_id', { length: 255 }), // Chat/conversation ID (JID — stays varchar)
    canonicalChatId: varchar('canonical_chat_id', { length: 255 }), // Resolved @lid → phone
    chatUuid: uuid('chat_uuid').references(() => chats.id, { onDelete: 'set null' }),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),

    // ---- Processing Status ----
    status: varchar('status', { length: 20 }).notNull().default('received'), // 'received' | 'processing' | 'completed' | 'failed'
    errorMessage: text('error_message'),
    errorStage: varchar('error_stage', { length: 50 }),

    // ---- Timing ----
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),

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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** G2 additive tenant ownership. Nullable through the additive phase. */
    tenantId: uuid('tenant_id').references((): AnyPgColumn => tenants.id, { onDelete: 'restrict' }),
  },
  (table) => ({
    tenantIdx: index('omni_events_tenant_idx').on(table.tenantId),
    tenantIdUq: uniqueIndex('omni_events_tenant_id_uq').on(table.tenantId, table.id),
    externalIdIdx: index('omni_events_external_id_idx').on(table.externalId),
    channelIdx: index('omni_events_channel_idx').on(table.channel),
    instanceIdx: index('omni_events_instance_idx').on(table.instanceId),
    personIdx: index('omni_events_person_idx').on(table.personId),
    eventTypeIdx: index('omni_events_type_idx').on(table.eventType),
    statusIdx: index('omni_events_status_idx').on(table.status),
    receivedAtIdx: index('omni_events_received_at_idx').on(table.receivedAt),
    chatIdIdx: index('omni_events_chat_id_idx').on(table.chatId),
    canonicalChatIdx: index('omni_events_canonical_chat_idx').on(table.canonicalChatId),
    agentIdIdx: index('omni_events_agent_id_idx').on(table.agentId),
    chatUuidIdx: index('omni_events_chat_uuid_idx').on(table.chatUuid),
    conversationIdIdx: index('omni_events_conversation_id_idx').on(table.conversationId),
  }),
);

// ============================================================================
// HANDOFF LOGS
// ============================================================================

/**
 * Records every agent→human handoff with full payload.
 * Written synchronously in the /send/handoff route so no data is lost.
 */
export const handoffLogs = pgTable(
  'handoff_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instanceId: uuid('instance_id').references(() => instances.id, { onDelete: 'set null' }),
    chatUuid: uuid('chat_uuid').references(() => chats.id, { onDelete: 'set null' }),
    chatId: varchar('chat_id', { length: 255 }).notNull(), // raw JID / phone used as chatId
    toPhone: varchar('to_phone', { length: 100 }).notNull(), // recipient phone
    text: text('text').notNull(), // handoff message shown to user
    extraInfo: text('extra_info'), // optional metadata string from agent (e.g. summary)
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    externalMessageId: varchar('external_message_id', { length: 255 }), // Gupshup message ID
    handoffFields: jsonb('handoff_fields').$type<Record<string, unknown>>(), // structured fields for Gupshup flow variables
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(), // extensible
    /** G2 additive tenant ownership. Nullable through the additive phase. */
    tenantId: uuid('tenant_id').references((): AnyPgColumn => tenants.id, { onDelete: 'restrict' }),
  },
  (table) => ({
    tenantIdx: index('handoff_logs_tenant_idx').on(table.tenantId),
    instanceIdx: index('handoff_logs_instance_idx').on(table.instanceId),
    chatUuidIdx: index('handoff_logs_chat_uuid_idx').on(table.chatUuid),
    chatIdIdx: index('handoff_logs_chat_id_idx').on(table.chatId),
    sentAtIdx: index('handoff_logs_sent_at_idx').on(table.sentAt),
    agentIdx: index('handoff_logs_agent_idx').on(table.agentId),
  }),
);

// ============================================================================
// CLOSE CONTACT LOGS
// ============================================================================

/**
 * Outcome literals for the close-contact endpoint. Mirrors the
 * `CloseContactOutcome` union in `@omni/core/events` — kept as a const here
 * so the column type is statically checked and BI tooling can introspect.
 *
 * - `won` / `lost`        → hard terminal close.
 * - `redirected_sac`      → cliente atual redirected to SAC; soft close.
 * - `unqualified`         → lead refused N times; soft close.
 * - `no_response`         → cadence exhausted, no inbound; soft close.
 * - `other`               → catch-all soft close.
 */
export const closeContactOutcomes = ['won', 'lost', 'redirected_sac', 'unqualified', 'no_response', 'other'] as const;
export type CloseContactOutcomeDb = (typeof closeContactOutcomes)[number];

/**
 * Records every agent→close-contact event with full payload.
 *
 * Written synchronously in the /send/close-contact route. The route also
 * **reads** this table at close-time to count recent rows for the same
 * `(chat_uuid, outcome)` within the configured escalation window — that
 * count drives the auto-promotion of soft outcomes to hard terminal
 * (recorded back as `escalated: true` on the new row). See `design.md`
 * §6 + §8.1 for the loop-bound proof.
 *
 * Escalation index is `(chat_uuid, outcome, sent_at DESC)` — supports the
 * recent-count query in O(log n). The instance/sent_at index is for BI.
 */
export const closeContactLogs = pgTable(
  'close_contact_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instanceId: uuid('instance_id').references(() => instances.id, { onDelete: 'set null' }),
    chatUuid: uuid('chat_uuid').references(() => chats.id, { onDelete: 'set null' }),
    chatId: varchar('chat_id', { length: 255 }).notNull(), // raw JID / phone used as chatId
    toPhone: varchar('to_phone', { length: 100 }).notNull(), // recipient phone
    text: text('text').notNull(), // farewell message shown to user
    outcome: varchar('outcome', { length: 32 }).notNull().$type<CloseContactOutcomeDb>(),
    reason: text('reason'), // free-text rationale for audit
    closeFields: jsonb('close_fields').$type<Record<string, unknown>>(), // structured BI/CRM payload
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    externalMessageId: varchar('external_message_id', { length: 255 }), // Gupshup message ID
    /**
     * True when this close was auto-promoted to hard terminal because the
     * same outcome had already fired N times within the escalation window
     * for the same chat. Driven by the route handler at insert time.
     */
    escalated: boolean('escalated').notNull().default(false),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(), // extensible
    /** G2 additive tenant ownership. Nullable through the additive phase. */
    tenantId: uuid('tenant_id').references((): AnyPgColumn => tenants.id, { onDelete: 'restrict' }),
  },
  (table) => ({
    tenantIdx: index('close_contact_logs_tenant_idx').on(table.tenantId),
    /** Hot path: recent-count query for escalation. */
    chatOutcomeSentAtIdx: index('close_contact_logs_chat_outcome_sent_at_idx').on(
      table.chatUuid,
      table.outcome,
      table.sentAt,
    ),
    /** BI: per-instance event timeline. */
    instanceSentAtIdx: index('close_contact_logs_instance_sent_at_idx').on(table.instanceId, table.sentAt),
    chatIdIdx: index('close_contact_logs_chat_id_idx').on(table.chatId),
    agentIdx: index('close_contact_logs_agent_idx').on(table.agentId),
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
    ruleType: varchar('rule_type', { length: 20 }).notNull().$type<RuleType>(),

    // ---- Matching Criteria ----
    phonePattern: varchar('phone_pattern', { length: 50 }), // E.164 with optional wildcard
    platformUserId: varchar('platform_user_id', { length: 255 }),
    personId: uuid('person_id').references(() => persons.id, { onDelete: 'cascade' }),

    // ---- Rule Settings ----
    priority: integer('priority').notNull().default(0),
    enabled: boolean('enabled').notNull().default(true),
    reason: text('reason'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),

    // ---- Action ----
    action: varchar('action', { length: 20 }).notNull().default('block'), // 'block' | 'allow' | 'silent_block'
    blockMessage: text('block_message'),

    // ---- Pairing metadata (for pending_pairing rules) ----
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    // ---- Timestamps ----
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** G2 additive tenant ownership. Nullable through the additive phase. */
    tenantId: uuid('tenant_id').references((): AnyPgColumn => tenants.id, { onDelete: 'restrict' }),
  },
  (table) => ({
    tenantIdx: index('access_rules_tenant_idx').on(table.tenantId),
    tenantRuleUq: uniqueIndex('access_rules_tenant_rule_uq')
      .on(table.tenantId, table.instanceId, table.phonePattern, table.ruleType)
      .where(sql`${table.tenantId} IS NOT NULL`),
    instanceIdx: index('access_rules_instance_idx').on(table.instanceId),
    phoneIdx: index('access_rules_phone_idx').on(table.phonePattern),
    ruleTypeIdx: index('access_rules_type_idx').on(table.ruleType),
    uniqueRule: uniqueIndex('access_rules_unique_idx').on(table.instanceId, table.phonePattern, table.ruleType),
    pairingIdx: index('idx_access_rules_pairing').on(table.instanceId, table.ruleType, table.expiresAt),
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
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
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
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
    totalCostUsd: numeric('total_cost_usd', { precision: 15, scale: 6 }),
    totalTokens: integer('total_tokens'),

    // ---- Error Handling ----
    errorMessage: text('error_message'),
    errors: jsonb('errors').$type<Array<{ itemId: string; error: string }>>(),

    // ---- Timing ----
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /** G2 additive tenant ownership. Nullable through the additive phase. */
    tenantId: uuid('tenant_id').references((): AnyPgColumn => tenants.id, { onDelete: 'restrict' }),
  },
  (table) => ({
    tenantIdx: index('batch_jobs_tenant_idx').on(table.tenantId),
    tenantIdUq: uniqueIndex('batch_jobs_tenant_id_uq').on(table.tenantId, table.id),
    statusIdx: index('batch_jobs_status_idx').on(table.status),
    instanceIdx: index('batch_jobs_instance_idx').on(table.instanceId),
    createdAtIdx: index('batch_jobs_created_at_idx').on(table.createdAt),
  }),
);

// ============================================================================
// SYNC JOBS
// ============================================================================

export const syncJobTypes = ['profile', 'messages', 'contacts', 'groups', 'all', 'history-push'] as const;
export type SyncJobType = (typeof syncJobTypes)[number];

/**
 * Sync job configuration stored in JSONB.
 *
 * Source of truth lives in @omni/core (event payload + db record must stay in sync).
 */
export type SyncJobConfig = CoreSyncJobConfig;

/**
 * Sync job progress tracking.
 */
export interface SyncJobProgress {
  fetched: number;
  stored: number;
  duplicates: number;
  mediaDownloaded: number;
  totalEstimated?: number;
  /**
   * ISO-8601 timestamp of the last `updateProgress` call. Lets clients
   * distinguish "running slowly" from "stuck" when `progressPercent` cannot
   * be computed (e.g. Baileys never reports a denominator). See issue #398.
   */
  lastProgressAt?: string;
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /** G2 additive tenant ownership. Nullable through the additive phase. */
    tenantId: uuid('tenant_id').references((): AnyPgColumn => tenants.id, { onDelete: 'restrict' }),
  },
  (table) => ({
    tenantIdx: index('sync_jobs_tenant_idx').on(table.tenantId),
    instanceIdx: index('sync_jobs_instance_idx').on(table.instanceId),
    statusIdx: index('sync_jobs_status_idx').on(table.status),
    typeIdx: index('sync_jobs_type_idx').on(table.type),
    createdAtIdx: index('sync_jobs_created_at_idx').on(table.createdAt),
  }),
);

export type SyncJob = typeof syncJobs.$inferSelect;
export type NewSyncJob = Omit<typeof syncJobs.$inferInsert, 'tenantId'>;

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
    costUsd: numeric('cost_usd', { precision: 15, scale: 6 }),

    // ---- Source Info ----
    batchJobId: uuid('batch_job_id').references(() => batchJobs.id, { onDelete: 'set null' }),
    processingTimeMs: integer('processing_time_ms'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** G2 additive tenant ownership. Nullable through the additive phase. */
    tenantId: uuid('tenant_id').references((): AnyPgColumn => tenants.id, { onDelete: 'restrict' }),
  },
  (table) => ({
    tenantIdx: index('media_content_tenant_idx').on(table.tenantId),
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
    discoveredAt: timestamp('discovered_at', { withTimezone: true }).notNull().defaultNow(),
    discoveredFrom: varchar('discovered_from', { length: 50 }), // 'message_key' | 'sender_match' | 'manual'
    /** G2 additive tenant ownership. Nullable through the additive phase. */
    tenantId: uuid('tenant_id').references((): AnyPgColumn => tenants.id, { onDelete: 'restrict' }),
  },
  (table) => ({
    tenantIdx: index('chat_id_mappings_tenant_idx').on(table.tenantId),
    tenantInstanceLidUq: uniqueIndex('chat_id_mappings_tenant_instance_lid_uq')
      .on(table.tenantId, table.instanceId, table.lidId)
      .where(sql`${table.tenantId} IS NOT NULL`),
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
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
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
  agents: many(agents),
}));

export const agentsRelations = relations(agents, ({ one, many }) => ({
  owner: one(persons, { fields: [agents.ownerId], references: [persons.id] }),
  agentProvider: one(agentProviders, { fields: [agents.agentProviderId], references: [agentProviders.id] }),
  platformIdentities: many(platformIdentities),
  sentMessages: many(messages),
  omniEvents: many(omniEvents),
  agentRoutes: many(agentRoutes),
}));

export const instancesRelations = relations(instances, ({ one, many }) => ({
  agent: one(agents, {
    fields: [instances.agentId],
    references: [agents.id],
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
  agent: one(agents, {
    fields: [platformIdentities.agentId],
    references: [agents.id],
  }),
  instance: one(instances, {
    fields: [platformIdentities.instanceId],
    references: [instances.id],
  }),
  omniEvents: many(omniEvents),
  chatParticipants: many(chatParticipants),
  sentMessages: many(messages),
}));

export const conversationsRelations = relations(conversations, ({ many }) => ({
  chats: many(chats),
  omniEvents: many(omniEvents),
}));

export const chatsRelations = relations(chats, ({ one, many }) => ({
  instance: one(instances, {
    fields: [chats.instanceId],
    references: [instances.id],
  }),
  conversation: one(conversations, {
    fields: [chats.conversationId],
    references: [conversations.id],
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
  senderAgent: one(agents, {
    fields: [messages.senderAgentId],
    references: [agents.id],
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
  chat: one(chats, {
    fields: [omniEvents.chatUuid],
    references: [chats.id],
  }),
  agent: one(agents, {
    fields: [omniEvents.agentId],
    references: [agents.id],
  }),
  conversation: one(conversations, {
    fields: [omniEvents.conversationId],
    references: [conversations.id],
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

export type AgentRoute = typeof agentRoutes.$inferSelect;
export type NewAgentRoute = Omit<typeof agentRoutes.$inferInsert, 'tenantId'>;

export type AgentSession = typeof agentSessions.$inferSelect;
export type NewAgentSession = Omit<typeof agentSessions.$inferInsert, 'tenantId'>;

export type Instance = typeof instances.$inferSelect;
export type NewInstance = Omit<typeof instances.$inferInsert, 'tenantId'>;

export type Person = typeof persons.$inferSelect;
export type NewPerson = Omit<typeof persons.$inferInsert, 'tenantId'>;

export type PlatformIdentity = typeof platformIdentities.$inferSelect;
export type NewPlatformIdentity = Omit<typeof platformIdentities.$inferInsert, 'tenantId'>;

export type Chat = typeof chats.$inferSelect;
export type NewChat = Omit<typeof chats.$inferInsert, 'tenantId'>;

export type ChatParticipant = typeof chatParticipants.$inferSelect;
export type NewChatParticipant = Omit<typeof chatParticipants.$inferInsert, 'tenantId'>;

export type OmniGroup = typeof omniGroups.$inferSelect;
export type NewOmniGroup = Omit<typeof omniGroups.$inferInsert, 'tenantId'>;

export type Message = typeof messages.$inferSelect;
export type NewMessage = Omit<typeof messages.$inferInsert, 'tenantId'>;

export type OmniEvent = typeof omniEvents.$inferSelect;
export type NewOmniEvent = Omit<typeof omniEvents.$inferInsert, 'tenantId'>;

export type AccessRule = typeof accessRules.$inferSelect;
export type NewAccessRule = Omit<typeof accessRules.$inferInsert, 'tenantId'>;

export type GlobalSetting = typeof globalSettings.$inferSelect;
export type NewGlobalSetting = typeof globalSettings.$inferInsert;

export type SettingChange = typeof settingChangeHistory.$inferSelect;
export type NewSettingChange = typeof settingChangeHistory.$inferInsert;

export type BatchJob = typeof batchJobs.$inferSelect;
export type NewBatchJob = Omit<typeof batchJobs.$inferInsert, 'tenantId'>;

export type MediaContent = typeof mediaContent.$inferSelect;
export type NewMediaContent = Omit<typeof mediaContent.$inferInsert, 'tenantId'>;

export type ChatIdMapping = typeof chatIdMappings.$inferSelect;
export type NewChatIdMapping = Omit<typeof chatIdMappings.$inferInsert, 'tenantId'>;

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
    nextAutoRetryAt: timestamp('next_auto_retry_at', { withTimezone: true }), // null = no more auto-retries

    // Status tracking
    status: varchar('status', { length: 20 }).notNull().default('pending').$type<DeadLetterStatus>(),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastRetryAt: timestamp('last_retry_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: varchar('resolved_by', { length: 100 }), // manual resolution note
    /** G2 additive tenant ownership. Nullable through the additive phase. */
    tenantId: uuid('tenant_id').references((): AnyPgColumn => tenants.id, { onDelete: 'restrict' }),
  },
  (table) => ({
    tenantIdx: index('dead_letter_events_tenant_idx').on(table.tenantId),
    eventIdIdx: index('dead_letter_events_event_id_idx').on(table.eventId),
    eventTypeIdx: index('dead_letter_events_event_type_idx').on(table.eventType),
    statusIdx: index('dead_letter_events_status_idx').on(table.status),
    createdAtIdx: index('dead_letter_events_created_at_idx').on(table.createdAt),
    nextAutoRetryAtIdx: index('dead_letter_events_next_retry_idx').on(table.nextAutoRetryAt),
  }),
);

export type DeadLetterEvent = typeof deadLetterEvents.$inferSelect;
export type NewDeadLetterEvent = Omit<typeof deadLetterEvents.$inferInsert, 'tenantId'>;

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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
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
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
    containsMedia: boolean('contains_media').notNull().default(false),
    containsBase64: boolean('contains_base64').notNull().default(false),

    // Soft-delete for audit trail
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: varchar('deleted_by', { length: 100 }),
    deleteReason: varchar('delete_reason', { length: 255 }),
    /** G2 additive tenant ownership. Nullable through the additive phase. */
    tenantId: uuid('tenant_id').references((): AnyPgColumn => tenants.id, { onDelete: 'restrict' }),
  },
  (table) => ({
    tenantIdx: index('event_payloads_tenant_idx').on(table.tenantId),
    eventIdIdx: index('event_payloads_event_id_idx').on(table.eventId),
    eventTypeIdx: index('event_payloads_event_type_idx').on(table.eventType),
    stageIdx: index('event_payloads_stage_idx').on(table.stage),
    timestampIdx: index('event_payloads_timestamp_idx').on(table.timestamp),
    deletedAtIdx: index('event_payloads_deleted_at_idx').on(table.deletedAt),
    eventStageIdx: index('event_payloads_event_stage_idx').on(table.eventId, table.stage),
  }),
);

export type EventPayload = typeof eventPayloads.$inferSelect;
export type NewEventPayload = Omit<typeof eventPayloads.$inferInsert, 'tenantId'>;

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
    lastReceivedAt: timestamp('last_received_at', { withTimezone: true }),
    totalReceived: integer('total_received').notNull().default(0),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** G2 additive tenant ownership. Nullable through the additive phase. */
    tenantId: uuid('tenant_id').references((): AnyPgColumn => tenants.id, { onDelete: 'restrict' }),
  },
  (table) => ({
    tenantIdx: index('webhook_sources_tenant_idx').on(table.tenantId),
    tenantNameUq: uniqueIndex('webhook_sources_tenant_name_uq')
      .on(table.tenantId, table.name)
      .where(sql`${table.tenantId} IS NOT NULL`),
    nameIdx: uniqueIndex('webhook_sources_name_idx').on(table.name),
    enabledIdx: index('webhook_sources_enabled_idx').on(table.enabled),
  }),
);

export type WebhookSource = typeof webhookSources.$inferSelect;
export type NewWebhookSource = Omit<typeof webhookSources.$inferInsert, 'tenantId'>;

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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** G2 additive tenant ownership. Nullable through the additive phase. */
    tenantId: uuid('tenant_id').references((): AnyPgColumn => tenants.id, { onDelete: 'restrict' }),
  },
  (table) => ({
    tenantIdx: index('automations_tenant_idx').on(table.tenantId),
    tenantIdUq: uniqueIndex('automations_tenant_id_uq').on(table.tenantId, table.id),
    nameIdx: index('automations_name_idx').on(table.name),
    triggerIdx: index('automations_trigger_idx').on(table.triggerEventType),
    enabledIdx: index('automations_enabled_idx').on(table.enabled),
    priorityIdx: index('automations_priority_idx').on(table.priority),
  }),
);

export type Automation = typeof automations.$inferSelect;
export type NewAutomation = Omit<typeof automations.$inferInsert, 'tenantId'>;

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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** G2 additive tenant ownership. Nullable through the additive phase. */
    tenantId: uuid('tenant_id').references((): AnyPgColumn => tenants.id, { onDelete: 'restrict' }),
  },
  (table) => ({
    tenantIdx: index('automation_logs_tenant_idx').on(table.tenantId),
    automationIdx: index('automation_logs_automation_idx').on(table.automationId),
    eventIdIdx: index('automation_logs_event_id_idx').on(table.eventId),
    statusIdx: index('automation_logs_status_idx').on(table.status),
    createdAtIdx: index('automation_logs_created_at_idx').on(table.createdAt),
  }),
);

export type AutomationLog = typeof automationLogs.$inferSelect;
export type NewAutomationLog = Omit<typeof automationLogs.$inferInsert, 'tenantId'>;

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
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
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
    /** Route that was matched (null = instance default) */
    routeId: uuid('route_id').references(() => agentRoutes.id, { onDelete: 'set null' }),
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
    /** G2 additive tenant ownership. Nullable through the additive phase. */
    tenantId: uuid('tenant_id').references((): AnyPgColumn => tenants.id, { onDelete: 'restrict' }),
  },
  (table) => ({
    tenantIdx: index('trigger_logs_tenant_idx').on(table.tenantId),
    instanceIdx: index('trigger_logs_instance_idx').on(table.instanceId),
    traceIdx: index('trigger_logs_trace_idx').on(table.traceId),
    firedAtIdx: index('trigger_logs_fired_at_idx').on(table.firedAt),
    eventTypeIdx: index('trigger_logs_event_type_idx').on(table.eventType),
  }),
);

export type TriggerLog = typeof triggerLogs.$inferSelect;
export type NewTriggerLog = Omit<typeof triggerLogs.$inferInsert, 'tenantId'>;

export const triggerLogsRelations = relations(triggerLogs, ({ one }) => ({
  instance: one(instances, {
    fields: [triggerLogs.instanceId],
    references: [instances.id],
  }),
  provider: one(agentProviders, {
    fields: [triggerLogs.providerId],
    references: [agentProviders.id],
  }),
  route: one(agentRoutes, {
    fields: [triggerLogs.routeId],
    references: [agentRoutes.id],
  }),
}));

export const agentRoutesRelations = relations(agentRoutes, ({ one, many }) => ({
  agent: one(agents, {
    fields: [agentRoutes.agentId],
    references: [agents.id],
  }),
  triggerLogs: many(triggerLogs),
}));

// ============================================================================
// AGENT TASKS
// ============================================================================

export const agentTaskStatuses = ['pending', 'running', 'completed', 'failed', 'cancelled', 'waiting_input'] as const;
export type AgentTaskStatus = (typeof agentTaskStatuses)[number];

/**
 * Persistent task history for agents.
 * Each row represents a discrete unit of work performed by an agent
 * (e.g. web search, code execution, API call, sub-agent delegation).
 *
 * @see docs/architecture/actor-model.md — "Agent Task (persistent)"
 */
export const agentTasks = pgTable(
  'agent_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // ---- Core FKs ----
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
    /** The message that triggered this task (null for programmatically created tasks) */
    messageId: uuid('message_id').references(() => messages.id, { onDelete: 'set null' }),

    // ---- Classification ----
    /** Task type: 'web_search' | 'code_exec' | 'api_call' | 'sub_agent' | 'media_process' | 'custom.*' */
    type: varchar('type', { length: 100 }).notNull(),
    /** Human-readable title: "Searching for X" */
    title: varchar('title', { length: 500 }).notNull(),
    description: text('description'),

    // ---- Lifecycle ----
    status: varchar('status', { length: 20 }).notNull().default('pending').$type<AgentTaskStatus>(),
    /** Progress percentage 0-100 */
    progress: integer('progress').notNull().default(0),
    priority: integer('priority').notNull().default(0),

    // ---- Payload ----
    /** Open per-task-type metadata — no migration needed for new fields */
    metadata: jsonb('metadata').notNull().default({}).$type<Record<string, unknown>>(),
    result: jsonb('result').$type<Record<string, unknown>>(),
    error: text('error'),

    // ---- Subtask nesting ----
    parentTaskId: uuid('parent_task_id').references(
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      (): AnyPgColumn => agentTasks.id,
      { onDelete: 'set null' },
    ),
    subtaskCount: integer('subtask_count').notNull().default(0),
    completedSubtaskCount: integer('completed_subtask_count').notNull().default(0),

    // ---- Timestamps ----
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /** G2 additive tenant ownership. Nullable through the additive phase. */
    tenantId: uuid('tenant_id').references((): AnyPgColumn => tenants.id, { onDelete: 'restrict' }),
  },
  (table) => ({
    tenantIdx: index('agent_tasks_tenant_idx').on(table.tenantId),
    tenantIdUq: uniqueIndex('agent_tasks_tenant_id_uq').on(table.tenantId, table.id),
    agentIdIdx: index('agent_tasks_agent_id_idx').on(table.agentId),
    chatIdIdx: index('agent_tasks_chat_id_idx').on(table.chatId),
    conversationIdIdx: index('agent_tasks_conversation_id_idx').on(table.conversationId),
    parentTaskIdIdx: index('agent_tasks_parent_task_id_idx').on(table.parentTaskId),
    statusIdx: index('agent_tasks_status_idx').on(table.status),
    agentChatIdx: index('agent_tasks_agent_chat_idx').on(table.agentId, table.chatId),
    agentStatusIdx: index('agent_tasks_agent_status_idx').on(table.agentId, table.status),
  }),
);

export type AgentTask = typeof agentTasks.$inferSelect;
export type NewAgentTask = Omit<typeof agentTasks.$inferInsert, 'tenantId'>;

export const agentTasksRelations = relations(agentTasks, ({ one, many }) => ({
  agent: one(agents, {
    fields: [agentTasks.agentId],
    references: [agents.id],
  }),
  chat: one(chats, {
    fields: [agentTasks.chatId],
    references: [chats.id],
  }),
  conversation: one(conversations, {
    fields: [agentTasks.conversationId],
    references: [conversations.id],
  }),
  message: one(messages, {
    fields: [agentTasks.messageId],
    references: [messages.id],
  }),
  parentTask: one(agentTasks, {
    fields: [agentTasks.parentTaskId],
    references: [agentTasks.id],
    relationName: 'parentChild',
  }),
  subtasks: many(agentTasks, {
    relationName: 'parentChild',
  }),
}));

// ============================================================================
// TURNS (Turn-Based Agent Execution)
// ============================================================================

export const turnStatuses = ['open', 'done', 'timeout'] as const;
export type TurnStatus = (typeof turnStatuses)[number];

export const turnActions = ['message', 'react', 'skip', 'timeout'] as const;
export type TurnAction = (typeof turnActions)[number];

/**
 * Turn state for turn-based agent execution.
 * Each turn represents a single agent work session triggered by an inbound message.
 * The agent gets a sandboxed environment and communicates via verb commands.
 * Turn lifecycle: open → (agent works, sends intermediate messages) → done/timeout.
 *
 * @see WISH.md — Turn-Based Execution Mode
 */
export const turns = pgTable(
  'turns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => instances.id, { onDelete: 'cascade' }),
    chatId: text('chat_id').notNull(),
    messageId: text('message_id').notNull(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    apiKeyId: uuid('api_key_id')
      .notNull()
      .references(() => apiKeys.id, { onDelete: 'cascade' }),

    // ---- Lifecycle ----
    status: varchar('status', { length: 20 }).notNull().default('open').$type<TurnStatus>(),
    action: varchar('action', { length: 20 }).$type<TurnAction>(),

    // ---- Counters ----
    nudgeCount: integer('nudge_count').notNull().default(0),
    messagesSent: integer('messages_sent').notNull().default(0),

    // ---- Timestamps ----
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),

    // ---- Close info ----
    closedReason: text('closed_reason'),

    // ---- Extensibility ----
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    /** G2 additive tenant ownership. Nullable through the additive phase. */
    tenantId: uuid('tenant_id').references((): AnyPgColumn => tenants.id, { onDelete: 'restrict' }),
  },
  (table) => ({
    tenantIdx: index('turns_tenant_idx').on(table.tenantId),
    instanceChatIdx: index('turns_instance_chat_idx').on(table.instanceId, table.chatId),
    statusIdx: index('turns_status_idx').on(table.status),
    apiKeyIdx: index('turns_api_key_idx').on(table.apiKeyId),
    agentIdx: index('turns_agent_idx').on(table.agentId),
    lastActivityIdx: index('turns_last_activity_idx').on(table.lastActivityAt),
    openTurnsIdx: index('turns_open_idx').on(table.status, table.lastActivityAt).where(sql`${table.status} = 'open'`),
  }),
);

export type Turn = typeof turns.$inferSelect;
export type NewTurn = Omit<typeof turns.$inferInsert, 'tenantId'>;

export const turnsRelations = relations(turns, ({ one }) => ({
  instance: one(instances, {
    fields: [turns.instanceId],
    references: [instances.id],
  }),
  agent: one(agents, {
    fields: [turns.agentId],
    references: [agents.id],
  }),
  apiKey: one(apiKeys, {
    fields: [turns.apiKeyId],
    references: [apiKeys.id],
  }),
}));

// ============================================================================
// CHAT FOLLOW-UP STATE (Idle-chat follow-up sequences)
// ============================================================================

/**
 * Disarm reason values persisted in `chat_follow_up_state.disarm_reason`.
 *
 * The column type is `varchar(32)` — there is NO CHECK constraint or pg
 * enum at the DB level. Validation lives in the TypeScript layer via
 * `$type<FollowUpDisarmReasonDb>()` and the matching zod
 * `DisarmReasonSchema`. Adding a value here is a pure type change; no
 * migration is needed unless a future revision wants to harden this with
 * a CHECK or a pg ENUM.
 *
 * Keep in sync with:
 *   - `packages/core/src/events/types.ts` → `FollowUpDisarmReason`
 *   - `packages/core/src/schemas/follow-up.ts` → `DisarmReasonSchema`
 */
export const followUpDisarmReasons = [
  'customer_replied',
  'handoff',
  'archived',
  'window_expired',
  'sequence_complete',
  'agent_error',
  'send_failed',
  'session_cleared',
  'contact_closed',
] as const;
export type FollowUpDisarmReasonDb = (typeof followUpDisarmReasons)[number];

/**
 * Durable runtime state for a single follow-up sequence on a chat.
 *
 * One row per (chatId, instanceId). The sweeper scans this table every 15s
 * (cron `*\/15 * * * * *`) for rows where `nextFireAt <= NOW()` and
 * `disarmReason IS NULL`, emits `chat.idle_timeout`, advances the sequence,
 * and updates `nextFireAt`.
 *
 * @see issue #404 — Configurable Idle-Chat Follow-Up Sequences
 */
export const chatFollowUpState = pgTable(
  'chat_follow_up_state',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // ---- Subject ----
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => instances.id, { onDelete: 'cascade' }),
    /** Agent that produced the outbound message which armed this sequence (nullable — agent may have been deleted). */
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),

    // ---- Config snapshot ----
    /** Snapshot of the resolved FollowUpSequenceConfig at arm time — decouples runtime from live config edits. */
    sequenceConfig: jsonb('sequence_config').notNull().$type<FollowUpSequenceConfig>(),

    // ---- Lifecycle ----
    /** Zero-based count of follow-ups already fired. The next fire uses this index, then increments. */
    sequenceIndex: integer('sequence_index').notNull().default(0),
    /** Timestamp of the outbound agent message that armed (or last refreshed) this sequence. */
    lastAgentMessageAt: timestamp('last_agent_message_at', { withTimezone: true }).notNull(),
    /** Timestamp of the most recent inbound customer message — used by the 24h BSP window guard. */
    lastInboundCustomerMessageAt: timestamp('last_inbound_customer_message_at', { withTimezone: true }),
    /** When the sweeper should next fire. Null only when disarmed. */
    nextFireAt: timestamp('next_fire_at', { withTimezone: true }),
    /** Non-null terminates the sequence. */
    disarmReason: varchar('disarm_reason', { length: 32 }).$type<FollowUpDisarmReasonDb>(),
    /** Timestamp of disarm for observability. */
    disarmedAt: timestamp('disarmed_at', { withTimezone: true }),

    // ---- Timestamps ----
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** G2 additive tenant ownership. Nullable through the additive phase. */
    tenantId: uuid('tenant_id').references((): AnyPgColumn => tenants.id, { onDelete: 'restrict' }),
  },
  (table) => ({
    tenantIdx: index('chat_follow_up_state_tenant_idx').on(table.tenantId),
    tenantChatInstanceUq: uniqueIndex('chat_follow_up_state_tenant_chat_instance_uq')
      .on(table.tenantId, table.chatId, table.instanceId)
      .where(sql`${table.tenantId} IS NOT NULL`),
    /** Sweeper scan: pick rows where nextFireAt is due and sequence is still armed. */
    sweeperIdx: index('chat_follow_up_state_sweeper_idx').on(table.nextFireAt, table.disarmReason),
    /** One active row per (chat, instance). */
    chatInstanceUnique: uniqueIndex('chat_follow_up_state_chat_instance_unique').on(table.chatId, table.instanceId),
    chatIdx: index('chat_follow_up_state_chat_idx').on(table.chatId),
    instanceIdx: index('chat_follow_up_state_instance_idx').on(table.instanceId),
  }),
);

export type ChatFollowUpState = typeof chatFollowUpState.$inferSelect;
export type NewChatFollowUpState = Omit<typeof chatFollowUpState.$inferInsert, 'tenantId'>;

export const chatFollowUpStateRelations = relations(chatFollowUpState, ({ one }) => ({
  chat: one(chats, {
    fields: [chatFollowUpState.chatId],
    references: [chats.id],
  }),
  instance: one(instances, {
    fields: [chatFollowUpState.instanceId],
    references: [instances.id],
  }),
  agent: one(agents, {
    fields: [chatFollowUpState.agentId],
    references: [agents.id],
  }),
}));

// ============================================================================
// PROCESSED EVENTS — durable subscriber idempotency (#411)
// ============================================================================

/**
 * Tracks which (event_id, handler_name) pairs a durable NATS subscriber has
 * already processed. Used by `withIdempotency()` to make customer-visible
 * side-effects (sends, deletes, agent dispatches) safe under NATS redelivery
 * — the at-least-once delivery contract caused duplicates after PM2 restart
 * (see issue #411).
 *
 * Composite primary key (event_id, handler) allows multiple handlers to
 * independently mark the same event as processed (e.g. session-cleaner AND
 * agent-dispatcher both see message.received).
 *
 * Rows are kept indefinitely for now; a periodic GC sweep can prune rows
 * older than the longest reasonable redelivery window (e.g. 24h) once the
 * fix has soaked.
 */
export const processedEvents = pgTable(
  'processed_events',
  {
    eventId: varchar('event_id', { length: 255 }).notNull(),
    handler: varchar('handler', { length: 100 }).notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
    /** G2 additive tenant ownership. Nullable through the additive phase. */
    tenantId: uuid('tenant_id').references((): AnyPgColumn => tenants.id, { onDelete: 'restrict' }),
  },
  (table) => ({
    tenantIdx: index('processed_events_tenant_idx').on(table.tenantId),
    pk: primaryKey({ columns: [table.eventId, table.handler], name: 'processed_events_pk' }),
    processedAtIdx: index('processed_events_processed_at_idx').on(table.processedAt),
  }),
);

export type ProcessedEvent = typeof processedEvents.$inferSelect;
export type NewProcessedEvent = Omit<typeof processedEvents.$inferInsert, 'tenantId'>;

// ============================================================================
// GENIE HOSTS — per-host fingerprint trust (omni-host-fingerprint-trust wish, D5)
// ============================================================================

/**
 * Per-host trust record for genie installations that talk to this omni server.
 *
 * A genie host registers its ed25519 public key once via
 * `POST /api/v2/trust/handshake` (typically driven by `genie omni handshake`).
 * Subsequent genie→omni writes can be signed; the verification middleware
 * (omni-host-fingerprint-trust wish, Group 4) looks the pubkey up here,
 * verifies the request signature, and attaches the resolved host_id to the
 * request context for audit.
 *
 * This table is the FOUNDATION (Group 1 of the wish). The signing,
 * verification, and per-host scope enforcement land in subsequent groups.
 * Today the table just stores data; nothing reads `scopes` for enforcement
 * yet — that's Group 5.
 *
 * `pubkey` is the canonical record key for idempotent registration: handshakes
 * are deduplicated by pubkey, so re-running `genie omni handshake` returns
 * the same `host_id` instead of creating duplicates.
 */
export const genieHosts = pgTable(
  'genie_hosts',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * ed25519 public key in base64url encoding (~44 chars including padding).
     * Unique — re-registering the same pubkey returns the existing host_id
     * (idempotent handshake). Rotation flow will revoke + re-register with a
     * new pubkey rather than mutating in place.
     */
    pubkey: varchar('pubkey', { length: 64 }).notNull().unique(),

    /** Hostname reported by the genie host at handshake time. Display only. */
    hostname: varchar('hostname', { length: 255 }).notNull(),

    /**
     * Free-form metadata reported at handshake — `genieVersion`, `os`,
     * `binaryPath`, etc. Not enforced; useful for audits and operator UIs.
     */
    capabilities: jsonb('capabilities').notNull().default(sql`'{}'::jsonb`),

    /**
     * Per-host scopes consumed by the verification middleware (Group 5).
     * Default on first handshake = full write access (`['*']`) so the
     * existing bearer-token model stays backward-compatible during
     * rollout. Operators narrow via `omni trust update <id> --scope`.
     */
    scopes: text('scopes').array().notNull().default(sql`ARRAY['*']::text[]`),

    /** Set by the verification middleware on every successful signed request. */
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),

    /** Set by `omni trust revoke <id>`. Revoked hosts cannot pass verification. */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pubkeyUq: index('genie_hosts_pubkey_idx').on(table.pubkey),
    activeIdx: index('genie_hosts_active_idx').on(table.revokedAt),
  }),
);

export type GenieHost = typeof genieHosts.$inferSelect;
export type NewGenieHost = typeof genieHosts.$inferInsert;

// ============================================================================
// MULTITENANCY CONTROL PLANE (wish: omni-full-multitenancy, Group G1)
// ============================================================================
//
// Additive, off-by-default control plane. These tables establish first-class
// tenant identity, principals/memberships, a bounded fixed-role registry, an
// ISOLATED authentication credential index, separate platform credentials,
// tenant key lineage/delegation foundations, and split tenant/platform audit
// stores.
//
// Frozen G0 contract (ADR-0001/0003/0005/0006/0010, OWNERSHIP_MATRIX "New
// ownership/control tables"): ownership classes are explicit, tenant routes
// can NEVER enumerate the credential index, tenant credentials can NEVER hold
// platform `*` authority, and there is NO hard tenant delete — foreign keys
// use RESTRICT so nothing cascade-deletes a tenant or erases audit lineage.
//
// G1 is additive only. It does NOT add tenant_id to existing business tables
// (G2), implement RLS/runtime roles (G3), or convert routes (G4/G5). Legacy
// `api_keys` and all current behavior remain intact.
// ----------------------------------------------------------------------------

/** Tenant lifecycle. Hard delete is intentionally absent — lifecycle ends at `archived`. */
export const tenantStatuses = ['active', 'suspended', 'archived'] as const;
export type TenantStatus = (typeof tenantStatuses)[number];

/** Principal is a stable human or service subject; it holds no tenant business data. */
export const principalTypes = ['human', 'service'] as const;
export type PrincipalType = (typeof principalTypes)[number];

export const principalStatuses = ['active', 'disabled'] as const;
export type PrincipalStatus = (typeof principalStatuses)[number];

/** Fixed tenant roles. Exactly these four; none may grant/mint platform `*` authority. */
export const tenantRoles = ['tenant-owner', 'tenant-admin', 'tenant-operator', 'tenant-viewer'] as const;
export type TenantRole = (typeof tenantRoles)[number];

export const membershipStatuses = ['active', 'disabled'] as const;
export type MembershipStatus = (typeof membershipStatuses)[number];

/** A credential is exactly one class. Class separation is enforced by CHECK constraints. */
export const credentialClasses = ['tenant', 'platform'] as const;
export type CredentialClass = (typeof credentialClasses)[number];

export const authCredentialStatuses = ['active', 'revoked', 'expired'] as const;
export type AuthCredentialStatus = (typeof authCredentialStatuses)[number];

export const platformApiKeyStatuses = ['active', 'revoked'] as const;
export type PlatformApiKeyStatus = (typeof platformApiKeyStatuses)[number];

// ---------------------------------------------------------------------------
// tenants — platform control plane
// ---------------------------------------------------------------------------
export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Immutable stable slug. Lowercase, DNS-like; unique platform-wide. */
    slug: varchar('slug', { length: 63 }).notNull(),
    displayName: varchar('display_name', { length: 255 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('active').$type<TenantStatus>(),
    /** Policy epoch. Bumped on policy change; snapshotted into credentials for freshness. */
    policyVersion: integer('policy_version').notNull().default(1),
    /** Revocation epoch. Bumped on suspend/archive/mass-revoke; snapshotted into credentials. */
    revocationEpoch: integer('revocation_epoch').notNull().default(0),
    /** Mandatory per-tenant ceilings for every root/delegated credential. */
    maxKeyTtlSeconds: integer('max_key_ttl_seconds').notNull(),
    maxKeyRateLimit: integer('max_key_rate_limit').notNull(),
    maxKeyBudget: integer('max_key_budget').notNull(),
    /** Immutable creator lineage. Nullable for bootstrap/system-created tenants. */
    createdByPrincipalId: uuid('created_by_principal_id').references((): AnyPgColumn => principals.id, {
      onDelete: 'restrict',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => ({
    slugUq: uniqueIndex('tenants_slug_uq').on(table.slug),
    statusIdx: index('tenants_status_idx').on(table.status),
    statusCheck: check('tenants_status_check', sql`${table.status} IN ('active', 'suspended', 'archived')`),
    slugFormatCheck: check('tenants_slug_format_check', sql`${table.slug} ~ '^[a-z0-9][a-z0-9-]*$'`),
    epochsCheck: check('tenants_epochs_check', sql`${table.policyVersion} >= 1 AND ${table.revocationEpoch} >= 0`),
    keyPolicyCheck: check(
      'tenants_key_policy_check',
      sql`${table.maxKeyTtlSeconds} > 0 AND ${table.maxKeyRateLimit} > 0 AND ${table.maxKeyBudget} > 0`,
    ),
  }),
);
export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;

// ---------------------------------------------------------------------------
// principals — platform identity plane
// ---------------------------------------------------------------------------
export const principals = pgTable(
  'principals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: varchar('type', { length: 20 }).notNull().$type<PrincipalType>(),
    /** Stable subject identifier (e.g. external IdP subject or service name). Unique. */
    subject: varchar('subject', { length: 255 }).notNull(),
    displayName: varchar('display_name', { length: 255 }),
    status: varchar('status', { length: 20 }).notNull().default('active').$type<PrincipalStatus>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
  },
  (table) => ({
    subjectUq: uniqueIndex('principals_subject_uq').on(table.subject),
    statusIdx: index('principals_status_idx').on(table.status),
    typeCheck: check('principals_type_check', sql`${table.type} IN ('human', 'service')`),
    statusCheck: check('principals_status_check', sql`${table.status} IN ('active', 'disabled')`),
  }),
);
export type Principal = typeof principals.$inferSelect;
export type NewPrincipal = typeof principals.$inferInsert;

// ---------------------------------------------------------------------------
// tenant_memberships — principal ↔ tenant role relation
// ---------------------------------------------------------------------------
export const tenantMemberships = pgTable(
  'tenant_memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // RESTRICT: a tenant cannot be deleted while memberships exist (no cascade erase).
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    principalId: uuid('principal_id')
      .notNull()
      .references(() => principals.id, { onDelete: 'restrict' }),
    role: varchar('role', { length: 32 }).notNull().$type<TenantRole>(),
    status: varchar('status', { length: 20 }).notNull().default('active').$type<MembershipStatus>(),
    invitedByPrincipalId: uuid('invited_by_principal_id').references((): AnyPgColumn => principals.id, {
      onDelete: 'restrict',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
  },
  (table) => ({
    tenantPrincipalUq: uniqueIndex('tenant_memberships_tenant_principal_uq').on(table.tenantId, table.principalId),
    tenantIdUq: uniqueIndex('tenant_memberships_tenant_id_uq').on(table.tenantId, table.id),
    tenantPrincipalIdUq: uniqueIndex('tenant_memberships_tenant_principal_id_uq').on(
      table.tenantId,
      table.principalId,
      table.id,
    ),
    tenantIdx: index('tenant_memberships_tenant_idx').on(table.tenantId),
    principalIdx: index('tenant_memberships_principal_idx').on(table.principalId),
    roleCheck: check(
      'tenant_memberships_role_check',
      sql`${table.role} IN ('tenant-owner', 'tenant-admin', 'tenant-operator', 'tenant-viewer')`,
    ),
    statusCheck: check('tenant_memberships_status_check', sql`${table.status} IN ('active', 'disabled')`),
  }),
);
export type TenantMembership = typeof tenantMemberships.$inferSelect;
export type NewTenantMembership = typeof tenantMemberships.$inferInsert;

// ---------------------------------------------------------------------------
// tenant_role_policies — fixed, bounded role ceiling registry (seed data)
// ---------------------------------------------------------------------------
// Reference/seed table pinning the bounded scope ceiling and delegation caps of
// each fixed role. The runtime source of truth is the code constant
// TENANT_ROLE_POLICIES; this table mirrors it for auditability. The
// `max_scopes` CHECK guarantees at the schema level that NO role can ever carry
// the platform `*` capability.
export const tenantRolePolicies = pgTable(
  'tenant_role_policies',
  {
    role: varchar('role', { length: 32 }).primaryKey().$type<TenantRole>(),
    description: text('description').notNull(),
    /** Bounded scope ceiling. CHECK forbids `*`. */
    maxScopes: text('max_scopes').array().notNull(),
    canManageMemberships: boolean('can_manage_memberships').notNull(),
    canDelegateKeys: boolean('can_delegate_keys').notNull(),
    maxDelegationDepth: integer('max_delegation_depth').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    roleCheck: check(
      'tenant_role_policies_role_check',
      sql`${table.role} IN ('tenant-owner', 'tenant-admin', 'tenant-operator', 'tenant-viewer')`,
    ),
    depthCheck: check('tenant_role_policies_depth_check', sql`${table.maxDelegationDepth} >= 0`),
    noPlatformAuthorityCheck: check(
      'tenant_role_policies_no_platform_authority_check',
      sql`cardinality(${table.maxScopes}) > 0
          AND array_position(${table.maxScopes}, NULL) IS NULL
          AND NOT ('*' = ANY(${table.maxScopes}))
          AND array_to_string(${table.maxScopes}, ',') !~ '(^|,)platform:'`,
    ),
    fixedCeilingCheck: check(
      'tenant_role_policies_fixed_ceiling_check',
      sql`(
        ${table.role} = 'tenant-owner'
        AND ${table.maxScopes} = ARRAY['tenant:*', 'keys:delegate']::text[]
        AND ${table.canManageMemberships} AND ${table.canDelegateKeys} AND ${table.maxDelegationDepth} = 1
      ) OR (
        ${table.role} = 'tenant-admin'
        AND ${table.maxScopes} = ARRAY['tenant:*', 'keys:delegate']::text[]
        AND ${table.canManageMemberships} AND ${table.canDelegateKeys} AND ${table.maxDelegationDepth} = 1
      ) OR (
        ${table.role} = 'tenant-operator'
        AND ${table.maxScopes} = ARRAY['tenant:read', 'tenant:write']::text[]
        AND NOT ${table.canManageMemberships} AND NOT ${table.canDelegateKeys} AND ${table.maxDelegationDepth} = 0
      ) OR (
        ${table.role} = 'tenant-viewer'
        AND ${table.maxScopes} = ARRAY['tenant:read']::text[]
        AND NOT ${table.canManageMemberships} AND NOT ${table.canDelegateKeys} AND ${table.maxDelegationDepth} = 0
      )`,
    ),
  }),
);
export type TenantRolePolicy = typeof tenantRolePolicies.$inferSelect;
export type NewTenantRolePolicy = typeof tenantRolePolicies.$inferInsert;

// ---------------------------------------------------------------------------
// platform_api_keys — platform credential class (break-glass / automation)
// ---------------------------------------------------------------------------
// Separate store kept out of the tenant key query path and the normal tenant
// RLS context. Platform keys are the ONLY credentials that may carry platform
// scopes (including `*`).
export const platformApiKeys = pgTable(
  'platform_api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    keyPrefix: varchar('key_prefix', { length: 12 }).notNull(),
    keyHash: varchar('key_hash', { length: 64 }).notNull(),
    scopes: text('scopes').array().notNull(),
    status: varchar('status', { length: 20 }).notNull().default('active').$type<PlatformApiKeyStatus>(),
    principalId: uuid('principal_id')
      .notNull()
      .references(() => principals.id, { onDelete: 'restrict' }),
    createdByPrincipalId: uuid('created_by_principal_id').references((): AnyPgColumn => principals.id, {
      onDelete: 'restrict',
    }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: varchar('revoked_by', { length: 255 }),
    revokeReason: text('revoke_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    nameUq: uniqueIndex('platform_api_keys_name_uq').on(table.name),
    keyHashUq: uniqueIndex('platform_api_keys_key_hash_uq').on(table.keyHash),
    idPrincipalUq: uniqueIndex('platform_api_keys_id_principal_uq').on(table.id, table.principalId),
    keyPrefixIdx: index('platform_api_keys_key_prefix_idx').on(table.keyPrefix),
    statusIdx: index('platform_api_keys_status_idx').on(table.status),
    statusCheck: check('platform_api_keys_status_check', sql`${table.status} IN ('active', 'revoked')`),
  }),
);
export type PlatformApiKey = typeof platformApiKeys.$inferSelect;
export type NewPlatformApiKey = typeof platformApiKeys.$inferInsert;

// ---------------------------------------------------------------------------
// tenant_key_lineage — tenant-visible key metadata + delegation lineage
// ---------------------------------------------------------------------------
// Tenant class credential metadata. Carries immutable tenant binding, parent/
// root/creator lineage, delegation depth, and an immutable ceiling snapshot.
// The `scopes` CHECK guarantees a tenant key can NEVER hold platform `*`.
export const tenantKeyLineage = pgTable(
  'tenant_key_lineage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // RESTRICT: never cascade-delete lineage when a tenant row is removed.
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    principalId: uuid('principal_id')
      .notNull()
      .references((): AnyPgColumn => principals.id, { onDelete: 'restrict' }),
    membershipId: uuid('membership_id')
      .notNull()
      .references((): AnyPgColumn => tenantMemberships.id, { onDelete: 'restrict' }),
    actorRole: varchar('actor_role', { length: 32 }).notNull().$type<TenantRole>(),
    name: varchar('name', { length: 255 }).notNull(),
    keyPrefix: varchar('key_prefix', { length: 12 }).notNull(),
    /** Subset of parent effective scopes ∩ role ceiling. CHECK forbids `*`. */
    scopes: text('scopes').array().notNull(),
    resourceConstraints: jsonb('resource_constraints').notNull().default(sql`'{}'::jsonb`),
    status: varchar('status', { length: 20 }).notNull().default('active').$type<AuthCredentialStatus>(),
    /** Immutable parent lineage. Null = tenant root key (depth 0). */
    parentKeyId: uuid('parent_key_id').references((): AnyPgColumn => tenantKeyLineage.id, { onDelete: 'restrict' }),
    /** Lineage root id. Root key stores its own id. */
    rootKeyId: uuid('root_key_id').notNull(),
    /** Delegation depth. 0 = tenant root key; children increment. */
    depth: integer('depth').notNull().default(0),
    createdByPrincipalId: uuid('created_by_principal_id').references((): AnyPgColumn => principals.id, {
      onDelete: 'restrict',
    }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    rateLimit: integer('rate_limit'),
    budget: integer('budget'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokeReason: text('revoke_reason'),
    revocationEpoch: integer('revocation_epoch').notNull().default(0),
    /** Set by ancestor-revocation propagation. */
    ancestorRevoked: boolean('ancestor_revoked').notNull().default(false),
    /** Immutable ceiling snapshot captured at creation for audit/reproducibility. */
    ceilingSnapshot: jsonb('ceiling_snapshot').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIdUq: uniqueIndex('tenant_key_lineage_tenant_id_uq').on(table.tenantId, table.id),
    authBindingUq: uniqueIndex('tenant_key_lineage_auth_binding_uq').on(
      table.tenantId,
      table.id,
      table.principalId,
      table.membershipId,
      table.actorRole,
    ),
    tenantIdx: index('tenant_key_lineage_tenant_idx').on(table.tenantId),
    parentIdx: index('tenant_key_lineage_parent_idx').on(table.parentKeyId),
    rootIdx: index('tenant_key_lineage_root_idx').on(table.rootKeyId),
    statusIdx: index('tenant_key_lineage_status_idx').on(table.status),
    roleCheck: check(
      'tenant_key_lineage_role_check',
      sql`${table.actorRole} IN ('tenant-owner', 'tenant-admin', 'tenant-operator', 'tenant-viewer')`,
    ),
    statusCheck: check('tenant_key_lineage_status_check', sql`${table.status} IN ('active', 'revoked', 'expired')`),
    depthCheck: check('tenant_key_lineage_depth_check', sql`${table.depth} >= 0`),
    positiveLimitsCheck: check(
      'tenant_key_lineage_positive_limits_check',
      sql`(${table.rateLimit} IS NULL OR ${table.rateLimit} > 0) AND (${table.budget} IS NULL OR ${table.budget} > 0)`,
    ),
    principalMembershipPairCheck: check(
      'tenant_key_lineage_principal_membership_pair_check',
      sql`(${table.principalId} IS NULL AND ${table.membershipId} IS NULL)
          OR (${table.principalId} IS NOT NULL AND ${table.membershipId} IS NOT NULL)`,
    ),
    depthShapeCheck: check(
      'tenant_key_lineage_depth_shape_check',
      sql`(${table.depth} = 0 AND ${table.parentKeyId} IS NULL AND ${table.rootKeyId} = ${table.id})
          OR (${table.depth} = 1 AND ${table.parentKeyId} IS NOT NULL)`,
    ),
    noPlatformAuthorityCheck: check(
      'tenant_key_lineage_no_platform_authority_check',
      sql`cardinality(${table.scopes}) > 0
          AND array_position(${table.scopes}, NULL) IS NULL
          AND NOT ('*' = ANY(${table.scopes}))
          AND array_to_string(${table.scopes}, ',') !~ '(^|,)platform:'`,
    ),
    parentTenantFk: foreignKey({
      name: 'tenant_key_lineage_parent_tenant_fk',
      columns: [table.tenantId, table.parentKeyId],
      foreignColumns: [table.tenantId, table.id],
    }).onDelete('restrict'),
    rootTenantFk: foreignKey({
      name: 'tenant_key_lineage_root_tenant_fk',
      columns: [table.tenantId, table.rootKeyId],
      foreignColumns: [table.tenantId, table.id],
    }).onDelete('restrict'),
    membershipPrincipalFk: foreignKey({
      name: 'tenant_key_lineage_membership_principal_fk',
      columns: [table.tenantId, table.principalId, table.membershipId],
      foreignColumns: [tenantMemberships.tenantId, tenantMemberships.principalId, tenantMemberships.id],
    }).onDelete('restrict'),
  }),
);
export type TenantKeyLineage = typeof tenantKeyLineage.$inferSelect;
export type NewTenantKeyLineage = typeof tenantKeyLineage.$inferInsert;

// ---------------------------------------------------------------------------
// auth_credentials — ISOLATED authentication index (platform-owned)
// ---------------------------------------------------------------------------
// The minimal hash→context lookup used to establish immutable credential
// context BEFORE any tenant transaction opens. Tenant data routes can NEVER
// enumerate this table (no list path is exposed). Class separation and the
// tenant-never-`*` rule are enforced by CHECK constraints, not app code alone.
export const authCredentials = pgTable(
  'auth_credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    credentialClass: varchar('credential_class', { length: 20 }).notNull().$type<CredentialClass>(),
    /** Indexed hash-equality lookup path. No plaintext, no secret-dependent branching. */
    keyHash: varchar('key_hash', { length: 64 }).notNull(),
    keyPrefix: varchar('key_prefix', { length: 12 }).notNull(),
    // RESTRICT everywhere: no cascade deletes across the auth plane.
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'restrict' }),
    principalId: uuid('principal_id').references((): AnyPgColumn => principals.id, { onDelete: 'restrict' }),
    membershipId: uuid('membership_id').references((): AnyPgColumn => tenantMemberships.id, {
      onDelete: 'restrict',
    }),
    actorRole: varchar('actor_role', { length: 32 }).$type<TenantRole>(),
    scopes: text('scopes').array().notNull(),
    status: varchar('status', { length: 20 }).notNull().default('active').$type<AuthCredentialStatus>(),
    /** Source metadata rows. Exactly one is set per class (CHECK-enforced). */
    tenantKeyLineageId: uuid('tenant_key_lineage_id').references((): AnyPgColumn => tenantKeyLineage.id, {
      onDelete: 'restrict',
    }),
    platformApiKeyId: uuid('platform_api_key_id').references((): AnyPgColumn => platformApiKeys.id, {
      onDelete: 'restrict',
    }),
    /** Freshness snapshots compared against the live tenant epochs at lookup. */
    policySnapshotVersion: integer('policy_snapshot_version').notNull().default(1),
    revocationEpochSnapshot: integer('revocation_epoch_snapshot').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    keyHashUq: uniqueIndex('auth_credentials_key_hash_uq').on(table.keyHash),
    tenantLineageUq: uniqueIndex('auth_credentials_tenant_lineage_uq').on(table.tenantKeyLineageId),
    platformSourceUq: uniqueIndex('auth_credentials_platform_source_uq').on(table.platformApiKeyId),
    classTenantIdx: index('auth_credentials_class_tenant_idx').on(table.credentialClass, table.tenantId),
    classCheck: check('auth_credentials_class_check', sql`${table.credentialClass} IN ('tenant', 'platform')`),
    statusCheck: check('auth_credentials_status_check', sql`${table.status} IN ('active', 'revoked', 'expired')`),
    // Strong class separation: tenant class binds a tenant + lineage + role and
    // no platform source; platform class binds a platform key and no tenant.
    classSeparationCheck: check(
      'auth_credentials_class_separation_check',
      sql`(
        ${table.credentialClass} = 'tenant'
        AND ${table.tenantId} IS NOT NULL
        AND ${table.tenantKeyLineageId} IS NOT NULL
        AND ${table.actorRole} IS NOT NULL
        AND ${table.principalId} IS NOT NULL
        AND ${table.membershipId} IS NOT NULL
        AND ${table.platformApiKeyId} IS NULL
      ) OR (
        ${table.credentialClass} = 'platform'
        AND ${table.tenantId} IS NULL
        AND ${table.platformApiKeyId} IS NOT NULL
        AND ${table.principalId} IS NOT NULL
        AND ${table.membershipId} IS NULL
        AND ${table.tenantKeyLineageId} IS NULL
        AND ${table.actorRole} IS NULL
      )`,
    ),
    principalMembershipPairCheck: check(
      'auth_credentials_principal_membership_pair_check',
      sql`${table.credentialClass} <> 'tenant' OR (
        (${table.principalId} IS NULL AND ${table.membershipId} IS NULL)
        OR (${table.principalId} IS NOT NULL AND ${table.membershipId} IS NOT NULL)
      )`,
    ),
    // A tenant-class credential can never carry platform `*` authority.
    tenantNoWildcardCheck: check(
      'auth_credentials_tenant_no_wildcard_check',
      sql`${table.credentialClass} <> 'tenant' OR (
        cardinality(${table.scopes}) > 0
        AND array_position(${table.scopes}, NULL) IS NULL
        AND NOT ('*' = ANY(${table.scopes}))
        AND array_to_string(${table.scopes}, ',') !~ '(^|,)platform:'
      )`,
    ),
    tenantLineageFk: foreignKey({
      name: 'auth_credentials_tenant_lineage_fk',
      columns: [table.tenantId, table.tenantKeyLineageId],
      foreignColumns: [tenantKeyLineage.tenantId, tenantKeyLineage.id],
    }).onDelete('restrict'),
    tenantLineageBindingFk: foreignKey({
      name: 'auth_credentials_tenant_lineage_binding_fk',
      columns: [table.tenantId, table.tenantKeyLineageId, table.principalId, table.membershipId, table.actorRole],
      foreignColumns: [
        tenantKeyLineage.tenantId,
        tenantKeyLineage.id,
        tenantKeyLineage.principalId,
        tenantKeyLineage.membershipId,
        tenantKeyLineage.actorRole,
      ],
    }).onDelete('restrict'),
    membershipPrincipalFk: foreignKey({
      name: 'auth_credentials_membership_principal_fk',
      columns: [table.tenantId, table.principalId, table.membershipId],
      foreignColumns: [tenantMemberships.tenantId, tenantMemberships.principalId, tenantMemberships.id],
    }).onDelete('restrict'),
    platformSourcePrincipalFk: foreignKey({
      name: 'auth_credentials_platform_source_principal_fk',
      columns: [table.platformApiKeyId, table.principalId],
      foreignColumns: [platformApiKeys.id, platformApiKeys.principalId],
    }).onDelete('restrict'),
  }),
);
export type AuthCredential = typeof authCredentials.$inferSelect;
export type NewAuthCredential = typeof authCredentials.$inferInsert;

// ---------------------------------------------------------------------------
// tenant_audit_logs — append-only, tenant-scoped audit store
// ---------------------------------------------------------------------------
export const tenantAuditLogs = pgTable(
  'tenant_audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    actorPrincipalId: uuid('actor_principal_id').references((): AnyPgColumn => principals.id, {
      onDelete: 'restrict',
    }),
    /** auth_credentials.id of the acting credential (no FK: audit must outlive credentials). */
    actorCredentialId: uuid('actor_credential_id').notNull(),
    action: varchar('action', { length: 100 }).notNull(),
    targetType: varchar('target_type', { length: 100 }),
    targetId: varchar('target_id', { length: 255 }),
    requestId: varchar('request_id', { length: 100 }).notNull(),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIdx: index('tenant_audit_logs_tenant_idx').on(table.tenantId),
    createdAtIdx: index('tenant_audit_logs_created_at_idx').on(table.createdAt),
  }),
);
export type TenantAuditLog = typeof tenantAuditLogs.$inferSelect;
export type NewTenantAuditLog = typeof tenantAuditLogs.$inferInsert;

// ---------------------------------------------------------------------------
// platform_audit_logs — append-only platform-admin audit store
// ---------------------------------------------------------------------------
export const platformAuditLogs = pgTable(
  'platform_audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorPrincipalId: uuid('actor_principal_id').references((): AnyPgColumn => principals.id, {
      onDelete: 'restrict',
    }),
    /** platform_api_keys.id / auth_credentials.id of the actor (no FK: audit outlives credentials). */
    actorCredentialId: uuid('actor_credential_id').notNull(),
    action: varchar('action', { length: 100 }).notNull(),
    /** RESTRICT: platform audit rows pin a target tenant and must not vanish with it. */
    targetTenantId: uuid('target_tenant_id').references(() => tenants.id, { onDelete: 'restrict' }),
    reason: text('reason').notNull(),
    requestId: varchar('request_id', { length: 100 }).notNull(),
    beforeMetadata: jsonb('before_metadata'),
    afterMetadata: jsonb('after_metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    targetTenantIdx: index('platform_audit_logs_target_tenant_idx').on(table.targetTenantId),
    createdAtIdx: index('platform_audit_logs_created_at_idx').on(table.createdAt),
    targetShapeCheck: check(
      'platform_audit_logs_target_shape_check',
      sql`${table.targetTenantId} IS NOT NULL OR ${table.action} = 'tenant.list'`,
    ),
  }),
);
export type PlatformAuditLog = typeof platformAuditLogs.$inferSelect;
export type NewPlatformAuditLog = typeof platformAuditLogs.$inferInsert;

// ============================================================================
// G2 SPLIT DESTINATIONS — additive schema contract only (migration 0041)
//
// G0 classifies seven legacy tables `split`. G1 delivered the key/auth/audit
// split; these are the five remaining concepts. G2 creates the destinations
// EMPTY: no legacy row is copied, no read or write path is switched, and no
// legacy table gains an ambiguous nullable tenant owner. Cutover is G3/G4.
// ============================================================================

// ---------------------------------------------------------------------------
// platform_provider_catalog — immutable, non-secret built-in provider catalog
// ---------------------------------------------------------------------------
export const platformProviderCatalog = pgTable(
  'platform_provider_catalog',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    providerType: varchar('provider_type', { length: 50 }).notNull(),
    displayName: varchar('display_name', { length: 255 }).notNull(),
    description: text('description'),
    capabilities: jsonb('capabilities').notNull().default(sql`'{}'::jsonb`),
    configSchema: jsonb('config_schema'),
    isBuiltin: boolean('is_builtin').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    providerTypeUq: uniqueIndex('platform_provider_catalog_type_uq').on(table.providerType),
  }),
);
export type PlatformProviderCatalogEntry = typeof platformProviderCatalog.$inferSelect;
export type NewPlatformProviderCatalogEntry = typeof platformProviderCatalog.$inferInsert;

// ---------------------------------------------------------------------------
// tenant_provider_config — tenant-configured provider credentials/config
// ---------------------------------------------------------------------------
export const tenantProviderConfig = pgTable(
  'tenant_provider_config',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    providerType: varchar('provider_type', { length: 50 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    baseUrl: text('base_url'),
    config: jsonb('config').notNull().default(sql`'{}'::jsonb`),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantNameUq: uniqueIndex('tenant_provider_config_tenant_name_uq').on(table.tenantId, table.name),
  }),
);
export type TenantProviderConfig = typeof tenantProviderConfig.$inferSelect;
export type NewTenantProviderConfig = typeof tenantProviderConfig.$inferInsert;

// ---------------------------------------------------------------------------
// platform_settings — platform runtime values, unreachable by tenant runtime
// ---------------------------------------------------------------------------
export const platformSettings = pgTable(
  'platform_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: varchar('key', { length: 255 }).notNull(),
    value: jsonb('value').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    keyUq: uniqueIndex('platform_settings_key_uq').on(table.key),
  }),
);
export type PlatformSetting = typeof platformSettings.$inferSelect;
export type NewPlatformSetting = typeof platformSettings.$inferInsert;

// ---------------------------------------------------------------------------
// tenant_settings — tenant-scoped settings plane
// ---------------------------------------------------------------------------
export const tenantSettings = pgTable(
  'tenant_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    key: varchar('key', { length: 255 }).notNull(),
    value: jsonb('value').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantKeyUq: uniqueIndex('tenant_settings_tenant_key_uq').on(table.tenantId, table.key),
  }),
);
export type TenantSetting = typeof tenantSettings.$inferSelect;
export type NewTenantSetting = typeof tenantSettings.$inferInsert;

// ---------------------------------------------------------------------------
// platform_setting_change_history — append-only history of platform settings
// ---------------------------------------------------------------------------
export const platformSettingChangeHistory = pgTable('platform_setting_change_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  settingId: uuid('setting_id').references((): AnyPgColumn => platformSettings.id, { onDelete: 'restrict' }),
  key: varchar('key', { length: 255 }).notNull(),
  oldValue: jsonb('old_value'),
  newValue: jsonb('new_value'),
  changedBy: varchar('changed_by', { length: 255 }),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export type PlatformSettingChange = typeof platformSettingChangeHistory.$inferSelect;
export type NewPlatformSettingChange = typeof platformSettingChangeHistory.$inferInsert;

// ---------------------------------------------------------------------------
// tenant_setting_change_history — append-only history of tenant settings
// ---------------------------------------------------------------------------
export const tenantSettingChangeHistory = pgTable(
  'tenant_setting_change_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    settingId: uuid('setting_id').references((): AnyPgColumn => tenantSettings.id, { onDelete: 'restrict' }),
    key: varchar('key', { length: 255 }).notNull(),
    oldValue: jsonb('old_value'),
    newValue: jsonb('new_value'),
    changedBy: varchar('changed_by', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIdx: index('tenant_setting_change_history_tenant_idx').on(table.tenantId),
  }),
);
export type TenantSettingChange = typeof tenantSettingChangeHistory.$inferSelect;
export type NewTenantSettingChange = typeof tenantSettingChangeHistory.$inferInsert;

// ---------------------------------------------------------------------------
// platform_plugin_storage — platform-owned plugin state
// ---------------------------------------------------------------------------
export const platformPluginStorage = pgTable(
  'platform_plugin_storage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pluginId: varchar('plugin_id', { length: 100 }).notNull(),
    key: varchar('key', { length: 255 }).notNull(),
    value: jsonb('value').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pluginKeyUq: uniqueIndex('platform_plugin_storage_plugin_key_uq').on(table.pluginId, table.key),
  }),
);
export type PlatformPluginStorageRow = typeof platformPluginStorage.$inferSelect;
export type NewPlatformPluginStorageRow = typeof platformPluginStorage.$inferInsert;

// ---------------------------------------------------------------------------
// tenant_plugin_storage — tenant-owned plugin state (no mixed keyspace)
// ---------------------------------------------------------------------------
export const tenantPluginStorage = pgTable(
  'tenant_plugin_storage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    pluginId: varchar('plugin_id', { length: 100 }).notNull(),
    key: varchar('key', { length: 255 }).notNull(),
    value: jsonb('value').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantPluginKeyUq: uniqueIndex('tenant_plugin_storage_tenant_plugin_key_uq').on(
      table.tenantId,
      table.pluginId,
      table.key,
    ),
  }),
);
export type TenantPluginStorageRow = typeof tenantPluginStorage.$inferSelect;
export type NewTenantPluginStorageRow = typeof tenantPluginStorage.$inferInsert;

// ---------------------------------------------------------------------------
// platform_payload_storage_config — platform-owned payload backend config
// ---------------------------------------------------------------------------
export const platformPayloadStorageConfig = pgTable(
  'platform_payload_storage_config',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    backend: varchar('backend', { length: 50 }).notNull(),
    retentionDays: integer('retention_days'),
    maxPayloadBytes: integer('max_payload_bytes'),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    eventTypeUq: uniqueIndex('platform_payload_storage_config_event_type_uq').on(table.eventType),
  }),
);
export type PlatformPayloadStorageConfig = typeof platformPayloadStorageConfig.$inferSelect;
export type NewPlatformPayloadStorageConfig = typeof platformPayloadStorageConfig.$inferInsert;

// ---------------------------------------------------------------------------
// tenant_payload_storage_overrides — per-tenant retention/quota overrides
// ---------------------------------------------------------------------------
export const tenantPayloadStorageOverrides = pgTable(
  'tenant_payload_storage_overrides',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    retentionDays: integer('retention_days'),
    maxPayloadBytes: integer('max_payload_bytes'),
    quotaBytes: bigint('quota_bytes', { mode: 'number' }),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantEventUq: uniqueIndex('tenant_payload_storage_overrides_tenant_event_uq').on(table.tenantId, table.eventType),
  }),
);
export type TenantPayloadStorageOverride = typeof tenantPayloadStorageOverrides.$inferSelect;
export type NewTenantPayloadStorageOverride = typeof tenantPayloadStorageOverrides.$inferInsert;

// ============================================================================
// G2 MIGRATION LEDGER — platform migration plane (WISH lines 185-190)
// ============================================================================

/**
 * tenant_migration_ledger — the conjunctive ownership-decision record.
 *
 * A row is only a valid ownership decision when it carries source identity,
 * target tenant, the decision rule, a redacted pre-image and post-image with
 * checksums, an inverse OR an explicit compensating action, the WAL/LSN
 * high-water mark, the writer epoch, status, ambiguity/quarantine state, the
 * reconciliation receipt, and the attempt/checkpoint data an interrupted run
 * needs to resume idempotently.
 *
 * The head row is mutable so a resume can advance status/attempt/checkpoint;
 * every version is mirrored into `tenant_migration_ledger_history`, which is
 * append-only at the database boundary.
 *
 * Images are REDACTED projections plus checksums. No plaintext credential,
 * secret value, or unredacted sensitive payload is ever stored here.
 *
 * `wal_lsn_high_water` is `pg_lsn` in SQL; Drizzle has no `pg_lsn` type, so it
 * is mapped as text (the wire representation is the same `X/Y` string).
 */
export const tenantMigrationLedger = pgTable(
  'tenant_migration_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceTable: varchar('source_table', { length: 63 }).notNull(),
    sourcePrimaryKey: jsonb('source_primary_key').notNull(),
    /** RESTRICT: a tenant can never be cascade-deleted through its migration record. */
    targetTenantId: uuid('target_tenant_id').references(() => tenants.id, { onDelete: 'restrict' }),
    decisionRule: text('decision_rule').notNull(),
    preImageRedacted: jsonb('pre_image_redacted').notNull(),
    preImageChecksum: varchar('pre_image_checksum', { length: 64 }).notNull(),
    postImageRedacted: jsonb('post_image_redacted'),
    postImageChecksum: varchar('post_image_checksum', { length: 64 }),
    inverseAction: jsonb('inverse_action'),
    compensatingAction: jsonb('compensating_action'),
    /** SQL type `pg_lsn`; carried as its canonical text form. */
    walLsnHighWater: text('wal_lsn_high_water').notNull(),
    writerEpoch: bigint('writer_epoch', { mode: 'number' }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('planned'),
    ambiguityState: varchar('ambiguity_state', { length: 20 }).notNull().default('none'),
    reconciliationReceipt: jsonb('reconciliation_receipt'),
    attemptCount: integer('attempt_count').notNull().default(0),
    checkpoint: jsonb('checkpoint'),
    redactionPolicy: varchar('redaction_policy', { length: 100 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sourceUq: uniqueIndex('tenant_migration_ledger_source_uq').on(table.sourceTable, table.sourcePrimaryKey),
    statusIdx: index('tenant_migration_ledger_status_idx').on(table.status),
    tenantIdx: index('tenant_migration_ledger_tenant_idx')
      .on(table.targetTenantId)
      .where(sql`${table.targetTenantId} IS NOT NULL`),
    statusCheck: check(
      'tenant_migration_ledger_status_check',
      sql`${table.status} IN ('planned', 'applied', 'compensated', 'failed', 'quarantined')`,
    ),
    ambiguityCheck: check(
      'tenant_migration_ledger_ambiguity_check',
      sql`${table.ambiguityState} IN ('none', 'ambiguous', 'quarantined')`,
    ),
    checksumsCheck: check(
      'tenant_migration_ledger_checksums_check',
      sql`${table.preImageChecksum} ~ '^[0-9a-f]{64}$' AND (${table.postImageChecksum} IS NULL OR ${table.postImageChecksum} ~ '^[0-9a-f]{64}$')`,
    ),
    /** Every decision must be reversible: an inverse, or an explicit compensating action. */
    inverseOrCompensatingCheck: check(
      'tenant_migration_ledger_inverse_or_compensating_check',
      sql`${table.inverseAction} IS NOT NULL OR ${table.compensatingAction} IS NOT NULL`,
    ),
    /** An applied decision must name the tenant it assigned and carry its post-image. */
    appliedCompletenessCheck: check(
      'tenant_migration_ledger_applied_completeness_check',
      sql`${table.status} <> 'applied' OR (${table.targetTenantId} IS NOT NULL AND ${table.postImageChecksum} IS NOT NULL AND ${table.reconciliationReceipt} IS NOT NULL)`,
    ),
    /** Ambiguity is never silently resolved into an assignment. */
    quarantineCheck: check(
      'tenant_migration_ledger_quarantine_check',
      sql`${table.ambiguityState} = 'none' OR ${table.targetTenantId} IS NULL`,
    ),
    attemptsCheck: check('tenant_migration_ledger_attempts_check', sql`${table.attemptCount} >= 0`),
    epochCheck: check('tenant_migration_ledger_epoch_check', sql`${table.writerEpoch} >= 0`),
  }),
);
export type TenantMigrationLedgerRow = typeof tenantMigrationLedger.$inferSelect;
export type NewTenantMigrationLedgerRow = typeof tenantMigrationLedger.$inferInsert;

/**
 * tenant_migration_ledger_history — append-only mirror of every ledger revision.
 *
 * Enforced append-only at the database boundary by BEFORE UPDATE/DELETE and
 * BEFORE TRUNCATE triggers created in migration 0041.
 */
export const tenantMigrationLedgerHistory = pgTable(
  'tenant_migration_ledger_history',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    ledgerId: uuid('ledger_id').notNull(),
    revision: integer('revision').notNull(),
    sourceTable: varchar('source_table', { length: 63 }).notNull(),
    sourcePrimaryKey: jsonb('source_primary_key').notNull(),
    /** No FK: the history must outlive any tenant row it references. */
    targetTenantId: uuid('target_tenant_id'),
    decisionRule: text('decision_rule').notNull(),
    preImageChecksum: varchar('pre_image_checksum', { length: 64 }).notNull(),
    postImageChecksum: varchar('post_image_checksum', { length: 64 }),
    /** SQL type `pg_lsn`; carried as its canonical text form. */
    walLsnHighWater: text('wal_lsn_high_water').notNull(),
    writerEpoch: bigint('writer_epoch', { mode: 'number' }).notNull(),
    status: varchar('status', { length: 20 }).notNull(),
    ambiguityState: varchar('ambiguity_state', { length: 20 }).notNull(),
    attemptCount: integer('attempt_count').notNull(),
    checkpoint: jsonb('checkpoint'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    revisionUq: uniqueIndex('tenant_migration_ledger_history_revision_uq').on(table.ledgerId, table.revision),
    ledgerIdx: index('tenant_migration_ledger_history_ledger_idx').on(table.ledgerId),
  }),
);
export type TenantMigrationLedgerHistoryRow = typeof tenantMigrationLedgerHistory.$inferSelect;
export type NewTenantMigrationLedgerHistoryRow = typeof tenantMigrationLedgerHistory.$inferInsert;
