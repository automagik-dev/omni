/**
 * WhatsApp Channel Plugin using Baileys
 *
 * Main plugin class that extends BaseChannelPlugin from channel-sdk.
 * Handles connection, messaging, and lifecycle for WhatsApp instances.
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
import type { WAMessage, WASocket } from '@whiskeysockets/baileys';

import { clearAuthState, createStorageAuthState } from './auth';
import { WHATSAPP_CAPABILITIES } from './capabilities';
import { resetReconnectAttempts, setupConnectionHandlers } from './handlers/connection';
import { setupMessageHandlers } from './handlers/messages';
import { toJid } from './jid';
import { buildMessageContent } from './senders/builders';
import { closeSocket, createSocket } from './socket';
import { ErrorCode, WhatsAppError, mapBaileysError } from './utils/errors';

/**
 * WhatsApp plugin configuration
 */
export interface WhatsAppConfig {
  /** Enable QR code terminal output (development only) */
  printQRInTerminal?: boolean;
  /** Custom Baileys logger level */
  logLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';
}

/**
 * WhatsApp Channel Plugin
 *
 * Extends BaseChannelPlugin to provide WhatsApp messaging via Baileys.
 *
 * Features:
 * - Multi-device support with storage-backed auth
 * - QR code authentication
 * - Text, media, reactions, location, contacts
 * - Typing indicators and presence
 * - Read receipts and delivery confirmations
 * - Automatic reconnection with exponential backoff
 */
export class WhatsAppPlugin extends BaseChannelPlugin {
  readonly id: ChannelType = 'whatsapp-baileys';
  readonly name = 'WhatsApp (Baileys)';
  readonly version = '1.0.0';
  readonly capabilities: ChannelCapabilities = WHATSAPP_CAPABILITIES;

  /** Active socket connections per instance */
  private sockets = new Map<string, WASocket>();

  /** Plugin configuration */
  private pluginConfig: WhatsAppConfig = {};

  /**
   * Plugin-specific initialization
   */
  protected override async onInitialize(_context: PluginContext): Promise<void> {
    this.logger.info('WhatsApp plugin initialized');
  }

  /**
   * Connect a WhatsApp instance
   *
   * @param instanceId - Unique instance identifier
   * @param config - Instance configuration (credentials not needed for QR auth)
   */
  async connect(instanceId: string, config: InstanceConfig): Promise<void> {
    // If forcing new QR, disconnect existing socket and clear auth state
    if (config.options?.forceNewQr === true) {
      const existingSocket = this.sockets.get(instanceId);
      if (existingSocket) {
        await closeSocket(existingSocket, false);
        this.sockets.delete(instanceId);
      }
      await clearAuthState(this.storage, instanceId);
      this.logger.info('Cleared auth state for fresh QR', { instanceId });
    } else if (this.sockets.has(instanceId)) {
      // Check if already connected (only if not forcing new QR)
      this.logger.warn('Instance already connected', { instanceId });
      return;
    }

    // Update status to connecting
    await this.updateInstanceStatus(instanceId, config, {
      state: 'connecting',
      since: new Date(),
    });

    // Create the connection
    await this.createConnection(instanceId, config);
  }

  /**
   * Create a new Baileys connection using socket wrapper
   */
  private async createConnection(instanceId: string, config: InstanceConfig): Promise<void> {
    // Storage-backed auth state
    const { state, saveCreds } = await createStorageAuthState(this.storage, instanceId);

    // Create Baileys socket using wrapper
    const sock = await createSocket({
      auth: state,
      printQRInTerminal: this.pluginConfig.printQRInTerminal,
      logLevel: this.pluginConfig.logLevel,
    });

    // Save credentials on update
    sock.ev.on('creds.update', saveCreds);

    // Set up connection handlers with reconnection callback
    setupConnectionHandlers(sock, this, instanceId, () => this.createConnection(instanceId, config));

    // Set up message handlers
    setupMessageHandlers(sock, this, instanceId);

    // Store socket
    this.sockets.set(instanceId, sock);
  }

  /**
   * Disconnect a WhatsApp instance
   *
   * @param instanceId - Instance to disconnect
   */
  async disconnect(instanceId: string): Promise<void> {
    const sock = this.sockets.get(instanceId);
    if (!sock) {
      return;
    }

    // Reset reconnection attempts (don't auto-reconnect after manual disconnect)
    resetReconnectAttempts(instanceId);

    // Close socket with logout
    await closeSocket(sock, true);
    this.sockets.delete(instanceId);

    // Emit disconnected event
    await this.emitInstanceDisconnected(instanceId, 'User requested disconnect');
  }

  /**
   * Logout and clear auth state for an instance
   *
   * @param instanceId - Instance to logout
   */
  async logout(instanceId: string): Promise<void> {
    // Disconnect first
    await this.disconnect(instanceId);

    // Clear stored auth state
    await clearAuthState(this.storage, instanceId);

    this.logger.info('Instance logged out and auth cleared', { instanceId });
  }

