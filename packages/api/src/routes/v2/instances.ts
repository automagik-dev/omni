/**
 * Instances routes - CRUD operations for channel instances
 */

import { zValidator } from '@hono/zod-validator';
import type { ChannelPlugin, ChannelRegistry } from '@omni/channel-sdk';
import { AccessModeSchema, ChannelTypeSchema, NotFoundError, createLogger } from '@omni/core';
import type { SyncJobType } from '@omni/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { accessCache } from '../../cache/cache-keys';
import { DEFAULT_TURN_SCOPES } from '../../constants/scopes';
import { filterByInstanceAccess, requireInstanceAccess } from '../../middleware/auth';
import { getQrCode } from '../../plugins/qr-store';
import type { Services } from '../../services';
import { PairingRequestConsumedError, PairingRequestExpiredError } from '../../services/access';
import { AgentReplayService } from '../../services/agent-replay';
import type { AppVariables } from '../../types';

const log = createLogger('api:instances');

const instancesRoutes = new Hono<{ Variables: AppVariables }>();

// Instance access middleware for :id routes
const instanceAccess = requireInstanceAccess((c) => c.req.param('id'));

// Query params schema for list
const listQuerySchema = z.object({
  channel: z
    .string()
    .optional()
    .transform(
      (v) => v?.split(',') as ('whatsapp-baileys' | 'whatsapp-cloud' | 'discord' | 'slack' | 'telegram')[] | undefined,
    ),
  status: z
    .string()
    .optional()
    .transform((v) => v?.split(',') as ('active' | 'inactive')[] | undefined),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

// Reply filter schema
const agentReplyFilterSchema = z.object({
  mode: z.enum(['all', 'filtered']).describe('Reply mode: all = reply to everything, filtered = check conditions'),
  conditions: z
    .object({
      onDm: z.boolean().default(true).describe('Reply if message is a DM'),
      onMention: z.boolean().default(true).describe('Reply if bot is @mentioned'),
      onReply: z.boolean().default(true).describe('Reply if message is a reply to bot'),
      onNameMatch: z.boolean().default(false).describe('Reply if bot name appears in text'),
      namePatterns: z.array(z.string()).optional().describe('Custom patterns for name matching'),
    })
    .default({ onDm: true, onMention: true, onReply: true, onNameMatch: false }),
});

// Create instance schema
const createInstanceSchema = z.object({
  name: z.string().min(1).max(255).describe('Unique name for the instance'),
  channel: ChannelTypeSchema.describe('Channel type (e.g., whatsapp-baileys, discord)'),
  agentId: z.string().uuid().nullable().optional().describe('Agent UUID referencing agents table'),
  agentTimeout: z.number().int().positive().default(60).describe('Agent timeout in seconds'),
  agentStreamMode: z.boolean().default(false).describe('Enable streaming responses'),
  agentReplyFilter: agentReplyFilterSchema.optional().nullable().describe('When agent should reply'),
  agentSessionStrategy: z
    .enum(['per_user', 'per_chat', 'per_thread'])
    .default('per_chat')
    .describe('Session strategy for agent memory'),
  agentPrefixSenderName: z.boolean().default(true).describe('Prefix messages with sender name'),
  enableAutoSplit: z.boolean().default(true).describe('Split responses on double newlines'),
  messageFormatMode: z
    .enum(['convert', 'passthrough'])
    .default('convert')
    .describe('Format conversion: convert markdown to native channel syntax, or passthrough raw text'),
  isDefault: z.boolean().default(false).describe('Set as default instance for channel'),
  token: z.string().optional().describe('Bot token for Discord instances (required for Discord)'),
  ttsVoiceId: z.string().optional().nullable().describe('Default ElevenLabs voice ID for this instance'),
  ttsModelId: z.string().optional().nullable().describe('Default ElevenLabs model for this instance'),
  accessMode: AccessModeSchema.optional().describe('Access control mode: disabled, blocklist, or allowlist'),
  agentWaitForMedia: z.boolean().default(true).describe('Wait for media processing before dispatching to agent'),
  agentSendMediaPath: z.boolean().default(true).describe('Include file path in formatted media text sent to agent'),
  agentSendMediaPathTypes: z
    .array(z.string())
    .optional()
    .nullable()
    .describe('Content types that receive file path (e.g. image, video, document). Default: all except audio'),
  messageDebounceMode: z
    .enum(['disabled', 'fixed', 'randomized'])
    .default('randomized')
    .describe('Message debounce mode: disabled, fixed delay, or randomized delay'),
  messageDebounceMinMs: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe('Minimum debounce delay in milliseconds (0 = no debounce)'),
  messageDebounceMaxMs: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe('Maximum debounce delay in milliseconds (0 = no debounce)'),
  messageDebounceRestartOnTyping: z.boolean().default(false).describe('Restart debounce timer when user is typing'),
  messageDebounceGroupMs: z
    .number()
    .int()
    .min(0)
    .nullable()
    .default(null)
    .describe('Debounce delay for group chats in milliseconds (null = use messageDebounceMinMs)'),
  messageSplitDelayMode: z
    .enum(['disabled', 'fixed', 'randomized'])
    .default('randomized')
    .describe('Between-chunk delay when agent responses are split into multiple messages'),
  messageSplitDelayFixedMs: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe('Fixed delay between split chunks in milliseconds (used when messageSplitDelayMode="fixed")'),
  messageSplitDelayMinMs: z
    .number()
    .int()
    .min(0)
    .default(300)
    .describe('Minimum delay between split chunks in milliseconds (used when messageSplitDelayMode="randomized")'),
  messageSplitDelayMaxMs: z
    .number()
    .int()
    .min(0)
    .default(1000)
    .describe('Maximum delay between split chunks in milliseconds (used when messageSplitDelayMode="randomized")'),
  agentGateEnabled: z.boolean().default(false).describe('Enable LLM response gate (pre-filter before agent dispatch)'),
  agentGateModel: z
    .string()
    .nullable()
    .default(null)
    .describe('Model for response gate (default: gemini-3-flash-preview)'),
  agentGatePrompt: z.string().nullable().default(null).describe('Custom prompt for response gate (null = use default)'),
  telegramBotToken: z.string().optional().nullable().describe('Telegram bot token (persisted for reconnection)'),
  discordBotToken: z.string().optional().nullable().describe('Discord bot token (persisted for reconnection)'),
  slackBotToken: z.string().optional().nullable().describe('Slack bot token (persisted for reconnection)'),
  slackAppToken: z.string().optional().nullable().describe('Slack app token (persisted for reconnection)'),
  slackSigningSecret: z.string().optional().nullable().describe('Slack signing secret (persisted for reconnection)'),
  gupshupCallbackUrl: z.string().optional().nullable().describe('Gupshup Custom Integration callback URL'),
  gupshupAuthToken: z.string().optional().nullable().describe('Gupshup Custom Integration auth token'),
  gupshupEventId: z.string().optional().nullable().describe('Gupshup event ID (default: nx_omni_agent_reply)'),
  webhookVerifyToken: z.string().optional().nullable().describe('Gupshup webhook verify token'),
  readReceipts: z
    .enum(['on', 'off', 'exclude-self'])
    .default('on')
    .describe('Read receipt mode: on (default), off, or exclude-self (skip receipts for the instance own number)'),
  groupHistorySize: z
    .number()
    .int()
    .min(0)
    .max(200)
    .default(50)
    .describe(
      'Number of context messages to include when dispatching to agent. Groups use the full value; DMs are capped at 20. (0 = disabled, max 200)',
    ),
  markOnlineOnConnect: z
    .boolean()
    .default(true)
    .describe(
      'Mark the instance as online when connecting to WhatsApp (default: true). Set to false to preserve phone push notifications.',
    ),
  reactionAck: z
    .enum(['on', 'off'])
    .default('off')
    .describe('Reaction ack mode: on to send a reaction while agent processes'),
  reactionAckEmoji: z
    .record(z.string())
    .optional()
    .nullable()
    .describe('Per-channel emoji map for reaction ack (e.g. {"whatsapp":"\\u2705"})'),
  ackTimeoutMs: z
    .number()
    .int()
    .min(0)
    .max(120_000)
    .default(30_000)
    .describe('Ack timeout in milliseconds (max 120000)'),
  agentStalledTimeoutMs: z
    .number()
    .int()
    .min(0)
    .default(600_000)
    .describe('Idle threshold in ms before the internal turn.stalled event fires (no channel message is ever sent)'),
});

// Update instance schema - allow null to clear values (only for nullable DB fields)
// NOTE: .partial() on fields with .default() still fires the default for omitted keys,
// so we must explicitly override fields that have defaults to strip the default value.
// Without this, a PATCH that omits e.g. readReceipts would reset it to 'on'.
const updateInstanceSchema = createInstanceSchema.partial().extend({
  // Nullable fields in DB - can be set to null
  agentId: z.string().uuid().nullable().optional(),
  agentReplyFilter: agentReplyFilterSchema.nullable().optional(),
  triggerEvents: z.array(z.string()).nullable().optional(),
  telegramBotToken: z.string().nullable().optional(),
  discordBotToken: z.string().nullable().optional(),
  slackBotToken: z.string().nullable().optional(),
  slackAppToken: z.string().nullable().optional(),
  gupshupCallbackUrl: z.string().nullable().optional(),
  gupshupAuthToken: z.string().nullable().optional(),
  gupshupEventId: z.string().nullable().optional(),
  webhookVerifyToken: z.string().nullable().optional(),
  // NOT NULL fields in DB - cannot be set to null
  // agentType, agentTimeout, agentStreamMode, agentSessionStrategy, agentPrefixSenderName,
  // triggerMode, triggerRateLimit, messageDebounce* all have NOT NULL constraints

  // Override fields with .default() to strip the default — omitted keys must stay undefined
  // so PATCH only updates what is explicitly sent (not reset to defaults)
  readReceipts: z.enum(['on', 'off', 'exclude-self']).optional(),
  markOnlineOnConnect: z.boolean().optional(),
  groupHistorySize: z.number().int().min(0).max(200).optional(),
  reactionAck: z.enum(['on', 'off']).optional(),
  reactionAckEmoji: z.record(z.string()).nullable().optional(),
  ackTimeoutMs: z.number().int().min(0).max(120_000).optional(),
  agentStalledTimeoutMs: z.number().int().min(0).optional(),
  // Split-delay fields are NOT NULL in DB — override to strip defaults so a
  // PATCH that omits them doesn't reset the stored values on the row.
  messageSplitDelayMode: z.enum(['disabled', 'fixed', 'randomized']).optional(),
  messageSplitDelayFixedMs: z.number().int().min(0).optional(),
  messageSplitDelayMinMs: z.number().int().min(0).optional(),
  messageSplitDelayMaxMs: z.number().int().min(0).optional(),
});

/**
 * Map the generic `token` field to the correct channel-specific DB column.
 * Also returns the token to use for the plugin connect call.
 */
function resolveChannelToken(data: {
  channel: string;
  token?: string;
  telegramBotToken?: string | null;
  discordBotToken?: string | null;
  slackBotToken?: string | null;
}): string | undefined {
  // If a generic `token` was provided but no channel-specific field, persist it
  if (data.token && !data.telegramBotToken && !data.discordBotToken && !data.slackBotToken) {
    if (data.channel === 'telegram') data.telegramBotToken = data.token;
    else if (data.channel === 'discord') data.discordBotToken = data.token;
    else if (data.channel === 'slack') data.slackBotToken = data.token;
  }
  return data.token ?? data.telegramBotToken ?? data.discordBotToken ?? data.slackBotToken ?? undefined;
}

function persistedTokenForChannel(instance: {
  channel: string;
  telegramBotToken?: string | null;
  discordBotToken?: string | null;
  slackBotToken?: string | null;
}): string | undefined {
  switch (instance.channel) {
    case 'telegram':
      return instance.telegramBotToken ?? undefined;
    case 'discord':
      return instance.discordBotToken ?? undefined;
    case 'slack':
      return instance.slackBotToken ?? undefined;
    default:
      return undefined;
  }
}

/** Sensitive fields that must never be returned in API responses */
const SENSITIVE_INSTANCE_FIELDS = [
  'telegramBotToken',
  'discordBotToken',
  'slackBotToken',
  'slackAppToken',
  'slackSigningSecret',
  'gupshupAuthToken',
  'webhookVerifyToken',
] as const;

/** Strip secret tokens from an instance before returning it in API responses */
function sanitizeInstance<T extends Record<string, unknown>>(
  instance: T,
): Omit<T, (typeof SENSITIVE_INSTANCE_FIELDS)[number]> {
  const sanitized = { ...instance };
  for (const field of SENSITIVE_INSTANCE_FIELDS) {
    delete sanitized[field];
  }
  return sanitized;
}

/** Apply Slack-specific config from profileMetadata */
function applySlackProfileMetadata(
  opts: Record<string, unknown>,
  metadata: Record<string, unknown> | null | undefined,
): void {
  if (!metadata) return;
  if (metadata.replyToMode) opts.replyToMode = metadata.replyToMode;
  if (metadata.streamMode) opts.streamMode = metadata.streamMode;
  if (metadata.dmPolicy) opts.dmPolicy = metadata.dmPolicy;
  if (metadata.dmAllowlist) opts.dmAllowlist = metadata.dmAllowlist;
}

/** Apply Slack tokens and config to connection options */
function applySlackConnectOptions(
  opts: Record<string, unknown>,
  instance: {
    slackBotToken?: string | null;
    slackAppToken?: string | null;
    slackSigningSecret?: string | null;
    profileMetadata?: Record<string, unknown> | null;
  },
  overrides?: { slackBotToken?: string | null; slackAppToken?: string | null; slackSigningSecret?: string | null },
): void {
  const botToken = overrides?.slackBotToken ?? instance.slackBotToken ?? opts.token;
  if (botToken) opts.botToken = botToken;
  const appToken = overrides?.slackAppToken ?? instance.slackAppToken;
  if (appToken) opts.appToken = appToken;
  const signingSecret = overrides?.slackSigningSecret ?? instance.slackSigningSecret;
  if (signingSecret) opts.signingSecret = signingSecret;
  applySlackProfileMetadata(opts, instance.profileMetadata);
}

/**
 * Map channel type to its token DB column name.
 * Returns undefined for channels that don't store tokens.
 */
function channelTokenField(channel: string): string | undefined {
  switch (channel) {
    case 'telegram':
      return 'telegramBotToken';
    case 'discord':
      return 'discordBotToken';
    case 'slack':
      return 'slackBotToken';
    default:
      return undefined;
  }
}

type InstanceConnectionOptionsInput = {
  channel: string;
  forceNewQr: boolean;
  token?: string;
  telegramReactionLevel?: string | null;
  slackAppToken?: string | null;
  slackSigningSecret?: string | null;
  whatsapp?: { syncFullHistory?: boolean };
  gupshupCallbackUrl?: string | null;
  gupshupAuthToken?: string | null;
  gupshupEventId?: string | null;
  webhookVerifyToken?: string | null;
};

function applyChannelSpecificConnectionOptions(
  options: Record<string, unknown>,
  input: InstanceConnectionOptionsInput,
): void {
  if (input.channel === 'telegram') {
    options.telegramReactionLevel = input.telegramReactionLevel;
    return;
  }

  if (input.channel === 'slack') {
    if (input.token) options.botToken = input.token;
    if (input.slackAppToken) options.appToken = input.slackAppToken;
    if (input.slackSigningSecret) options.signingSecret = input.slackSigningSecret;
  }

  if (input.channel === 'gupshup') {
    if (input.gupshupCallbackUrl) options.gupshupCallbackUrl = input.gupshupCallbackUrl;
    if (input.gupshupAuthToken) options.gupshupAuthToken = input.gupshupAuthToken;
    if (input.gupshupEventId) options.gupshupEventId = input.gupshupEventId;
    if (input.webhookVerifyToken) options.webhookVerifyToken = input.webhookVerifyToken;
  }
}

function buildInstanceConnectionOptions(input: InstanceConnectionOptionsInput): Record<string, unknown> {
  const options: Record<string, unknown> = { forceNewQr: input.forceNewQr };
  if (input.token) {
    options.token = input.token;
  }
  applyChannelSpecificConnectionOptions(options, input);
  if (input.whatsapp) {
    options.whatsapp = input.whatsapp;
  }
  return options;
}

function getPluginFromRegistry(
  channelRegistry: ChannelRegistry | null | undefined,
  channel: string,
): ChannelPlugin | undefined {
  return channelRegistry?.get(channel as Parameters<ChannelRegistry['get']>[0]);
}

async function connectInstanceWithPlugin(
  plugin: ChannelPlugin,
  instanceId: string,
  options: Record<string, unknown>,
): Promise<string | undefined> {
  try {
    await plugin.connect(instanceId, {
      instanceId,
      credentials: {},
      options,
    });
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : 'Unknown error';
  }
}

async function triggerCreateConnection(
  channelRegistry: ChannelRegistry | null | undefined,
  channel: string,
  instanceId: string,
  options: Record<string, unknown>,
): Promise<void> {
  const plugin = getPluginFromRegistry(channelRegistry, channel);
  if (!plugin) {
    log.warn('No plugin found for channel', { channel });
    return;
  }

  const errorMessage = await connectInstanceWithPlugin(plugin, instanceId, options);
  if (errorMessage) {
    log.error('Failed to connect instance', { instanceId, error: errorMessage });
    return;
  }

  log.info('Triggered connection', { instanceId, channel });
}

/** Build DB update payload to persist tokens provided in a connect request */
function buildTokenPersistUpdates(
  channel: string,
  body: { token?: string; slackBotToken?: string; slackAppToken?: string; slackSigningSecret?: string },
): Record<string, string> {
  const updates: Record<string, string> = {};
  const tokenField = body.token ? channelTokenField(channel) : undefined;
  if (tokenField && body.token) updates[tokenField] = body.token;
  if (channel === 'slack') {
    if (body.slackBotToken) updates.slackBotToken = body.slackBotToken;
    if (body.slackAppToken) updates.slackAppToken = body.slackAppToken;
    if (body.slackSigningSecret) updates.slackSigningSecret = body.slackSigningSecret;
  }
  return updates;
}

/**
 * GET /instances - List all instances
 */
instancesRoutes.get('/', zValidator('query', listQuerySchema), async (c) => {
  const { channel, status, limit, cursor } = c.req.valid('query');
  const services = c.get('services');
  const apiKey = c.get('apiKey');

  const result = await services.instances.list({ channel, status, limit, cursor });

  // Filter by API key's allowed instanceIds
  const filtered = apiKey ? filterByInstanceAccess(result.items, (item) => item.id, apiKey) : result.items;
  const items = filtered.map(sanitizeInstance);

  return c.json({
    items,
    meta: {
      hasMore: result.hasMore,
      cursor: result.cursor,
    },
  });
});

/**
 * GET /instances/supported-channels - List supported channel types
 *
 * NOTE: This route MUST be defined before /:id to avoid being captured by the param
 */
instancesRoutes.get('/supported-channels', async (c) => {
  const channelRegistry = c.get('channelRegistry');

  // Get loaded plugins from registry
  const loadedPlugins = channelRegistry ? channelRegistry.getAll() : [];

  // Build dynamic list from loaded plugins
  const loadedChannels = loadedPlugins.map((plugin) => ({
    id: plugin.id,
    name: plugin.name,
    version: plugin.version,
    loaded: true as const,
    capabilities: plugin.capabilities,
  }));

  // Add static entries for channels that aren't loaded
  const loadedIds = new Set(loadedPlugins.map((p) => p.id));

  const staticChannels = [
    {
      id: 'whatsapp-cloud' as const,
      name: 'WhatsApp Business Cloud',
      description: 'Official WhatsApp Business API',
      loaded: false as const,
    },
    { id: 'discord' as const, name: 'Discord', description: 'Discord bot integration', loaded: false as const },
    { id: 'slack' as const, name: 'Slack', description: 'Slack bot integration', loaded: false as const },
    { id: 'telegram' as const, name: 'Telegram', description: 'Telegram bot integration', loaded: false as const },
  ];

  const unloadedChannels = staticChannels.filter((ch) => !loadedIds.has(ch.id));

  return c.json({
    items: [...loadedChannels, ...unloadedChannels],
  });
});

/**
 * GET /instances/:id - Get instance by ID
 */
instancesRoutes.get('/:id', instanceAccess, async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const instance = await services.instances.getById(id);

  return c.json({ data: sanitizeInstance(instance) });
});

/**
 * POST /instances - Create new instance
 */
instancesRoutes.post('/', zValidator('json', createInstanceSchema), async (c) => {
  const data = c.req.valid('json');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  if (data.agentId && data.agentReplyFilter === undefined) {
    data.agentReplyFilter = {
      mode: 'all',
      conditions: { onDm: true, onMention: true, onReply: true, onNameMatch: false },
    };
    log.info('Auto-set agentReplyFilter for new instance', { agentId: data.agentId });
  }

  // Map generic `token` → channel-specific DB column + resolve connect token
  const connectToken = resolveChannelToken(data);

  // Create the database record first
  const instance = await services.instances.create(data);

  const connectionOptions = buildInstanceConnectionOptions({
    channel: data.channel,
    forceNewQr: true,
    token: connectToken,
    telegramReactionLevel: instance.telegramReactionLevel,
    slackAppToken: instance.slackAppToken,
    slackSigningSecret: instance.slackSigningSecret,
    gupshupCallbackUrl: instance.gupshupCallbackUrl,
    gupshupAuthToken: instance.gupshupAuthToken,
    gupshupEventId: instance.gupshupEventId,
    webhookVerifyToken: instance.webhookVerifyToken,
  });

  // Wire: load guild config overrides into plugin before connection
  const createPlugin = getPluginFromRegistry(channelRegistry, data.channel);
  if (createPlugin && 'loadGuildConfigs' in createPlugin && instance.guildConfigOverrides) {
    (createPlugin as { loadGuildConfigs: (iId: string, cfg: Record<string, unknown>) => void }).loadGuildConfigs(
      instance.id,
      instance.guildConfigOverrides as Record<string, unknown>,
    );
  }

  await triggerCreateConnection(channelRegistry, data.channel, instance.id, connectionOptions);

  return c.json({ data: sanitizeInstance(instance) }, 201);
});

/**
 * PATCH /instances/:id - Update instance
 */
instancesRoutes.patch('/:id', instanceAccess, zValidator('json', updateInstanceSchema), async (c) => {
  const id = c.req.param('id');
  const data = c.req.valid('json');
  const services = c.get('services');

  // Detect agent assignment changes for auto-key provisioning and auto-reply-filter
  let oldAgentId: string | null | undefined;
  let current: Awaited<ReturnType<typeof services.instances.getById>> | undefined;
  if (data.agentId !== undefined || data.agentReplyFilter === undefined) {
    try {
      current = await services.instances.getById(id);
      oldAgentId = current.agentId;
    } catch {
      // Instance not found — update will throw
    }
  }

  // Auto-set agentReplyFilter when agent is assigned (new or existing) and no filter configured
  const finalAgentId = data.agentId !== undefined ? data.agentId : (current?.agentId ?? null);
  if (finalAgentId && data.agentReplyFilter === undefined && !current?.agentReplyFilter) {
    data.agentReplyFilter = {
      mode: 'all',
      conditions: { onDm: true, onMention: true, onReply: true, onNameMatch: false },
    };
    log.info('Auto-set agentReplyFilter on agent assignment', { instanceId: id, agentId: finalAgentId });
  }

  const instance = await services.instances.update(id, data);

  // Invalidate access cache when access mode changes
  if (data.accessMode !== undefined) {
    await accessCache.clear();
  }

  // Auto-provision/update scoped API key on agent assignment change
  if (data.agentId !== undefined && data.agentId !== oldAgentId) {
    await handleAgentKeyProvisioning(services, id, data.agentId, oldAgentId ?? null);
  }

  return c.json({ data: sanitizeInstance(instance) });
});

/**
 * Auto-provision or update a scoped API key when an agent is assigned to an instance.
 * - Assign: creates or updates key `agent:<name>` with instanceIds including this instance
 * - Unassign: removes instanceId from the old agent's key
 */
async function handleAgentKeyProvisioning(
  services: Services,
  instanceId: string,
  newAgentId: string | null,
  oldAgentId: string | null,
) {
  // Remove instance from old agent's key
  if (oldAgentId) {
    try {
      const oldAgent = await services.agents.getById(oldAgentId);
      const keyName = `agent:${oldAgent.name}`;
      const existingKey = await services.apiKeys.findByName(keyName);
      if (existingKey?.instanceIds) {
        const updated = existingKey.instanceIds.filter((id) => id !== instanceId);
        await services.apiKeys.update(existingKey.id, {
          instanceIds: updated.length > 0 ? updated : null,
        });
        log.info('Removed instance from agent key', { keyName, instanceId });
      }
    } catch (err) {
      log.error('Failed to remove instance from old agent key', { oldAgentId, instanceId, error: String(err) });
    }
  }

  // Add instance to new agent's key (or create key)
  if (newAgentId) {
    try {
      const agent = await services.agents.getById(newAgentId);
      const keyName = `agent:${agent.name}`;
      const existingKey = await services.apiKeys.findByName(keyName);

      if (existingKey) {
        // Add instanceId to existing key's instanceIds
        const currentIds = existingKey.instanceIds ?? [];
        if (!currentIds.includes(instanceId)) {
          await services.apiKeys.update(existingKey.id, {
            instanceIds: [...currentIds, instanceId],
          });
          log.info('Added instance to existing agent key', { keyName, instanceId });
        }
      } else {
        // Create new scoped API key for this agent
        // Use agent's declared omniScopes if available, otherwise fall back to DEFAULT_TURN_SCOPES
        const agentScopes = Array.isArray(agent.metadata?.omniScopes)
          ? (agent.metadata.omniScopes as string[])
          : [...DEFAULT_TURN_SCOPES];
        const result = await services.apiKeys.create({
          name: keyName,
          description: `Auto-provisioned scoped key for agent ${agent.name}`,
          scopes: agentScopes,
          instanceIds: [instanceId],
          createdBy: 'system:auto-provision',
        });
        log.info('Created scoped agent key', { keyName, instanceId, keyId: result.key.id });
      }
    } catch (err) {
      log.error('Failed to provision agent key', { newAgentId, instanceId, error: String(err) });
    }
  }
}

/**
 * DELETE /instances/:id - Delete instance
 */
instancesRoutes.delete('/:id', instanceAccess, async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  const instance = await services.instances.getById(id);
  const plugin = channelRegistry?.get(instance.channel as Parameters<typeof channelRegistry.get>[0]);

  // Disconnect runtime connection first (non-destructive)
  if (plugin) {
    try {
      await plugin.disconnect(id);
    } catch (error) {
      log.error('Failed to disconnect instance before delete', { instanceId: id, error: String(error) });
      // Continue with deletion anyway
    }
  }

  // Delete instance row first; only clear credentials after this succeeds.
  await services.instances.delete(id);

  // Best-effort credential cleanup after successful delete.
  if (plugin && 'logout' in plugin && typeof (plugin as { logout?: unknown }).logout === 'function') {
    try {
      await (plugin as { logout: (id: string) => Promise<void> }).logout(id);
    } catch (error) {
      log.error('Failed to clear channel auth after delete', { instanceId: id, error: String(error) });
    }
  }

  return c.json({ success: true });
});

