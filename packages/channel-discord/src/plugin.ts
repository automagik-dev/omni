/**
 * Discord Channel Plugin using discord.js
 *
 * Main plugin class that extends BaseChannelPlugin from channel-sdk.
 * Handles connection, messaging, and lifecycle for Discord bot instances.
 */

import { BaseChannelPlugin } from '@omni/channel-sdk';
import type {
  ChannelCapabilities,
  InstanceConfig,
  OutgoingMessage,
  PluginContext,
  SendResult,
} from '@omni/channel-sdk';
import type { ChannelType, ContentType } from '@omni/core/types';
import type { Client, Message, TextBasedChannel } from 'discord.js';

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

/**
 * Message from history sync
 */
export interface HistorySyncMessage {
  externalId: string;
  chatId: string;
  from: string;
  timestamp: Date;
  content: {
    type: string;
    text?: string;
    mediaUrl?: string;
    mimeType?: string;
    caption?: string;
  };
  isFromMe: boolean;
  rawPayload: unknown;
}

/**
 * Options for fetchHistory method
 */
export interface FetchHistoryOptions {
  /** Channel ID to fetch messages from (required for Discord) */
  channelId: string;
  /** Fetch messages since this date */
  since?: Date;
  /** Fetch messages until this date (default: now) */
  until?: Date;
  /** Maximum number of messages to fetch (default: 100, max: 1000) */
  limit?: number;
  /** Callback for progress updates */
  onProgress?: (fetched: number, total?: number) => void;
  /** Callback for each message synced */
  onMessage?: (message: HistorySyncMessage) => void;
}

/**
 * Result of fetchHistory operation
 */
