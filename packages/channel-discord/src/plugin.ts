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
import type { Client } from 'discord.js';

import { clearToken, loadToken, saveToken } from './auth';
import { DISCORD_CAPABILITIES } from './capabilities';
import { createClient, destroyClient, getBotUser, isClientReady } from './client';
import {
  resetConnectionState,
  setupAllEventHandlers,
  setupConnectionHandlers,
  setupInteractionHandlers,
  setupMessageHandlers,
  setupReactionHandlers,
} from './handlers';
import { sendMediaMessage } from './senders/media';
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
    this.logger.info('Discord plugin initialized');
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
    if (this.clients.has(instanceId)) {
      const client = this.clients.get(instanceId)!;
      if (isClientReady(client)) {
        this.logger.warn('Instance already connected', { instanceId });
        return;
      }
      // Client exists but not ready, destroy and reconnect
      await destroyClient(client);
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
    const channelId = message.to;

    try {
      let messageId: string;

      // Handle different content types
      const content = message.content;

      switch (content.type) {
        case 'text': {
          const text = content.text ?? '';
          const messageIds = await sendTextMessage(client, channelId, text, message.replyTo);
          messageId = messageIds[0] ?? ''; // Return first chunk's ID
          break;
        }

        case 'image':
        case 'audio':
        case 'video':
        case 'document': {
          if (!content.mediaUrl) {
            throw new DiscordError(ErrorCode.SEND_FAILED, 'Media URL required');
          }
          messageId = await sendMediaMessage(client, channelId, content.mediaUrl, {
            caption: content.text || content.caption,
            filename: content.filename,
            replyToId: message.replyTo,
          });
          break;
        }

        case 'reaction': {
          if (!content.emoji || !message.replyTo) {
            throw new DiscordError(ErrorCode.SEND_FAILED, 'Reaction requires emoji and target message');
          }
          await addReaction(client, channelId, message.replyTo, content.emoji);
          messageId = message.replyTo; // Reaction doesn't create a new message
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