/**
 * GET /instances/:id/status - Get instance connection status
 */
instancesRoutes.get('/:id/status', instanceAccess, async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  const instance = await services.instances.getById(id);

  // Get actual connection status from channel plugin
  let connectionState = 'unknown';
  let statusMessage: string | undefined;

  if (channelRegistry) {
    const plugin = channelRegistry.get(instance.channel as Parameters<typeof channelRegistry.get>[0]);
    if (plugin) {
      try {
        const status = await plugin.getStatus(id);
        connectionState = status.state;
        statusMessage = status.message;
      } catch {
        connectionState = 'error';
        statusMessage = 'Failed to get status from plugin';
      }
    }
  }

  return c.json({
    data: {
      instanceId: instance.id,
      state: connectionState,
      isConnected: connectionState === 'connected',
      connectedAt: null,
      profileName: instance.profileName,
      profilePicUrl: instance.profilePicUrl,
      ownerIdentifier: instance.ownerIdentifier,
      message: statusMessage,
    },
  });
});

/**
 * GET /instances/:id/qr - Get QR code for WhatsApp connection
 */
instancesRoutes.get('/:id/qr', instanceAccess, async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const instance = await services.instances.getById(id);

  if (!instance.channel.startsWith('whatsapp')) {
    return c.json(
      { error: { code: 'INVALID_OPERATION', message: 'QR code only available for WhatsApp instances' } },
      400,
    );
  }

  // Get QR code from store
  const stored = getQrCode(id);

  if (!stored) {
    return c.json({
      data: {
        qr: null,
        expiresAt: null,
        message: 'No QR code available. Instance may already be connected or connection not initiated.',
      },
    });
  }

  return c.json({
    data: {
      qr: stored.code,
      expiresAt: stored.expiresAt.toISOString(),
      message: 'Scan with WhatsApp to connect',
    },
  });
});

