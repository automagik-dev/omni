/**
 * Slack Channel Plugin using Bolt.js with Socket Mode
 *
 * Main plugin class that extends BaseChannelPlugin from channel-sdk.
 * Handles connection, messaging, streaming, interactions, and file handling.
 */

import { BaseChannelPlugin } from '@omni/channel-sdk';
import type {
  ChannelCapabilities,
  InstanceConfig,
  OutgoingMessage,
  PluginContext,
  SendResult,
  StreamSender,
} from '@omni/channel-sdk';
import type { ChannelType, ContentType } from '@omni/core/types';

import { SLACK_CAPABILITIES } from './capabilities';
import { resolveStreamMode, resolveStreamThrottle } from './config/stream-mode';
import type { BoltConnection } from './connection/bolt-client';
import { checkBoltHealth, createBoltConnection, destroyBoltConnection } from './connection/bolt-client';
import { setupCommandHandlers } from './handlers/commands';
import { extractFileInfo, getContentTypeFromMime } from './handlers/files';
import { setupInteractionHandlers } from './handlers/interactions';
import { setupMessageHandlers } from './handlers/messages';
import { setupReactionHandlers } from './handlers/reactions';
import { uploadFile, uploadFileFromUrl } from './senders/media';
import { createSlackStreamSender } from './senders/stream';
import { deleteSlackMessage, editSlackMessage, sendTextMessage } from './senders/text';
import type { ReplyToMode, SlackConfig, SlackInteractionPayload } from './types';
import { SlackError, SlackErrorCode } from './types';

/**
 * Slack Channel Plugin
 *
 * Extends BaseChannelPlugin to provide Slack messaging via Bolt.js Socket Mode.
 *
 * Features:
 * - Socket Mode connection (no webhook URL needed)
 * - Text messaging with mrkdwn formatting
 * - Streaming draft messages (replace, status_final, off)
 * - Thread support
 * - Interactive components (Block Kit)
 * - Slash commands
 * - File uploads/downloads
 * - Reactions, pins
 * - DM policy enforcement
 * - Identity customization
 */
export class SlackPlugin extends BaseChannelPlugin {
  readonly id: ChannelType = 'slack';
  readonly name = 'Slack (Bolt.js)';
  readonly version = '1.0.0';
  readonly capabilities: ChannelCapabilities = SLACK_CAPABILITIES;

  /** Active Bolt.js connections per instance */
  private connections = new Map<string, BoltConnection>();

  /** Plugin-specific config per instance */
  private slackConfigs = new Map<string, SlackConfig>();

  /**
   * Plugin-specific initialization
   */
  protected override async onInitialize(_context: PluginContext): Promise<void> {
    // No additional initialization needed
  }

  /**
   * Plugin-specific cleanup
   */
  protected override async onDestroy(): Promise<void> {
    for (const [instanceId, connection] of this.connections) {
      this.logger.info('Destroying Slack connection', { instanceId });
      await destroyBoltConnection(connection, this.logger);
    }
    this.connections.clear();
    this.slackConfigs.clear();
  }

  /**
   * Connect a Slack instance via Socket Mode
   */
  async connect(instanceId: string, config: InstanceConfig): Promise<void> {
    const existing = this.connections.get(instanceId);
    if (existing) {
      const isHealthy = await checkBoltHealth(existing);
      if (isHealthy) {
        this.logger.warn('Instance already connected', { instanceId });
        return;
      }
      await destroyBoltConnection(existing, this.logger);
      this.connections.delete(instanceId);
    }

    await this.updateInstanceStatus(instanceId, config, {
      state: 'connecting',
      since: new Date(),
    });

    const slackConfig = (config.options ?? {}) as SlackConfig;
    const botToken = slackConfig.botToken ?? (config.credentials?.botToken as string);
    const appToken = slackConfig.appToken ?? (config.credentials?.appToken as string);
    const signingSecret = slackConfig.signingSecret ?? (config.credentials?.signingSecret as string | undefined);

    if (!botToken || !appToken) {
      throw new SlackError(
        SlackErrorCode.INVALID_TOKEN,
        'Both botToken (xoxb-...) and appToken (xapp-...) are required for Socket Mode',
      );
    }

    this.slackConfigs.set(instanceId, slackConfig);

    try {
      const connection = await createBoltConnection(
        { botToken, appToken, signingSecret, retryConfig: slackConfig.retryConfig },
        this.logger,
      );

      // Set up event handlers
      this.setupHandlers(instanceId, connection, slackConfig);

      this.connections.set(instanceId, connection);

      await this.updateInstanceStatus(instanceId, config, {
        state: 'connected',
        since: new Date(),
        metadata: {
          profileName: connection.botName,
          ownerIdentifier: connection.botUserId,
        },
      });

      await this.emitInstanceConnected(instanceId, {
        profileName: connection.botName,
        ownerIdentifier: connection.botUserId,
      });

      this.logger.info('Slack instance connected', {
        instanceId,
        botName: connection.botName,
        teamName: connection.teamName,
      });
    } catch (error) {
      await this.updateInstanceStatus(instanceId, config, {
        state: 'error',
        since: new Date(),
        error: {
          code: SlackErrorCode.CONNECTION_FAILED,
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
        },
      });
      throw error;
    }
  }