export interface FetchHistoryResult {
  totalFetched: number;
  messages: HistorySyncMessage[];
}

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

  /** Plugin configuration */
  private pluginConfig: DiscordConfig = {};

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

    setupMessageHandlers(client, this, instanceId);
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
      // Resolve channel ID - if 'to' is a user ID, create a DM channel
      try {
        await client.channels.fetch(channelId);
      } catch (channelError) {
        // Channel fetch failed - might be a user ID, try to create DM
        if ((channelError as { code?: number }).code === 10003) {
          // Unknown Channel error - try as user ID
          this.logger.debug('Channel not found, trying as user ID for DM', { to: channelId });
          try {
            const user = await client.users.fetch(channelId);
            this.logger.debug('Fetched user, creating DM channel', { userId: user.id, username: user.username });
            const dmChannel = await user.createDM();
            channelId = dmChannel.id;
            this.logger.info('Created DM channel for user', { userId: message.to, dmChannelId: channelId });
          } catch (userError) {
            this.logger.error('Failed to create DM channel', { userId: channelId, error: String(userError) });
            // Neither channel nor user - rethrow original error
            throw channelError;
          }
        } else {
          throw channelError;
        }
      }

      let messageId: string;

      // Handle different content types
      const content = message.content;

      switch (content.type) {
        case 'text': {
          // Check if this is actually an embed request via metadata
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
            // Convert timestamp from string to Date if present
            const embedOptions = {
              ...embedData,
              timestamp: embedData.timestamp ? new Date(embedData.timestamp) : undefined,
            };
            messageId = await sendEmbedMessage(client, channelId, embedOptions, content.text, message.replyTo);
          } else {
            // Regular text message - handle mentions if present
            let text = content.text ?? '';

            // Process mentions from metadata
            const mentions = message.metadata?.mentions as Array<{ id: string; type?: string }> | undefined;
            if (mentions && mentions.length > 0) {
              const mentionStrings = mentions.map((m) => {
                const type = m.type || 'user';
                switch (type) {
                  case 'user':
                    return `<@${m.id}>`;
                  case 'role':
                    return `<@&${m.id}>`;
                  case 'channel':
                    return `<#${m.id}>`;
                  case 'everyone':
                    return '@everyone';
                  case 'here':
                    return '@here';
                  default:
                    return `<@${m.id}>`;
                }
              });
              text = `${mentionStrings.join(' ')} ${text}`;
            }

            const messageIds = await sendTextMessage(client, channelId, text, message.replyTo);
            messageId = messageIds[0] ?? ''; // Return first chunk's ID
          }
          break;
        }

        case 'image':
        case 'audio':
        case 'video':
        case 'document': {
          // Check if base64 is provided in metadata (for external URLs that can't be embedded)
          const base64 = message.metadata?.base64 as string | undefined;

          if (base64) {
            // Send from buffer (base64 decoded)
            const buffer = Buffer.from(base64, 'base64');
            const filename = content.filename || `media-${Date.now()}.${content.type === 'image' ? 'png' : 'bin'}`;
            messageId = await sendMediaBuffer(client, channelId, buffer, {
              filename,
              caption: content.text || content.caption,
              replyToId: message.replyTo,
            });
          } else {
            // Send from URL
            if (!content.mediaUrl) {
              throw new DiscordError(ErrorCode.SEND_FAILED, 'Media URL or base64 required');
            }

            // Let media sender infer filename from URL/headers if not provided
            // This allows proper filename extraction for inline display
            messageId = await sendMediaMessage(client, channelId, content.mediaUrl, {
              caption: content.text || content.caption,
              filename: content.filename, // undefined if not provided - sender will infer
              replyToId: message.replyTo,
            });
          }
          break;
        }

        case 'reaction': {
          // Target message ID can come from content.targetMessageId or message.replyTo
          const targetMessageId = content.targetMessageId || message.replyTo;
          if (!content.emoji || !targetMessageId) {
            throw new DiscordError(ErrorCode.SEND_FAILED, 'Reaction requires emoji and target message ID');
          }
          await addReaction(client, channelId, targetMessageId, content.emoji);
          messageId = targetMessageId; // Reaction doesn't create a new message
          break;
        }

        case 'poll': {
          const pollData = message.metadata?.poll as
            | {
                question: string;
                answers: string[];
                durationHours?: number;
                multiSelect?: boolean;
              }
            | undefined;
          if (!pollData) {
            throw new DiscordError(ErrorCode.SEND_FAILED, 'Poll data required in metadata');
          }
          const { sendPollMessage } = await import('./senders/poll');
          messageId = await sendPollMessage(
            client,
            channelId,
            {
              question: pollData.question,
              answers: pollData.answers,
              durationHours: pollData.durationHours,
              multiSelect: pollData.multiSelect,
            },
            message.replyTo,
          );
          break;
        }

        default:
          throw new DiscordError(ErrorCode.SEND_FAILED, `Unsupported content type: ${content.type}`);
      }

      // Emit sent event
      await this.emitMessageSent({
        instanceId,
        externalId: messageId,
        chatId: channelId,
        to: message.to,
        content: {
          type: content.type,
          text: content.text,
        },
        replyToId: message.replyTo,
      });

      return {
        success: true,
        messageId,
        timestamp: Date.now(),
      };
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

      for (const msg of batch.values()) {
        // Apply date filters
        if (options.since && msg.createdAt < options.since) {
          remaining = 0; // Stop fetching, reached oldest message
          break;
        }
        if (options.until && msg.createdAt > options.until) {
          continue; // Skip messages newer than until date
        }

        const historyMsg = this.convertToHistoryMessage(msg, options.channelId, botId);
        messages.push(historyMsg);
        options.onMessage?.(historyMsg);
      }

      remaining -= batch.size;
      before = batch.last()?.id;
      options.onProgress?.(messages.length);

      // If batch returned less than requested, we've reached the end
      if (batch.size < batchSize) break;
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
  ): Promise<void> {
    await this.emitMessageReceived({
      instanceId,
      externalId,
      chatId,
      from,
      content,
      replyToId,
      rawPayload,
    });
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
