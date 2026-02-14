/**
 * Telegram Channel Plugin using grammy
 *
 * Main plugin class that extends BaseChannelPlugin from channel-sdk.
 * Handles connection, messaging, and lifecycle for Telegram bot instances.
 *
 * Supports two connection modes:
 * - polling: Long-polling (dev/testing)
 * - webhook: Webhook updates (production)
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
import type { ChannelType } from '@omni/core/types';
import type { Bot } from 'grammy';

import { TELEGRAM_CAPABILITIES } from './capabilities';
import { createBot, destroyBot, getBot } from './client';
import {
  setupChannelPostHandlers,
  setupInteractiveHandlers,
  setupMessageHandlers,
  setupReactionHandlers,
} from './handlers';
import {
  sendAudio,
  sendContact,
  sendDocument,
  sendLocation,
  sendPhoto,
  sendSticker,
  sendTextMessage,
  sendVideo,
} from './senders';
import { setReaction } from './senders/reaction';
import { TelegramStreamSender } from './senders/stream';
import type { TelegramConfig } from './types';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Send a reaction to a target message. Returns null (no message ID produced).
 */
async function dispatchReaction(bot: Bot, chatId: string, content: OutgoingMessage['content']): Promise<null> {
  if (content.targetMessageId && content.emoji) {
    const targetId = Number.parseInt(content.targetMessageId, 10);
    if (!Number.isNaN(targetId)) {
      await setReaction(bot, chatId, targetId, content.emoji);
    }
  }
  return null;
}

/** Content type → sender dispatch (media subtypes) */
async function dispatchMedia(
  bot: Bot,
  chatId: string,
  content: OutgoingMessage['content'],
  replyParam?: number,
): Promise<number> {
  const caption = content.caption ?? content.text;
  const url = content.mediaUrl ?? '';

  switch (content.type) {
    case 'image':
      return sendPhoto(bot, chatId, url, caption, replyParam);
    case 'audio':
      return sendAudio(bot, chatId, url, caption, replyParam);
    case 'video':
      return sendVideo(bot, chatId, url, caption, replyParam);
    case 'document':
      return sendDocument(bot, chatId, url, caption, content.filename, replyParam);
    case 'sticker':
      return sendSticker(bot, chatId, url, replyParam);
    default:
      return sendTextMessage(bot, chatId, content.text ?? '[Unsupported content]', replyParam);
  }
}

/**
 * Dispatch outgoing content to the appropriate Telegram sender method.
 * Returns the sent message ID, or null for reaction-type messages.
 */
async function dispatchContent(
  bot: Bot,
  chatId: string,
  content: OutgoingMessage['content'],
  replyParam?: number,
  formatMode: 'convert' | 'passthrough' = 'convert',
): Promise<number | null> {
  if (content.type === 'text') return sendTextMessage(bot, chatId, content.text ?? '', replyParam, formatMode);
  if (content.type === 'reaction') return dispatchReaction(bot, chatId, content);
  if (content.type === 'contact') return dispatchContact(bot, chatId, content, replyParam);
  if (content.type === 'location') return dispatchLocation(bot, chatId, content, replyParam);
  return dispatchMedia(bot, chatId, content, replyParam);
}

/**
 * Dispatch a contact card via Telegram sender
 */
async function dispatchContact(
  bot: Bot,
  chatId: string,
  content: OutgoingMessage['content'],
  replyParam?: number,
): Promise<number> {
  const contact = content.contact;
  const phone = contact?.phone ?? '';
  const name = contact?.name ?? content.text ?? '';
  const [firstName, ...lastParts] = name.split(' ');
  const lastName = lastParts.join(' ') || undefined;
  return sendContact(bot, chatId, phone, firstName ?? name, lastName, replyParam);
}

/**
 * Dispatch a location pin via Telegram sender
 */