  /**
   * Send a message through WhatsApp
   */
  async sendMessage(instanceId: string, message: OutgoingMessage): Promise<SendResult> {
    const sock = this.getSocket(instanceId);
    const jid = toJid(message.to);

    try {
      // Build message content based on type
      const content = this.buildContent(message);

      // Send with optional reply
      const result = await sock.sendMessage(
        jid,
        content,
        message.replyTo ? { quoted: { key: { id: message.replyTo, remoteJid: jid } } as WAMessage } : undefined,
      );

      const externalId = result?.key?.id || '';

      // Emit sent event
      await this.emitMessageSent({
        instanceId,
        externalId,
        chatId: jid,
        to: message.to,
        content: {
          type: message.content.type,
          text: message.content.text,
        },
        replyToId: message.replyTo,
      });

      return {
        success: true,
        messageId: externalId,
        timestamp: Date.now(),
      };
    } catch (error) {
      const waError = mapBaileysError(error);

      await this.emitMessageFailed({
        instanceId,
        chatId: jid,
        error: waError.message,
        errorCode: waError.code,
        retryable: waError.retryable,
      });

      return {
        success: false,
        error: waError.message,
        errorCode: waError.code,
        retryable: waError.retryable,
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Build Baileys message content from OutgoingMessage
   * Delegates to external builder for reduced complexity.
   */
  private buildContent(message: OutgoingMessage) {
    return buildMessageContent(message, this.buildVCard.bind(this));
  }

  /**
   * Build a vCard string from contact data
   */
  private buildVCard(contact: { name: string; phone?: string; email?: string }): string {
    const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${contact.name}`];

    if (contact.phone) {
      lines.push(`TEL;type=CELL:${contact.phone}`);
    }

    if (contact.email) {
      lines.push(`EMAIL:${contact.email}`);
    }

    lines.push('END:VCARD');
    return lines.join('\n');
  }

  /**
   * Send typing indicator
   */
  async sendTyping(instanceId: string, chatId: string, duration = 3000): Promise<void> {
    const sock = this.getSocket(instanceId);
    const jid = toJid(chatId);

    // Send composing presence
    await sock.sendPresenceUpdate('composing', jid);

    // Auto-pause after duration
    setTimeout(async () => {
      try {
        await sock.sendPresenceUpdate('paused', jid);
      } catch {
        // Ignore errors when pausing typing
      }
    }, duration);
  }

  /**
   * Mark messages as read
   */
  async markAsRead(instanceId: string, chatId: string, messageIds: string[]): Promise<void> {
    const sock = this.getSocket(instanceId);
    const jid = toJid(chatId);

    const keys = messageIds.map((id) => ({
      remoteJid: jid,
      id,
      fromMe: false,
    }));

    await sock.readMessages(keys);
  }

  /**
   * Update presence (online/offline)
   */
  async updatePresence(instanceId: string, presence: 'available' | 'unavailable'): Promise<void> {
    const sock = this.getSocket(instanceId);
    await sock.sendPresenceUpdate(presence);
  }

  // ─────────────────────────────────────────────────────────────
  // Internal handlers called by connection/message handlers
  // ─────────────────────────────────────────────────────────────

  /**
   * Handle QR code generation
   * @internal
   */
  async handleQrCode(instanceId: string, qrCode: string, expiresAt: Date): Promise<void> {
    await this.emitQrCode(instanceId, qrCode, expiresAt);

    // Also update status with QR code
    const config = this.instances.get(instanceId)?.config;
    if (config) {
      await this.updateInstanceStatus(instanceId, config, {
        state: 'connecting',
        since: new Date(),
        qrCode: { code: qrCode, expiresAt },
      });
    }
  }

  /**
   * Handle successful connection
   * @internal
   */
  async handleConnected(instanceId: string, sock: WASocket): Promise<void> {
    // Get profile info
    let profileName: string | undefined;
    let profilePicUrl: string | undefined;
    let ownerIdentifier: string | undefined;

    try {
      const user = sock.user;
      if (user) {
        ownerIdentifier = user.id;
        profileName = user.name || undefined;

        // Try to get profile picture
        try {
          profilePicUrl = await sock.profilePictureUrl(user.id, 'image');
        } catch {
          // Profile picture might not be set
        }
      }
    } catch {
      // Ignore profile fetch errors
    }

    // Update instance status
    const config = this.instances.get(instanceId)?.config;
    if (config) {
      await this.updateInstanceStatus(instanceId, config, {
        state: 'connected',
        since: new Date(),
        metadata: { profileName, profilePicUrl, ownerIdentifier },
      });
    }

    // Emit connected event
    await this.emitInstanceConnected(instanceId, {
      profileName,
      profilePicUrl,
      ownerIdentifier,
    });
  }

  /**
   * Handle disconnection
   * @internal
   */
  async handleDisconnected(instanceId: string, reason: string, willReconnect: boolean): Promise<void> {
    this.sockets.delete(instanceId);

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
      caption?: string;
      filename?: string;
      location?: { latitude: number; longitude: number; name?: string; address?: string };
      contact?: { name: string; phone?: string };
      // Extended content fields
      poll?: { name: string; options: string[]; selectableCount?: number };
      pollVotes?: string[];
      event?: { name: string; description?: string; location?: string; startTime?: Date; endTime?: Date };
      product?: { id: string; title?: string; description?: string; price?: string; currency?: string; imageUrl?: string };
      targetMessageId?: string;
      editedText?: string;
    },
    replyToId: string | undefined,
    rawMessage: WAMessage,
    isFromMe: boolean,
  ): Promise<void> {
    // Skip messages from self (already sent via sendMessage)
    if (isFromMe) {
      return;
    }

    // Build extended raw payload with structured content data
    const extendedPayload: Record<string, unknown> = {
      ...(rawMessage as unknown as Record<string, unknown>),
    };

    // Add structured extended fields if present
    if (content.poll) extendedPayload.poll = content.poll;
    if (content.pollVotes) extendedPayload.pollVotes = content.pollVotes;
    if (content.event) extendedPayload.event = content.event;
    if (content.product) extendedPayload.product = content.product;
    if (content.location) extendedPayload.location = content.location;
    if (content.contact) extendedPayload.contact = content.contact;
    if (content.targetMessageId) extendedPayload.targetMessageId = content.targetMessageId;

    await this.emitMessageReceived({
      instanceId,
      externalId,
      chatId,
      from,
      content: {
        type: content.type,
        text: content.text || content.caption,
        mediaUrl: content.mediaUrl,
        mimeType: content.mimeType,
      },
      replyToId,
      rawPayload: extendedPayload,
    });
  }

  /**
   * Handle incoming reaction
   * @internal
   */
  async handleReactionReceived(
    instanceId: string,
    externalId: string,
    chatId: string,
    from: string,
    emoji: string,
    targetMessageId: string,
    isFromMe: boolean,
  ): Promise<void> {
    if (isFromMe) {
      return;
    }

    await this.emitMessageReceived({
      instanceId,
      externalId,
      chatId,
      from,
      content: {
        type: 'reaction',
        text: emoji,
      },
      rawPayload: { targetMessageId },
    });
  }

  /**
   * Handle message delivered receipt
   * @internal
   */
  async handleMessageDelivered(instanceId: string, externalId: string, chatId: string): Promise<void> {
    await this.emitMessageDelivered({
      instanceId,
      externalId,
      chatId,
      deliveredAt: Date.now(),
    });
  }

  /**
   * Handle message read receipt
   * @internal
   */
  async handleMessageRead(instanceId: string, externalId: string, chatId: string): Promise<void> {
    await this.emitMessageRead({
      instanceId,
      externalId,
      chatId,
      readAt: Date.now(),
    });
  }

  /**
   * Handle message edited
   * @internal
   */
  async handleMessageEdited(
    instanceId: string,
    externalId: string,
    chatId: string,
    newText: string,
  ): Promise<void> {
    // Emit as a special message.received event with type 'edit'
    await this.emitMessageReceived({
      instanceId,
      externalId: `${externalId}-edit-${Date.now()}`,
      chatId,
      from: chatId,
      content: {
        type: 'edit',
        text: newText,
      },
      rawPayload: {
        editedMessageId: externalId,
        newText,
        editedAt: Date.now(),
      },
    });

    this.logger.debug('Message edited', { instanceId, externalId, chatId, newText: newText.substring(0, 50) });
  }

  /**
   * Handle message deleted (revoked)
   * @internal
   */
  async handleMessageDeleted(
    instanceId: string,
    externalId: string,
    chatId: string,
    fromMe: boolean,
  ): Promise<void> {
    // Emit as a special message.received event with type 'delete'
    await this.emitMessageReceived({
      instanceId,
      externalId: `${externalId}-delete-${Date.now()}`,
      chatId,
      from: chatId,
      content: {
        type: 'delete',
        text: fromMe ? 'Message deleted by sender' : 'Message deleted',
      },
      rawPayload: {
        deletedMessageId: externalId,
        deletedAt: Date.now(),
        deletedByMe: fromMe,
      },
    });

    this.logger.debug('Message deleted', { instanceId, externalId, chatId, fromMe });
  }

  /**
   * Emit media.received event (internal wrapper for handlers)
   * @internal
   */
  async emitMediaReceivedInternal(params: {
    instanceId: string;
    eventId: string;
    mediaId: string;
    mimeType: string;
    size: number;
    url: string;
    duration?: number;
  }): Promise<void> {
    await this.emitMediaReceived(params);
  }

  // ─────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────

  /**
   * Get socket for an instance or throw
   */
  private getSocket(instanceId: string): WASocket {
    const sock = this.sockets.get(instanceId);
    if (!sock) {
      throw new WhatsAppError(ErrorCode.NOT_CONNECTED, `Instance ${instanceId} not connected`);
    }
    return sock;
  }
}
