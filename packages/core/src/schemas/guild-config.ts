/**
 * Per-guild configuration override schemas for Discord instances.
 *
 * Guild config overlays instance-level defaults, enabling different behavior
 * per Discord server connected to the same instance.
 */

import { z } from 'zod';

/**
 * Agent reply filter override (same shape as instance-level)
 */
const GuildAgentReplyFilterSchema = z.object({
  mode: z.enum(['all', 'filtered']).optional(),
  conditions: z
    .object({
      onDm: z.boolean().optional(),
      onMention: z.boolean().optional(),
      onReply: z.boolean().optional(),
      onNameMatch: z.boolean().optional(),
      namePatterns: z.array(z.string()).optional(),
    })
    .optional(),
});

/**
 * Per-guild configuration override.
 * All fields are optional — only set fields override instance defaults.
 */
export const GuildConfigOverrideSchema = z.object({
  /** Override agent reply filter for this guild */
  agentReplyFilter: GuildAgentReplyFilterSchema.optional(),
  /** Tool policies per guild (e.g., disable certain tools in specific servers) */
  toolPolicies: z.record(z.string(), z.enum(['allow', 'deny'])).optional(),
  /** Reaction settings override */
  reactions: z
    .object({
      enabled: z.boolean().optional(),
      allowedEmojis: z.array(z.string()).optional(),
    })
    .optional(),
  /** Soft max lines per message (0 = disabled, default from instance) */
  maxLines: z.number().int().min(0).optional(),
  /** Bot presence override for this guild */
  presence: z
    .object({
      status: z.enum(['online', 'dnd', 'idle', 'invisible']).optional(),
      activityText: z.string().max(128).optional(),
      activityType: z.enum(['Playing', 'Streaming', 'Listening', 'Watching', 'Custom', 'Competing']).optional(),
    })
    .optional(),
});

export type GuildConfigOverride = z.infer<typeof GuildConfigOverrideSchema>;

/**
 * Map of guild ID → config override, stored as JSONB on the instances table.
 */
export const GuildConfigOverridesSchema = z.record(z.string(), GuildConfigOverrideSchema);

export type GuildConfigOverrides = z.infer<typeof GuildConfigOverridesSchema>;

/**
 * Audit log entry for guild config changes.
 */
export const GuildConfigAuditEntrySchema = z.object({
  instanceId: z.string().uuid(),
  guildId: z.string(),
  apiKeyId: z.string().optional(),
  action: z.enum(['create', 'update', 'delete']),
  diff: z.record(z.string(), z.unknown()),
  timestamp: z.number(),
});

export type GuildConfigAuditEntry = z.infer<typeof GuildConfigAuditEntrySchema>;

/**
 * Bot presence configuration schema (used in API endpoints).
 */
export const BotPresenceSchema = z.object({
  status: z.enum(['online', 'dnd', 'idle', 'invisible']).default('online'),
  activityText: z.string().max(128).optional(),
  activityType: z.enum(['Playing', 'Streaming', 'Listening', 'Watching', 'Custom', 'Competing']).default('Playing'),
});

export type BotPresence = z.infer<typeof BotPresenceSchema>;