async function dispatchLocation(
  bot: Bot,
  chatId: string,
  content: OutgoingMessage['content'],
  replyParam?: number,
): Promise<number> {
  const loc = content.location;
  const latitude = loc?.latitude ?? 0;
  const longitude = loc?.longitude ?? 0;
  return sendLocation(bot, chatId, latitude, longitude, replyParam);
}

// ============================================================================
// Plugin Class
// ============================================================================

export class TelegramPlugin extends BaseChannelPlugin {
  readonly id = 'telegram' as ChannelType;
  readonly name = 'Telegram';
  readonly version = '1.0.0';
  readonly capabilities: ChannelCapabilities = TELEGRAM_CAPABILITIES;

  /** Active bot instances mapped by instanceId */
  private configs = new Map<string, TelegramConfig>();

  // ────────────────────────────────────────────────────────────
  // Lifecycle
  // ────────────────────────────────────────────────────────────

  protected override async onInitialize(_context: PluginContext): Promise<void> {
    this.logger.info('Telegram plugin initialized');
  }

  protected override async onDestroy(): Promise<void> {
    this.configs.clear();
    this.logger.info('Telegram plugin destroyed');
  }

  // ────────────────────────────────────────────────────────────
  // Connection
  // ────────────────────────────────────────────────────────────

  async connect(instanceId: string, config: InstanceConfig): Promise<void> {
    const token = (config.credentials?.token ?? config.options?.token) as string | undefined;
    const mode = ((config.options?.mode as string) ?? 'polling') as 'polling' | 'webhook';
    const webhookUrl = config.webhookUrl ?? (config.options?.webhookUrl as string | undefined);
    const webhookSecret = config.options?.webhookSecret as string | undefined;

    if (!token) {
      throw new Error('Telegram bot token is required in credentials.token or options.token');
    }

    const telegramConfig: TelegramConfig = {
      token,
      mode,
      webhookUrl,
      webhookSecret,
    };

    this.logger.info('Connecting Telegram instance', { instanceId, mode: telegramConfig.mode });

    // Create and initialize bot
    const bot = createBot(instanceId, telegramConfig.token);

    // Global error handler — prevents unhandled errors from crashing the process
    bot.catch((err) => {
      this.logger.error('Bot error', {
        instanceId,
        error: err.message ?? String(err),
        ctx: err.ctx?.update?.update_id,
      });
    });

    // Set up handlers before starting
    setupMessageHandlers(bot, this, instanceId);
    setupChannelPostHandlers(bot, this, instanceId);
    setupReactionHandlers(bot, this, instanceId);
    setupInteractiveHandlers(bot, this, instanceId);

    // Initialize bot (fetches bot info)
    await bot.init();

    const botInfo = bot.botInfo;
    this.logger.info('Bot initialized', {
      instanceId,
      botId: botInfo.id,
      botUsername: botInfo.username,
      firstName: botInfo.first_name,
    });

    // Store config
    this.configs.set(instanceId, telegramConfig);

    // Start receiving updates
    if (telegramConfig.mode === 'webhook') {
      await this.startWebhook(bot, instanceId, telegramConfig);
    } else {
      await this.startPolling(bot, instanceId);
    }

    // Update instance state
    await this.updateInstanceStatus(instanceId, config, {
      state: 'connected',
      since: new Date(),
      message: `Connected as @${botInfo.username}`,
    });

    // Emit connected event
    await this.emitInstanceConnected(instanceId, {
      profileName: botInfo.first_name,
      ownerIdentifier: `@${botInfo.username}`,
    });
  }

  async disconnect(instanceId: string): Promise<void> {
    this.logger.info('Disconnecting Telegram instance', { instanceId });

    destroyBot(instanceId);
    this.configs.delete(instanceId);

    this.instances.setInstance(instanceId, {} as InstanceConfig, {
      state: 'disconnected',
      since: new Date(),
      message: 'Disconnected',
    });

    await this.emitInstanceDisconnected(instanceId, 'Manual disconnect');
  }

