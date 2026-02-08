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
import type { WAMessage, WASocket, proto } from '@whiskeysockets/baileys';

import { clearAuthState, createStorageAuthState } from './auth';
import { WHATSAPP_CAPABILITIES } from './capabilities';
import { setupAllEventHandlers } from './handlers/all-events';
import { resetConnectionState, setupConnectionHandlers } from './handlers/connection';
import { setupMessageHandlers } from './handlers/messages';
import { fromJid, toJid } from './jid';
import { buildMessageContent } from './senders/builders';
import { DEFAULT_SOCKET_CONFIG, type SocketConfig, closeSocket, createSocket } from './socket';
import { ErrorCode, WhatsAppError, mapBaileysError } from './utils/errors';

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
 * Anchor point for fetching older messages in a chat
 */
export interface MessageAnchor {
  /** Chat JID (e.g., "5511999999999@s.whatsapp.net") */
  chatJid: string;
  /** Message key of the oldest message we have */
  messageKey: {
    remoteJid: string;
    id: string;
    fromMe: boolean;
  };
  /** Timestamp of the oldest message (Unix ms) */
  timestamp: number;
}

/**
 * Options for fetchHistory method
 */
export interface FetchHistoryOptions {
  /** Fetch messages since this date */
  since?: Date;
  /** Fetch messages until this date (default: now) */
  until?: Date;
  /** Callback for progress updates */
  onProgress?: (fetched: number, progress?: number) => void;
  /** Callback for each message synced */
  onMessage?: (message: HistorySyncMessage) => void;
  /** Request additional history beyond initial sync */
  fetchMore?: boolean;
  /** Max messages to fetch when using fetchMore */
  maxMessages?: number;
  /** Number of messages to fetch per chat (default: 50) */
  count?: number;
  /** Anchor points for specific chats - if provided, actively fetches older messages */
  anchors?: MessageAnchor[];
}

/**
 * Result of fetchHistory operation
 */
export interface FetchHistoryResult {
  totalFetched: number;
  messages: HistorySyncMessage[];
}

/**
 * Contact from sync
 */
export interface SyncContact {
  platformUserId: string;
  name?: string;
  phone?: string;
  profilePicUrl?: string;
  isGroup: boolean;
  isBusiness?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Options for fetchContacts method
 */
export interface FetchContactsOptions {
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
 * Group from sync
 */
export interface SyncGroup {
  externalId: string;
  name?: string;
  description?: string;
  memberCount?: number;
  createdAt?: Date;
  createdBy?: string;
  isReadOnly?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Options for fetchGroups method
 */
export interface FetchGroupsOptions {
  /** Callback for progress updates */
  onProgress?: (fetched: number) => void;
  /** Callback for each group */
  onGroup?: (group: SyncGroup) => void;
}

/**
 * Result of fetchGroups operation
 */
export interface FetchGroupsResult {
  totalFetched: number;
  groups: SyncGroup[];
}

/**
 * WhatsApp connection options - passed per instance
 * All options have sensible defaults and can be overridden
 */
export interface WhatsAppConnectionOptions {
  /** Baileys logger level (default: 'warn') */
  logLevel?: SocketConfig['logLevel'];
  /** Browser identification (default: ['Omni', 'Chrome', '120.0.0']) */
  browser?: [string, string, string];
  /** Mobile mode (default: false) */
  mobile?: boolean;
  /** Connection timeout in ms (default: 60000) */
  connectTimeoutMs?: number;
  /** Query timeout in ms (default: 60000) */
  defaultQueryTimeoutMs?: number;
  /** Keep alive interval in ms (default: 25000) */
  keepAliveIntervalMs?: number;
  /** Sync full message history (default: true) */
  syncFullHistory?: boolean;
  /** Generate high quality link previews (default: true) */
  generateHighQualityLinkPreview?: boolean;
  /** Mark online when connecting (default: true) */
  markOnlineOnConnect?: boolean;
}

/**
 * WhatsApp plugin configuration (global defaults)
 */
export interface WhatsAppConfig extends WhatsAppConnectionOptions {}

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

  /** Active history sync operations - tracks callbacks for history sync events */
  private historySyncCallbacks = new Map<
    string,
    {
      since?: Date;
      until?: Date;
      onProgress?: (fetched: number, progress?: number) => void;
      onMessage?: (message: HistorySyncMessage) => void;
      onComplete?: (totalFetched: number) => void;
      totalFetched: number;
    }
  >();

  /** Cached contacts from sync events per instance */
  private contactsCache = new Map<string, Map<string, SyncContact>>();

  /** Cached group metadata (subject/name) per instance */
  private groupsCache = new Map<string, Map<string, { subject: string; desc?: string }>>();

  /** Cached chat display names per instance (for DMs from chats.upsert) */
  private chatNamesCache = new Map<string, Map<string, string>>();

  /**
   * Plugin-specific initialization
   */
  protected override async onInitialize(_context: PluginContext): Promise<void> {
    // No additional initialization needed for WhatsApp plugin
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

    // Merge socket options: defaults <- plugin config <- instance options
    const instanceOptions = (config.options?.whatsapp || {}) as WhatsAppConnectionOptions;
    const socketOptions: Partial<SocketConfig> = {
      // Plugin-level defaults
      ...this.pluginConfig,
      // Instance-specific overrides
      ...instanceOptions,
    };

    this.logger.debug('Creating socket with options', {
      instanceId,
      syncFullHistory: socketOptions.syncFullHistory ?? DEFAULT_SOCKET_CONFIG.syncFullHistory,
      connectTimeoutMs: socketOptions.connectTimeoutMs ?? DEFAULT_SOCKET_CONFIG.connectTimeoutMs,
    });

    // Create Baileys socket using wrapper
    const sock = await createSocket({
      auth: state,
      ...socketOptions,
    });

    // Save credentials on update
    sock.ev.on('creds.update', async (update) => {
      // Merge the update into state.creds
      Object.assign(state.creds, update);

      // If we have 'me' populated, we're registered (Baileys doesn't always set this flag)
      if (state.creds.me?.id && !state.creds.registered) {
        state.creds.registered = true;
      }

      await saveCreds();
    });

    // Set up connection handlers with reconnection and auth-clear callbacks
    setupConnectionHandlers(
      sock,
      this,
      instanceId,
      () => this.createConnection(instanceId, config),
      async () => {
        // Clear auth and reconnect fresh - this is called after MAX_QR_ATTEMPTS
        // IMPORTANT: Close the old socket to release resources and event listeners
        const oldSocket = this.sockets.get(instanceId);
        if (oldSocket) {
          await closeSocket(oldSocket, false);
          this.sockets.delete(instanceId);
        }
        await clearAuthState(this.storage, instanceId);
        await this.createConnection(instanceId, config);
      },
    );

    // Set up message handlers
    setupMessageHandlers(sock, this, instanceId);

    // Set up ALL other event handlers (calls, presence, groups, etc.)
    setupAllEventHandlers(sock, this, instanceId);

    // Store socket
    this.sockets.set(instanceId, sock);
  }

