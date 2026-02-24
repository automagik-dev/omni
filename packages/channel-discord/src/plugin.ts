/**
 * Discord Channel Plugin using discord.js
 *
 * Main plugin class that extends BaseChannelPlugin from channel-sdk.
 * Handles connection, messaging, and lifecycle for Discord bot instances.
 */

import { BaseChannelPlugin, createInboundDedupeCache } from '@omni/channel-sdk';
import type {
  ChannelCapabilities,
  DedupeCache,
  FetchHistoryOptions,
  FetchHistoryResult,
  HistorySyncMessage,
  InstanceConfig,
  OutgoingMessage,
  PluginContext,
  SendResult,
} from '@omni/channel-sdk';
import type { GuildConfigOverride } from '@omni/core/schemas';
import type { ChannelType, ContentType } from '@omni/core/types';
import { ActivityType } from 'discord.js';
import type { Client, Message, PresenceStatusData, TextBasedChannel } from 'discord.js';

import { clearToken, loadToken, saveToken } from './auth';
import { DISCORD_CAPABILITIES } from './capabilities';
import { createClient, destroyClient, getBotUser, isClientReady } from './client';
import {
  resetConnectionState,
  setupAllEventHandlers,
  setupConnectionHandlers,
  setupInteractionHandlers,
  setupMessageHandlers,
  setupRawEventHandler,
  setupReactionHandlers,
} from './handlers';
import { sendMediaBuffer, sendMediaMessage } from './senders/media';
import { mediaDedup } from './senders/media-dedup';
import { addReaction, removeReaction } from './senders/reaction';
import { deleteMessage as deleteTextMessage, editTextMessage, sendTextMessage } from './senders/text';
import type {
  AutocompletePayload,
  ButtonPayload,
  ContextMenuPayload,
  DiscordConfig,
  ModalSubmitPayload,
  SelectMenuPayload,
  SlashCommandPayload,
} from './types';
import { DiscordError, ErrorCode, mapDiscordError } from './utils/errors';

// ============================================================================
// Send Message Helpers
// ============================================================================

/**
 * Format a single mention to Discord format
 */
function formatSingleMention(mention: { id: string; type?: string }): string {
  const type = mention.type || 'user';
  switch (type) {
    case 'user':
      return `<@${mention.id}>`;
    case 'role':
      return `<@&${mention.id}>`;
    case 'channel':
      return `<#${mention.id}>`;
    case 'everyone':
      return '@everyone';
    case 'here':
      return '@here';
    default:
      return `<@${mention.id}>`;
  }
}

/**
 * Format mentions array to Discord mention strings
 */
function formatMentionsToText(mentions: Array<{ id: string; type?: string }>): string {
  return mentions.map(formatSingleMention).join(' ');
}

/**
 * Resolve channel ID - creates DM channel if necessary
 */
async function resolveChannelId(
  client: Client,
  channelId: string,
  logger: {
    debug: (msg: string, ctx?: Record<string, unknown>) => void;
    info: (msg: string, ctx?: Record<string, unknown>) => void;
    error: (msg: string, ctx?: Record<string, unknown>) => void;
  },
): Promise<string> {
  try {
    await client.channels.fetch(channelId);
    return channelId;
  } catch (channelError) {
    // Channel fetch failed - might be a user ID, try to create DM
    if ((channelError as { code?: number }).code !== 10003) throw channelError;

    logger.debug('Channel not found, trying as user ID for DM', { to: channelId });
    try {
      const user = await client.users.fetch(channelId);
      logger.debug('Fetched user, creating DM channel', { userId: user.id, username: user.username });
      const dmChannel = await user.createDM();
      logger.info('Created DM channel for user', { userId: channelId, dmChannelId: dmChannel.id });
      return dmChannel.id;
    } catch (userError) {
      logger.error('Failed to create DM channel', { userId: channelId, error: String(userError) });
      throw channelError; // Rethrow original error
    }
  }
}

/**
 * Send text content (with optional embed)
 */
async function sendTextContent(client: Client, channelId: string, message: OutgoingMessage): Promise<string> {
  const content = message.content;

  // Handle embed request via metadata
  if (message.metadata?.embed) {
    const embedData = message.metadata.embed as {
      title?: string;
      description?: string;
      color?: number;
      url?: string;
      timestamp?: string;
      footer?: { text: string; iconUrl?: string };
      author?: { name: string; url?: string; iconUrl?: string };
      thumbnail?: string;
      image?: string;
      fields?: Array<{ name: string; value: string; inline?: boolean }>;
    };
    const { sendEmbedMessage } = await import('./senders/embeds');
    const embedOptions = { ...embedData, timestamp: embedData.timestamp ? new Date(embedData.timestamp) : undefined };
    return sendEmbedMessage(client, channelId, embedOptions, content.text, message.replyTo);
  }

  // Regular text message with mentions
  let text = content.text ?? '';
  const mentions = message.metadata?.mentions as Array<{ id: string; type?: string }> | undefined;
  if (mentions?.length) {
    text = `${formatMentionsToText(mentions)} ${text}`;
  }

  const formatMode =
    message.metadata?.messageFormatMode === 'passthrough' || message.metadata?.formatMode === 'passthrough'
      ? 'passthrough'
      : 'convert';

  const messageIds = await sendTextMessage(client, channelId, text, message.replyTo, formatMode);
  return messageIds[0] ?? '';
}

/** Sentinel returned by sendMediaContent when dedup suppresses the send. */
const DEDUP_SKIPPED = '__dedup_skipped__';

/**
 * Send media content (image, audio, video, document)
 * Includes media deduplication check to prevent duplicate sends within TTL window.
 *
 * Returns DEDUP_SKIPPED (not an empty string) when the send was suppressed to
 * allow callers to distinguish dedup skips from genuine empty message IDs.
 */
