/**
 * Slack Channel Plugin using Bolt.js with Socket Mode
 *
 * Main plugin class that extends BaseChannelPlugin from channel-sdk.
 * Handles connection, messaging, streaming, interactions, and file handling.
 */

import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BaseChannelPlugin } from '@omni/channel-sdk';
import type {
  ChannelCapabilities,
  FetchHistoryOptions,
  FetchHistoryResult,
  HistorySyncMessage,
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
import { checkBoltHealth, createBoltApp, destroyBoltConnection, startBoltConnection } from './connection/bolt-client';
import type { CommandPayload } from './handlers/commands';
import { setupCommandHandlers } from './handlers/commands';
import { downloadSlackFile, extractFileInfo, getContentTypeFromMime } from './handlers/files';
import { setupInteractionHandlers } from './handlers/interactions';
import { setupMessageHandlers } from './handlers/messages';
import { setupReactionHandlers } from './handlers/reactions';
import { uploadFile, uploadFileFromUrl } from './senders/media';
import { createSlackStreamSender } from './senders/stream';
import { deleteSlackMessage, editSlackMessage, sendTextMessage } from './senders/text';
import type { ReplyToMode, SlackConfig, SlackConnectionMode, SlackInteractionPayload } from './types';
import { SlackError, SlackErrorCode } from './types';

/**
 * Resolve Slack credentials from config, options, and credentials sources.
 * Supports legacy token aliases and both connection modes.
 */
function resolveSlackTokens(
  slackConfig: SlackConfig,
  rawOptions: Record<string, unknown>,
  rawCredentials: Record<string, unknown>,
): { botToken: string; appToken?: string; signingSecret?: string; mode: SlackConnectionMode } {
  const botToken =
    slackConfig.botToken ??
    (rawOptions.token as string | undefined) ??
    (rawCredentials.botToken as string | undefined) ??
    (rawCredentials.token as string | undefined);
  const appToken = slackConfig.appToken ?? (rawCredentials.appToken as string | undefined);
  const signingSecret = slackConfig.signingSecret ?? (rawCredentials.signingSecret as string | undefined);
  const mode: SlackConnectionMode = slackConfig.mode ?? 'socket';

  if (!botToken) {
    throw new SlackError(SlackErrorCode.INVALID_TOKEN, 'botToken (xoxb-...) is required');
  }
  if (mode === 'socket' && !appToken) {
    throw new SlackError(SlackErrorCode.INVALID_TOKEN, 'appToken (xapp-...) is required for Socket Mode');
  }
  if (mode === 'http' && !signingSecret) {
    throw new SlackError(SlackErrorCode.INVALID_TOKEN, 'signingSecret is required for HTTP mode');
  }

  return { botToken, appToken, signingSecret, mode };
}

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

  /** Cached user display names per instance: Map<`${instanceId}:${userId}`, displayName | null> (null = failed lookup) */
  private userNameCache = new Map<string, string | null>();

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
    this.userNameCache.clear();
  }

  /**
   * Connect a Slack instance
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

    const rawOptions = (config.options ?? {}) as Record<string, unknown>;
    const rawCredentials = (config.credentials ?? {}) as Record<string, unknown>;
    const slackConfig = rawOptions as SlackConfig;

    let connection: BoltConnection | undefined;
    try {
      const resolved = resolveSlackTokens(slackConfig, rawOptions, rawCredentials);
      this.slackConfigs.set(instanceId, slackConfig);

      // Runtime guard: warn early if both allowlist and blocklist are set.
      // The allowlist takes precedence in isChannelBlocked(), so the blocklist
      // would be silently ignored — warn here so misconfiguration is visible.
      if (slackConfig.channelAllowlist?.length && slackConfig.channelBlocklist?.length) {
        this.logger.warn(
          'Both channelAllowlist and channelBlocklist are configured — channelAllowlist takes precedence and channelBlocklist will be ignored',
          { instanceId },
        );
      }

      // Phase 1: Create the Bolt.js app (NOT started yet)
      connection = createBoltApp(
        {
          botToken: resolved.botToken,
          appToken: resolved.appToken,
          signingSecret: resolved.signingSecret,
          retryConfig: slackConfig.retryConfig,
          mode: resolved.mode,
          httpPort: slackConfig.httpPort,
        },
        this.logger,
      );

      // Phase 2: Register all event handlers BEFORE starting
      // This is critical — Bolt.js Socket Mode starts receiving events
      // immediately after start(), so handlers must be in place first.
      this.setupHandlers(instanceId, connection, slackConfig);

      // Phase 3: Start Socket Mode connection (now handlers are ready)
      await startBoltConnection(connection, this.logger);

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
      if (connection) {
        await destroyBoltConnection(connection, this.logger).catch(() => {});
      }
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

    // Clear cached user names for this instance
    for (const key of this.userNameCache.keys()) {
      if (key.startsWith(`${instanceId}:`)) this.userNameCache.delete(key);
    }

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
    const replyToMode = slackConfig.replyToMode ?? 'all';
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
   * Resolve user display name with caching.
   * Caches both successful and failed lookups to avoid repeated API calls
   * (prevents rate-limit storms when users.info consistently fails for a user).
   */
  private async resolveUserDisplayName(instanceId: string, userId: string): Promise<string | undefined> {
    const cacheKey = `${instanceId}:${userId}`;
    if (this.userNameCache.has(cacheKey)) {
      return this.userNameCache.get(cacheKey) ?? undefined;
    }

    try {
      const profile = await this.fetchUserProfile(instanceId, userId);
      if (profile.displayName) {
        this.userNameCache.set(cacheKey, profile.displayName);
        return profile.displayName;
      }
    } catch {
      // fetchUserProfile already logs the warning
    }
    // Cache the failure (null sentinel) so we don't retry on every message
    this.userNameCache.set(cacheKey, null);
    return undefined;
  }

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

  // ─────────────────────────────────────────────────────────────
  // Thread History & Reactions (per_thread collaboration sessions)
  // ─────────────────────────────────────────────────────────────

  /** Map unicode emoji to Slack reaction names */
  private static readonly EMOJI_TO_SLACK: Record<string, string> = {
    '👀': 'eyes',
    '🎧': 'headphones',
    '✅': 'white_check_mark',
    '❌': 'x',
  };

  /**
   * Fetch message history for a Slack thread (conversations.replies).
   * Supports per_thread collaboration session lazy init.
   */
  async fetchHistory(instanceId: string, options: FetchHistoryOptions): Promise<FetchHistoryResult> {
    const connection = this.getConnection(instanceId);
    const channelId = options.channelId ?? options.threadId;
    const threadTs = options.threadId;

    if (!channelId || !threadTs) return { totalFetched: 0, messages: [] };

    const botUserId = connection.botUserId;
    const botToken = (this.slackConfigs.get(instanceId) as Record<string, unknown>)?.botToken as string | undefined;
    if (!botToken) {
      this.logger.warn('fetchHistory: no botToken for instance', { instanceId });
      return { totalFetched: 0, messages: [] };
    }

    const messages = await this.paginateThreadHistory(
      connection,
      channelId,
      threadTs,
      botUserId,
      botToken,
      options.limit ?? 200,
    );
    return { totalFetched: messages.length, messages };
  }

  /** Paginate through conversations.replies and collect HistorySyncMessages. */
  private async paginateThreadHistory(
    connection: BoltConnection,
    channelId: string,
    threadTs: string,
    botUserId: string | undefined,
    botToken: string,
    maxMessages: number,
  ): Promise<HistorySyncMessage[]> {
    const messages: HistorySyncMessage[] = [];
    let cursor: string | undefined;

    do {
      const response = await connection.client.conversations.replies({
        channel: channelId,
        ts: threadTs,
        limit: Math.min(200, maxMessages - messages.length),
        cursor,
      });

      for (const msg of (response.messages ?? []) as Record<string, unknown>[]) {
        const result = await this.buildHistorySyncMessage(msg, channelId, botUserId, botToken);
        if (result) messages.push(result);
        if (messages.length >= maxMessages) break;
      }

      cursor = response.response_metadata?.next_cursor ?? undefined;
    } while (cursor && messages.length < maxMessages);

    return messages;
  }

  /** Download a Slack private file to a temp path and return its MIME type + local path. */
  private async downloadSlackMediaToTemp(
    file: Record<string, unknown>,
    botToken: string,
    ts: string,
  ): Promise<{ mimeType: string; localPath: string | undefined }> {
    const mimeType = (file.mimetype as string) ?? 'application/octet-stream';
    const urlPrivate = (file.url_private_download as string | undefined) ?? (file.url_private as string | undefined);

    if (!urlPrivate) return { mimeType, localPath: undefined };

    try {
      const { buffer } = await downloadSlackFile(urlPrivate, botToken, this.logger);
      const ext = (mimeType.split('/')[1]?.split(';')[0] ?? 'bin').replace(/[^a-z0-9]/gi, '');
      const tmpPath = join(tmpdir(), `omni-slack-hist-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
      await writeFile(tmpPath, buffer);
      return { mimeType, localPath: tmpPath };
    } catch (err) {
      this.logger.debug('fetchHistory: file download failed', { error: String(err), ts });
      return { mimeType, localPath: undefined };
    }
  }

  /** Convert a raw Slack message to HistorySyncMessage, or null to skip (bot/own message). */
  private async buildHistorySyncMessage(
    msg: Record<string, unknown>,
    channelId: string,
    botUserId: string | undefined,
    botToken: string,
  ): Promise<HistorySyncMessage | null> {
    const userId = msg.user as string | undefined;
    if (msg.bot_id || (botUserId && userId === botUserId) || !userId) return null;

    const ts = msg.ts as string;
    const text = (msg.text as string | undefined) ?? '';
    const files = msg.files as Record<string, unknown>[] | undefined;
    const timestamp = new Date(Number.parseFloat(ts) * 1000);

    if (files && files.length > 0) {
      const { mimeType, localPath } = await this.downloadSlackMediaToTemp(
        files[0] as Record<string, unknown>,
        botToken,
        ts,
      );
      return {
        externalId: ts,
        chatId: channelId,
        from: userId,
        timestamp,
        content: {
          type: getContentTypeFromMime(mimeType),
          text: text || undefined,
          mimeType,
          localPath,
          caption: text || undefined,
        },
        isFromMe: false,
        rawPayload: msg,
      };
    }

    return {
      externalId: ts,
      chatId: channelId,
      from: userId,
      timestamp,
      content: { type: 'text', text: text || undefined },
      isFromMe: false,
      rawPayload: msg,
    };
  }

  /**
   * Add a reaction emoji to a Slack message (per_thread media processing feedback).
   */
  async react(instanceId: string, chatId: string, messageId: string, emoji: string): Promise<void> {
    const connection = this.getConnection(instanceId);
    const slackName = SlackPlugin.EMOJI_TO_SLACK[emoji] ?? emoji.replace(/^:|:$/g, '');
    try {
      await connection.client.reactions.add({ channel: chatId, timestamp: messageId, name: slackName });
    } catch (err) {
      this.logger.warn('react: failed to add reaction', { chatId, messageId, emoji, error: String(err) });
    }
  }

  /**
   * Remove a reaction emoji from a Slack message.
   */
  async unreact(instanceId: string, chatId: string, messageId: string, emoji: string): Promise<void> {
    const connection = this.getConnection(instanceId);
    const slackName = SlackPlugin.EMOJI_TO_SLACK[emoji] ?? emoji.replace(/^:|:$/g, '');
    try {
      await connection.client.reactions.remove({ channel: chatId, timestamp: messageId, name: slackName });
    } catch (err) {
      this.logger.warn('unreact: failed to remove reaction', { chatId, messageId, emoji, error: String(err) });
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
    // Message handlers — pass getter so botUserId resolves after start()
    setupMessageHandlers(
      connection.app,
      instanceId,
      () => connection.botUserId,
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
          // Resolve sender display name (cached after first lookup)
          const displayName = await this.resolveUserDisplayName(instanceId, from);
          const isDm = rawPayload.isDm as boolean;

          // Enrich rawPayload with cross-channel identity contract
          const enrichedPayload: Record<string, unknown> = {
            ...rawPayload,
            displayName,
            pushName: displayName,
            chatName: isDm ? displayName : undefined,
            isGroup: !isDm,
          };

          const files = enrichedPayload.files as unknown[] | undefined;
          if (files && files.length > 0) {
            await this.handleInboundFiles(
              instanceId,
              externalId,
              chatId,
              from,
              content,
              replyToId,
              enrichedPayload,
              platformTimestamp,
            );
            if (!content.text) return;
          }

          await this.handleMessageReceived(
            instanceId,
            externalId,
            chatId,
            from,
            content,
            replyToId,
            enrichedPayload,
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
      {
        channelAllowlist: config.channelAllowlist,
        channelBlocklist: config.channelBlocklist,
        channels: config.channels,
      },
    );

    // Reaction handlers — pass getter so botUserId resolves after start()
    setupReactionHandlers(
      connection.app,
      instanceId,
      () => connection.botUserId,
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
    const replyToMode = config.replyToMode ?? 'all';
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
    const replyToMode = config.replyToMode ?? 'all';
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
   * Emit inbound Slack file attachments.
   *
   * Slack `url_private*` links require bot-token auth.  Rather than downloading
   * the entire file here (which would copy large files entirely into heap memory
   * before base64-encoding them into a data: URI), we pass the private URL as
   * `mediaUrl` and include `_slackAuth.botToken` in `rawPayload`.  The
   * media-processor plugin reads that field and forwards it as an Authorization
   * header when it calls `storeFromUrl`, so the download happens exactly once
   * and never needs to be base64-encoded.
   */
  private async handleInboundFiles(
    instanceId: string,
    externalId: string,
    chatId: string,
    from: string,
    content: { text?: string },
    replyToId: string | undefined,
    rawPayload: Record<string, unknown>,
    platformTimestamp: number | undefined,
  ): Promise<void> {
    const files = rawPayload.files as unknown[] | undefined;
    if (!files || files.length === 0) return;

    const fileInfos = extractFileInfo(files);
    for (const fileInfo of fileInfos) {
      const contentType = getContentTypeFromMime(fileInfo.mimeType);
      const mediaUrl = fileInfo.urlPrivateDownload ?? fileInfo.urlPrivate;

      await this.handleMessageReceived(
        instanceId,
        `${externalId}-file-${fileInfo.id}`,
        chatId,
        from,
        { type: contentType as ContentType, text: content.text, mediaUrl, mimeType: fileInfo.mimeType },
        replyToId,
        // botToken is NOT included here — media-processor fetches it from the
        // instances table by instanceId so credentials never enter the event/DB
        { ...rawPayload, fileInfo },
        platformTimestamp,
      );
    }
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
   * Handle slash command — emit as inbound message.received so downstream
   * agents can process the command text just like any other message.
   */
  private async handleCommand(payload: CommandPayload): Promise<void> {
    this.logger.debug('Command received', {
      command: payload.command,
      userId: payload.userId,
      channelId: payload.channelId,
    });

    // Combine command + args into a single text string (e.g. "/remind 5min meeting")
    const text = payload.text ? `${payload.command} ${payload.text}` : payload.command;

    await this.handleMessageReceived(
      payload.instanceId,
      payload.triggerId,
      payload.channelId,
      payload.userId,
      { type: 'text', text },
      undefined,
      { command: payload.command, responseUrl: payload.responseUrl },
    );
  }
}