  // ────────────────────────────────────────────────────────────
  // Sending
  // ────────────────────────────────────────────────────────────

  async sendMessage(instanceId: string, message: OutgoingMessage): Promise<SendResult> {
    const bot = getBot(instanceId);
    if (!bot) {
      return {
        success: false,
        error: 'Bot not connected',
        errorCode: 'NOT_CONNECTED',
        retryable: false,
        timestamp: Date.now(),
      };
    }

    try {
      const chatId = message.to;
      const content = message.content;
      const replyToId = message.replyTo ? Number.parseInt(message.replyTo, 10) : undefined;
      const replyParam = replyToId && !Number.isNaN(replyToId) ? replyToId : undefined;

      // Journey timing: T10 (pluginSentAt) before platform call
      const correlationId = message.metadata?.correlationId as string | undefined;
      if (correlationId) this.captureT10(correlationId);

      const formatMode = (message.metadata?.messageFormatMode as 'convert' | 'passthrough') ?? 'convert';
      const messageId = await dispatchContent(bot, chatId, content, replyParam, formatMode);

      // Journey timing: T11 (platformDeliveredAt) after Telegram API responds
      if (correlationId) this.captureT11(correlationId);

      // Reaction-type sends don't produce a message ID
      if (messageId === null) {
        return { success: true, timestamp: Date.now() };
      }

      await this.emitMessageSent({
        instanceId,
        externalId: String(messageId),
        chatId,
        to: chatId,
        content: {
          type: content.type as 'text',
          text: content.text,
          mediaUrl: content.mediaUrl,
        },
        replyToId: message.replyTo,
      });

      return {
        success: true,
        messageId: String(messageId),
        timestamp: Date.now(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      await this.emitMessageFailed({
        instanceId,
        chatId: message.to,
        error: errorMessage,
        retryable: this.isRetryableError(error),
      });

      return {
        success: false,
        error: errorMessage,
        retryable: this.isRetryableError(error),
        timestamp: Date.now(),
      };
    }
  }

  // ────────────────────────────────────────────────────────────
  // Typing indicator
  // ────────────────────────────────────────────────────────────

  createStreamSender(
    instanceId: string,
    chatId: string,
    replyToMessageId?: string,
    chatType?: 'dm' | 'group' | 'channel',
  ): StreamSender {
    const bot = getBot(instanceId);
    if (!bot) {
      throw new Error(`No bot for instance ${instanceId}`);
    }
    return new TelegramStreamSender(bot, chatId, replyToMessageId ? Number(replyToMessageId) : undefined, chatType);
  }

  /**
   * Forward a message from one chat to another
   */
  async forwardMessage(instanceId: string, fromChatId: string, toChatId: string, messageId: string): Promise<string> {
    const bot = getBot(instanceId);
    if (!bot) throw new Error(`No bot for instance ${instanceId}`);

    const result = await bot.api.forwardMessage(toChatId, fromChatId, Number(messageId));
    return String(result.message_id);
  }

  /**
   * Get the bot's own profile
   */
  async getProfile(instanceId: string): Promise<{
    name?: string;
    avatarUrl?: string;
    bio?: string;
    ownerIdentifier?: string;
    platformMetadata: Record<string, unknown>;
  }> {
    const bot = getBot(instanceId);
    if (!bot) throw new Error(`No bot for instance ${instanceId}`);

    const me = await bot.api.getMe();
    let avatarUrl: string | undefined;
    try {
      const photos = await bot.api.getUserProfilePhotos(me.id, { limit: 1 });
      if (photos.total_count > 0 && photos.photos[0]?.[0]) {
        const file = await bot.api.getFile(photos.photos[0][0].file_id);
        avatarUrl = file.file_path ? `https://api.telegram.org/file/bot${bot.token}/${file.file_path}` : undefined;
      }
    } catch {
      // Avatar fetch is best-effort
    }

    return {
      name: [me.first_name, me.last_name].filter(Boolean).join(' '),
      avatarUrl,
      bio: undefined, // Bots don't have bios accessible via API
      ownerIdentifier: me.username ? `@${me.username}` : String(me.id),
      platformMetadata: {
        id: me.id,
        username: me.username,
        isBot: me.is_bot,
        canJoinGroups: me.can_join_groups,
        canReadAllGroupMessages: me.can_read_all_group_messages,
        supportsInlineQueries: me.supports_inline_queries,
      },
    };
  }

  /**
   * Fetch profile for a specific user/chat
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
    const bot = getBot(instanceId);
    if (!bot) throw new Error(`No bot for instance ${instanceId}`);

    const chat = await bot.api.getChat(userId);
    let avatarUrl: string | undefined;
    if ('photo' in chat && chat.photo) {
      try {
        const file = await bot.api.getFile(chat.photo.big_file_id);
        avatarUrl = file.file_path ? `https://api.telegram.org/file/bot${bot.token}/${file.file_path}` : undefined;
      } catch {
        // Avatar fetch is best-effort
      }
    }

    const displayName =
      'first_name' in chat
        ? [chat.first_name, 'last_name' in chat ? chat.last_name : undefined].filter(Boolean).join(' ')
        : 'title' in chat
          ? chat.title
          : undefined;

    return {
      displayName,
      avatarUrl,
      bio: 'bio' in chat ? (chat.bio as string) : undefined,
      platformData: {
        id: chat.id,
        type: chat.type,
        username: 'username' in chat ? chat.username : undefined,
      },
    };
  }

  async sendTyping(instanceId: string, chatId: string): Promise<void> {
    const bot = getBot(instanceId);
    if (!bot) return;

    try {
      await bot.api.sendChatAction(chatId, 'typing');
    } catch (error) {
      this.logger.debug('Failed to send typing', { instanceId, chatId, error: String(error) });
    }
  }

  // ────────────────────────────────────────────────────────────
  // Incoming event handlers (called by handler modules)
  // ────────────────────────────────────────────────────────────

  /**
   * Handle incoming message from Telegram
   * @internal
   */
  async handleMessageReceived(
    instanceId: string,
    externalId: string,
    chatId: string,
    from: string,
    content: {
      type: string;
      text?: string;
      mediaUrl?: string;
      mimeType?: string;
    },
    replyToId: string | undefined,
    rawPayload: Record<string, unknown>,
    platformTimestamp?: number,
  ): Promise<void> {
    // Journey timing: capture T0 (platform) and T1 (plugin received)
    // Telegram timestamps arrive pre-normalized to ms from the handler
    const timings = platformTimestamp ? this.captureInboundTimings(platformTimestamp) : undefined;

    const correlationId = await this.emitMessageReceived({
      instanceId,
      externalId,
      chatId,
      from,
      content: {
        type: content.type as import('@omni/core/types').ContentType,
        text: content.text,
        mediaUrl: content.mediaUrl,
        mimeType: content.mimeType,
      },
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
   * Handle incoming reaction add
   * @internal
   */
  async handleReactionAdd(
    instanceId: string,
    messageId: string,
    chatId: string,
    from: string,
    emoji: string,
    isCustomEmoji: boolean,
  ): Promise<void> {
    await this.emitReactionReceived({
      instanceId,
      messageId,
      chatId,
      from,
      emoji,
      isCustomEmoji,
    });
  }

  /**
   * Handle incoming reaction remove
   * @internal
   */
  async handleReactionRemove(
    instanceId: string,
    messageId: string,
    chatId: string,
    from: string,
    emoji: string,
    isCustomEmoji: boolean,
  ): Promise<void> {
    await this.emitReactionRemoved({
      instanceId,
      messageId,
      chatId,
      from,
      emoji,
      isCustomEmoji,
    });
  }

  /**
   * Handle button click (callback_query)
   * @internal
   */
  async handleButtonClick(params: {
    instanceId: string;
    callbackQueryId?: string;
    messageId?: string;
    chatId?: string;
    from: string;
    text?: string;
    data?: string;
    rawPayload?: Record<string, unknown>;
  }): Promise<void> {
    await this.emitButtonClick(params);
  }

  /**
   * Handle poll received/created
   * @internal
   */
  async handlePoll(params: {
    instanceId: string;
    pollId: string;
    chatId?: string;
    from?: string;
    question: string;
    options: string[];
    multiSelect?: boolean;
    rawPayload?: Record<string, unknown>;
  }): Promise<void> {
    await this.emitPoll(params);
  }

  /**
   * Handle poll vote/answer
   * @internal
   */
  async handlePollVote(params: {
    instanceId: string;
    pollId: string;
    chatId?: string;
    from: string;
    optionIds: number[];
    rawPayload?: Record<string, unknown>;
  }): Promise<void> {
    await this.emitPollVote(params);
  }

  // ────────────────────────────────────────────────────────────
  // Health
  // ────────────────────────────────────────────────────────────

  protected override async getHealthChecks() {
    const checks = await super.getHealthChecks();

    // Add Telegram API health check
    for (const instanceId of this.instances.getAllIds()) {
      const bot = getBot(instanceId);
      if (!bot) continue;

      try {
        const me = await bot.api.getMe();
        checks.push({
          name: `telegram-api-${instanceId}`,
          status: 'pass',
          message: `Bot @${me.username} is reachable`,
        });
      } catch (error) {
        checks.push({
          name: `telegram-api-${instanceId}`,
          status: 'fail',
          message: `Bot API unreachable: ${String(error)}`,
        });
      }
    }

    return checks;
  }

  // ────────────────────────────────────────────────────────────
  // Private helpers
  // ────────────────────────────────────────────────────────────

  private async startPolling(bot: Bot, instanceId: string): Promise<void> {
    this.logger.info('Starting polling mode', { instanceId });

    // Start polling in background (non-blocking)
    bot.start({
      drop_pending_updates: true,
      allowed_updates: [
        'message',
        'edited_message',
        'channel_post',
        'edited_channel_post',
        'message_reaction',
        'callback_query',
        'my_chat_member',
      ],
      onStart: () => {
        this.logger.info('Polling started', { instanceId });
      },
    });

    // grammy emits 'error' on polling failures — the bot.catch() handler will
    // catch these, and grammy will automatically retry polling with backoff.
    // If polling stops entirely (e.g. bot revoked), the health check will
    // surface the failure via getHealthChecks().
  }

  private async startWebhook(_bot: Bot, instanceId: string, _config: TelegramConfig): Promise<void> {
    // TODO: Webhook mode requires an HTTP handler (e.g. Hono route) to receive
    // incoming updates from Telegram. This is not yet implemented.
    // See: https://grammy.dev/guide/deployment-types#webhooks
    //
    // For now, use polling mode (mode: 'polling' or omit mode entirely).
    throw new Error(
      `Webhook mode is not yet supported for Telegram instance ${instanceId}. Use polling mode instead (set mode: "polling" in instance config). Webhook support requires an HTTP endpoint to receive Telegram updates.`,
    );
  }

  /**
   * Get the grammy Bot instance for a given instance ID.
   * Useful for webhook handlers that need to process incoming updates.
   */
  getGrammyBot(instanceId: string): Bot | undefined {
    return getBot(instanceId);
  }

  private isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      // Telegram rate limit or server errors
      if (msg.includes('429') || msg.includes('too many requests')) return true;
      if (msg.includes('500') || msg.includes('502') || msg.includes('503')) return true;
      if (msg.includes('timeout') || msg.includes('econnreset')) return true;
    }
    return false;
  }
}