async function sendMediaContent(
  client: Client,
  channelId: string,
  message: OutgoingMessage,
  instanceId: string,
): Promise<string> {
  const content = message.content;
  const base64 = message.metadata?.base64 as string | undefined;
  // Scope dedup by instance + channel so identical media going to different
  // destinations is not incorrectly collapsed.
  const dedupScope = `${instanceId}:${channelId}`;

  if (base64) {
    const buffer = Buffer.from(base64, 'base64');

    // Wire: media dedup — skip sending if this exact media was sent recently
    if (mediaDedup.isDuplicate(buffer, dedupScope)) {
      return DEDUP_SKIPPED;
    }

    const filename = content.filename || `media-${Date.now()}.${content.type === 'image' ? 'png' : 'bin'}`;
    const bufferResult = await sendMediaBuffer(client, channelId, buffer, {
      filename,
      caption: content.text || content.caption,
      replyToId: message.replyTo,
    });
    // Mark sent only after the API call succeeds to avoid poisoning the cache
    // on transient failures (which would prevent legitimate retries).
    mediaDedup.markSent(buffer, dedupScope);
    return bufferResult;
  }

  if (!content.mediaUrl) {
    throw new DiscordError(ErrorCode.SEND_FAILED, 'Media URL or base64 required');
  }

  // Wire: media dedup for URL-based media — hash the URL as a content proxy
  const urlBuffer = Buffer.from(content.mediaUrl);
  if (mediaDedup.isDuplicate(urlBuffer, dedupScope)) {
    return DEDUP_SKIPPED;
  }

  const urlResult = await sendMediaMessage(client, channelId, content.mediaUrl, {
    caption: content.text || content.caption,
    filename: content.filename,
    replyToId: message.replyTo,
  });
  // Mark sent only after the API call succeeds.
  mediaDedup.markSent(urlBuffer, dedupScope);
  return urlResult;
}

/**
 * Send reaction
 */
async function sendReactionContent(client: Client, channelId: string, message: OutgoingMessage): Promise<string> {
  const content = message.content;
  const targetMessageId = content.targetMessageId || message.replyTo;
  if (!content.emoji || !targetMessageId) {
    throw new DiscordError(ErrorCode.SEND_FAILED, 'Reaction requires emoji and target message ID');
  }
  await addReaction(client, channelId, targetMessageId, content.emoji);
  return targetMessageId;
}

/**
 * Send poll
 */
async function sendPollContent(client: Client, channelId: string, message: OutgoingMessage): Promise<string> {
  const pollData = message.metadata?.poll as
    | { question: string; answers: string[]; durationHours?: number; multiSelect?: boolean }
    | undefined;
  if (!pollData) {
    throw new DiscordError(ErrorCode.SEND_FAILED, 'Poll data required in metadata');
  }
  const { sendPollMessage } = await import('./senders/poll');
  return sendPollMessage(client, channelId, pollData, message.replyTo);
}

// ============================================================================
// Types
// ============================================================================

// HistorySyncMessage, FetchHistoryOptions, FetchHistoryResult imported from @omni/channel-sdk
// Re-export for external consumers
export type { HistorySyncMessage, FetchHistoryOptions, FetchHistoryResult };

/**
 * Contact from sync (guild member)
 */
export interface SyncContact {
  platformUserId: string;
  name?: string;
  username?: string;
  discriminator?: string;
  profilePicUrl?: string;
  isBot?: boolean;
  guildId?: string;
  roles?: string[];
  joinedAt?: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Options for fetchContacts method
 */
export interface FetchContactsOptions {
  /** Guild ID to fetch members from (required) */
  guildId: string;
  /** Maximum number of members to fetch (default: 1000) */
  limit?: number;
  /** Callback for progress updates */
  onProgress?: (fetched: number) => void;
  /** Callback for each contact */
  onContact?: (contact: SyncContact) => void;
}

/**
 * Result of fetchContacts operation
 */
export interface FetchContactsResult {
  totalFetched: number;
  contacts: SyncContact[];
}

/**
 * Guild from sync
 */
export interface SyncGuild {
  externalId: string;
  name: string;
  description?: string;
  memberCount?: number;
  iconUrl?: string;
  ownerId?: string;
  createdAt?: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Options for fetchGuilds method
 */
export interface FetchGuildsOptions {
  /** Callback for progress updates */
  onProgress?: (fetched: number) => void;
  /** Callback for each guild */
  onGuild?: (guild: SyncGuild) => void;
}

/**
 * Result of fetchGuilds operation
 */
export interface FetchGuildsResult {
  totalFetched: number;
  guilds: SyncGuild[];
}

/**
 * Discord Channel Plugin
 *
 * Extends BaseChannelPlugin to provide Discord messaging via discord.js.
 *
 * Features:
 * - Multi-guild support (one bot, many servers)
 * - Text, media, embeds, reactions
 * - Interactive components (buttons, select menus, modals)
 * - Slash commands and context menu commands
 * - Thread support
 * - Discord webhooks
 * - Automatic reconnection
 */
export class DiscordPlugin extends BaseChannelPlugin {
  readonly id: ChannelType = 'discord';
  readonly name = 'Discord (discord.js)';
  readonly version = '1.0.0';
  readonly capabilities: ChannelCapabilities = DISCORD_CAPABILITIES;

  /** Active Discord clients per instance */
  private clients = new Map<string, Client>();

  /** Per-instance inbound dedup caches */
  private dedupeCaches = new Map<string, DedupeCache>();

  /** Plugin configuration */
  private pluginConfig: DiscordConfig = {};