  /**
   * Disconnect a WhatsApp instance (keeps session for reconnect)
   *
   * @param instanceId - Instance to disconnect
   */
  async disconnect(instanceId: string): Promise<void> {
    const sock = this.sockets.get(instanceId);
    if (!sock) {
      return;
    }

    // Reset all connection tracking state (don't auto-reconnect after manual disconnect)
    resetConnectionState(instanceId);

    // Close socket WITHOUT logging out (preserves session for reconnect)
    await closeSocket(sock, false);
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
   * Request a pairing code for phone number authentication
   * Alternative to QR code scanning
   *
   * @param instanceId - Instance to pair
   * @param phoneNumber - Phone number in international format (e.g., +5511999999999)
   * @returns The pairing code to enter on WhatsApp mobile
   */
  async requestPairingCode(instanceId: string, phoneNumber: string): Promise<string> {
    const sock = this.sockets.get(instanceId);
    if (!sock) {
      throw new WhatsAppError(ErrorCode.NOT_CONNECTED, `Instance ${instanceId} not connected. Call connect() first.`);
    }

    // Normalize phone number - remove non-digits except leading +
    const normalized = phoneNumber.replace(/[^\d]/g, '');
    if (!normalized || normalized.length < 10) {
      throw new WhatsAppError(ErrorCode.INVALID_PHONE, `Invalid phone number: ${phoneNumber}`);
    }

    try {
      const code = await sock.requestPairingCode(normalized);
      this.logger.info('Pairing code requested', { instanceId, phoneNumber: `${normalized.slice(0, 4)}****` });
      return code;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new WhatsAppError(ErrorCode.PAIRING_FAILED, `Failed to request pairing code: ${message}`);
    }
  }

  /**
   * Send a message through WhatsApp
   */
  async sendMessage(instanceId: string, message: OutgoingMessage): Promise<SendResult> {
    const sock = this.getSocket(instanceId);
    const jid = toJid(message.to);

    try {
      // Handle audio conversion for voice notes (PTT)
      let processedMessage = message;
      if (message.content.type === 'audio' && message.metadata?.ptt === true) {
        processedMessage = await this.processAudioForVoiceNote(message);
      }

      // Build message content based on type
      const content = this.buildContent(processedMessage);

      // Send with optional reply
      // Baileys requires key.fromMe and a message object for quoted messages
      let quotedOptions: { quoted: unknown } | undefined;
      if (message.replyTo) {
        // Get fromMe, rawPayload, and text from metadata (looked up by API)
        const replyToFromMe = (message.metadata?.replyToFromMe as boolean) ?? false;
        const replyToRawPayload = message.metadata?.replyToRawPayload as Record<string, unknown> | undefined;
        const replyToText = message.metadata?.replyToText as string | undefined;
        this.logger.debug('Sending with reply', {
          replyTo: message.replyTo,
          jid,
          replyToFromMe,
          hasRawPayload: !!replyToRawPayload,
          hasText: !!replyToText,
        });

        // If we have the full rawPayload, use it directly (this is a WAMessage)
        if (replyToRawPayload) {
          quotedOptions = { quoted: replyToRawPayload };
        } else {
          // Fallback: construct quoted object with text content for preview
          quotedOptions = {
            quoted: {
              key: {
                id: message.replyTo,
                remoteJid: jid,
                fromMe: replyToFromMe,
              },
              message: replyToText ? { conversation: replyToText } : {},
            },
          };
        }
      }

      this.logger.debug('Sending message', { jid, content, hasQuoted: !!quotedOptions });
      const result = await sock.sendMessage(jid, content, quotedOptions as never);

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
   * Process audio for voice note, converting to OGG/OPUS if needed
   * Supports both URL and base64 input
   */
  private async processAudioForVoiceNote(message: OutgoingMessage): Promise<OutgoingMessage> {
    const { convertAudioForVoiceNote, convertBufferForVoiceNote } = await import('./utils/audio-converter');

    const mediaUrl = message.content.mediaUrl;
    const base64 = message.metadata?.base64 as string | undefined;

    // No audio source available
    if (!mediaUrl && !base64) {
      return message;
    }

    try {
      let result: { buffer: Buffer; mimeType: string } | null = null;

      if (base64) {
        // Convert from base64
        const inputBuffer = Buffer.from(base64, 'base64');
        result = await convertBufferForVoiceNote(inputBuffer, message.content.mimeType);
      } else if (mediaUrl) {
        // Convert from URL
        result = await convertAudioForVoiceNote(mediaUrl, message.content.mimeType);
      }

      if (result) {
        // Audio was converted, update message to use buffer
        this.logger.info('Audio converted to OGG/OPUS for voice note');
        return {
          ...message,
          content: {
            ...message.content,
            // Store buffer in metadata for the builder to use
            mimeType: result.mimeType,
          },
          metadata: {
            ...message.metadata,
            audioBuffer: result.buffer,
          },
        };
      }

      // No conversion needed
      return message;
    } catch (error) {
      this.logger.warn('Audio conversion failed, sending as-is', {
        error: error instanceof Error ? error.message : String(error),
      });
      return message;
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
   *
   * @param instanceId - Instance ID
   * @param chatId - Chat ID (JID or phone number)
   * @param messageIds - Array of message IDs, or ['all'] to mark entire chat as read
   */
  async markAsRead(instanceId: string, chatId: string, messageIds: string[]): Promise<void> {
    const sock = this.getSocket(instanceId);
    const jid = toJid(chatId);

    // Handle 'all' marker - marks entire chat as read
    if (messageIds.length === 1 && messageIds[0] === 'all') {
      await this.markChatAsRead(instanceId, chatId);
      return;
    }

    const keys = messageIds.map((id) => ({
      remoteJid: jid,
      id,
      fromMe: false,
    }));

    await sock.readMessages(keys);
  }

  /**
   * Mark entire chat as read
   *
   * Uses presence update to mark all unread messages in the chat as read.
   *
   * @param instanceId - Instance ID
   * @param chatId - Chat ID (JID or phone number)
   */
  async markChatAsRead(instanceId: string, chatId: string): Promise<void> {
    const sock = this.getSocket(instanceId);
    const jid = toJid(chatId);

    // Send presence update and read all messages
    await sock.sendPresenceUpdate('available', jid);
    await sock.readMessages([{ remoteJid: jid, id: 'all', fromMe: false }]);
  }

  /**
   * Update presence (online/offline)
   */
  async updatePresence(instanceId: string, presence: 'available' | 'unavailable'): Promise<void> {
    const sock = this.getSocket(instanceId);
    await sock.sendPresenceUpdate(presence);
  }

  // =========================================================================
  // B1-B6: Baileys Quick Wins — Direct WhatsApp operations
  // =========================================================================

  /**
   * B1: Delete a message for everyone.
   * Sends a protocol message to delete a previously sent message.
   * @param fromMe - Whether the message was sent by us (required for correct key construction)
   */
  async deleteMessage(instanceId: string, chatId: string, messageId: string, fromMe = true): Promise<void> {
    const sock = this.getSocket(instanceId);
    const jid = toJid(chatId);
    await sock.sendMessage(jid, {
      delete: { remoteJid: jid, id: messageId, fromMe },
    });
    this.logger.info('Message deleted for everyone', { instanceId, chatId, messageId, fromMe });
  }

  /**
   * B2: Check if phone numbers are registered on WhatsApp.
   * Returns registration status and JID for each number.
   */
  async checkNumber(instanceId: string, phones: string[]): Promise<{ phone: string; exists: boolean; jid?: string }[]> {
    const sock = this.getSocket(instanceId);
    const results = await sock.onWhatsApp(...phones);
    return phones.map((phone, i) => {
      const r = results?.[i];
      return {
        phone,
        exists: r?.exists ?? false,
        jid: r?.jid ?? undefined,
      };
    });
  }

  /**
   * B3: Update own profile bio/status text.
   */
  async updateBio(instanceId: string, status: string): Promise<void> {
    const sock = this.getSocket(instanceId);
    await sock.updateProfileStatus(status);
    this.logger.info('Profile bio updated', { instanceId });
  }

  /**
   * B4: Block a contact.
   */
  async blockContact(instanceId: string, contactJid: string): Promise<void> {
    const sock = this.getSocket(instanceId);
    const jid = toJid(contactJid);
    await sock.updateBlockStatus(jid, 'block');
    this.logger.info('Contact blocked', { instanceId, jid });
  }

  /**
   * B4: Unblock a contact.
   */
  async unblockContact(instanceId: string, contactJid: string): Promise<void> {
    const sock = this.getSocket(instanceId);
    const jid = toJid(contactJid);
    await sock.updateBlockStatus(jid, 'unblock');
    this.logger.info('Contact unblocked', { instanceId, jid });
  }

  /**
   * B4: Fetch the list of blocked contacts.
   */
  async fetchBlocklist(instanceId: string): Promise<string[]> {
    const sock = this.getSocket(instanceId);
    const list = await sock.fetchBlocklist();
    return list.filter((jid): jid is string => typeof jid === 'string');
  }

  /**
   * B5: Toggle disappearing messages for a chat.
   * @param duration - Seconds (86400=24h, 604800=7d, 7776000=90d) or false to disable
   */
  async setDisappearing(instanceId: string, chatId: string, duration: number | false): Promise<void> {
    const sock = this.getSocket(instanceId);
    const jid = toJid(chatId);
    await sock.sendMessage(jid, { disappearingMessagesInChat: duration });
    this.logger.info('Disappearing messages toggled', { instanceId, chatId, duration });
  }

  /**
   * B6: Star or unstar a message.
   * @param fromMe - Whether the message was sent by us (required for correct key construction)
   */
  async starMessage(
    instanceId: string,
    chatId: string,
    messageId: string,
    star: boolean,
    fromMe = true,
  ): Promise<void> {
    const sock = this.getSocket(instanceId);
    const jid = toJid(chatId);
    await sock.star(jid, [{ id: messageId, fromMe }], star);
    this.logger.info('Message star toggled', { instanceId, chatId, messageId, star, fromMe });
  }

  // =========================================================================

  /**
   * Update the profile display name (push name) on WhatsApp.
   */
  async updateProfileName(instanceId: string, name: string): Promise<void> {
    const sock = this.getSocket(instanceId);
    await sock.updateProfileName(name);
    this.logger.info('Profile name updated', { instanceId, name });
  }

  /**
   * Get the profile of the connected WhatsApp account.
   * Returns profile info including name, avatar, bio, and platform-specific metadata.
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
      phoneNumber?: string;
      pushName?: string;
      isBusiness?: boolean;
      businessName?: string;
      businessDescription?: string;
      businessCategory?: string;
      isVerified?: boolean;
    };
  }> {
    const sock = this.getSocket(instanceId);
    const user = sock.user;

    if (!user) {
      throw new WhatsAppError(ErrorCode.NOT_CONNECTED, `Instance ${instanceId} not fully connected - no user info`);
    }

    let avatarUrl: string | undefined;
    let bio: string | undefined;

    // Try to get profile picture
    try {
      avatarUrl = await sock.profilePictureUrl(user.id, 'image');
    } catch {
      // Profile picture might not be set
    }

    // Try to get status (bio)
    try {
      const statusResult = await sock.fetchStatus(user.id);
      // fetchStatus returns an array of status results
      if (Array.isArray(statusResult) && statusResult.length > 0) {
        const firstStatus = statusResult[0] as { status?: string };
        bio = firstStatus?.status;
      }
    } catch {
      // Status might not be set or available
    }

    // Extract phone number from JID (format: 5511999999999@s.whatsapp.net)
    const phoneNumber = user.id.split('@')[0]?.split(':')[0];

    // Build platform metadata
    const platformMetadata: {
      phoneNumber?: string;
      pushName?: string;
      isBusiness?: boolean;
      businessName?: string;
      businessDescription?: string;
      businessCategory?: string;
      isVerified?: boolean;
    } = {
      phoneNumber: phoneNumber ? `+${phoneNumber}` : undefined,
      pushName: user.name,
    };

    // Try to get business profile if available
    try {
      const businessProfile = await sock.getBusinessProfile(user.id);
      if (businessProfile) {
        platformMetadata.isBusiness = true;
        platformMetadata.businessName = businessProfile.wid?.split('@')[0] || undefined;
        platformMetadata.businessDescription = businessProfile.description || undefined;
        platformMetadata.businessCategory = businessProfile.category || undefined;
      }
    } catch {
      // Not a business account or business profile not available
    }

    return {
      name: user.name,
      avatarUrl,
      bio,
      ownerIdentifier: user.id,
      platformMetadata,
    };
  }

  /**
   * Fetch profile info for a specific user/contact
   *
   * @param instanceId - Instance to use
   * @param userId - User JID (e.g., 5511999999999@s.whatsapp.net)
   * @returns Profile data including name, avatar, bio, phone
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
    const sock = this.getSocket(instanceId);
    const jid = toJid(userId);

    let avatarUrl: string | undefined;
    let bio: string | undefined;

    // Try to get profile picture
    try {
      avatarUrl = await sock.profilePictureUrl(jid, 'image');
    } catch {
      // Profile picture might not be set or not accessible
    }

    // Try to get status (bio)
    try {
      const statusResult = await sock.fetchStatus(jid);
      if (Array.isArray(statusResult) && statusResult.length > 0) {
        const firstStatus = statusResult[0] as { status?: string };
        bio = firstStatus?.status;
      }
    } catch {
      // Status might not be available
    }

    // Extract phone number from JID
    const { id: phoneNumber } = fromJid(jid);
    const phone = phoneNumber ? `+${phoneNumber}` : undefined;

    // Try to get business profile
    let platformData: Record<string, unknown> | undefined;
    try {
      const businessProfile = await sock.getBusinessProfile(jid);
      if (businessProfile) {
        platformData = {
          isBusiness: true,
          businessDescription: businessProfile.description,
          businessCategory: businessProfile.category,
        };
      }
    } catch {
      // Not a business account
    }

    return {
      avatarUrl,
      bio,
      phone,
      platformData,
    };
  }

  /** Chat tracking data for history fetch */
  private createMessageTracker(anchors: NonNullable<FetchHistoryOptions['anchors']>) {
    const messagesPerChat = new Map<string, { count: number; oldest: { key: unknown; timestamp: number } | null }>();
    for (const anchor of anchors) {
      messagesPerChat.set(anchor.chatJid, { count: 0, oldest: null });
    }
    return messagesPerChat;
  }

  /** Build new anchors from chats that have more messages */
  private buildNextAnchors(
    messagesPerChat: Map<string, { count: number; oldest: { key: unknown; timestamp: number } | null }>,
    threshold: number,
  ): { anchors: NonNullable<FetchHistoryOptions['anchors']>; totalFetched: number } {
    const newAnchors: NonNullable<FetchHistoryOptions['anchors']> = [];
    let totalFetched = 0;

    for (const [chatJid, data] of messagesPerChat) {
      totalFetched += data.count;
      if (data.count < threshold || !data.oldest?.key) continue;

      const key = data.oldest.key as { remoteJid?: string; id?: string; fromMe?: boolean };
      if (!key.remoteJid || !key.id) continue;

      newAnchors.push({
        chatJid,
        messageKey: { remoteJid: key.remoteJid, id: key.id, fromMe: key.fromMe ?? false },
        timestamp: data.oldest.timestamp,
      });
    }
    return { anchors: newAnchors, totalFetched };
  }

  /**
   * Fetch history for anchors (active fetching with recursive pagination)
   *
   * For each chat, fetches `count` messages older than the anchor.
   * If `count` messages are returned, recursively fetches more using
   * the oldest received message as the new anchor.
   * Continues until fewer than `count` messages are returned for all chats.
   */
  private async fetchAnchorsHistory(
    sock: ReturnType<typeof this.getSocket>,
    instanceId: string,
    anchors: NonNullable<FetchHistoryOptions['anchors']>,
    count: number,
    depth = 0,
    maxDepth = 50,
  ): Promise<void> {
    if (anchors.length === 0) return;
    if (depth >= maxDepth) {
      this.logger.warn('Max fetch depth reached', { instanceId, depth, maxDepth });
      return;
    }

    this.logger.info('Actively fetching history for chats', {
      instanceId,
      chatCount: anchors.length,
      countPerChat: count,
      depth,
    });

    const messagesPerChat = this.createMessageTracker(anchors);
    const syncState = this.historySyncCallbacks.get(instanceId);
    const originalOnMessage = syncState?.onMessage;

    // Wrap onMessage to track messages per chat
    if (syncState) {
      syncState.onMessage = (msg) => {
        originalOnMessage?.(msg);
        const chatData = messagesPerChat.get(msg.chatId);
        if (!chatData) return;
        chatData.count++;
        const msgTimestamp = msg.timestamp.getTime();
        if (!chatData.oldest || msgTimestamp < chatData.oldest.timestamp) {
          chatData.oldest = { key: (msg.rawPayload as { key?: unknown })?.key, timestamp: msgTimestamp };
        }
      };
    }

    // Fetch history for each anchor
    await this.fetchAllAnchors(sock, instanceId, anchors, count, depth, messagesPerChat);

    // Wait for history responses
    const waitTime = Math.min(anchors.length * 1500, 20000);
    this.logger.debug('Waiting for history responses', { waitTime, depth });
    await new Promise((resolve) => setTimeout(resolve, waitTime));

    // Restore original onMessage handler
    if (syncState && originalOnMessage) {
      syncState.onMessage = originalOnMessage;
    }

    const { anchors: newAnchors, totalFetched } = this.buildNextAnchors(messagesPerChat, count);

    this.logger.info('Fetch round completed', {
      instanceId,
      depth,
      totalFetchedThisRound: totalFetched,
      chatsWithMore: newAnchors.length,
    });

    if (newAnchors.length > 0) {
      await this.fetchAnchorsHistory(sock, instanceId, newAnchors, count, depth + 1, maxDepth);
    }
  }

  /** Fetch history for all anchors with rate limiting */
  private async fetchAllAnchors(
    sock: ReturnType<typeof this.getSocket>,
    instanceId: string,
    anchors: NonNullable<FetchHistoryOptions['anchors']>,
    count: number,
    depth: number,
    messagesPerChat: Map<string, { count: number; oldest: { key: unknown; timestamp: number } | null }>,
  ): Promise<void> {
    for (const anchor of anchors) {
      try {
        this.logger.debug('Fetching history for chat', {
          instanceId,
          chatJid: anchor.chatJid,
          anchorId: anchor.messageKey.id,
          timestamp: new Date(anchor.timestamp).toISOString(),
          depth,
        });
        await sock.fetchMessageHistory(count, anchor.messageKey, anchor.timestamp);
        await new Promise((resolve) => setTimeout(resolve, 300));
      } catch (error) {
        this.logger.warn('Failed to fetch history for chat', {
          instanceId,
          chatJid: anchor.chatJid,
          error: error instanceof Error ? error.message : String(error),
        });
        messagesPerChat.delete(anchor.chatJid);
      }
    }
  }

  /**
   * Wait for passive history sync (no anchors)
   */
  private async waitForPassiveSync(instanceId: string): Promise<void> {
    this.logger.info('No anchors provided, waiting for passive history sync', { instanceId });
    const timeout = 60000;
    const startTime = Date.now();

    await new Promise<void>((resolve) => {
      const checkComplete = setInterval(() => {
        const state = this.historySyncCallbacks.get(instanceId);
        if (!state || Date.now() - startTime > timeout) {
          clearInterval(checkComplete);
          resolve();
        }
      }, 1000);
    });
  }

  /**
   * Fetch message history for an instance.
   *
   * Uses Baileys `fetchMessageHistory` to request older messages for specific chats.
   * This triggers `messaging-history.set` events with the older messages.
   */
  async fetchHistory(instanceId: string, options: FetchHistoryOptions = {}): Promise<FetchHistoryResult> {
    const sock = this.getSocket(instanceId);
    const messages: HistorySyncMessage[] = [];
    const count = options.count ?? 50;

    const syncState = {
      since: options.since,
      until: options.until ?? new Date(),
      onProgress: options.onProgress,
      onMessage: (msg: HistorySyncMessage) => {
        messages.push(msg);
        options.onMessage?.(msg);
      },
      onComplete: options.onProgress ? () => options.onProgress?.(messages.length, 100) : undefined,
      totalFetched: 0,
    };

    this.historySyncCallbacks.set(instanceId, syncState);

    try {
      if (options.anchors?.length) {
        await this.fetchAnchorsHistory(sock, instanceId, options.anchors, count);
      } else {
        await this.waitForPassiveSync(instanceId);
      }

      this.logger.info('History fetch completed', { instanceId, totalMessages: messages.length });
      return { totalFetched: messages.length, messages };
    } finally {
      this.historySyncCallbacks.delete(instanceId);
    }
  }

  /**
   * Fetch contacts for an instance.
   *
   * WhatsApp contacts are received through events (contacts.upsert, messaging-history.set).
   * This method returns the cached contacts that have been received since connection.
   *
   * @param instanceId - Instance to fetch contacts for
   * @param options - Fetch options including callbacks
   * @returns Promise with fetched contacts
   */
  async fetchContacts(instanceId: string, options: FetchContactsOptions = {}): Promise<FetchContactsResult> {
    // Validate instance is connected
    this.getSocket(instanceId);

    // Get cached contacts for this instance
    const instanceContacts = this.contactsCache.get(instanceId);
    const contacts: SyncContact[] = [];

    if (instanceContacts) {
      for (const contact of instanceContacts.values()) {
        contacts.push(contact);
        options.onContact?.(contact);
      }
      options.onProgress?.(contacts.length);
    }

    this.logger.info('Contacts fetch complete', {
      instanceId,
      totalContacts: contacts.length,
    });

    return {
      totalFetched: contacts.length,
      contacts,
    };
  }

  /**
   * Fetch groups for an instance.
   *
   * Uses the Baileys groupFetchAllParticipating() method to get all groups
   * the user is participating in.
   *
   * @param instanceId - Instance to fetch groups for
   * @param options - Fetch options including callbacks
   * @returns Promise with fetched groups
   */
  async fetchGroups(instanceId: string, options: FetchGroupsOptions = {}): Promise<FetchGroupsResult> {
    const sock = this.getSocket(instanceId);
    const groups: SyncGroup[] = [];

    try {
      // Fetch all groups the user is participating in
      const allGroups = await sock.groupFetchAllParticipating();

      for (const [jid, metadata] of Object.entries(allGroups)) {
        const group: SyncGroup = {
          externalId: jid,
          name: metadata.subject || undefined,
          description: metadata.desc || undefined,
          memberCount: metadata.participants?.length,
          createdAt: metadata.creation ? new Date(metadata.creation * 1000) : undefined,
          createdBy: metadata.owner || undefined,
          isReadOnly: metadata.announce ?? false,
          metadata: {
            size: metadata.size,
            restrict: metadata.restrict,
            isCommunity: metadata.isCommunity,
            isCommunityAnnounce: metadata.isCommunityAnnounce,
            linkedParent: metadata.linkedParent,
          },
        };

        groups.push(group);
        options.onGroup?.(group);
        options.onProgress?.(groups.length);
      }

      this.logger.info('Groups fetch complete', {
        instanceId,
        totalGroups: groups.length,
      });

      return {
        totalFetched: groups.length,
        groups,
      };
    } catch (error) {
      const waError = mapBaileysError(error);
      throw waError;
    }
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
    // Close and cleanup socket to prevent memory leaks
    const sock = this.sockets.get(instanceId);
    if (sock) {
      await closeSocket(sock, false);
      this.sockets.delete(instanceId);
    }

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
      mediaLocalPath?: string;
      mimeType?: string;
      caption?: string;
      filename?: string;
      location?: { latitude: number; longitude: number; name?: string; address?: string };
      contact?: { name: string; phone?: string };
      // Extended content fields
      poll?: { name: string; options: string[]; selectableCount?: number };
      pollVotes?: string[];
      event?: { name: string; description?: string; location?: string; startTime?: Date; endTime?: Date };
      product?: {
        id: string;
        title?: string;
        description?: string;
        price?: string;
        currency?: string;
        imageUrl?: string;
      };
      targetMessageId?: string;
      editedText?: string;
    },
    replyToId: string | undefined,
    rawMessage: WAMessage,
    isFromMe: boolean,
  ): Promise<void> {
    // Note: We process fromMe messages to capture messages sent from the phone
    // (synced via WhatsApp multi-device). Messages sent via API emit message.sent separately.

    // Build extended raw payload with structured content data
    const extendedPayload: Record<string, unknown> = {
      ...(rawMessage as unknown as Record<string, unknown>),
      isFromMe, // Include for message-persistence to use
    };

    // Add structured extended fields if present
    if (content.poll) extendedPayload.poll = content.poll;
    if (content.pollVotes) extendedPayload.pollVotes = content.pollVotes;
    if (content.event) extendedPayload.event = content.event;
    if (content.product) extendedPayload.product = content.product;
    if (content.location) extendedPayload.location = content.location;
    if (content.contact) extendedPayload.contact = content.contact;
    if (content.targetMessageId) extendedPayload.targetMessageId = content.targetMessageId;
    if (content.mediaLocalPath) extendedPayload.mediaLocalPath = content.mediaLocalPath;

    // Add chatName from cached group/chat metadata
    this.enrichPayloadWithChatName(extendedPayload, instanceId, chatId);

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
    // Note: We process fromMe reactions to capture reactions made from the phone

    await this.emitMessageReceived({
      instanceId,
      externalId,
      chatId,
      from,
      content: {
        type: 'reaction',
        text: emoji,
      },
      rawPayload: { targetMessageId, isFromMe },
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
  async handleMessageEdited(instanceId: string, externalId: string, chatId: string, newText: string): Promise<void> {
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
  async handleMessageDeleted(instanceId: string, externalId: string, chatId: string, fromMe: boolean): Promise<void> {
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
  // ALL EVENT HANDLERS (for comprehensive Baileys coverage)
  // ─────────────────────────────────────────────────────────────

  /**
   * Handle incoming call (voice/video)
   * @internal
   */
  handleCallReceived(
    instanceId: string,
    callId: string,
    from: string,
    callType: 'voice' | 'video',
    status: string,
    _rawCall: unknown,
  ): void {
    // TODO: Emit call event when we add call support
    this.logger.info('Call received', { instanceId, callId, from, callType, status });
  }

  /**
   * Handle presence update (typing, online/offline)
   * @internal
   */
  handlePresenceUpdate(
    _instanceId: string,
    _chatId: string,
    _userId: string,
    _presence: string,
    _lastSeen?: number,
  ): void {
    // TODO: Emit presence event
    // presence can be: 'available', 'unavailable', 'composing', 'recording', 'paused'
  }

  /**
   * Handle chats upsert (new chats)
   * Caches chat display names for later use when emitting messages
   * @internal
   */
  handleChatsUpsert(instanceId: string, chats: unknown[]): void {
    let cache = this.chatNamesCache.get(instanceId);
    if (!cache) {
      cache = new Map();
      this.chatNamesCache.set(instanceId, cache);
    }

    for (const chat of chats) {
      // Baileys Chat type extends IConversation which has displayName
      const c = chat as { id?: string; displayName?: string; name?: string };
      if (c.id) {
        const name = c.displayName || c.name;
        if (name) {
          cache.set(c.id, name);
          this.logger.debug('Cached chat name', { instanceId, chatId: c.id, name });
        }
      }
    }
  }

  /**
   * Handle chats update
   * Updates cached chat display names
   * @internal
   */
  handleChatsUpdate(instanceId: string, updates: unknown[]): void {
    const cache = this.chatNamesCache.get(instanceId);
    if (!cache) return;

    for (const update of updates) {
      const u = update as { id?: string; displayName?: string; name?: string };
      if (!u.id) continue;

      const name = u.displayName || u.name;
      if (name) {
        cache.set(u.id, name);
      }
    }
  }

  /**
   * Handle chats delete
   * @internal
   */
  handleChatsDelete(_instanceId: string, _chatIds: string[]): void {
    // TODO: Emit chats.delete event
  }

  /**
   * Handle contacts upsert (new contacts)
   * @internal
   */
  handleContactsUpsert(instanceId: string, contacts: unknown[]): void {
    // Get or create contacts cache for this instance
    let cache = this.contactsCache.get(instanceId);
    if (!cache) {
      cache = new Map();
      this.contactsCache.set(instanceId, cache);
    }

    for (const contact of contacts) {
      const c = contact as {
        id: string;
        lid?: string;
        phoneNumber?: string;
        name?: string;
        notify?: string;
        verifiedName?: string;
        imgUrl?: string | null;
        status?: string;
      };

      // Skip group JIDs (they're handled separately)
      const isGroup = c.id.endsWith('@g.us');

      // Extract phone number from JID if not provided
      const phone = c.phoneNumber || (c.id.includes('@s.whatsapp.net') ? `+${c.id.split('@')[0]}` : undefined);

      const syncContact: SyncContact = {
        platformUserId: c.id,
        name: c.name || c.notify || c.verifiedName || undefined,
        phone,
        profilePicUrl: c.imgUrl && c.imgUrl !== 'changed' ? c.imgUrl : undefined,
        isGroup,
        isBusiness: !!c.verifiedName,
        metadata: {
          lid: c.lid,
          status: c.status,
          notify: c.notify,
          verifiedName: c.verifiedName,
        },
      };

      cache.set(c.id, syncContact);
    }

    this.logger.debug('Contacts upserted', { instanceId, count: contacts.length, cacheSize: cache.size });
  }

  /**
   * Handle contacts update
   * @internal
   */
  handleContactsUpdate(instanceId: string, updates: unknown[]): void {
    const cache = this.contactsCache.get(instanceId);
    if (!cache) return;

    for (const update of updates) {
      this.applyContactUpdate(cache, update);
    }

    this.logger.debug('Contacts updated', { instanceId, count: updates.length });
  }

  /**
   * Apply a single contact update to the cache
   * @internal
   */
  private applyContactUpdate(cache: Map<string, SyncContact>, update: unknown): void {
    const u = update as {
      id: string;
      name?: string;
      notify?: string;
      verifiedName?: string;
      imgUrl?: string | null;
    };

    const existing = cache.get(u.id);
    if (!existing) return;

    // Merge updates into existing contact
    existing.name = u.name || existing.name || u.notify;
    if (u.imgUrl && u.imgUrl !== 'changed') existing.profilePicUrl = u.imgUrl;
    if (u.verifiedName) existing.isBusiness = true;

    cache.set(u.id, existing);
  }

  /**
   * Handle groups upsert (new groups)
   * Caches group metadata for later use when emitting messages
   * @internal
   */
  handleGroupsUpsert(instanceId: string, groups: unknown[]): void {
    let cache = this.groupsCache.get(instanceId);
    if (!cache) {
      cache = new Map();
      this.groupsCache.set(instanceId, cache);
    }

    for (const group of groups) {
      const g = group as { id?: string; subject?: string; desc?: string };
      if (g.id && g.subject) {
        cache.set(g.id, { subject: g.subject, desc: g.desc });
        this.logger.debug('Cached group metadata', { instanceId, groupId: g.id, subject: g.subject });
      }
    }
  }

  /**
   * Handle groups update
   * Updates cached group metadata
   * @internal
   */
  handleGroupsUpdate(instanceId: string, updates: unknown[]): void {
    const cache = this.groupsCache.get(instanceId);
    if (!cache) return;

    for (const update of updates) {
      const u = update as { id?: string; subject?: string; desc?: string };
      if (!u.id) continue;

      const existing = cache.get(u.id);
      if (existing) {
        if (u.subject) existing.subject = u.subject;
        if (u.desc !== undefined) existing.desc = u.desc;
        cache.set(u.id, existing);
      } else if (u.subject) {
        cache.set(u.id, { subject: u.subject, desc: u.desc });
      }
    }
  }

  /**
   * Handle group participants update (join/leave/promote/demote)
   * @internal
   */
  handleGroupParticipantsUpdate(_instanceId: string, _update: unknown): void {
    // TODO: Emit group-participants.update event
  }

  /**
   * Handle group join request
   * @internal
   */
  handleGroupJoinRequest(_instanceId: string, _request: unknown): void {
    // TODO: Emit group.join-request event
  }

  /**
   * Handle message receipt update (detailed read receipts)
   * @internal
   */
  handleMessageReceiptUpdate(_instanceId: string, _update: unknown): void {
    // TODO: Process detailed receipt info
  }

  /**
   * Handle media update (upload/download progress)
   * @internal
   */
  handleMediaUpdate(_instanceId: string, _update: unknown): void {
    // TODO: Emit media.update event
  }

  /**
   * Handle history sync (initial load)
   * Processes messages from `messaging-history.set` event
   * @internal
   */
  async handleHistorySync(
    instanceId: string,
    history: {
      chats: unknown[];
      contacts: unknown[];
      messages: WAMessage[];
      isLatest?: boolean;
      progress?: number | null;
      syncType?: proto.HistorySync.HistorySyncType | null;
    },
  ): Promise<void> {
    const { contacts, messages, progress, isLatest, syncType } = history;
    const syncState = this.historySyncCallbacks.get(instanceId);

    this.logger.debug('Processing history sync batch', {
      instanceId,
      messageCount: messages.length,
      contactCount: contacts.length,
      progress: progress ?? 'unknown',
      isLatest,
      syncType,
    });

    // Process contacts from history sync
    if (contacts.length > 0) {
      this.handleContactsUpsert(instanceId, contacts);
    }

    // Process each message in the history
    // Process in parallel for better performance, but limit concurrency
    const BATCH_SIZE = 50;
    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      const batch = messages.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map((msg) => this.processHistoryMessage(instanceId, msg, syncState)));
    }

    // Report progress and completion
    this.reportHistorySyncProgress(instanceId, syncState, progress, isLatest, messages.length);
  }

  /**
   * Process a single message from history sync
   *
   * When syncState is provided (explicit fetch job), calls the callback.
   * When syncState is undefined (initial connection), emits via emitMessageReceived
   * to ensure messages are stored in the database.
   *
   * @internal
   */
  private async processHistoryMessage(
    instanceId: string,
    msg: WAMessage,
    syncState: typeof this.historySyncCallbacks extends Map<string, infer V> ? V | undefined : never,
  ): Promise<void> {
    if (!msg.key?.id || !msg.key?.remoteJid) return;

    const timestamp = this.getMessageTimestamp(msg);

    // Filter by date range if specified
    if (syncState?.since && timestamp < syncState.since) return;
    if (syncState?.until && timestamp > syncState.until) return;

    // Extract basic content info
    const content = this.extractHistoryMessageContent(msg);
    if (!content) return;

    const chatId = msg.key.remoteJid;
    const { id: senderId } = fromJid(msg.key.fromMe ? chatId : msg.key.participant || chatId);
    const isFromMe = msg.key.fromMe ?? false;

    const historyMessage: HistorySyncMessage = {
      externalId: msg.key.id,
      chatId,
      from: senderId,
      timestamp,
      content,
      isFromMe,
      rawPayload: msg,
    };

    // If we have an active sync callback, use it
    if (syncState?.onMessage) {
      syncState.onMessage(historyMessage);
      syncState.totalFetched++;
    } else {
      // No active sync job - this is initial connection history sync
      // Emit the message so it gets stored in the database
      // Note: We store isFromMe messages too for history completeness

      // Build rawPayload with chatName from cache
      const rawPayload: Record<string, unknown> = {
        ...(msg as unknown as Record<string, unknown>),
      };
      this.enrichPayloadWithChatName(rawPayload, instanceId, chatId);

      await this.emitMessageReceived({
        instanceId,
        externalId: msg.key.id,
        chatId,
        from: senderId,
        content: {
          type: content.type as ContentType,
          text: content.text || content.caption,
          mediaUrl: content.mediaUrl,
          mimeType: content.mimeType,
        },
        rawPayload,
      });
    }
  }

  /**
   * Enrich rawPayload with chat name from cached group/chat metadata
   * @internal
   */
  private enrichPayloadWithChatName(payload: Record<string, unknown>, instanceId: string, chatId: string): void {
    if (chatId.includes('@g.us')) {
      const group = this.groupsCache.get(instanceId)?.get(chatId);
      if (group?.subject) {
        payload.chatName = group.subject;
        payload.isGroup = true;
      }
    } else {
      const chatName = this.chatNamesCache.get(instanceId)?.get(chatId);
      if (chatName) {
        payload.chatName = chatName;
      }
    }
  }

  /**
   * Get timestamp from a message
   * @internal
   */
  private getMessageTimestamp(msg: WAMessage): Date {
    if (!msg.messageTimestamp) return new Date();
    const ts = typeof msg.messageTimestamp === 'number' ? msg.messageTimestamp : Number(msg.messageTimestamp);
    return new Date(ts * 1000);
  }

  /**
   * Report history sync progress and completion
   * @internal
   */
  private reportHistorySyncProgress(
    instanceId: string,
    syncState: typeof this.historySyncCallbacks extends Map<string, infer V> ? V | undefined : never,
    progress: number | null | undefined,
    isLatest: boolean | undefined,
    messageCount: number,
  ): void {
    // Report progress
    if (syncState?.onProgress && progress !== undefined && progress !== null) {
      syncState.onProgress(syncState.totalFetched, progress);
    }

    // Check if sync is complete
    if (isLatest || progress === 100) {
      syncState?.onComplete?.(syncState?.totalFetched ?? 0);
      this.logger.info('History sync complete', {
        instanceId,
        totalMessages: syncState?.totalFetched ?? messageCount,
      });
    }
  }

  /**
   * Extract content from a history message
   * Simplified version for history sync processing
   * @internal
   */
  private extractHistoryMessageContent(
    msg: WAMessage,
  ): { type: string; text?: string; mediaUrl?: string; mimeType?: string; caption?: string } | null {
    const message = msg.message;
    if (!message) return null;

    // Use a lookup approach to reduce complexity
    return this.extractTextContent(message) || this.extractMediaContent(message) || this.extractOtherContent(message);
  }

  /**
   * Extract text content from message
   * @internal
   */
  private extractTextContent(message: NonNullable<WAMessage['message']>): { type: string; text?: string } | null {
    if (message.conversation) {
      return { type: 'text', text: message.conversation };
    }
    if (message.extendedTextMessage?.text) {
      return { type: 'text', text: message.extendedTextMessage.text };
    }
    return null;
  }

  /**
   * Extract media content from message
   * @internal
   */
  private extractMediaContent(
    message: NonNullable<WAMessage['message']>,
  ): { type: string; mimeType?: string; caption?: string } | null {
    if (message.imageMessage) {
      return {
        type: 'image',
        mimeType: message.imageMessage.mimetype ?? 'image/jpeg',
        caption: message.imageMessage.caption ?? undefined,
      };
    }
    if (message.audioMessage) {
      return { type: 'audio', mimeType: message.audioMessage.mimetype ?? 'audio/ogg' };
    }
    if (message.videoMessage) {
      return {
        type: 'video',
        mimeType: message.videoMessage.mimetype ?? 'video/mp4',
        caption: message.videoMessage.caption ?? undefined,
      };
    }
    if (message.documentMessage) {
      return {
        type: 'document',
        mimeType: message.documentMessage.mimetype ?? 'application/octet-stream',
        caption: message.documentMessage.caption ?? undefined,
      };
    }
    if (message.stickerMessage) {
      return { type: 'sticker', mimeType: message.stickerMessage.mimetype ?? 'image/webp' };
    }
    return null;
  }

  /**
   * Extract other content types (location, contact, poll)
   * @internal
   */
  private extractOtherContent(message: NonNullable<WAMessage['message']>): { type: string; text?: string } | null {
    if (message.locationMessage) {
      return { type: 'location', text: message.locationMessage.name ?? message.locationMessage.address ?? undefined };
    }
    if (message.contactMessage) {
      return { type: 'contact', text: message.contactMessage.displayName ?? undefined };
    }
    if (message.pollCreationMessage || message.pollCreationMessageV3) {
      const poll = message.pollCreationMessage || message.pollCreationMessageV3;
      return { type: 'poll', text: poll?.name ?? undefined };
    }

    return null;
  }

  /**
   * Handle blocklist set
   * @internal
   */
  handleBlocklistSet(_instanceId: string, _blocklist: string[]): void {
    // TODO: Emit blocklist.set event
  }

  /**
   * Handle blocklist update
   * @internal
   */
  handleBlocklistUpdate(_instanceId: string, _blocklist: string[], _type: 'add' | 'remove'): void {
    // TODO: Emit blocklist.update event
  }

  /**
   * Handle label edit (WhatsApp Business)
   * @internal
   */
  handleLabelEdit(_instanceId: string, _label: unknown): void {
    // TODO: Emit labels.edit event
  }

  /**
   * Handle label association (WhatsApp Business)
   * @internal
   */
  handleLabelAssociation(_instanceId: string, _association: unknown, _type: 'add' | 'remove'): void {
    // TODO: Emit labels.association event
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