// Pairing code schema
const pairingCodeSchema = z.object({
  phoneNumber: z.string().min(10).max(20).describe('Phone number in international format (e.g., +5511999999999)'),
});

/**
 * POST /instances/:id/pair - Request pairing code for phone authentication
 *
 * Alternative to QR code scanning. The instance must be connected (in connecting state)
 * before requesting a pairing code.
 */
instancesRoutes.post('/:id/pair', instanceAccess, zValidator('json', pairingCodeSchema), async (c) => {
  const id = c.req.param('id');
  const { phoneNumber } = c.req.valid('json');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  const instance = await services.instances.getById(id);

  if (!instance.channel.startsWith('whatsapp')) {
    return c.json(
      { error: { code: 'INVALID_OPERATION', message: 'Pairing code only available for WhatsApp instances' } },
      400,
    );
  }

  if (!channelRegistry) {
    return c.json({ error: { code: 'NO_REGISTRY', message: 'Channel registry not available' } }, 503);
  }

  const plugin = channelRegistry.get(instance.channel as Parameters<typeof channelRegistry.get>[0]);
  if (!plugin) {
    return c.json({ error: { code: 'PLUGIN_NOT_FOUND', message: `No plugin for channel: ${instance.channel}` } }, 400);
  }

  // Check if plugin supports pairing code (WhatsApp specific)
  if (!('requestPairingCode' in plugin)) {
    return c.json({ error: { code: 'NOT_SUPPORTED', message: 'This plugin does not support pairing codes' } }, 400);
  }

  try {
    // Type assertion is safe here - we checked for method existence above
    const code = await (
      plugin as unknown as { requestPairingCode: (id: string, phone: string) => Promise<string> }
    ).requestPairingCode(id, phoneNumber);

    // Format code as XXXX-XXXX for readability
    const formattedCode = code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;

    return c.json({
      data: {
        code: formattedCode,
        phoneNumber: phoneNumber.replace(/(\d{4})(\d+)(\d{2})/, '$1****$3'),
        message: 'Enter this code on your WhatsApp mobile app: Settings > Linked Devices > Link with phone number',
        expiresIn: 60, // seconds
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: { code: 'PAIRING_FAILED', message } }, 500);
  }
});

// Connect instance schema
const connectInstanceSchema = z.object({
  token: z.string().optional().describe('Bot token for Discord/Telegram instances'),
  slackBotToken: z.string().optional().describe('Slack bot token (xoxb-...)'),
  slackAppToken: z.string().optional().describe('Slack app-level token (xapp-...)'),
  slackSigningSecret: z.string().optional().describe('Slack signing secret'),
  forceNewQr: z.boolean().optional().describe('Force new QR code for WhatsApp (re-authentication)'),
  gupshupCallbackUrl: z.string().optional().describe('Gupshup webhook callback URL (persisted for reconnection)'),
  whatsapp: z
    .object({
      syncFullHistory: z.boolean().optional().describe('Sync full message history on connect (default: true)'),
    })
    .optional()
    .describe('WhatsApp-specific connection options'),
});

/**
 * POST /instances/:id/connect - Connect instance
 *
 * Body (optional):
 * - token: Bot token for Discord instances
 * - forceNewQr: Force new QR code for WhatsApp (re-authentication)
 *
 * Query params (deprecated, use body):
 * - forceNewQr: true - Clear auth state and force fresh QR code
 */
instancesRoutes.post(
  '/:id/connect',
  instanceAccess,
  zValidator('json', connectInstanceSchema.optional()),
  async (c) => {
    const id = c.req.param('id');
    const body = c.req.valid('json') ?? {};
    const forceNewQr = body.forceNewQr ?? c.req.query('forceNewQr') === 'true';
    const services = c.get('services');
    const channelRegistry = c.get('channelRegistry');

    const instance = await services.instances.getById(id);

    const connectToken = body.token ?? persistedTokenForChannel(instance);
    const connectionOptions = buildInstanceConnectionOptions({
      channel: instance.channel,
      forceNewQr,
      token: connectToken,
      telegramReactionLevel: instance.telegramReactionLevel,
      slackAppToken: body.slackAppToken ?? instance.slackAppToken,
      slackSigningSecret: body.slackSigningSecret ?? instance.slackSigningSecret,
      whatsapp: body.whatsapp,
      gupshupCallbackUrl: instance.gupshupCallbackUrl,
      gupshupAuthToken: instance.gupshupAuthToken,
      gupshupEventId: instance.gupshupEventId,
      webhookVerifyToken: instance.webhookVerifyToken,
    });

    // Trigger connection via channel plugin
    if (!channelRegistry) {
      return c.json({ error: { code: 'NO_REGISTRY', message: 'Channel registry not available' } }, 503);
    }

    const plugin = getPluginFromRegistry(channelRegistry, instance.channel);
    if (!plugin) {
      return c.json(
        { error: { code: 'PLUGIN_NOT_FOUND', message: `No plugin for channel: ${instance.channel}` } },
        400,
      );
    }

    // Wire: load guild config overrides into plugin before connection
    if ('loadGuildConfigs' in plugin && instance.guildConfigOverrides) {
      (plugin as { loadGuildConfigs: (iId: string, cfg: Record<string, unknown>) => void }).loadGuildConfigs(
        id,
        instance.guildConfigOverrides as Record<string, unknown>,
      );
    }

    // Re-apply persisted presence on reconnect (plugin reads options.presence in handleConnected)
    if (instance.discordPresence) {
      connectionOptions.presence = instance.discordPresence;
    }

    // Pass per-instance markOnlineOnConnect to WhatsApp plugin (GH #310)
    if (instance.channel === 'whatsapp-baileys' && instance.markOnlineOnConnect != null) {
      connectionOptions.whatsapp = {
        ...(connectionOptions.whatsapp as Record<string, unknown> | undefined),
        markOnlineOnConnect: instance.markOnlineOnConnect,
      };
    }

    const errorMessage = await connectInstanceWithPlugin(plugin, id, connectionOptions);
    if (errorMessage) {
      return c.json(
        {
          error: {
            code: 'CONNECTION_FAILED',
            message: `Failed to connect: ${errorMessage}`,
          },
        },
        500,
      );
    }

    // Update database — persist tokens if new ones were provided
    const updated = await services.instances.update(id, {
      isActive: true,
      ...buildTokenPersistUpdates(instance.channel, body),
    });

    return c.json({
      data: {
        instanceId: updated.id,
        status: 'connecting',
        message: 'Connection initiated',
      },
    });
  },
);

/**
 * POST /instances/:id/disconnect - Disconnect instance
 */
instancesRoutes.post('/:id/disconnect', instanceAccess, async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  const instance = await services.instances.getById(id);

  // Trigger disconnection via channel plugin
  if (channelRegistry) {
    const plugin = channelRegistry.get(instance.channel as Parameters<typeof channelRegistry.get>[0]);
    if (plugin) {
      try {
        await plugin.disconnect(id);
      } catch (error) {
        log.error('Failed to disconnect instance', { instanceId: id, error: String(error) });
        // Continue anyway - update database state
      }
    }
  }

  // Update database
  await services.instances.update(id, { isActive: false });

  return c.json({ success: true });
});

/**
 * POST /instances/:id/restart - Restart instance
 *
 * Query params:
 * - forceNewQr: true - Clear auth state and force fresh QR code (for re-authentication)
 */