  /** Per-instance guild config overrides cache: instanceId → (guildId → config) */
  private guildConfigCache = new Map<string, Record<string, GuildConfigOverride>>();

  /**
   * Plugin-specific initialization
   */
  protected override async onInitialize(_context: PluginContext): Promise<void> {
    // No additional initialization needed for Discord plugin
  }

  /**
   * Plugin-specific cleanup
   */
  protected override async onDestroy(): Promise<void> {
    // Destroy all clients
    for (const [instanceId, client] of this.clients) {
      this.logger.info('Destroying client', { instanceId });
      await destroyClient(client);
    }
    this.clients.clear();
    // Dispose all per-instance dedup caches
    for (const cache of this.dedupeCaches.values()) cache.dispose();
    this.dedupeCaches.clear();
  }

  /**
   * Connect a Discord instance
   *
   * @param instanceId - Unique instance identifier
   * @param config - Instance configuration (must include token in options or storage)
   */
  async connect(instanceId: string, config: InstanceConfig): Promise<void> {
    const existingClient = this.clients.get(instanceId);
    if (existingClient) {
      if (isClientReady(existingClient)) {
        this.logger.warn('Instance already connected', { instanceId });
        return;
      }
      // Client exists but not ready, destroy and reconnect
      await destroyClient(existingClient);
      this.clients.delete(instanceId);
    }

    // Update status to connecting
    await this.updateInstanceStatus(instanceId, config, {
      state: 'connecting',
      since: new Date(),
    });

    // Get token from config or storage
    let token = config.options?.token as string | undefined;

    if (!token) {
      // Try loading from storage
      token = (await loadToken(this.storage, instanceId)) ?? undefined;
    }

    if (!token) {
      throw new DiscordError(
        ErrorCode.INVALID_TOKEN,
        'No bot token provided. Pass token in config.options.token or save it first.',
      );
    }

    // Save token if it was passed in config
    if (config.options?.token) {
      await saveToken(this.storage, instanceId, token);
    }

    // Create and setup client
    await this.createConnection(instanceId, config, token);
  }

  /**
   * Create a new Discord client connection
   */
  private async createConnection(instanceId: string, config: InstanceConfig, token: string): Promise<void> {
    const client = createClient();

    // Setup handlers
    setupConnectionHandlers(client, this, instanceId, async () => {
      // Reconnection callback
      await this.createConnection(instanceId, config, token);
    });

    // Setup raw event handler first (for DEBUG_PAYLOADS capture)
    setupRawEventHandler(client, instanceId);

    // Create per-instance dedup cache for the lifetime of this connection
    const dedupeCache = createInboundDedupeCache();
    this.dedupeCaches.set(instanceId, dedupeCache);

    setupMessageHandlers(client, this, instanceId, dedupeCache);
    setupReactionHandlers(client, this, instanceId);
    setupInteractionHandlers(client, this, instanceId);
    setupAllEventHandlers(client, this, instanceId);

    // Store client before login (so handlers can access it)
    this.clients.set(instanceId, client);

    // Login
    try {
      await client.login(token);
    } catch (error) {
      this.clients.delete(instanceId);
      throw mapDiscordError(error);
    }
  }

  /**
   * Disconnect a Discord instance
   *
   * @param instanceId - Instance to disconnect
   */
  async disconnect(instanceId: string): Promise<void> {
    const client = this.clients.get(instanceId);
    if (!client) {
      return;
    }

    // Reset connection state
    resetConnectionState(instanceId);

    // Destroy client
    await destroyClient(client);
    this.clients.delete(instanceId);

    // Dispose per-instance dedup cache
    this.dedupeCaches.get(instanceId)?.dispose();
    this.dedupeCaches.delete(instanceId);

    // Emit disconnected event
    await this.emitInstanceDisconnected(instanceId, 'User requested disconnect');
  }

  /**
   * Logout and clear token for an instance
   *
   * @param instanceId - Instance to logout
   */
  async logout(instanceId: string): Promise<void> {
    await this.disconnect(instanceId);
    await clearToken(this.storage, instanceId);
    this.logger.info('Instance logged out and token cleared', { instanceId });
  }