  /**
   * Disconnect a Slack instance
   */
  async disconnect(instanceId: string): Promise<void> {
    const connection = this.connections.get(instanceId);
    if (!connection) return;

    await destroyBoltConnection(connection, this.logger);
    this.connections.delete(instanceId);
    this.slackConfigs.delete(instanceId);

    await this.emitInstanceDisconnected(instanceId, 'User requested disconnect');
  }

  /**
   * Send a message through Slack
   */
  async sendMessage(instanceId: string, message: OutgoingMessage): Promise<SendResult> {
    const connection = this.getConnection(instanceId);
    const slackConfig = this.slackConfigs.get(instanceId) ?? {};
    const channelId = message.to;

    try {
      const correlationId = message.metadata?.correlationId as string | undefined;
      if (correlationId) this.captureT10(correlationId);

      const messageId = await this.dispatchMessageByType(connection, channelId, message, slackConfig);

      if (correlationId) this.captureT11(correlationId);

      await this.emitMessageSent({
        instanceId,
        externalId: messageId,
        chatId: channelId,
        threadId: message.threadId,
        to: message.to,
        content: { type: message.content.type, text: message.content.text },
        replyToId: message.replyTo,
      });

      return { success: true, messageId, timestamp: Date.now() };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorCode = error instanceof SlackError ? error.code : SlackErrorCode.SEND_FAILED;
      const retryable = error instanceof SlackError ? error.retryable : false;

      await this.emitMessageFailed({
        instanceId,
        chatId: channelId,
        error: errorMessage,
        errorCode,
        retryable,
      });

      return {
        success: false,
        error: errorMessage,
        errorCode,
        retryable,
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Create a stream sender for progressive message rendering
   */
  createStreamSender(
    instanceId: string,
    chatId: string,
    replyToMessageId?: string,
    _chatType?: 'dm' | 'group' | 'channel',
    options?: { formatMode?: 'convert' | 'passthrough' },
  ): StreamSender {
    const connection = this.getConnection(instanceId);
    const slackConfig = this.slackConfigs.get(instanceId) ?? {};
    const replyToMode = slackConfig.replyToMode ?? 'off';
    const threadTs = this.resolveThreadTs(replyToMode, replyToMessageId, undefined);

    return createSlackStreamSender({
      client: connection.client,
      channelId: chatId,
      threadTs,
      streamMode: resolveStreamMode(slackConfig.streamMode),
      throttleMs: resolveStreamThrottle(slackConfig.streamThrottleMs),
      username: slackConfig.defaultUsername,
      iconUrl: slackConfig.defaultIconUrl,
      iconEmoji: slackConfig.defaultIconEmoji,
      formatMode: options?.formatMode ?? 'convert',
      logger: this.logger,
    });
  }

  /**
   * Send typing indicator
   */
  async sendTyping(_instanceId: string, _chatId: string): Promise<void> {
    // Slack doesn't have a direct typing indicator API for bots
    // The typing event is only available for human users
  }

  /**
   * Edit a message
   */
  async editMessage(instanceId: string, channelId: string, messageTs: string, newText: string): Promise<void> {
    const connection = this.getConnection(instanceId);
    await editSlackMessage(connection.client, channelId, messageTs, newText, 'convert', this.logger);
  }

  /**
   * Delete a message
   */
  async deleteMessage(instanceId: string, channelId: string, messageTs: string): Promise<void> {
    const connection = this.getConnection(instanceId);
    await deleteSlackMessage(connection.client, channelId, messageTs, this.logger);
  }

  /**
   * Add a reaction to a message
   */
  async addReaction(instanceId: string, channelId: string, messageTs: string, emoji: string): Promise<void> {
    const connection = this.getConnection(instanceId);
    const { addReaction } = await import('./tools');
    await addReaction(connection.client, channelId, messageTs, emoji, this.logger);
  }

  /**
   * Remove a reaction from a message
   */
  async removeReaction(instanceId: string, channelId: string, messageTs: string, emoji: string): Promise<void> {
    const connection = this.getConnection(instanceId);
    const { removeReaction } = await import('./tools');
    await removeReaction(connection.client, channelId, messageTs, emoji, this.logger);
  }

  /**
   * Get bot profile
   */
  async getProfile(instanceId: string): Promise<{
    name?: string;
    avatarUrl?: string;
    bio?: string;
    ownerIdentifier?: string;
    platformMetadata: Record<string, unknown>;
  }> {
    const connection = this.getConnection(instanceId);

    return {
      name: connection.botName,
      avatarUrl: undefined,
      bio: undefined,
      ownerIdentifier: connection.botUserId,
      platformMetadata: {
        botUserId: connection.botUserId,
        teamId: connection.teamId,
        teamName: connection.teamName,
      },
    };
  }

  /**
   * Fetch user profile
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
    const connection = this.getConnection(instanceId);

    try {
      const result = await connection.client.users.info({ user: userId });
      const user = result.user as Record<string, unknown> | undefined;
      if (!user) return {};

      const profile = user.profile as Record<string, unknown> | undefined;
      return {
        displayName: (profile?.display_name as string) || (profile?.real_name as string) || (user.name as string),
        avatarUrl: profile?.image_192 as string | undefined,
        bio: profile?.status_text as string | undefined,
        phone: profile?.phone as string | undefined,
        platformData: {
          username: user.name,
          realName: profile?.real_name,
          isBot: user.is_bot,
          isAdmin: user.is_admin,
          timezone: user.tz,
        },
      };
    } catch (error) {
      this.logger.warn('Failed to fetch user profile', { userId, error: String(error) });
      return {};
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────

  /**
   * Resolve thread_ts based on replyToMode config
   *
   * - 'off': Only thread if already in a thread context (threadId set)
   * - 'first': Thread when replyTo is available (first reply creates thread)
   * - 'all': Always use available thread context (replyTo or threadId)
   */
  private resolveThreadTs(
    replyToMode: ReplyToMode,
    replyTo: string | undefined,
    threadId: string | undefined,
  ): string | undefined {
    switch (replyToMode) {
      case 'all':
      case 'first':
        return replyTo ?? threadId;
      default:
        // 'off' or unrecognized: only thread if already in a thread context
        return threadId;
    }
  }

  /**
   * Get the Bolt connection for an instance
   */
  private getConnection(instanceId: string): BoltConnection {
    const connection = this.connections.get(instanceId);
    if (!connection) {
      throw new SlackError(SlackErrorCode.NOT_CONNECTED, `Instance ${instanceId} not connected`);
    }
    return connection;
  }

  /**
   * Set up all event handlers for an instance
   */
  private setupHandlers(instanceId: string, connection: BoltConnection, config: SlackConfig): void {
    // Message handlers
    setupMessageHandlers(
      connection.app,
      instanceId,
      connection.botUserId,
      {
        onMessage: async (
          _instId,
          externalId,
          chatId,
          from,
          content,
          replyToId,
          rawPayload,
          platformTimestamp,
          _meta,
        ) => {
          // Handle file attachments
          const files = rawPayload.files as unknown[] | undefined;
          if (files && files.length > 0) {
            const fileInfos = extractFileInfo(files);
            for (const fileInfo of fileInfos) {
              const contentType = getContentTypeFromMime(fileInfo.mimeType);
              await this.handleMessageReceived(
                instanceId,
                `${externalId}-file-${fileInfo.id}`,
                chatId,
                from,
                {
                  type: contentType as ContentType,
                  text: content.text,
                  mediaUrl: fileInfo.urlPrivateDownload ?? fileInfo.urlPrivate,
                  mimeType: fileInfo.mimeType,
                },
                replyToId,
                { ...rawPayload, fileInfo },
                platformTimestamp,
              );
            }
            // If there was also text, emit the text message too
            if (!content.text) return;
          }

          await this.handleMessageReceived(
            instanceId,
            externalId,
            chatId,
            from,
            content,
            replyToId,
            rawPayload,
            platformTimestamp,
          );
        },
        onDmRejected: async (_instId, channelId, _userId, message) => {
          try {
            await sendTextMessage(
              connection.client,
              {
                channelId,
                text: message,
                formatMode: 'passthrough',
              },
              this.logger,
            );
          } catch (err) {
            this.logger.warn('Failed to send DM rejection', { error: String(err) });
          }
        },
      },
      {
        policy: config.dmPolicy ?? 'open',
        allowlist: config.dmAllowlist,
        rejectionMessage: config.dmRejectionMessage,
      },
      this.logger,
    );

    // Reaction handlers
    setupReactionHandlers(
      connection.app,
      instanceId,
      connection.botUserId,
      {
        onReaction: async (instId, messageId, chatId, userId, emoji, action) => {
          await this.handleReactionReceived(instId, messageId, chatId, userId, emoji, action);
        },
      },
      this.logger,
    );

    // Interaction handlers
    setupInteractionHandlers(
      connection.app,
      instanceId,
      {
        onInteraction: async (_instId, payload) => {
          await this.handleInteraction(payload);
        },
      },
      this.logger,
    );

    // Command handlers (if any commands are configured)
    const commands = (config as Record<string, unknown>).slashCommands as string[] | undefined;
    if (commands && commands.length > 0) {
      setupCommandHandlers(
        connection.app,
        instanceId,
        commands,
        {
          onCommand: async (payload) => {
            await this.handleCommand(payload);
            return undefined;
          },
        },
        this.logger,
      );
    }
  }

  /**
   * Dispatch outgoing message by content type
   */
  private async dispatchMessageByType(
    connection: BoltConnection,
    channelId: string,
    message: OutgoingMessage,
    config: SlackConfig,
  ): Promise<string> {
    switch (message.content.type) {
      case 'text':
        return this.sendTextContent(connection, channelId, message, config);
      case 'image':
      case 'audio':
      case 'video':
      case 'document':
        return this.sendMediaContent(connection, channelId, message, config);
      case 'reaction':
        return this.sendReactionContent(connection, channelId, message);
      default:
        throw new SlackError(SlackErrorCode.SEND_FAILED, `Unsupported content type: ${message.content.type}`);
    }
  }

  /** Send text content */
  private async sendTextContent(
    connection: BoltConnection,
    channelId: string,
    message: OutgoingMessage,
    config: SlackConfig,
  ): Promise<string> {
    const formatMode = (message.metadata?.messageFormatMode as 'convert' | 'passthrough') ?? 'convert';
    const replyToMode = config.replyToMode ?? 'off';
    const threadTs = this.resolveThreadTs(replyToMode, message.replyTo, message.threadId);

    return sendTextMessage(
      connection.client,
      {
        channelId,
        text: message.content.text ?? '',
        threadTs,
        username: config.defaultUsername,
        iconUrl: config.defaultIconUrl,
        iconEmoji: config.defaultIconEmoji,
        formatMode,
        ephemeral: message.metadata?.ephemeral === true,
        ephemeralUserId: message.metadata?.ephemeralUserId as string | undefined,
      },
      this.logger,
    );
  }

  /** Send media content (image, audio, video, document) */
  private async sendMediaContent(
    connection: BoltConnection,
    channelId: string,
    message: OutgoingMessage,
    config: SlackConfig,
  ): Promise<string> {
    const replyToMode = config.replyToMode ?? 'off';
    const threadTs = this.resolveThreadTs(replyToMode, message.replyTo, message.threadId);

    if (message.metadata?.base64) {
      const buffer = Buffer.from(message.metadata.base64 as string, 'base64');
      const filename = message.content.filename || `file-${Date.now()}`;
      return uploadFile(
        connection.client,
        {
          channelId,
          content: buffer,
          filename,
          threadTs,
          initialComment: message.content.text || message.content.caption,
        },
        this.logger,
      );
    }

    if (!message.content.mediaUrl) {
      throw new SlackError(SlackErrorCode.SEND_FAILED, 'Media URL or base64 required');
    }

    return uploadFileFromUrl(
      connection.client,
      {
        channelId,
        url: message.content.mediaUrl,
        filename: message.content.filename || `file-${Date.now()}`,
        threadTs,
        initialComment: message.content.text || message.content.caption,
      },
      this.logger,
    );
  }

  /** Send reaction to a message */
  private async sendReactionContent(
    connection: BoltConnection,
    channelId: string,
    message: OutgoingMessage,
  ): Promise<string> {
    const emoji = message.content.emoji;
    const targetTs = message.content.targetMessageId ?? message.replyTo;
    if (!emoji || !targetTs) {
      throw new SlackError(SlackErrorCode.SEND_FAILED, 'Reaction requires emoji and target message');
    }
    const { addReaction } = await import('./tools');
    await addReaction(connection.client, channelId, targetTs, emoji, this.logger);
    return targetTs;
  }

  /**
   * Handle incoming message (delegate to base class)
   */
  private async handleMessageReceived(
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

    if (timings) {
      this.captureT2(correlationId, timings);
    }
  }

  /**
   * Handle incoming reaction
   */
  private async handleReactionReceived(
    instanceId: string,
    messageId: string,
    chatId: string,
    userId: string,
    emoji: string,
    action: 'add' | 'remove',
  ): Promise<void> {
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
  }

  /**
   * Handle interaction (button, select, modal)
   */
  private async handleInteraction(payload: SlackInteractionPayload): Promise<void> {
    this.logger.debug('Interaction handled', {
      type: payload.type,
      actionId: payload.actionId,
      userId: payload.userId,
    });
    // Custom events would be published here for downstream processing
  }

  /**
   * Handle slash command
   */
  private async handleCommand(payload: unknown): Promise<void> {
    this.logger.debug('Command handled', { payload: String(payload) });
    // Custom events would be published here for downstream processing
  }
}