instancesRoutes.post('/:id/restart', instanceAccess, async (c) => {
  const id = c.req.param('id');
  const forceNewQr = c.req.query('forceNewQr') === 'true';
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  if (!channelRegistry) {
    return c.json({ error: { code: 'NO_REGISTRY', message: 'Channel registry not available' } }, 503);
  }

  const instance = await services.instances.getById(id);
  const plugin = channelRegistry.get(instance.channel as Parameters<typeof channelRegistry.get>[0]);

  if (!plugin) {
    return c.json({ error: { code: 'PLUGIN_NOT_FOUND', message: `No plugin for channel: ${instance.channel}` } }, 400);
  }

  try {
    await plugin.disconnect(id);
    const restartOptions: Record<string, unknown> = { forceNewQr };
    const restartToken = persistedTokenForChannel(instance);
    if (restartToken) restartOptions.token = restartToken;
    if (instance.channel === 'telegram') {
      restartOptions.telegramReactionLevel = instance.telegramReactionLevel;
    } else if (instance.channel === 'slack') {
      if (restartToken) restartOptions.botToken = restartToken;
      if (instance.slackAppToken) restartOptions.appToken = instance.slackAppToken;
    }
    if (instance.channel === 'slack') {
      applySlackConnectOptions(restartOptions, instance);
    }
    // Pass markOnlineOnConnect for WhatsApp restart (GH #310)
    if (instance.channel === 'whatsapp-baileys' && instance.markOnlineOnConnect != null) {
      restartOptions.whatsapp = {
        ...(restartOptions.whatsapp as Record<string, unknown> | undefined),
        markOnlineOnConnect: instance.markOnlineOnConnect,
      };
    }
    await plugin.connect(id, { instanceId: id, credentials: {}, options: restartOptions });
  } catch (error) {
    return c.json(
      {
        error: {
          code: 'RESTART_FAILED',
          message: `Failed to restart: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      },
      500,
    );
  }

  return c.json({
    data: {
      instanceId: instance.id,
      status: 'restarting',
      message: 'Restart initiated',
    },
  });
});

/**
 * POST /instances/:id/logout - Logout instance (clear session)
 */
instancesRoutes.post('/:id/logout', instanceAccess, async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  const instance = await services.instances.getById(id);

  // Logout via channel plugin (clears auth state)
  if (channelRegistry) {
    const plugin = channelRegistry.get(instance.channel as Parameters<typeof channelRegistry.get>[0]);
    if (plugin && 'logout' in plugin && typeof plugin.logout === 'function') {
      try {
        await (plugin as ChannelPlugin & { logout: (id: string) => Promise<void> }).logout(id);
      } catch (error) {
        log.error('Failed to logout instance', { instanceId: id, error: String(error) });
      }
    } else if (plugin) {
      // Fall back to disconnect
      try {
        await plugin.disconnect(id);
      } catch (error) {
        log.error('Failed to disconnect instance during logout', { instanceId: id, error: String(error) });
      }
    }
  }

  // Update database
  await services.instances.update(id, { isActive: false });

  return c.json({
    success: true,
    message: 'Session cleared, re-authentication required',
  });
});

// ============================================================================
// SYNC ENDPOINTS
// ============================================================================

// Sync request schema
const syncRequestSchema = z.object({
  type: z
    .enum(['profile', 'messages', 'contacts', 'groups', 'all'])
    .describe('Type of sync: profile, messages, contacts, groups, or all'),
  depth: z.enum(['7d', '30d', '90d', '1y', 'all']).optional().describe('Sync depth for message history'),
  channelId: z.string().optional().describe('Discord channel ID for channel-specific sync'),
  downloadMedia: z.boolean().optional().describe('Download and store media files'),
  chatJids: z
    .array(z.string().min(1).max(128))
    .max(50)
    .optional()
    .describe('Specific chat JIDs for per-chat active sync (WhatsApp only). Omit for passive sync.'),
});

/** Type for profile sync response */
interface ProfileSyncResult {
  name?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  platformMetadata?: Record<string, unknown> | null;
  syncedAt?: Date | null;
}

/**
 * POST /instances/:id/sync/profile - Sync profile immediately
 */
instancesRoutes.post('/:id/sync/profile', instanceAccess, async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  const instance = await services.instances.getById(id);

  if (!channelRegistry) {
    return c.json({ error: { code: 'NO_REGISTRY', message: 'Channel registry not available' } }, 503);
  }

  const plugin = channelRegistry.get(instance.channel as Parameters<typeof channelRegistry.get>[0]);

  if (!plugin) {
    return c.json({ error: { code: 'PLUGIN_NOT_FOUND', message: `No plugin for channel: ${instance.channel}` } }, 400);
  }

  // Check if plugin supports profile sync
  if (!('getProfile' in plugin) || typeof plugin.getProfile !== 'function') {
    return c.json(
      { error: { code: 'NOT_SUPPORTED', message: `Plugin ${instance.channel} does not support profile sync` } },
      400,
    );
  }

  try {
    // Get profile from plugin
    type ProfileResult = {
      name?: string;
      avatarUrl?: string;
      bio?: string;
      ownerIdentifier?: string;
      platformMetadata: Record<string, unknown>;
    };
    const profile = await (plugin as { getProfile: (id: string) => Promise<ProfileResult> }).getProfile(id);

    // Update instance with profile info
    const updated = await services.instances.update(id, {
      profileName: profile.name,
      profilePicUrl: profile.avatarUrl,
      profileBio: profile.bio,
      profileMetadata: profile.platformMetadata,
      profileSyncedAt: new Date(),
      ownerIdentifier: profile.ownerIdentifier,
    });

    const result: ProfileSyncResult = {
      name: updated.profileName,
      avatarUrl: updated.profilePicUrl,
      bio: updated.profileBio,
      platformMetadata: updated.profileMetadata as Record<string, unknown> | null,
      syncedAt: updated.profileSyncedAt,
    };

    return c.json({ data: { type: 'profile', status: 'completed', profile: result } });
  } catch (error) {
    const message = `Failed to sync profile: ${error instanceof Error ? error.message : 'Unknown error'}`;
    return c.json({ error: { code: 'SYNC_FAILED', message } }, 500);
  }
});

// ============================================================================
// Profile Name Update
// ============================================================================

/**
 * PUT /instances/:id/profile/name - Update profile display name
 */
instancesRoutes.put(
  '/:id/profile/name',
  instanceAccess,
  zValidator('json', z.object({ name: z.string().min(1).max(25) })),
  async (c) => {
    const id = c.req.param('id');
    const { name } = c.req.valid('json');
    const services = c.get('services');
    const channelRegistry = c.get('channelRegistry');

    const instance = await services.instances.getById(id);

    if (!channelRegistry) {
      return c.json({ error: { code: 'NO_REGISTRY', message: 'Channel registry not available' } }, 503);
    }

    const plugin = channelRegistry.get(instance.channel as Parameters<typeof channelRegistry.get>[0]);
    if (!plugin || !('updateProfileName' in plugin) || typeof plugin.updateProfileName !== 'function') {
      return c.json({ error: { code: 'NOT_SUPPORTED', message: 'Plugin does not support profile name update' } }, 400);
    }

    try {
      await (plugin as { updateProfileName: (instanceId: string, name: string) => Promise<void> }).updateProfileName(
        id,
        name,
      );

      // Update local DB too
      await services.instances.update(id, { profileName: name });

      return c.json({ success: true, data: { instanceId: id, action: 'profile_name_updated', name } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return c.json({ error: { code: 'UPDATE_FAILED', message } }, 500);
    }
  },
);

/** Validate chatJids + history-push guard for message sync. Returns error tuple [message, status] or null. */
async function validateMessageSyncPreconditions(
  services: { syncJobs: { hasActiveJob: (id: string, type: SyncJobType) => Promise<boolean> } },
  instanceId: string,
  channel: string,
  type: string,
  chatJids?: string[],
): Promise<{ error: string | { code: string; message: string }; status: 400 | 409 } | null> {
  if (chatJids?.length && !channel.startsWith('whatsapp')) {
    return {
      error: { code: 'VALIDATION_ERROR', message: 'chatJids is only supported for WhatsApp instances' },
      status: 400,
    };
  }
  const requiresMessageHistory = type === 'messages' || type === 'all' || Boolean(chatJids?.length);
  if (requiresMessageHistory && (await services.syncJobs.hasActiveJob(instanceId, 'history-push'))) {
    return {
      error: {
        code: 'SYNC_IN_PROGRESS',
        message:
          'Cannot start manual sync while history push sync is in progress. Wait for the push sync to complete or check progress with GET /instances/:id/sync.',
      },
      status: 409,
    };
  }
  return null;
}

/**
 * POST /instances/:id/sync - Request a sync operation
 *
 * Creates a sync job for the specified type:
 * - profile: Sync instance profile (redirects to /sync/profile)
 * - messages: Sync message history (with optional depth)
 * - contacts: Sync contacts
 * - groups: Sync groups/guilds
 * - all: Sync everything
 */
instancesRoutes.post('/:id/sync', instanceAccess, zValidator('json', syncRequestSchema), async (c) => {
  const id = c.req.param('id');
  const { type, depth, channelId, downloadMedia, chatJids } = c.req.valid('json');
  const services = c.get('services');

  const instance = await services.instances.getById(id);

  // For profile sync, redirect to dedicated endpoint
  if (type === 'profile') {
    // Create internal redirect by calling the profile sync handler directly
    const channelRegistry = c.get('channelRegistry');
    if (!channelRegistry) {
      return c.json({ error: { code: 'NO_REGISTRY', message: 'Channel registry not available' } }, 503);
    }

    const plugin = channelRegistry.get(instance.channel as Parameters<typeof channelRegistry.get>[0]);
    if (!plugin || !('getProfile' in plugin)) {
      return c.json({ error: { code: 'NOT_SUPPORTED', message: 'Profile sync not supported' } }, 400);
    }

    type ProfileResult = {
      name?: string;
      avatarUrl?: string;
      bio?: string;
      ownerIdentifier?: string;
      platformMetadata: Record<string, unknown>;
    };
    const profile = await (plugin as { getProfile: (id: string) => Promise<ProfileResult> }).getProfile(id);
    const updated = await services.instances.update(id, {
      profileName: profile.name,
      profilePicUrl: profile.avatarUrl,
      profileBio: profile.bio,
      profileMetadata: profile.platformMetadata,
      profileSyncedAt: new Date(),
      ownerIdentifier: profile.ownerIdentifier,
    });

    return c.json({
      data: {
        type: 'profile',
        status: 'completed',
        profile: {
          name: updated.profileName,
          avatarUrl: updated.profilePicUrl,
          bio: updated.profileBio,
          platformMetadata: updated.profileMetadata,
          syncedAt: updated.profileSyncedAt,
        },
      },
    });
  }

  // Validate chatJids support + history-push guard
  const preconditionError = await validateMessageSyncPreconditions(services, id, instance.channel, type, chatJids);
  if (preconditionError) return c.json({ error: preconditionError.error }, preconditionError.status);

  // For other sync types, check for existing active job
  const hasActiveJob = await services.syncJobs.hasActiveJob(id, type);
  if (hasActiveJob) {
    return c.json({ error: { code: 'JOB_EXISTS', message: `A ${type} sync job is already running` } }, 409);
  }

  // Create sync job with channelType for proper event routing
  const job = await services.syncJobs.create({
    instanceId: id,
    channelType: instance.channel,
    type,
    config: {
      depth: depth ?? '7d',
      channelId,
      downloadMedia: downloadMedia ?? instance.downloadMediaOnSync,
      ...(chatJids?.length ? { chatJids } : {}),
    },
  });

  return c.json(
    {
      data: {
        jobId: job.id,
        instanceId: id,
        type,
        status: job.status,
        config: job.config,
        message: 'Sync job created',
      },
    },
    201,
  );
});

/**
 * GET /instances/:id/sync/:jobId - Get sync job status
 */
instancesRoutes.get('/:id/sync/:jobId', instanceAccess, async (c) => {
  const id = c.req.param('id');
  const jobId = c.req.param('jobId');
  const services = c.get('services');

  // Verify instance exists
  await services.instances.getById(id);

  const job = await services.syncJobs.getByIdWithStats(jobId);

  // Verify job belongs to this instance
  if (job.instanceId !== id) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Sync job not found' } }, 404);
  }

  return c.json({
    data: {
      jobId: job.id,
      instanceId: job.instanceId,
      type: job.type,
      status: job.status,
      config: job.config,
      progress: job.progress,
      progressPercent: job.progressPercent,
      errorMessage: job.errorMessage,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    },
  });
});

/**
 * GET /instances/:id/sync - List sync jobs for instance
 */
instancesRoutes.get('/:id/sync', instanceAccess, async (c) => {
  const id = c.req.param('id');
  const status = c.req.query('status')?.split(',') as
    | ('pending' | 'running' | 'completed' | 'failed' | 'cancelled')[]
    | undefined;
  const limit = Number.parseInt(c.req.query('limit') ?? '20', 10);
  const services = c.get('services');

  // Verify instance exists
  await services.instances.getById(id);

  const result = await services.syncJobs.list({
    instanceId: id,
    status,
    limit,
  });

  return c.json({
    items: result.items.map((job) => ({
      jobId: job.id,
      type: job.type,
      status: job.status,
      progressPercent: job.progressPercent,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    })),
    meta: {
      hasMore: result.hasMore,
      cursor: result.cursor,
    },
  });
});

// ============================================================================
// PROFILE & CONTACTS ENDPOINTS
// ============================================================================

/**
 * GET /instances/:id/users/:userId/profile - Fetch user profile
 *
 * Fetches profile information for a specific user on this channel.
 * Useful for getting profile pics, bios, business info etc.
 */
instancesRoutes.get('/:id/users/:userId/profile', instanceAccess, async (c) => {
  const id = c.req.param('id');
  const userId = c.req.param('userId');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  const instance = await services.instances.getById(id);

  if (!channelRegistry) {
    return c.json({ error: { code: 'NO_REGISTRY', message: 'Channel registry not available' } }, 503);
  }

  const plugin = channelRegistry.get(instance.channel as Parameters<typeof channelRegistry.get>[0]);

  if (!plugin) {
    return c.json({ error: { code: 'PLUGIN_NOT_FOUND', message: `No plugin for channel: ${instance.channel}` } }, 400);
  }

  // Check if plugin supports user profile fetching
  if (!('fetchUserProfile' in plugin) || typeof plugin.fetchUserProfile !== 'function') {
    return c.json(
      {
        error: { code: 'NOT_SUPPORTED', message: `Plugin ${instance.channel} does not support user profile fetching` },
      },
      400,
    );
  }

  try {
    type ProfileResult = {
      displayName?: string;
      avatarUrl?: string;
      bio?: string;
      phone?: string;
      platformData?: Record<string, unknown>;
    };

    const profile = await (
      plugin as { fetchUserProfile: (instanceId: string, userId: string) => Promise<ProfileResult> }
    ).fetchUserProfile(id, userId);

    return c.json({
      data: {
        platformUserId: userId,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
        bio: profile.bio,
        phone: profile.phone,
        platformMetadata: profile.platformData,
      },
    });
  } catch (error) {
    const message = `Failed to fetch user profile: ${error instanceof Error ? error.message : 'Unknown error'}`;
    return c.json({ error: { code: 'PROFILE_FETCH_FAILED', message } }, 500);
  }
});

/** Enrich plugin contacts that have no name from platform_identities (GH #307) */
async function enrichContactNames(
  contacts: { platformUserId: string; name?: string }[],
  services: Services,
  instanceId: string,
): Promise<void> {
  const nameless = contacts.filter((c) => !c.name);
  if (nameless.length === 0) return;

  const identities = await services.persons.listIdentitiesByInstance(instanceId, { limit: 1000 });
  const nameMap = new Map<string, string>();
  for (const identity of identities.items) {
    if (identity.platformUsername) {
      nameMap.set(identity.platformUserId, identity.platformUsername);
    }
  }
  for (const contact of nameless) {
    const dbName = nameMap.get(contact.platformUserId);
    if (dbName) contact.name = dbName;
  }
}

// List contacts query schema
const listContactsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  cursor: z.string().optional(),
  guildId: z.string().optional().describe('Guild ID (required for Discord)'),
  search: z.string().optional(),
  excludeGroups: z.coerce.boolean().optional(),
});

/**
 * GET /instances/:id/contacts - List contacts for an instance
 *
 * Returns cached contacts from the channel plugin.
 * For Discord, requires guildId query parameter.
 */
instancesRoutes.get('/:id/contacts', instanceAccess, zValidator('query', listContactsQuerySchema), async (c) => {
  const id = c.req.param('id');
  const { limit, guildId, search, excludeGroups } = c.req.valid('query');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  const instance = await services.instances.getById(id);

  if (!channelRegistry) {
    return c.json({ error: { code: 'NO_REGISTRY', message: 'Channel registry not available' } }, 503);
  }

  const plugin = channelRegistry.get(instance.channel as Parameters<typeof channelRegistry.get>[0]);

  if (!plugin) {
    return c.json({ error: { code: 'PLUGIN_NOT_FOUND', message: `No plugin for channel: ${instance.channel}` } }, 400);
  }

  // Check if plugin supports contacts fetching
  if (!('fetchContacts' in plugin) || typeof plugin.fetchContacts !== 'function') {
    return c.json(
      { error: { code: 'NOT_SUPPORTED', message: `Plugin ${instance.channel} does not support contacts fetching` } },
      400,
    );
  }

  try {
    type Contact = {
      platformUserId: string;
      name?: string;
      phone?: string;
      profilePicUrl?: string;
      isGroup: boolean;
      isBusiness?: boolean;
      metadata?: Record<string, unknown>;
    };

    type FetchContactsResult = {
      totalFetched: number;
      contacts: Contact[];
    };

    // Build options based on channel type
    const fetchOptions: Record<string, unknown> = {};
    if (instance.channel === 'discord') {
      if (!guildId) {
        return c.json(
          { error: { code: 'VALIDATION_ERROR', message: 'guildId is required for Discord instances' } },
          400,
        );
      }
      fetchOptions.guildId = guildId;
      fetchOptions.limit = limit;
    }

    const result = await (
      plugin as {
        fetchContacts: (instanceId: string, options: Record<string, unknown>) => Promise<FetchContactsResult>;
      }
    ).fetchContacts(id, fetchOptions);

    // If plugin returns contacts, use them
    if (result.contacts.length > 0) {
      // Enrich contacts that have no name from platform_identities (GH #307)
      await enrichContactNames(result.contacts, services, id);

      let filtered = result.contacts;

      // Server-side search filter
      if (search) {
        const q = search.toLowerCase();
        filtered = filtered.filter(
          (c) =>
            c.name?.toLowerCase().includes(q) || c.phone?.includes(q) || c.platformUserId.toLowerCase().includes(q),
        );
      }

      // Exclude groups if requested
      if (excludeGroups) {
        filtered = filtered.filter((c) => !c.isGroup);
      }

      const contacts = filtered.slice(0, limit);

      return c.json({
        items: contacts.map((contact) => ({
          platformUserId: contact.platformUserId,
          displayName: contact.name,
          phone: contact.phone,
          avatarUrl: contact.profilePicUrl,
          isGroup: contact.isGroup,
          isBusiness: contact.isBusiness,
          platformMetadata: contact.metadata,
        })),
        meta: {
          totalFetched: result.totalFetched,
          totalMatched: filtered.length,
          hasMore: contacts.length < filtered.length,
          cursor: undefined,
        },
      });
    }

    // Fallback: get contacts from stored platform identities
    const identitiesResult = await services.persons.listIdentitiesByInstance(id, { limit });

    return c.json({
      items: identitiesResult.items.map((identity) => ({
        platformUserId: identity.platformUserId,
        displayName: identity.platformUsername,
        phone: identity.platformUserId.includes('@s.whatsapp.net') ? identity.platformUserId.split('@')[0] : undefined,
        avatarUrl: identity.profilePicUrl,
        isGroup: identity.platformUserId.includes('@g.us'),
        isBusiness: undefined,
        platformMetadata: identity.profileData as Record<string, unknown> | undefined,
      })),
      meta: {
        totalFetched: identitiesResult.items.length,
        hasMore: identitiesResult.hasMore,
        cursor: identitiesResult.cursor,
      },
    });
  } catch (error) {
    const message = `Failed to fetch contacts: ${error instanceof Error ? error.message : 'Unknown error'}`;
    return c.json({ error: { code: 'CONTACTS_FETCH_FAILED', message } }, 500);
  }
});

// List groups query schema
const listGroupsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  cursor: z.string().optional(),
  search: z.string().optional(),
});

/**
 * GET /instances/:id/groups - List groups for an instance
 *
 * Returns groups the instance is participating in.
 */
instancesRoutes.get('/:id/groups', instanceAccess, zValidator('query', listGroupsQuerySchema), async (c) => {
  const id = c.req.param('id');
  const { limit, search } = c.req.valid('query');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  const instance = await services.instances.getById(id);

  if (!channelRegistry) {
    return c.json({ error: { code: 'NO_REGISTRY', message: 'Channel registry not available' } }, 503);
  }

  const plugin = channelRegistry.get(instance.channel as Parameters<typeof channelRegistry.get>[0]);

  if (!plugin) {
    return c.json({ error: { code: 'PLUGIN_NOT_FOUND', message: `No plugin for channel: ${instance.channel}` } }, 400);
  }

  // Check if plugin supports groups fetching
  if (!('fetchGroups' in plugin) || typeof plugin.fetchGroups !== 'function') {
    return c.json(
      { error: { code: 'NOT_SUPPORTED', message: `Plugin ${instance.channel} does not support groups fetching` } },
      400,
    );
  }

  try {
    type Group = {
      externalId: string;
      name?: string;
      description?: string;
      memberCount?: number;
      createdAt?: Date;
      createdBy?: string;
      isReadOnly?: boolean;
      metadata?: Record<string, unknown>;
    };

    type FetchGroupsResult = {
      totalFetched: number;
      groups: Group[];
    };

    const result = await (
      plugin as { fetchGroups: (instanceId: string, options: Record<string, unknown>) => Promise<FetchGroupsResult> }
    ).fetchGroups(id, {});

    // Apply server-side search filter before limiting
    let filtered = result.groups;
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter((g) => g.name?.toLowerCase().includes(q) || g.externalId.toLowerCase().includes(q));
    }

    // Apply limit
    const groups = filtered.slice(0, limit);

    return c.json({
      items: groups.map((group) => ({
        externalId: group.externalId,
        name: group.name,
        description: group.description,
        memberCount: group.memberCount,
        createdAt: group.createdAt?.toISOString(),
        createdBy: group.createdBy,
        isReadOnly: group.isReadOnly,
        platformMetadata: group.metadata,
      })),
      meta: {
        totalFetched: result.totalFetched,
        totalMatched: filtered.length,
        hasMore: groups.length < filtered.length,
        cursor: undefined, // TODO: implement pagination cursor
      },
    });
  } catch (error) {
    const message = `Failed to fetch groups: ${error instanceof Error ? error.message : 'Unknown error'}`;
    return c.json({ error: { code: 'GROUPS_FETCH_FAILED', message } }, 500);
  }
});

// ============================================================================
// Group Members
// ============================================================================

/**
 * GET /instances/:id/groups/:jid/members - List members of a group
 *
 * Returns group members with names and roles.
 * Returns 501 if the plugin does not support group member listing.
 */
instancesRoutes.get('/:id/groups/:jid/members', instanceAccess, async (c) => {
  const id = c.req.param('id');
  const jid = c.req.param('jid');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  const instance = await services.instances.getById(id);

  if (!channelRegistry) {
    return c.json({ error: { code: 'NO_REGISTRY', message: 'Channel registry not available' } }, 503);
  }

  const plugin = channelRegistry.get(instance.channel as Parameters<typeof channelRegistry.get>[0]);

  if (!plugin) {
    return c.json({ error: { code: 'PLUGIN_NOT_FOUND', message: `No plugin for channel: ${instance.channel}` } }, 400);
  }

  if (!('fetchGroupMembers' in plugin) || typeof plugin.fetchGroupMembers !== 'function') {
    return c.json(
      { error: { code: 'NOT_SUPPORTED', message: `Plugin ${instance.channel} does not support group member listing` } },
      501,
    );
  }

  try {
    const result = await (
      plugin as {
        fetchGroupMembers: (
          instanceId: string,
          groupJid: string,
        ) => Promise<{ members: Array<{ id: string; name?: string; role?: string }> }>;
      }
    ).fetchGroupMembers(id, jid);

    return c.json({ members: result.members });
  } catch (error) {
    const message = `Failed to fetch group members: ${error instanceof Error ? error.message : 'Unknown error'}`;
    return c.json({ error: { code: 'GROUP_MEMBERS_FETCH_FAILED', message } }, 500);
  }
});

// ============================================================================
// B2: CHECK NUMBER ON WHATSAPP
// ============================================================================

const checkNumberSchema = z.object({
  phones: z.array(z.string().min(1)).min(1).max(100).describe('Phone numbers to check (e.g., ["+5511999999999"])'),
});

/**
 * POST /instances/:id/check-number - Check if phone numbers are on WhatsApp
 */
instancesRoutes.post('/:id/check-number', instanceAccess, zValidator('json', checkNumberSchema), async (c) => {
  const id = c.req.param('id');
  const { phones } = c.req.valid('json');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  const instance = await services.instances.getById(id);

  if (!channelRegistry) {
    return c.json({ error: { code: 'NO_REGISTRY', message: 'Channel registry not available' } }, 503);
  }

  const plugin = channelRegistry.get(instance.channel as Parameters<typeof channelRegistry.get>[0]);
  if (!plugin) {
    return c.json({ error: { code: 'PLUGIN_NOT_FOUND', message: `No plugin for channel: ${instance.channel}` } }, 400);
  }

  if (!('checkNumber' in plugin) || typeof plugin.checkNumber !== 'function') {
    return c.json(
      { error: { code: 'NOT_SUPPORTED', message: `Plugin ${instance.channel} does not support number checking` } },
      400,
    );
  }

  try {
    type CheckResult = { exists: boolean; jid: string; phone: string };
    const results = await (
      plugin as { checkNumber: (id: string, phones: string[]) => Promise<CheckResult[]> }
    ).checkNumber(id, phones);

    return c.json({ data: { results } });
  } catch (error) {
    const message = `Failed to check numbers: ${error instanceof Error ? error.message : 'Unknown error'}`;
    return c.json({ error: { code: 'CHECK_FAILED', message } }, 500);
  }
});

// ============================================================================
// B3: UPDATE OWN BIO/STATUS
// ============================================================================

const updateBioSchema = z.object({
  status: z.string().min(1).max(500).describe('New profile bio/status text'),
});

/**
 * PUT /instances/:id/profile/status - Update own bio/status
 */
instancesRoutes.put('/:id/profile/status', instanceAccess, zValidator('json', updateBioSchema), async (c) => {
  const id = c.req.param('id');
  const { status } = c.req.valid('json');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  const instance = await services.instances.getById(id);

  if (!channelRegistry) {
    return c.json({ error: { code: 'NO_REGISTRY', message: 'Channel registry not available' } }, 503);
  }

  const plugin = channelRegistry.get(instance.channel as Parameters<typeof channelRegistry.get>[0]);
  if (!plugin) {
    return c.json({ error: { code: 'PLUGIN_NOT_FOUND', message: `No plugin for channel: ${instance.channel}` } }, 400);
  }

  if (!('updateBio' in plugin) || typeof plugin.updateBio !== 'function') {
    return c.json(
      { error: { code: 'NOT_SUPPORTED', message: `Plugin ${instance.channel} does not support bio updates` } },
      400,
    );
  }

  try {
    await (plugin as { updateBio: (id: string, status: string) => Promise<void> }).updateBio(id, status);
    return c.json({ success: true, data: { status } });
  } catch (error) {
    const message = `Failed to update bio: ${error instanceof Error ? error.message : 'Unknown error'}`;
    return c.json({ error: { code: 'UPDATE_FAILED', message } }, 500);
  }
});

// ============================================================================
// B4: BLOCK / UNBLOCK / BLOCKLIST
// ============================================================================

const blockContactSchema = z.object({
  contactId: z.string().min(1).describe('Contact JID or phone number to block'),
});

/**
 * POST /instances/:id/block - Block a contact
 */
instancesRoutes.post('/:id/block', instanceAccess, zValidator('json', blockContactSchema), async (c) => {
  const id = c.req.param('id');
  const { contactId } = c.req.valid('json');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  const instance = await services.instances.getById(id);

  if (!channelRegistry) {
    return c.json({ error: { code: 'NO_REGISTRY', message: 'Channel registry not available' } }, 503);
  }

  const plugin = channelRegistry.get(instance.channel as Parameters<typeof channelRegistry.get>[0]);
  if (!plugin) {
    return c.json({ error: { code: 'PLUGIN_NOT_FOUND', message: `No plugin for channel: ${instance.channel}` } }, 400);
  }

  if (!('blockContact' in plugin) || typeof plugin.blockContact !== 'function') {
    return c.json(
      { error: { code: 'NOT_SUPPORTED', message: `Plugin ${instance.channel} does not support blocking` } },
      400,
    );
  }

  try {
    await (plugin as { blockContact: (id: string, contactId: string) => Promise<void> }).blockContact(id, contactId);
    return c.json({ success: true, data: { contactId, action: 'blocked' } });
  } catch (error) {
    const message = `Failed to block contact: ${error instanceof Error ? error.message : 'Unknown error'}`;
    return c.json({ error: { code: 'BLOCK_FAILED', message } }, 500);
  }
});

/**
 * DELETE /instances/:id/block - Unblock a contact
 */
instancesRoutes.delete('/:id/block', instanceAccess, zValidator('json', blockContactSchema), async (c) => {
  const id = c.req.param('id');
  const { contactId } = c.req.valid('json');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  const instance = await services.instances.getById(id);

  if (!channelRegistry) {
    return c.json({ error: { code: 'NO_REGISTRY', message: 'Channel registry not available' } }, 503);
  }

  const plugin = channelRegistry.get(instance.channel as Parameters<typeof channelRegistry.get>[0]);
  if (!plugin) {
    return c.json({ error: { code: 'PLUGIN_NOT_FOUND', message: `No plugin for channel: ${instance.channel}` } }, 400);
  }

  if (!('unblockContact' in plugin) || typeof plugin.unblockContact !== 'function') {
    return c.json(
      { error: { code: 'NOT_SUPPORTED', message: `Plugin ${instance.channel} does not support unblocking` } },
      400,
    );
  }

  try {
    await (plugin as { unblockContact: (id: string, contactId: string) => Promise<void> }).unblockContact(
      id,
      contactId,
    );
    return c.json({ success: true, data: { contactId, action: 'unblocked' } });
  } catch (error) {
    const message = `Failed to unblock contact: ${error instanceof Error ? error.message : 'Unknown error'}`;
    return c.json({ error: { code: 'UNBLOCK_FAILED', message } }, 500);
  }
});

/**
 * GET /instances/:id/blocklist - Get blocked contacts list
 */
instancesRoutes.get('/:id/blocklist', instanceAccess, async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  const instance = await services.instances.getById(id);

  if (!channelRegistry) {
    return c.json({ error: { code: 'NO_REGISTRY', message: 'Channel registry not available' } }, 503);
  }

  const plugin = channelRegistry.get(instance.channel as Parameters<typeof channelRegistry.get>[0]);
  if (!plugin) {
    return c.json({ error: { code: 'PLUGIN_NOT_FOUND', message: `No plugin for channel: ${instance.channel}` } }, 400);
  }

  if (!('fetchBlocklist' in plugin) || typeof plugin.fetchBlocklist !== 'function') {
    return c.json(
      { error: { code: 'NOT_SUPPORTED', message: `Plugin ${instance.channel} does not support blocklist` } },
      400,
    );
  }

  try {
    const blocklist = await (plugin as { fetchBlocklist: (id: string) => Promise<string[]> }).fetchBlocklist(id);
    return c.json({ data: { blocklist, count: blocklist.length } });
  } catch (error) {
    const message = `Failed to fetch blocklist: ${error instanceof Error ? error.message : 'Unknown error'}`;
    return c.json({ error: { code: 'BLOCKLIST_FAILED', message } }, 500);
  }
});

// ============================================================================
// C2: Profile Picture
// ============================================================================

/**
 * PUT /instances/:id/profile/picture - Update profile picture
 */
instancesRoutes.put(
  '/:id/profile/picture',
  instanceAccess,
  zValidator('json', z.object({ base64: z.string().min(1), mimeType: z.string().optional() })),
  async (c) => {
    const id = c.req.param('id');
    const { base64 } = c.req.valid('json');
    const services = c.get('services');
    const channelRegistry = c.get('channelRegistry');

    const instance = await services.instances.getById(id);

    if (!channelRegistry) {
      return c.json({ error: { code: 'NO_REGISTRY', message: 'Channel registry not available' } }, 503);
    }

    const plugin = channelRegistry.get(instance.channel as Parameters<typeof channelRegistry.get>[0]);
    if (!plugin || !('updateProfilePicture' in plugin)) {
      return c.json(
        { error: { code: 'NOT_SUPPORTED', message: 'Plugin does not support profile picture update' } },
        400,
      );
    }

    try {
      const imageBuffer = Buffer.from(base64, 'base64');
      await (
        plugin as { updateProfilePicture: (instanceId: string, buffer: Buffer) => Promise<void> }
      ).updateProfilePicture(id, imageBuffer);

      return c.json({ success: true, data: { instanceId: id, action: 'profile_picture_updated' } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return c.json({ error: { code: 'UPDATE_FAILED', message } }, 500);
    }
  },
);

/**
 * DELETE /instances/:id/profile/picture - Remove profile picture
 */
instancesRoutes.delete('/:id/profile/picture', instanceAccess, async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  const instance = await services.instances.getById(id);

  if (!channelRegistry) {
    return c.json({ error: { code: 'NO_REGISTRY', message: 'Channel registry not available' } }, 503);
  }

  const plugin = channelRegistry.get(instance.channel as Parameters<typeof channelRegistry.get>[0]);
  if (!plugin || !('removeProfilePicture' in plugin)) {
    return c.json(
      { error: { code: 'NOT_SUPPORTED', message: 'Plugin does not support profile picture removal' } },
      400,
    );
  }

  try {
    await (plugin as { removeProfilePicture: (instanceId: string) => Promise<void> }).removeProfilePicture(id);
    return c.json({ success: true, data: { instanceId: id, action: 'profile_picture_removed' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: { code: 'REMOVE_FAILED', message } }, 500);
  }
});

// ============================================================================
// Group Create
// ============================================================================

/**
 * POST /instances/:id/groups - Create a new WhatsApp group
 */
instancesRoutes.post(
  '/:id/groups',
  instanceAccess,
  zValidator(
    'json',
    z.object({
      subject: z.string().min(1).max(100).describe('Group name/subject'),
      participants: z.array(z.string().min(1)).min(1).describe('Phone numbers or JIDs to add'),
    }),
  ),
  async (c) => {
    const id = c.req.param('id');
    const { subject, participants } = c.req.valid('json');
    const services = c.get('services');
    const channelRegistry = c.get('channelRegistry');

    const instance = await services.instances.getById(id);

    if (!channelRegistry) {
      return c.json({ error: { code: 'NO_REGISTRY', message: 'Channel registry not available' } }, 503);
    }

    const plugin = channelRegistry.get(instance.channel as Parameters<typeof channelRegistry.get>[0]);
    if (!plugin || !('groupCreate' in plugin)) {
      return c.json({ error: { code: 'NOT_SUPPORTED', message: 'Plugin does not support group creation' } }, 400);
    }

    const result = await (
      plugin as {
        groupCreate: (
          instanceId: string,
          subject: string,
          participants: string[],
        ) => Promise<{
          id: string;
          subject: string;
          owner: string | undefined;
          creation: number | undefined;
          participants: Array<{ id: string; admin: string | null }>;
        }>;
      }
    ).groupCreate(id, subject, participants);

    return c.json({ data: result }, 201);
  },
);

// ============================================================================
// C3: Group Invite Links
// ============================================================================

/**
 * GET /instances/:id/chats/:chatId/invite - Export (or retrieve) chat invite link
 *
 * WhatsApp: group invite code/link (delegates to getGroupInviteCode)
 * Telegram: exportChatInviteLink (bot must be admin)
 */
instancesRoutes.get('/:id/chats/:chatId/invite', instanceAccess, async (c) => {
  const id = c.req.param('id');
  const chatId = c.req.param('chatId');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  const instance = await services.instances.getById(id);

  if (!channelRegistry) {
    return c.json({ error: { code: 'NO_REGISTRY', message: 'Channel registry not available' } }, 503);
  }

  const plugin = channelRegistry.get(instance.channel as Parameters<typeof channelRegistry.get>[0]);
  if (!plugin) {
    return c.json({ error: { code: 'NOT_SUPPORTED', message: 'Plugin not available' } }, 400);
  }

  // WhatsApp compatibility: treat chatId as groupJid
  if ('getGroupInviteCode' in plugin) {
    try {
      const code = await (
        plugin as { getGroupInviteCode: (instanceId: string, groupJid: string) => Promise<string> }
      ).getGroupInviteCode(id, chatId);

      return c.json({
        data: {
          chatId,
          code,
          inviteLink: `https://chat.whatsapp.com/${code}`,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return c.json({ error: { code: 'INVITE_FAILED', message } }, 500);
    }
  }

  if ('exportChatInviteLink' in plugin) {
    try {
      const inviteLink = await (
        plugin as { exportChatInviteLink: (instanceId: string, chatId: string) => Promise<string> }
      ).exportChatInviteLink(id, chatId);

      return c.json({
        data: {
          chatId,
          inviteLink,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return c.json({ error: { code: 'INVITE_FAILED', message } }, 500);
    }
  }

  return c.json({ error: { code: 'NOT_SUPPORTED', message: 'Plugin does not support chat invites' } }, 400);
});

/**
 * GET /instances/:id/groups/:groupJid/invite - Get group invite code
 */
instancesRoutes.get('/:id/groups/:groupJid/invite', instanceAccess, async (c) => {
  const id = c.req.param('id');
  const groupJid = c.req.param('groupJid');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  const instance = await services.instances.getById(id);

  if (!channelRegistry) {
    return c.json({ error: { code: 'NO_REGISTRY', message: 'Channel registry not available' } }, 503);
  }

  const plugin = channelRegistry.get(instance.channel as Parameters<typeof channelRegistry.get>[0]);
  if (!plugin || !('getGroupInviteCode' in plugin)) {
    return c.json({ error: { code: 'NOT_SUPPORTED', message: 'Plugin does not support group invites' } }, 400);
  }

  try {
    const code = await (
      plugin as { getGroupInviteCode: (instanceId: string, groupJid: string) => Promise<string> }
    ).getGroupInviteCode(id, groupJid);

    return c.json({
      data: {
        groupJid,
        code,
        inviteLink: `https://chat.whatsapp.com/${code}`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: { code: 'INVITE_FAILED', message } }, 500);
  }
});

/**
 * POST /instances/:id/groups/:groupJid/invite/revoke - Revoke and regenerate invite link
 */
instancesRoutes.post('/:id/groups/:groupJid/invite/revoke', instanceAccess, async (c) => {
  const id = c.req.param('id');
  const groupJid = c.req.param('groupJid');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  const instance = await services.instances.getById(id);

  if (!channelRegistry) {
    return c.json({ error: { code: 'NO_REGISTRY', message: 'Channel registry not available' } }, 503);
  }

  const plugin = channelRegistry.get(instance.channel as Parameters<typeof channelRegistry.get>[0]);
  if (!plugin || !('revokeGroupInvite' in plugin)) {
    return c.json(
      { error: { code: 'NOT_SUPPORTED', message: 'Plugin does not support group invite revocation' } },
      400,
    );
  }

  try {
    const newCode = await (
      plugin as { revokeGroupInvite: (instanceId: string, groupJid: string) => Promise<string> }
    ).revokeGroupInvite(id, groupJid);

    return c.json({
      data: {
        groupJid,
        code: newCode,
        inviteLink: `https://chat.whatsapp.com/${newCode}`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: { code: 'REVOKE_FAILED', message } }, 500);
  }
});

/**
 * POST /instances/:id/groups/join - Join a group via invite code
 */
instancesRoutes.post(
  '/:id/groups/join',
  instanceAccess,
  zValidator('json', z.object({ code: z.string().min(1).describe('Invite code from the invite link') })),
  async (c) => {
    const id = c.req.param('id');
    const { code } = c.req.valid('json');
    const services = c.get('services');
    const channelRegistry = c.get('channelRegistry');

    const instance = await services.instances.getById(id);

    if (!channelRegistry) {
      return c.json({ error: { code: 'NO_REGISTRY', message: 'Channel registry not available' } }, 503);
    }

    const plugin = channelRegistry.get(instance.channel as Parameters<typeof channelRegistry.get>[0]);
    if (!plugin || !('joinGroup' in plugin)) {
      return c.json({ error: { code: 'NOT_SUPPORTED', message: 'Plugin does not support joining groups' } }, 400);
    }

    try {
      const groupJid = await (plugin as { joinGroup: (instanceId: string, code: string) => Promise<string> }).joinGroup(
        id,
        code,
      );

      return c.json({ data: { groupJid, joined: true } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return c.json({ error: { code: 'JOIN_FAILED', message } }, 500);
    }
  },
);

// ============================================================================

// ============================================================================
// Group Profile Picture
// ============================================================================

/**
 * PUT /instances/:id/groups/:groupJid/picture - Update group picture
 */
instancesRoutes.put(
  '/:id/groups/:groupJid/picture',
  instanceAccess,
  zValidator('json', z.object({ base64: z.string().min(1), mimeType: z.string().optional() })),
  async (c) => {
    const id = c.req.param('id');
    const groupJid = c.req.param('groupJid');
    const { base64 } = c.req.valid('json');
    const channelRegistry = c.get('channelRegistry');
    const services = c.get('services');

    const instance = await services.instances.getById(id);

    if (!channelRegistry) {
      return c.json({ error: { code: 'NO_REGISTRY', message: 'Channel registry not available' } }, 503);
    }

    const plugin = channelRegistry.get(instance.channel as Parameters<typeof channelRegistry.get>[0]);
    if (!plugin || !('updateGroupPicture' in plugin)) {
      return c.json({ error: { code: 'NOT_SUPPORTED', message: 'Plugin does not support group picture update' } }, 400);
    }

    const imageBuffer = Buffer.from(base64, 'base64');
    await (
      plugin as { updateGroupPicture: (id: string, jid: string, buf: Buffer) => Promise<void> }
    ).updateGroupPicture(id, groupJid, imageBuffer);

    return c.json({ success: true, data: { instanceId: id, groupJid, action: 'group_picture_updated' } });
  },
);

// ============================================================================
// C5: Privacy Settings
// ============================================================================

/**
 * GET /instances/:id/privacy - Fetch privacy settings
 */
instancesRoutes.get('/:id/privacy', instanceAccess, async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  const instance = await services.instances.getById(id);

  if (!channelRegistry) {
    return c.json({ error: { code: 'NO_REGISTRY', message: 'Channel registry not available' } }, 503);
  }

  const plugin = channelRegistry.get(instance.channel as Parameters<typeof channelRegistry.get>[0]);
  if (!plugin || !('fetchPrivacySettings' in plugin)) {
    return c.json({ error: { code: 'NOT_SUPPORTED', message: 'Plugin does not support privacy settings' } }, 400);
  }

  try {
    const settings = await (
      plugin as { fetchPrivacySettings: (instanceId: string) => Promise<Record<string, unknown>> }
    ).fetchPrivacySettings(id);

    return c.json({ data: settings });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: { code: 'PRIVACY_FAILED', message } }, 500);
  }
});

// ============================================================================
// C6: Reject Incoming Calls
// ============================================================================

/**
 * POST /instances/:id/calls/reject - Reject an incoming call
 */
instancesRoutes.post(
  '/:id/calls/reject',
  instanceAccess,
  zValidator(
    'json',
    z.object({
      callId: z.string().min(1).describe('Call ID from the incoming call event'),
      callFrom: z.string().min(1).describe('Caller JID'),
    }),
  ),
  async (c) => {
    const id = c.req.param('id');
    const { callId, callFrom } = c.req.valid('json');
    const services = c.get('services');
    const channelRegistry = c.get('channelRegistry');

    const instance = await services.instances.getById(id);

    if (!channelRegistry) {
      return c.json({ error: { code: 'NO_REGISTRY', message: 'Channel registry not available' } }, 503);
    }

    const plugin = channelRegistry.get(instance.channel as Parameters<typeof channelRegistry.get>[0]);
    if (!plugin || !('rejectCall' in plugin)) {
      return c.json({ error: { code: 'NOT_SUPPORTED', message: 'Plugin does not support call rejection' } }, 400);
    }

    try {
      await (
        plugin as { rejectCall: (instanceId: string, callId: string, callFrom: string) => Promise<void> }
      ).rejectCall(id, callId, callFrom);

      return c.json({ success: true, data: { callId, callFrom, rejected: true } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return c.json({ error: { code: 'REJECT_FAILED', message } }, 500);
    }
  },
);

// ============================================================================
// Resync endpoint - trigger history backfill for an instance
// ============================================================================

const resyncSchema = z.object({
  since: z
    .string()
    .optional()
    .describe('Backfill start time (ISO 8601 or relative duration like "2h", "30m"). Default: 2h ago'),
  until: z.string().optional().describe('Backfill end time (ISO 8601). Default: now'),
  chatJids: z
    .array(z.string())
    .optional()
    .describe(
      'Specific WhatsApp chat JIDs to fetch history for (e.g. ["5511999999999@s.whatsapp.net"]). Useful for recovering chats not in the database.',
    ),
});

/**
 * Parse a duration string (e.g., "2h", "30m", "1d") into milliseconds
 */
function parseDuration(duration: string): number | null {
  const match = duration.match(/^(\d+)(s|m|h|d)$/);
  if (!match?.[1] || !match[2]) return null;
  const value = Number.parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case 's':
      return value * 1000;
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    case 'd':
      return value * 24 * 60 * 60 * 1000;
    default:
      return null;
  }
}

/**
 * Parse a since value into a Date — supports ISO timestamps and durations
 */
function parseSince(since: string | undefined): Date {
  if (!since) {
    return new Date(Date.now() - 2 * 60 * 60 * 1000); // Default: 2h ago
  }

  // Try duration first
  const durationMs = parseDuration(since);
  if (durationMs !== null) {
    return new Date(Date.now() - durationMs);
  }

  // Try ISO timestamp
  const date = new Date(since);
  if (!Number.isNaN(date.getTime())) {
    return date;
  }

  return new Date(Date.now() - 2 * 60 * 60 * 1000); // Fallback: 2h ago
}

/**
 * POST /v2/instances/:id/resync - Trigger history backfill
 *
 * Uses the channel's fetchHistory() via sync-worker to re-fetch messages
 * from the platform for the specified time range.
 */
instancesRoutes.post('/:id/resync', instanceAccess, zValidator('json', resyncSchema), async (c) => {
  const id = c.req.param('id');
  const { since, until, chatJids } = c.req.valid('json');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');
  const eventBus = c.get('eventBus');

  // Get instance (throws NotFoundError if not found)
  const instance = await services.instances.getById(id);

  if (!channelRegistry || !eventBus) {
    return c.json({ error: { code: 'NOT_AVAILABLE', message: 'Channel registry or event bus not available' } }, 503);
  }

  // Guard: block resync while a history-push job is active
  const guardError = await validateMessageSyncPreconditions(services, id, instance.channel, 'messages', chatJids);
  if (guardError) return c.json({ error: guardError.error }, guardError.status);

  const sinceDate = parseSince(since);
  const untilDate = until ? new Date(until) : new Date();

  // Create a sync job (inserts DB row + publishes sync.started event)
  try {
    const job = await services.syncJobs.create({
      instanceId: id,
      channelType: instance.channel,
      type: 'messages',
      config: {
        since: sinceDate.toISOString(),
        until: untilDate.toISOString(),
        ...(chatJids?.length ? { chatJids } : {}),
      },
    });

    log.info('Resync triggered', {
      instanceId: id,
      jobId: job.id,
      since: sinceDate.toISOString(),
      until: untilDate.toISOString(),
    });

    return c.json({
      success: true,
      data: {
        instanceId: id,
        since: sinceDate.toISOString(),
        until: untilDate.toISOString(),
        jobId: job.id,
        message: `Resync triggered for ${instance.name}. Messages since ${sinceDate.toISOString()} will be re-fetched.`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error('Failed to trigger resync', { instanceId: id, error: message });
    return c.json({ error: { code: 'RESYNC_FAILED', message } }, 500);
  }
});

// ============================================================================
// Agent Replay: manually replay missed messages
// ============================================================================

const replaySchema = z.object({
  since: z
    .string()
    .refine(
      (v) =>
        /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/.test(v) &&
        !Number.isNaN(new Date(v).getTime()),
      'Invalid ISO 8601 timestamp (expected YYYY-MM-DD or YYYY-MM-DDTHH:mm:ssZ)',
    )
    .optional()
    .describe('Replay start time (ISO 8601 timestamp). Default: lastSeenAt from instance record. Capped at 24h ago.'),
});

/**
 * POST /v2/instances/:id/replay - Manually trigger agent replay for missed messages
 *
 * Re-dispatches inbound messages received since `since` (or lastSeenAt, capped at 24h)
 * through the normal agent handler pipeline.
 */
instancesRoutes.post('/:id/replay', instanceAccess, zValidator('json', replaySchema), async (c) => {
  const id = c.req.param('id');
  const { since } = c.req.valid('json');
  const services = c.get('services');
  const eventBus = c.get('eventBus');
  const db = c.get('db');

  if (!eventBus) {
    return c.json({ error: { code: 'NOT_AVAILABLE', message: 'Event bus not available' } }, 503);
  }

  let instance: Awaited<ReturnType<typeof services.instances.getById>>;
  try {
    instance = await services.instances.getById(id);
  } catch (err) {
    if (err instanceof NotFoundError) {
      return c.json({ error: { code: 'NOT_FOUND', message: `Instance ${id} not found` } }, 404);
    }
    throw err;
  }

  const replayService = new AgentReplayService(db, eventBus);
  const sinceDate = since ? new Date(since) : undefined;

  try {
    const result = await replayService.replayMissedMessages({ instanceId: instance.id, since: sinceDate });

    log.info('Manual replay triggered', {
      instanceId: instance.id,
      replayed: result.replayed,
      since: result.since.toISOString(),
    });

    return c.json({
      data: {
        message: `Replay complete for ${instance.name}. ${result.replayed} message(s) re-dispatched.`,
        replayed: result.replayed,
        skipped: result.skipped,
        since: result.since.toISOString(),
        until: result.until.toISOString(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error('Manual replay failed', { instanceId: id, error: message });
    return c.json({ error: { code: 'REPLAY_FAILED', message } }, 500);
  }
});

// ============================================================================
// Access Control: Pairing Requests
// ============================================================================

/**
 * GET /instances/:id/pairing-requests - List pending pairing requests
 */
instancesRoutes.get('/:id/pairing-requests', instanceAccess, async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const requests = await services.access.listPendingPairingRequests(id);

  return c.json({
    items: requests.map((r) => ({
      id: r.id,
      instanceId: r.instanceId,
      platformUserId: r.platformUserId,
      pairingCode: r.pairingCode,
      expiresAt: r.expiresAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
    })),
  });
});

// Pairing action schema
const pairingActionSchema = z.object({
  action: z.enum(['approve', 'deny']).describe('Action: approve or deny the pairing request'),
  reason: z.string().optional().describe('Reason for denial (optional)'),
});

/**
 * POST /instances/:id/pairing-requests/:requestId/action - Approve or deny a pairing request
 */
instancesRoutes.post(
  '/:id/pairing-requests/:requestId/action',
  instanceAccess,
  zValidator('json', pairingActionSchema),
  async (c) => {
    const id = c.req.param('id');
    const requestId = c.req.param('requestId');
    const { action, reason } = c.req.valid('json');
    const services = c.get('services');

    try {
      if (action === 'approve') {
        const rule = await services.access.approvePairingRequest(requestId, id);
        return c.json({
          data: {
            action: 'approve',
            ruleId: rule.id,
            message: `User ${rule.platformUserId} approved and added to allowlist`,
          },
        });
      }

      await services.access.denyPairingRequest(requestId, id, reason);
      return c.json({
        data: {
          action: 'deny',
          reason: reason ?? 'Denied by administrator',
          message: 'Pairing request denied and deleted',
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (error instanceof NotFoundError) {
        return c.json({ error: { code: 'NOT_FOUND', message } }, 404);
      }
      if (error instanceof PairingRequestExpiredError || error instanceof PairingRequestConsumedError) {
        return c.json({ error: { code: 'INVALID_REQUEST', message } }, 400);
      }
      return c.json({ error: { code: 'ACTION_FAILED', message } }, 500);
    }
  },
);

// ============================================================================
// GUILD CONFIG ENDPOINTS (Discord per-server overrides)
// ============================================================================

const guildConfigOverrideSchema = z.object({
  agentReplyFilter: z
    .object({
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
    })
    .optional(),
  toolPolicies: z.record(z.string(), z.enum(['allow', 'deny'])).optional(),
  reactions: z
    .object({
      enabled: z.boolean().optional(),
      allowedEmojis: z.array(z.string()).optional(),
    })
    .optional(),
  maxLines: z.number().int().min(0).optional(),
  presence: z
    .object({
      status: z.enum(['online', 'dnd', 'idle', 'invisible']).optional(),
      activityText: z.string().max(128).optional(),
      activityType: z.enum(['Playing', 'Streaming', 'Listening', 'Watching', 'Custom', 'Competing']).optional(),
    })
    .optional(),
});

/** In-memory guild config cache with write-through invalidation */
const guildConfigCache = new Map<string, { data: Record<string, unknown>; expiresAt: number }>();
const GUILD_CONFIG_TTL = 5 * 60 * 1000; // 5 minutes

function getCacheKey(instanceId: string, guildId: string): string {
  return `${instanceId}:${guildId}`;
}

function invalidateGuildCache(instanceId: string, guildId: string): void {
  guildConfigCache.delete(getCacheKey(instanceId, guildId));
}

/**
 * GET /instances/:id/guilds - List all guilds with their config overrides
 */
instancesRoutes.get('/:id/guilds', instanceAccess, async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const instance = await services.instances.getById(id);
  const overrides = (instance.guildConfigOverrides as Record<string, unknown>) ?? {};

  const guilds = Object.entries(overrides).map(([guildId, config]) => ({
    guildId,
    config,
  }));

  return c.json({ items: guilds });
});

/**
 * GET /instances/:id/guilds/:guildId/config - Get resolved config for guild
 */
instancesRoutes.get('/:id/guilds/:guildId/config', instanceAccess, async (c) => {
  const id = c.req.param('id');
  const guildId = c.req.param('guildId');
  const services = c.get('services');

  // Check cache
  const cacheKey = getCacheKey(id, guildId);
  const cached = guildConfigCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return c.json({ data: { guildId, config: cached.data, cached: true } });
  }

  const instance = await services.instances.getById(id);
  const overrides = (instance.guildConfigOverrides as Record<string, Record<string, unknown>>) ?? {};

  // Build resolved config: instance-level defaults layered under guild-specific overrides.
  // Without merging defaults, callers that use this as source-of-truth for a PUT can
  // inadvertently clear inherited instance settings (e.g. agentReplyFilter).
  const instanceDefaults: Record<string, unknown> = {};
  if (instance.agentReplyFilter) instanceDefaults.agentReplyFilter = instance.agentReplyFilter;
  if (instance.discordPresence) instanceDefaults.presence = instance.discordPresence;

  const guildConfig = { ...instanceDefaults, ...(overrides[guildId] ?? {}) };

  // Cache the result
  guildConfigCache.set(cacheKey, { data: guildConfig, expiresAt: Date.now() + GUILD_CONFIG_TTL });

  return c.json({ data: { guildId, config: guildConfig, cached: false } });
});

/**
 * PUT /instances/:id/guilds/:guildId/config - Set guild config overrides
 */
instancesRoutes.put(
  '/:id/guilds/:guildId/config',
  instanceAccess,
  zValidator('json', guildConfigOverrideSchema),
  async (c) => {
    const id = c.req.param('id');
    const guildId = c.req.param('guildId');
    const newConfig = c.req.valid('json');
    const services = c.get('services');
    const apiKey = c.get('apiKey');

    const instance = await services.instances.getById(id);
    const existingOverrides = (instance.guildConfigOverrides as Record<string, unknown>) ?? {};
    const oldConfig = existingOverrides[guildId] ?? {};
    const action = existingOverrides[guildId] ? 'update' : 'create';

    // Atomic jsonb_set — avoids read-modify-write race where concurrent requests
    // for different guild IDs both read the same snapshot and one clobbers the other.
    await services.instances.setGuildConfigOverride(id, guildId, newConfig);

    // Write-through cache invalidation
    invalidateGuildCache(id, guildId);

    // Wire: push guild config to channel plugin for runtime consumption
    const channelRegistry = c.get('channelRegistry');
    if (channelRegistry) {
      const plugin = channelRegistry.get(instance.channel as Parameters<typeof channelRegistry.get>[0]);
      if (plugin && 'setGuildConfig' in plugin) {
        (plugin as { setGuildConfig: (iId: string, gId: string, cfg: unknown) => void }).setGuildConfig(
          id,
          guildId,
          newConfig,
        );
      }
    }

    // Audit log
    log.info('Guild config updated', {
      instanceId: id,
      guildId,
      apiKeyId: apiKey?.id,
      action,
      diff: { old: oldConfig, new: newConfig },
    });

    return c.json({ data: { guildId, config: newConfig, action } });
  },
);

/**
 * DELETE /instances/:id/guilds/:guildId/config - Reset guild to instance defaults
 */
instancesRoutes.delete('/:id/guilds/:guildId/config', instanceAccess, async (c) => {
  const id = c.req.param('id');
  const guildId = c.req.param('guildId');
  const services = c.get('services');
  const apiKey = c.get('apiKey');

  const instance = await services.instances.getById(id);
  const existingOverrides = (instance.guildConfigOverrides as Record<string, unknown>) ?? {};
  const oldConfig = existingOverrides[guildId];

  if (!oldConfig) {
    return c.json({ data: { guildId, message: 'No overrides to remove' } });
  }

  // Atomic JSONB key removal — avoids read-modify-write race.
  await services.instances.deleteGuildConfigOverride(id, guildId);

  // Write-through cache invalidation
  invalidateGuildCache(id, guildId);

  // Wire: remove guild config from channel plugin cache
  const channelRegistry = c.get('channelRegistry');
  if (channelRegistry) {
    const plugin = channelRegistry.get(instance.channel as Parameters<typeof channelRegistry.get>[0]);
    if (plugin && 'removeGuildConfig' in plugin) {
      (plugin as { removeGuildConfig: (iId: string, gId: string) => void }).removeGuildConfig(id, guildId);
    }
  }

  // Audit log
  log.info('Guild config deleted', {
    instanceId: id,
    guildId,
    apiKeyId: apiKey?.id,
    action: 'delete',
    diff: { old: oldConfig, new: null },
  });

  return c.json({ data: { guildId, message: 'Guild config reset to instance defaults' } });
});

/**
 * GET /instances/:id/guilds/:guildId/audit - Query guild config audit log
 * NOTE: Audit entries are currently logged via structured logs (log.info).
 * A dedicated audit table can be added when persistent audit querying is needed.
 */
instancesRoutes.get('/:id/guilds/:guildId/audit', instanceAccess, async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  // Verify instance exists
  await services.instances.getById(id);

  // Audit events are stored in structured logs for now
  return c.json({ items: [], meta: { hasMore: false, note: 'Audit log stored in structured logs' } });
});

// ============================================================================
// BOT PRESENCE ENDPOINT (Discord)
// ============================================================================

const presenceSchema = z.object({
  status: z.enum(['online', 'dnd', 'idle', 'invisible']).default('online'),
  activityText: z.string().max(128).optional(),
  activityType: z.enum(['Playing', 'Streaming', 'Listening', 'Watching', 'Custom', 'Competing']).default('Playing'),
});

/**
 * PUT /instances/:id/presence - Set bot presence (Discord only)
 */
instancesRoutes.put('/:id/presence', instanceAccess, zValidator('json', presenceSchema), async (c) => {
  const id = c.req.param('id');
  const presenceData = c.req.valid('json');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  const instance = await services.instances.getById(id);

  if (instance.channel !== 'discord') {
    return c.json(
      { error: { code: 'INVALID_OPERATION', message: 'Presence is only available for Discord instances' } },
      400,
    );
  }

  if (!channelRegistry) {
    return c.json({ error: { code: 'NO_REGISTRY', message: 'Channel registry not available' } }, 503);
  }

  const plugin = channelRegistry.get('discord');
  if (!plugin) {
    return c.json({ error: { code: 'PLUGIN_NOT_FOUND', message: 'Discord plugin not loaded' } }, 400);
  }

  // Call setPresence on the plugin
  if (!('setPresence' in plugin) || typeof plugin.setPresence !== 'function') {
    return c.json({ error: { code: 'NOT_SUPPORTED', message: 'Plugin does not support setPresence' } }, 400);
  }

  try {
    await (plugin as { setPresence: (instanceId: string, presence: typeof presenceData) => Promise<void> }).setPresence(
      id,
      presenceData,
    );

    // Persist so reconnect flows can re-apply presence via options.presence.
    await services.instances.update(id, { discordPresence: presenceData });

    return c.json({ success: true, data: { instanceId: id, presence: presenceData } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: { code: 'PRESENCE_FAILED', message } }, 500);
  }
});

// ============================================================================
// Telegram Webhook Ingress
// ============================================================================

export { instancesRoutes };