  /**
   * Send a message through Discord
   */
  async sendMessage(instanceId: string, message: OutgoingMessage): Promise<SendResult> {
    const client = this.getClient(instanceId);
    let channelId = message.to;

    try {
      channelId = await resolveChannelId(client, channelId, this.logger);

      // Journey timing: T10 (pluginSentAt) before platform call
      const correlationId = message.metadata?.correlationId as string | undefined;
      if (correlationId) this.captureT10(correlationId);

      const messageId = await this.dispatchMessageByType(client, channelId, message, instanceId);

      // Dedup-skipped sends must not emit message.sent — doing so would produce
      // phantom events with externalId: '' that corrupt downstream persistence.
      if (messageId === DEDUP_SKIPPED) {
        return { success: true, messageId: '', timestamp: Date.now() };
      }

      // Journey timing: T11 (platformDeliveredAt) after Discord API responds
      if (correlationId) this.captureT11(correlationId);

      await this.emitMessageSent({
        instanceId,
        externalId: messageId,
        chatId: channelId,
        to: message.to,
        content: { type: message.content.type, text: message.content.text },
        replyToId: message.replyTo,
      });

      return { success: true, messageId, timestamp: Date.now() };
    } catch (error) {
      const discordError = mapDiscordError(error);
      await this.emitMessageFailed({
        instanceId,
        chatId: channelId,
        error: discordError.message,
        errorCode: discordError.code,
        retryable: discordError.retryable,
      });
      return {
        success: false,
        error: discordError.message,
        errorCode: discordError.code,
        retryable: discordError.retryable,
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Dispatch message to appropriate handler based on content type
   */
  private async dispatchMessageByType(
    client: Client,
    channelId: string,
    message: OutgoingMessage,
    instanceId: string,
  ): Promise<string> {
    switch (message.content.type) {
      case 'text':
        return sendTextContent(client, channelId, message);
      case 'image':
      case 'audio':
      case 'video':
      case 'document':
        return sendMediaContent(client, channelId, message, instanceId);
      case 'reaction':
        return sendReactionContent(client, channelId, message);
      case 'poll':
        return sendPollContent(client, channelId, message);
      default:
        throw new DiscordError(ErrorCode.SEND_FAILED, `Unsupported content type: ${message.content.type}`);
    }
  }

  /**
   * Send typing indicator
   */
  async sendTyping(instanceId: string, channelId: string): Promise<void> {
    const client = this.getClient(instanceId);
    const channel = await client.channels.fetch(channelId);

    if (channel && 'sendTyping' in channel) {
      await (channel as { sendTyping: () => Promise<void> }).sendTyping();
    }
  }

  /**
   * Edit a message
   */
  async editMessage(instanceId: string, channelId: string, messageId: string, newText: string): Promise<void> {
    const client = this.getClient(instanceId);
    await editTextMessage(client, channelId, messageId, newText);
  }

  /**
   * Delete a message
   */
  async deleteMessage(instanceId: string, channelId: string, messageId: string): Promise<void> {
    const client = this.getClient(instanceId);
    await deleteTextMessage(client, channelId, messageId);
  }

  /**
   * Add a reaction to a message
   */
  async addReaction(instanceId: string, channelId: string, messageId: string, emoji: string): Promise<void> {
    const client = this.getClient(instanceId);
    await addReaction(client, channelId, messageId, emoji);
  }

  /**
   * Remove the bot's reaction from a message
   */
  async removeReaction(instanceId: string, channelId: string, messageId: string, emoji: string): Promise<void> {
    const client = this.getClient(instanceId);
    await removeReaction(client, channelId, messageId, emoji);
  }

  // ─────────────────────────────────────────────────────────────
  // ChannelPlugin: react / unreact (per_thread media processing feedback)
  // ─────────────────────────────────────────────────────────────

  /**
   * Add a reaction emoji to a Discord message (per_thread media processing feedback).
   * Graceful skip on permission errors (bot may lack ADD_REACTIONS in this channel).
   */
  async react(instanceId: string, chatId: string, messageId: string, emoji: string): Promise<void> {
    const client = this.getClient(instanceId);
    try {
      await addReaction(client, chatId, messageId, emoji);
    } catch (err) {
      this.logger.warn('react: failed to add reaction', { chatId, messageId, emoji, error: String(err) });
    }
  }

  /**
   * Remove a reaction emoji from a Discord message.
   * Graceful skip on permission errors.
   */
  async unreact(instanceId: string, chatId: string, messageId: string, emoji: string): Promise<void> {
    const client = this.getClient(instanceId);
    try {
      await removeReaction(client, chatId, messageId, emoji);
    } catch (err) {
      this.logger.warn('unreact: failed to remove reaction', { chatId, messageId, emoji, error: String(err) });
    }
  }

  /**
   * Set bot presence (status + activity) for a Discord instance.
   * Can be called at runtime without reconnecting.
   */
  async setPresence(
    instanceId: string,
    presence: {
      status?: 'online' | 'dnd' | 'idle' | 'invisible';
      activityText?: string;
      activityType?: 'Playing' | 'Streaming' | 'Listening' | 'Watching' | 'Custom' | 'Competing';
    },
  ): Promise<void> {
    const client = this.getClient(instanceId);

    const activityTypeMap: Record<string, ActivityType> = {
      Playing: ActivityType.Playing,
      Streaming: ActivityType.Streaming,
      Listening: ActivityType.Listening,
      Watching: ActivityType.Watching,
      Custom: ActivityType.Custom,
      Competing: ActivityType.Competing,
    };

    const activities = presence.activityText
      ? [
          {
            name: presence.activityText,
            type: activityTypeMap[presence.activityType ?? 'Playing'] ?? ActivityType.Playing,
          },
        ]
      : [];

    client.user?.setPresence({
      status: (presence.status ?? 'online') as PresenceStatusData,
      activities,
    });

    this.logger.info('Bot presence updated', { instanceId, presence });
  }

  /**
   * Set guild config overrides for an instance.
   * Called by API routes when guild config is created/updated.
   */
  setGuildConfig(instanceId: string, guildId: string, config: GuildConfigOverride): void {
    let overrides = this.guildConfigCache.get(instanceId);
    if (!overrides) {
      overrides = {};
      this.guildConfigCache.set(instanceId, overrides);
    }
    overrides[guildId] = config;
    this.logger.debug('Guild config updated in plugin cache', { instanceId, guildId });
  }

  /**
   * Remove guild config overrides for an instance (reset to defaults).
   * Called by API routes when guild config is deleted.
   */
  removeGuildConfig(instanceId: string, guildId: string): void {
    const overrides = this.guildConfigCache.get(instanceId);
    if (overrides) {
      delete overrides[guildId];
      this.logger.debug('Guild config removed from plugin cache', { instanceId, guildId });
    }
  }

  /**
   * Get resolved guild config for a specific guild.
   * Returns the guild-specific overrides, or undefined if no overrides exist.
   */
  getGuildConfig(instanceId: string, guildId: string): GuildConfigOverride | undefined {
    return this.guildConfigCache.get(instanceId)?.[guildId];
  }

  /**
   * Load guild config overrides from instance data into plugin cache.
   * Called during connection setup.
   */
  loadGuildConfigs(instanceId: string, overrides: Record<string, GuildConfigOverride>): void {
    this.guildConfigCache.set(instanceId, { ...overrides });
    this.logger.debug('Guild configs loaded into plugin cache', {
      instanceId,
      guildCount: Object.keys(overrides).length,
    });
  }

  /**
   * Get the profile of the connected Discord bot.
   * Returns profile info including bot name, avatar, and platform-specific metadata.
   *
   * @param instanceId - Instance to get profile for
   * @returns Profile information including platform metadata
   */
  async getProfile(instanceId: string): Promise<{
    name?: string;
    avatarUrl?: string;
    bio?: string;
    ownerIdentifier?: string;
    platformMetadata: {
      botId: string;
      applicationId?: string;
      discriminator?: string;
      isBot: boolean;
      guildCount: number;
      flags?: number;
    };
  }> {
    const client = this.getClient(instanceId);
    const user = client.user;

    if (!user) {
      throw new DiscordError(ErrorCode.NOT_CONNECTED, `Instance ${instanceId} not fully connected - no bot user info`);
    }

    // Get guild count
    const guildCount = client.guilds.cache.size;

    // Get avatar URL (access directly from client.user to have full User type)
    const avatarUrl = user.displayAvatarURL({ size: 256 });

    // Build platform metadata
    const platformMetadata: {
      botId: string;
      applicationId?: string;
      discriminator?: string;
      isBot: boolean;
      guildCount: number;
      flags?: number;
    } = {
      botId: user.id,
      applicationId: client.application?.id,
      discriminator: user.discriminator || undefined,
      isBot: user.bot ?? true,
      guildCount,
      flags: user.flags?.bitfield,
    };

    return {
      name: user.username,
      avatarUrl,
      bio: undefined, // Discord bots don't have bios
      ownerIdentifier: user.id,
      platformMetadata,
    };
  }

  /**
   * Fetch profile info for a specific Discord user
   *
   * @param instanceId - Instance to use
   * @param userId - Discord user ID
   * @returns Profile data including username, avatar, banner, bio
   */
  async fetchUserProfile(
    instanceId: string,
    userId: string,
  ): Promise<{
    displayName?: string;
    avatarUrl?: string;
    bio?: string;
    phone?: string;
    platformData?: Record<string, unknown>;
  }> {
    const client = this.getClient(instanceId);

    try {
      // Fetch full user to get all profile data including banner
      const user = await client.users.fetch(userId, { force: true });

      const platformData: Record<string, unknown> = {
        username: user.username,
        globalName: user.globalName,
        discriminator: user.discriminator,
        isBot: user.bot,
        flags: user.flags?.bitfield,
        createdAt: user.createdAt?.toISOString(),
      };

      // Get banner if available
      const bannerUrl = user.bannerURL({ size: 512 });
      if (bannerUrl) {
        platformData.bannerUrl = bannerUrl;
      }

      return {
        displayName: user.globalName || user.username,
        avatarUrl: user.displayAvatarURL({ size: 256 }),
        bio: undefined, // Discord user bios require OAuth2 - not available via bot
        platformData,
      };
    } catch (error) {
      this.logger.warn('Failed to fetch user profile', { userId, error: String(error) });
      return {};
    }
  }

  /**
   * Fetch message history from a Discord channel.
   *
   * Discord provides a proper API for fetching historical messages using
   * the channel.messages.fetch() method.
   *
   * @param instanceId - Instance to fetch history for
   * @param options - Fetch options including channel ID and date range
   * @returns Promise that resolves with fetched messages
   */
  async fetchHistory(instanceId: string, options: FetchHistoryOptions): Promise<FetchHistoryResult> {
    if (!options.channelId) {
      throw new DiscordError(
        ErrorCode.NOT_FOUND,
        'channelId is required for Discord history fetch — Discord sync must target a specific channel',
      );
    }

    const client = this.getClient(instanceId);
    const limit = Math.min(options.limit ?? 100, 1000); // Max 1000 messages

    // Get the channel
    const channel = await client.channels.fetch(options.channelId);
    if (!channel || !('messages' in channel)) {
      throw new DiscordError(ErrorCode.NOT_FOUND, `Channel ${options.channelId} not found or not a text channel`);
    }

    const textChannel = channel as TextBasedChannel;
    const botId = client.user?.id;

    this.logger.debug('Starting history fetch', {
      instanceId,
      channelId: options.channelId,
      limit,
      since: options.since?.toISOString(),
      until: options.until?.toISOString(),
    });

    try {
      const messages = await this.fetchMessageBatches(textChannel, options, limit, botId);

      this.logger.info('History fetch complete', {
        instanceId,
        channelId: options.channelId,
        totalFetched: messages.length,
      });

      return {
        totalFetched: messages.length,
        messages,
      };
    } catch (error) {
      throw mapDiscordError(error);
    }
  }

  /**
   * Convert a Discord message to HistorySyncMessage format
   * @internal
   */
  private convertToHistoryMessage(msg: Message, channelId: string, botId?: string): HistorySyncMessage {
    const { contentType, text, mediaUrl, mimeType } = this.extractMessageContent(msg);

    return {
      externalId: msg.id,
      chatId: channelId,
      from: msg.author.id,
      timestamp: msg.createdAt,
      content: { type: contentType, text, mediaUrl, mimeType },
      isFromMe: msg.author.id === botId,
      rawPayload: this.buildRawPayload(msg),
    };
  }

  /**
   * Extract content from a Discord message
   * @internal
   */
  private extractMessageContent(msg: Message): {
    contentType: string;
    text: string | undefined;
    mediaUrl: string | undefined;
    mimeType: string | undefined;
  } {
    let contentType = 'text';
    let text = msg.content || undefined;
    let mediaUrl: string | undefined;
    let mimeType: string | undefined;

    // Check for attachments
    const attachment = msg.attachments.first();
    if (attachment) {
      mediaUrl = attachment.url;
      mimeType = attachment.contentType ?? undefined;
      contentType = this.getContentTypeFromMime(mimeType);
    }

    // Check for embeds
    if (msg.embeds.length > 0 && !text) {
      const embed = msg.embeds[0];
      if (embed) {
        text = embed.description ?? embed.title ?? undefined;
      }
    }

    return { contentType, text, mediaUrl, mimeType };
  }

  /**
   * Get content type from MIME type
   * @internal
   */
  private getContentTypeFromMime(mimeType: string | undefined): string {
    if (!mimeType) return 'document';
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('audio/')) return 'audio';
    if (mimeType.startsWith('video/')) return 'video';
    return 'document';
  }

  /**
   * Build raw payload from a Discord message
   * @internal
   */
  private buildRawPayload(msg: Message): Record<string, unknown> {
    return {
      id: msg.id,
      channelId: msg.channelId,
      guildId: msg.guildId,
      authorId: msg.author.id,
      authorTag: msg.author.tag,
      content: msg.content,
      attachments: msg.attachments.map((a) => ({
        id: a.id,
        url: a.url,
        name: a.name,
        size: a.size,
        contentType: a.contentType,
      })),
      embeds: msg.embeds.length,
      reactions: msg.reactions.cache.map((r) => ({
        emoji: r.emoji.name,
        count: r.count,
      })),
      replyToId: msg.reference?.messageId,
      createdAt: msg.createdAt.toISOString(),
      editedAt: msg.editedAt?.toISOString(),
    };
  }

  /**
   * Fetch message batches from a Discord channel
   * Handles pagination and filtering by date range
   * @internal
   */
  /** Process a single batch of messages, applying date filters. Returns false to stop iteration. */
  private processBatch(
    batch: Map<string, Message> & { last: () => Message | undefined; size: number },
    options: FetchHistoryOptions,
    messages: HistorySyncMessage[],
    botId: string | undefined,
  ): boolean {
    for (const msg of batch.values()) {
      if (options.since && msg.createdAt < options.since) return false; // reached oldest — stop
      if (options.until && msg.createdAt > options.until) continue; // too new — skip
      const historyMsg = this.convertToHistoryMessage(msg, options.channelId ?? '', botId);
      messages.push(historyMsg);
      options.onMessage?.(historyMsg);
    }
    return true;
  }

  private async fetchMessageBatches(
    channel: TextBasedChannel,
    options: FetchHistoryOptions,
    limit: number,
    botId: string | undefined,
  ): Promise<HistorySyncMessage[]> {
    const messages: HistorySyncMessage[] = [];
    let before: string | undefined;
    let remaining = limit;

    while (remaining > 0) {
      const batchSize = Math.min(remaining, 100);
      const batch = await channel.messages.fetch({ limit: batchSize, before });

      if (batch.size === 0) break;

      const shouldContinue = this.processBatch(
        batch as unknown as Map<string, Message> & { last: () => Message | undefined; size: number },
        options,
        messages,
        botId,
      );

      remaining -= batch.size;
      before = batch.last()?.id;
      options.onProgress?.(messages.length);

      if (!shouldContinue || batch.size < batchSize) break;
    }

    return messages;
  }

  /**
   * Fetch guild members (contacts) for a Discord instance.
   *
   * Discord allows fetching members from guilds the bot is in.
   *
   * @param instanceId - Instance to fetch contacts for
   * @param options - Fetch options including guild ID and callbacks
   * @returns Promise with fetched contacts
   */
  async fetchContacts(instanceId: string, options: FetchContactsOptions): Promise<FetchContactsResult> {
    const client = this.getClient(instanceId);
    const limit = options.limit ?? 1000;
    const contacts: SyncContact[] = [];

    // Fetch the guild
    const guild = await client.guilds.fetch(options.guildId);
    if (!guild) {
      throw new DiscordError(ErrorCode.NOT_FOUND, `Guild ${options.guildId} not found`);
    }

    try {
      // Fetch members with limit
      const members = await guild.members.fetch({ limit });

      for (const member of members.values()) {
        const contact: SyncContact = {
          platformUserId: member.user.id,
          name: member.nickname || member.user.displayName,
          username: member.user.username,
          discriminator: member.user.discriminator || undefined,
          profilePicUrl: member.user.displayAvatarURL({ size: 256 }),
          isBot: member.user.bot,
          guildId: guild.id,
          roles: member.roles.cache.map((r) => r.name),
          joinedAt: member.joinedAt || undefined,
          metadata: {
            guildName: guild.name,
            premiumSince: member.premiumSince?.toISOString(),
            pending: member.pending,
          },
        };

        contacts.push(contact);
        options.onContact?.(contact);
        options.onProgress?.(contacts.length);
      }

      this.logger.info('Guild members fetch complete', {
        instanceId,
        guildId: options.guildId,
        totalMembers: contacts.length,
      });

      return {
        totalFetched: contacts.length,
        contacts,
      };
    } catch (error) {
      throw mapDiscordError(error);
    }
  }

  /**
   * Fetch all guilds (servers) for a Discord instance.
   *
   * Returns all guilds the bot is a member of.
   *
   * @param instanceId - Instance to fetch guilds for
   * @param options - Fetch options including callbacks
   * @returns Promise with fetched guilds
   */
  async fetchGuilds(instanceId: string, options: FetchGuildsOptions = {}): Promise<FetchGuildsResult> {
    const client = this.getClient(instanceId);
    const guilds: SyncGuild[] = [];

    try {
      // Get all guilds the bot is in
      for (const guild of client.guilds.cache.values()) {
        const syncGuild: SyncGuild = {
          externalId: guild.id,
          name: guild.name,
          description: guild.description || undefined,
          memberCount: guild.memberCount,
          iconUrl: guild.iconURL({ size: 256 }) || undefined,
          ownerId: guild.ownerId,
          createdAt: guild.createdAt,
          metadata: {
            features: guild.features,
            preferredLocale: guild.preferredLocale,
            verified: guild.verified,
            partnered: guild.partnered,
            vanityURLCode: guild.vanityURLCode,
          },
        };

        guilds.push(syncGuild);
        options.onGuild?.(syncGuild);
        options.onProgress?.(guilds.length);
      }

      this.logger.info('Guilds fetch complete', {
        instanceId,
        totalGuilds: guilds.length,
      });

      return {
        totalFetched: guilds.length,
        guilds,
      };
    } catch (error) {
      throw mapDiscordError(error);
    }
  }

  /**
   * Get the Discord client for an instance
   * @internal - Used by other modules
   */
  getClient(instanceId: string): Client {
    const client = this.clients.get(instanceId);
    if (!client) {
      throw new DiscordError(ErrorCode.NOT_CONNECTED, `Instance ${instanceId} not connected`);
    }
    if (!isClientReady(client)) {
      throw new DiscordError(ErrorCode.NOT_CONNECTED, `Instance ${instanceId} not ready`);
    }
    return client;
  }

  // ─────────────────────────────────────────────────────────────
  // Internal handlers called by event handlers
  // ─────────────────────────────────────────────────────────────

  /**
   * Handle successful connection
   * @internal
   */
  async handleConnected(instanceId: string, client: Client): Promise<void> {
    const botUser = getBotUser(client);

    const config = this.instances.get(instanceId)?.config;
    if (config) {
      await this.updateInstanceStatus(instanceId, config, {
        state: 'connected',
        since: new Date(),
      });

      // Set initial presence from config if available
      const presenceConfig = config.options?.presence as
        | { status?: string; activityText?: string; activityType?: string }
        | undefined;
      if (presenceConfig) {
        try {
          await this.setPresence(instanceId, presenceConfig as Parameters<typeof this.setPresence>[1]);
        } catch (error) {
          this.logger.warn('Failed to set initial presence', { instanceId, error: String(error) });
        }
      }
    }

    await this.emitInstanceConnected(instanceId, {
      profileName: botUser?.username,
      ownerIdentifier: botUser?.id,
    });
  }

  /**
   * Handle disconnection
   * @internal
   */
  async handleDisconnected(instanceId: string, reason: string, willReconnect: boolean): Promise<void> {
    const config = this.instances.get(instanceId)?.config;
    if (config) {
      await this.updateInstanceStatus(instanceId, config, {
        state: 'disconnected',
        since: new Date(),
        message: reason,
      });
    }

    await this.emitInstanceDisconnected(instanceId, reason, willReconnect);
  }

  /**
   * Handle reconnection attempt
   * @internal
   */
  async handleReconnecting(instanceId: string, attempt: number, maxAttempts: number): Promise<void> {
    const config = this.instances.get(instanceId)?.config;
    if (config) {
      await this.updateInstanceStatus(instanceId, config, {
        state: 'reconnecting',
        since: new Date(),
        message: `Reconnecting (attempt ${attempt}/${maxAttempts})`,
      });
    }

    this.logger.info('Reconnecting instance', { instanceId, attempt, maxAttempts });
  }

  /**
   * Handle connection error
   * @internal
   */
  handleConnectionError(instanceId: string, error: string, willRetry: boolean): void {
    this.logger.error('Connection error', { instanceId, error, willRetry });
  }

  /**
   * Handle incoming message
   * @internal
   */
  async handleMessageReceived(
    instanceId: string,
    externalId: string,
    chatId: string,
    from: string,
    content: {
      type: ContentType;
      text?: string;
      mediaUrl?: string;
      mimeType?: string;
    },
    replyToId: string | undefined,
    rawPayload: Record<string, unknown>,
    platformTimestamp?: number,
  ): Promise<void> {
    // Journey timing: capture T0 (platform) and T1 (plugin received)
    // Discord timestamps are already in milliseconds
    const timings = platformTimestamp ? this.captureInboundTimings(platformTimestamp) : undefined;

    const correlationId = await this.emitMessageReceived({
      instanceId,
      externalId,
      chatId,
      from,
      content,
      replyToId,
      rawPayload,
      timings,
    });

    // Journey timing: capture T2 (event published to NATS)
    if (timings) {
      this.captureT2(correlationId, timings);
    }
  }

  /**
   * Handle incoming reaction
   * @internal
   */
  async handleReactionReceived(
    instanceId: string,
    messageId: string,
    chatId: string,
    userId: string,
    emoji: string,
    action: 'add' | 'remove',
  ): Promise<void> {
    // Emit first-class reaction event
    if (action === 'add') {
      await this.emitReactionReceived({
        instanceId,
        messageId,
        chatId,
        from: userId,
        emoji,
        isCustomEmoji: false,
      });
    } else {
      await this.emitReactionRemoved({
        instanceId,
        messageId,
        chatId,
        from: userId,
        emoji,
        isCustomEmoji: false,
      });
    }

    // Dual-emit as message.received for backward compatibility
    // Remove this once all consumers migrate to reaction.* events
    if (process.env.OMNI_DUAL_EMIT_REACTIONS !== 'false') {
      await this.emitMessageReceived({
        instanceId,
        externalId: `${messageId}-reaction-${Date.now()}`,
        chatId,
        from: userId,
        content: {
          type: 'reaction',
          text: emoji,
        },
        rawPayload: {
          targetMessageId: messageId,
          action,
          emoji,
        },
      });
    }
  }

  /**
   * Handle message edited
   * @internal
   */
  async handleMessageEdited(instanceId: string, messageId: string, chatId: string, newText: string): Promise<void> {
    await this.emitMessageReceived({
      instanceId,
      externalId: `${messageId}-edit-${Date.now()}`,
      chatId,
      from: chatId,
      content: {
        type: 'edit',
        text: newText,
      },
      rawPayload: {
        editedMessageId: messageId,
        newText,
        editedAt: Date.now(),
      },
    });

    this.logger.debug('Message edited', { instanceId, messageId, chatId });
  }

  /**
   * Handle message deleted
   * @internal
   */
  async handleMessageDeleted(instanceId: string, messageId: string, chatId: string, fromMe: boolean): Promise<void> {
    await this.emitMessageReceived({
      instanceId,
      externalId: `${messageId}-delete-${Date.now()}`,
      chatId,
      from: chatId,
      content: {
        type: 'delete',
        text: fromMe ? 'Message deleted by bot' : 'Message deleted',
      },
      rawPayload: {
        deletedMessageId: messageId,
        deletedAt: Date.now(),
        deletedByMe: fromMe,
      },
    });

    this.logger.debug('Message deleted', { instanceId, messageId, chatId });
  }

  /**
   * Handle typing start
   * @internal
   */
  handleTypingStart(_instanceId: string, _channelId: string, _userId: string): void {
    // Could emit typing event if needed
  }

  /**
   * Handle presence update
   * @internal
   */
  handlePresenceUpdate(_instanceId: string, _userId: string, _status: string, _guildId?: string): void {
    // Could emit presence event if needed
  }

  /**
   * Handle thread create
   * @internal
   */
  handleThreadCreate(_instanceId: string, _threadId: string, _name: string, _parentId?: string): void {
    this.logger.debug('Thread created', { _instanceId, _threadId, _name });
  }

  /**
   * Handle thread delete
   * @internal
   */
  handleThreadDelete(_instanceId: string, _threadId: string): void {
    this.logger.debug('Thread deleted', { _instanceId, _threadId });
  }

  /**
   * Handle thread update
   * @internal
   */
  handleThreadUpdate(
    _instanceId: string,
    _threadId: string,
    _changes: { name?: string; archived?: boolean; locked?: boolean },
  ): void {
    this.logger.debug('Thread updated', { _instanceId, _threadId, _changes });
  }

  /**
   * Handle thread members update
   * @internal
   */
  handleThreadMembersUpdate(_instanceId: string, _threadId: string, _added: string[], _removed: string[]): void {
    this.logger.debug('Thread members updated', { _instanceId, _threadId });
  }

  /**
   * Handle member join
   * @internal
   */
  handleMemberJoin(_instanceId: string, _guildId: string, _memberId: string, _tag: string): void {
    this.logger.debug('Member joined', { _instanceId, _guildId, _memberId });
  }

  /**
   * Handle member leave
   * @internal
   */
  handleMemberLeave(_instanceId: string, _guildId: string, _memberId: string): void {
    this.logger.debug('Member left', { _instanceId, _guildId, _memberId });
  }

  /**
   * Handle guild join (bot added to server)
   * @internal
   */
  handleGuildJoin(_instanceId: string, _guildId: string, _guildName: string): void {
    this.logger.info('Bot joined guild', { _instanceId, _guildId, _guildName });
  }

  /**
   * Handle guild leave (bot removed from server)
   * @internal
   */
  handleGuildLeave(_instanceId: string, _guildId: string): void {
    this.logger.info('Bot left guild', { _instanceId, _guildId });
  }

  // ─────────────────────────────────────────────────────────────
  // Interaction handlers
  // ─────────────────────────────────────────────────────────────

  /**
   * Handle slash command
   * @internal
   */
  async handleSlashCommand(payload: SlashCommandPayload): Promise<void> {
    await this.emitCustomEvent('custom.discord.slash_command', payload);
  }

  /**
   * Handle context menu command
   * @internal
   */
  async handleContextMenu(payload: ContextMenuPayload): Promise<void> {
    await this.emitCustomEvent('custom.discord.context_menu', payload);
  }

  /**
   * Handle button click
   * @internal
   */
  async handleButtonClick(payload: ButtonPayload): Promise<void> {
    await this.emitCustomEvent('custom.discord.button', payload);
  }

  /**
   * Handle select menu
   * @internal
   */
  async handleSelectMenu(payload: SelectMenuPayload): Promise<void> {
    await this.emitCustomEvent('custom.discord.select_menu', payload);
  }

  /**
   * Handle modal submit
   * @internal
   */
  async handleModalSubmit(payload: ModalSubmitPayload): Promise<void> {
    await this.emitCustomEvent('custom.discord.modal_submit', payload);
  }

  /**
   * Handle autocomplete
   * @internal
   */
  async handleAutocomplete(payload: AutocompletePayload): Promise<void> {
    await this.emitCustomEvent('custom.discord.autocomplete', payload);
  }

  /**
   * Emit a custom event
   * @internal
   */
  private async emitCustomEvent(
    eventType: string,
    payload:
      | SlashCommandPayload
      | ContextMenuPayload
      | ButtonPayload
      | SelectMenuPayload
      | ModalSubmitPayload
      | AutocompletePayload,
  ): Promise<void> {
    // Custom events use a different publishing pattern
    // They go through the event bus with a custom type
    this.logger.debug('Custom event', { eventType, payload: { ...payload } });

    // Note: In a full implementation, this would publish to the event bus
    // For now, we log it - the events-ext system can subscribe to these
  }
}
