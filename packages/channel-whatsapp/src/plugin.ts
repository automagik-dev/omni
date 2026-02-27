/**
 * WhatsApp Channel Plugin using Baileys
 *
 * Main plugin class that extends BaseChannelPlugin from channel-sdk.
 * Handles connection, messaging, and lifecycle for WhatsApp instances.
 */

import { BaseChannelPlugin, createInboundDedupeCache } from '@omni/channel-sdk';
import type {
  ChannelCapabilities,
  DedupeCache,
  FetchHistoryResult,
  HistorySyncMessage,
  InstanceConfig,
  OutgoingMessage,
  PluginContext,
  SendResult,
  StreamSender,
} from '@omni/channel-sdk';
import type { ChannelType, ContentType } from '@omni/core/types';
import type { GroupMetadata, WAMessage, WASocket, proto } from 'baileys';

import { clearAuthState, createStorageAuthState } from './auth';
import { WHATSAPP_CAPABILITIES } from './capabilities';
import { setupAllEventHandlers } from './handlers/all-events';
import {
  cancelPendingReconnect,
  resetConnectionState,
  seedAuthenticated,
  setupConnectionHandlers,
} from './handlers/connection';
import { setupMessageHandlers, tryDownloadMedia } from './handlers/messages';
import { fromJid, isLidJid, isUserJid, toJid } from './jid';
import { type ReceiptTracker, createReceiptTracker, isDelivered, isRead, mapStatusCode } from './receipts';
import { resendStore } from './resend-store';
import { buildMessageContent } from './senders/builders';
import { sendReaction } from './senders/reaction';
import { WhatsAppStreamSender } from './senders/stream';
import { DEFAULT_SOCKET_CONFIG, type SocketConfig, closeSocket, createSocket } from './socket';
import { DecryptFailureTracker } from './utils/decrypt-failure-tracker';
import { ErrorCode, WhatsAppError, mapBaileysError } from './utils/errors';
import { type RateLimitManager, createRateLimitManager, isRateLimitError } from './utils/rate-limit';

// Re-export for external consumers that previously imported from this module
export type { HistorySyncMessage, FetchHistoryResult };

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
 * WhatsApp-specific options for fetchHistory method
 * Extends the base FetchHistoryOptions with WhatsApp-specific anchors
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
  /** Enable LID-first identity resolution (default: true).
   *  When false, falls back to legacy phone-based resolution (resolveToPhoneJidLegacy).
   *  Per-instance rollback flag — DEC-8. */
  lidFirstEnabled?: boolean;
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
/** Summarize message content for debug logging, replacing raw buffers with size descriptions. */
function summarizeContent(content: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = { ...content };
  for (const key of ['audio', 'image', 'video', 'document', 'sticker'] as const) {
    if (Buffer.isBuffer(summary[key])) {
      summary[key] = `<Buffer ${(summary[key] as Buffer).length} bytes>`;
    }
  }
  return summary;
}

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

  /** Tracks total messages fetched during initial history push (no explicit sync job) per instance */
  private historyPushFetchCount = new Map<string, number>();

  /** Cached contacts from sync events per instance */
  private contactsCache = new Map<string, Map<string, SyncContact>>();

  /**
   * Full GroupMetadata cache per instance — keyed by group JID.
   * Passed to Baileys via `cachedGroupMetadata` so it can encrypt group
   * messages without a network round-trip inside the buffer/transaction.
   * Entries have a 5-minute TTL.
   */
  private static readonly GROUP_CACHE_TTL_MS = 5 * 60 * 1000;
  private groupMetadataCache = new Map<string, Map<string, { metadata: GroupMetadata; cachedAt: number }>>();

  /** Legacy light cache for display names — derived from groupMetadataCache */
  private groupsCache = new Map<string, Map<string, { subject: string; desc?: string }>>();

  /** Last outgoing action timestamp per instance — for humanized delay */
  private lastActionTime = new Map<string, number>();

  /**
   * Cache of message IDs sent by this bot (per instance).
   * Used to detect and skip echoed messages that Baileys receives back
   * after we send them — prevents infinite agent reply loops in self-chat.
   * Entries auto-expire after 5 minutes.
   */
  private sentMessageIds = new Map<string, Set<string>>();
  private static readonly SENT_ID_TTL_MS = 5 * 60 * 1000;

  /** Rate limit managers per instance — handles Baileys 429 backoff */
  private rateLimitManagers = new Map<string, RateLimitManager>();

  /** Per-instance inbound dedup caches */
  private dedupeCaches = new Map<string, DedupeCache>();

  /**
   * Decrypt failure trackers per instance (#70).
   * Tracks JIDs with repeated decrypt failures and temporarily blocks them
   * via shouldIgnoreJid to prevent transaction mutex starvation.
   */
  private decryptTrackers = new Map<string, DecryptFailureTracker>();

  /**
   * Per-instance receipt trackers for in-memory delivery status.
   * Allows omni-ktb (resend in-flight) to query current delivery state
   * without hitting the DB for each status check.
   */
  private receiptTrackers = new Map<string, ReceiptTracker>();

  /** Get or create a rate limit manager for an instance */
  private getRateLimitManager(instanceId: string): RateLimitManager {
    let manager = this.rateLimitManagers.get(instanceId);
    if (!manager) {
      manager = createRateLimitManager(instanceId, this.logger);
      this.rateLimitManagers.set(instanceId, manager);
    }
    return manager;
  }

  /**
   * Enforce a randomized delay between outgoing actions to avoid
   * WhatsApp anti-bot detection. Simulates human-probable timing.
   *
   * Actions arriving faster than the random window are held until
   * enough time has passed since the previous action.
   */
  private async humanDelay(instanceId: string): Promise<void> {
    const now = Date.now();
    const last = this.lastActionTime.get(instanceId) || 0;
    const minDelay = 1500;
    const maxDelay = 3500;
    const randomDelay = minDelay + Math.random() * (maxDelay - minDelay);
    const elapsed = now - last;

    if (elapsed < randomDelay) {
      await new Promise<void>((r) => setTimeout(r, randomDelay - elapsed));
    }

    this.lastActionTime.set(instanceId, Date.now());
  }

  /**
   * Send typing indicator (composing → pause) before a text message.
   * Duration scales with text length to look natural.
   */
  private async simulateTyping(instanceId: string, jid: string, text: string): Promise<void> {
    try {
      const sock = this.getSocket(instanceId);
      const typingMs = Math.min(800 + text.length * 30, 4000);
      await sock.sendPresenceUpdate('composing', jid);
      await new Promise<void>((r) => setTimeout(r, typingMs));
      await sock.sendPresenceUpdate('paused', jid);
    } catch {
      // Non-critical — don't fail the send if presence update fails
    }
  }

  /**
   * Track a message ID as sent by this bot.
   * Called after sendMessage() succeeds so we can detect the echo later.
   */
  trackSentMessageId(instanceId: string, messageId: string): void {
    let ids = this.sentMessageIds.get(instanceId);
    if (!ids) {
      ids = new Set();
      this.sentMessageIds.set(instanceId, ids);
    }
    ids.add(messageId);

    // Auto-expire after TTL
    setTimeout(() => {
      ids?.delete(messageId);
    }, WhatsAppPlugin.SENT_ID_TTL_MS);
  }

  /**
   * Check if a message was sent by this bot (echo detection).
   * Used by message handlers to skip bot-originated messages and prevent loops.
   */
  isBotSentMessage(instanceId: string, messageId: string): boolean {
    return this.sentMessageIds.get(instanceId)?.has(messageId) ?? false;
  }

  /** Cached chat display names per instance (for DMs from chats.upsert) */
  private chatNamesCache = new Map<string, Map<string, string>>();

  /** Last-known unread count per JID per instance — sourced from chats.upsert/chats.update */
  private chatUnreadCache = new Map<string, Map<string, number>>();

  /**
   * Get all chat JIDs known to Baileys for an instance.
   * Sourced from chats.upsert events (fires on every connection).
   * Used by sync worker to discover chats not yet in the database.
   */
  getKnownChatJids(instanceId: string): string[] {
    return Array.from(this.chatNamesCache.get(instanceId)?.keys() ?? []);
  }

  /**
   * Re-emit all cached unread counts for an instance.
   * Call this periodically (e.g. every hour) to keep DB in sync with Baileys state.
   * Counts are sourced from the most recent chats.upsert/chats.update events.
   */
  refreshUnreadCounts(instanceId: string): void {
    const cache = this.chatUnreadCache.get(instanceId);
    if (!cache || cache.size === 0) return;
    for (const [chatId, unreadCount] of cache) {
      this.emitChatUnreadUpdate(instanceId, chatId, unreadCount);
    }
    this.logger.debug('Refreshed unread counts from cache', { instanceId, count: cache.size });
  }

  /** Per-instance LID-first enabled flag (DEC-8 rollback). Default: true. */
  private lidFirstEnabledMap = new Map<string, boolean>();

  /**
   * LID → phone JID mapping cache per instance.
   * Maps @lid JIDs to their canonical @s.whatsapp.net equivalents.
   * Populated from contacts.upsert (c.lid + c.id) and lid-mapping.update events.
   */
  private lidMappingCache = new Map<string, Map<string, string>>();

  /**
   * Short-lived cache of recent message keys (externalId → { participant, fromMe }).
   * Populated on message receipt, used by markAsRead as fallback when DB hasn't
   * persisted the message yet (race condition with auto-read automations).
   * Key format: `${instanceId}:${externalId}`
   */
  private recentMessageKeys = new Map<string, { participant?: string; fromMe: boolean }>();
  private static readonly MESSAGE_KEY_CACHE_TTL_MS = 60_000; // 1 minute

  /**
   * Store a LID → phone JID mapping for an instance
   */
  storeLidMapping(instanceId: string, lidJid: string, phoneJid: string): void {
    let cache = this.lidMappingCache.get(instanceId);
    if (!cache) {
      cache = new Map();
      this.lidMappingCache.set(instanceId, cache);
    }
    cache.set(lidJid, phoneJid);
    this.logger.debug('Stored LID mapping', { instanceId, lidJid, phoneJid });
  }

  /**
   * Get the LID mapping cache for an instance
   */
  getLidMappingCache(instanceId: string): Map<string, string> {
    return this.lidMappingCache.get(instanceId) ?? new Map();
  }

  /**
   * Get the ReceiptTracker for an instance.
   *
   * Allows external callers (e.g. the resend-in-flight logic in omni-ktb) to
   * check current in-memory delivery status for a message without a DB query.
   *
   * Returns undefined if no receipts have been received for this instance yet.
   */
  getReceiptTracker(instanceId: string): ReceiptTracker | undefined {
    return this.receiptTrackers.get(instanceId);
  }

  /**
   * Check if LID-first identity resolution is enabled for an instance.
   * When false, falls back to legacy phone-based resolution (DEC-8 rollback).
   */
  isLidFirstEnabled(instanceId: string): boolean {
    return this.lidFirstEnabledMap.get(instanceId) ?? true;
  }

  /**
   * Get the bot's own JID for an instance (e.g., "5511999990000@s.whatsapp.net")
   */
  getMeJid(instanceId: string): string | undefined {
    return this.sockets.get(instanceId)?.user?.id;
  }

  /**
   * Get the API base URL (e.g., "http://localhost:8881") for constructing absolute media URLs.
   * Used by message handlers so that tryDownloadMedia() returns fetch-able URLs.
   */
  getApiBaseUrl(): string {
    return this.config.apiBaseUrl;
  }

  /**
   * Cache contact info for future lookups
   */
  private cacheContactInfo(instanceId: string, jid: string, name: string | undefined, phone: string | undefined): void {
    let cache = this.contactsCache.get(instanceId);
    if (!cache) {
      cache = new Map();
      this.contactsCache.set(instanceId, cache);
    }
    cache.set(jid, {
      platformUserId: jid,
      name,
      phone,
      isGroup: false,
    });
  }

  /**
   * Try to fetch contact from group participants
   */
  private async tryFetchFromGroupParticipants(
    sock: ReturnType<typeof this.getSocket>,
    instanceId: string,
    groupJid: string,
    lookupJid: string,
    normalizedJid?: string,
    originalLid?: string,
  ): Promise<{ name?: string; phone?: string } | null> {
    try {
      const metadata = await sock.groupMetadata(groupJid);
      // Try matching with all possible JID formats: PN, normalized, and LID
      const participant = metadata.participants?.find(
        (p) => p.id === lookupJid || p.id === normalizedJid || p.id === originalLid,
      );

      if (participant) {
        // Log available fields to understand what we can use
        this.logger.debug('Found participant in group', {
          jid: lookupJid,
          participantKeys: Object.keys(participant),
          participant,
        });

        // Group participants don't have a name/notify field, but they have phoneNumber
        // Try to look up the phoneNumber in contactsCache or chatNamesCache
        const participantPhoneJid = (participant as { phoneNumber?: string }).phoneNumber;
        let name: string | undefined;

        if (participantPhoneJid) {
          // Try contactsCache first
          const contactsCacheMap = this.contactsCache.get(instanceId);
          this.logger.debug('Checking contactsCache for participant', {
            jid: lookupJid,
            phoneJid: participantPhoneJid,
            hasContactsCache: !!contactsCacheMap,
            cacheSize: contactsCacheMap?.size ?? 0,
            sampleKeys: Array.from(contactsCacheMap?.keys() ?? []).slice(0, 5),
          });

          const cachedContact = contactsCacheMap?.get(participantPhoneJid);
          if (cachedContact?.name) {
            name = cachedContact.name;
            this.logger.debug('Found participant name in contactsCache', {
              jid: lookupJid,
              phoneJid: participantPhoneJid,
              name,
            });
          } else {
            // Try chatNamesCache
            const chatNamesMap = this.chatNamesCache.get(instanceId);
            const chatName = chatNamesMap?.get(participantPhoneJid);
            if (chatName) {
              name = chatName;
              this.logger.debug('Found participant name in chatNamesCache', {
                jid: lookupJid,
                phoneJid: participantPhoneJid,
                name,
              });
            }
          }
        }

        const phoneMatch = lookupJid.match(/^(\d+)(:\d+)?@/);
        const phone = phoneMatch?.[1];
        return { name, phone };
      }

      this.logger.debug('Participant not found in group metadata', {
        groupJid,
        lookupJid,
        participantCount: metadata.participants?.length,
        sampleParticipants: metadata.participants?.slice(0, 2).map((p) => p.id),
      });
    } catch (error) {
      this.logger.debug('Failed to fetch group metadata', { groupJid, error: String(error) });
    }
    return null;
  }

  /**
   * Try fetching contact info directly from WhatsApp (business profile or onWhatsApp check)
   */
  private async tryFetchFromWhatsApp(
    sock: ReturnType<typeof this.getSocket>,
    instanceId: string,
    lookupJid: string,
    phone: string,
  ): Promise<{ name?: string; phone?: string } | null> {
    this.logger.debug('tryFetchFromWhatsApp called', { instanceId, lookupJid, phone });

    // Convert PN format (e.g., "551151999885:0@s.whatsapp.net") to standard phone JID
    // getBusinessProfile needs the standard format without the :0 device ID
    const phoneJid = `${phone}@s.whatsapp.net`;

    // Try business profile first (has name info for business accounts)
    this.logger.debug('Attempting business profile lookup', { lookupJid, phoneJid });
    try {
      const businessProfile = await sock.getBusinessProfile(phoneJid);
      this.logger.debug('getBusinessProfile returned', {
        phoneJid,
        businessProfile,
        allKeys: Object.keys(businessProfile || {}),
      });
      if (businessProfile) {
        // Check for various name fields that might be present
        const profile = businessProfile as {
          verifiedName?: string;
          verified_name?: string;
          name?: string;
          business_name?: string;
          description?: string;
        };
        const businessName = profile.verifiedName || profile.verified_name || profile.name || profile.business_name;
        this.logger.debug('Checking business name fields', {
          phoneJid,
          verifiedName: profile.verifiedName,
          verified_name: profile.verified_name,
          name: profile.name,
          business_name: profile.business_name,
          finalBusinessName: businessName,
        });
        if (businessName) {
          this.cacheContactInfo(instanceId, lookupJid, businessName, phone);
          this.logger.debug('Fetched business profile', { jid: phoneJid, name: businessName });
          return { name: businessName, phone };
        }
      }
    } catch (error) {
      // Not a business account or error fetching - continue to regular check
      this.logger.debug('No business profile found', {
        jid: phoneJid,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Fallback to onWhatsApp (just checks existence, usually no name)
    const results = await sock.onWhatsApp(phone);
    const result = results?.[0];
    this.logger.debug('onWhatsApp result', {
      phone,
      result,
      resultKeys: result ? Object.keys(result) : [],
    });

    if (result?.exists) {
      const name = (result as { notify?: string }).notify || undefined;
      this.cacheContactInfo(instanceId, lookupJid, name, phone);
      this.logger.debug('Fetched and cached contact from WhatsApp', {
        jid: lookupJid,
        name,
        hasNotify: !!(result as { notify?: string }).notify,
      });
      return { name, phone };
    }

    this.logger.debug('Contact not found on WhatsApp', { instanceId, phone });
    return null;
  }

  /**
   * Check both contactsCache and chatNamesCache for a contact
   */
  private checkContactCaches(
    instanceId: string,
    lookupJid: string,
    normalizedJid: string,
    phone: string | undefined,
  ): { name?: string; phone?: string } | null {
    // Try contactsCache first
    const contactsMap = this.contactsCache.get(instanceId);
    let cachedContact = contactsMap?.get(lookupJid);
    if (!cachedContact && normalizedJid !== lookupJid) {
      cachedContact = contactsMap?.get(normalizedJid);
    }
    this.logger.debug('Checking contactsCache', {
      lookupJid,
      normalizedJid,
      hasContactsMap: !!contactsMap,
      cacheSize: contactsMap?.size,
      foundContact: cachedContact,
      sampleKeys: Array.from(contactsMap?.keys() ?? []).slice(0, 5),
    });
    if (cachedContact) {
      return {
        name: cachedContact.name,
        phone: cachedContact.phone,
      };
    }

    // Try chatNamesCache
    const chatNamesMap = this.chatNamesCache.get(instanceId);
    let chatName = chatNamesMap?.get(lookupJid);
    if (!chatName && normalizedJid !== lookupJid) {
      chatName = chatNamesMap?.get(normalizedJid);
    }
    this.logger.debug('Checking chatNamesCache', {
      lookupJid,
      hasChatNamesMap: !!chatNamesMap,
      cacheSize: chatNamesMap?.size,
      foundName: chatName,
      sampleKeys: Array.from(chatNamesMap?.keys() ?? []).slice(0, 5),
    });
    if (chatName) {
      return { name: chatName, phone };
    }

    return null;
  }

  /**
   * Get contact info from Baileys (name, phone) by JID
   * Resolves LID to PN if needed and queries the internal contact cache
   * Falls back to fetching from WhatsApp or group metadata if not cached
   */
  async getContactInfo(
    instanceId: string,
    jid: string,
    groupJid?: string,
  ): Promise<{ name?: string; phone?: string } | null> {
    try {
      const sock = this.sockets.get(instanceId);
      if (!sock) {
        this.logger.debug('Socket not found for instance', { instanceId });
        return null;
      }

      // Resolve LID to PN if needed using Baileys' signalRepository
      let lookupJid = jid;
      const originalLid = jid.endsWith('@lid') ? jid : undefined;
      if (originalLid) {
        const pn = await sock.signalRepository.lidMapping.getPNForLID(originalLid);
        if (pn) {
          lookupJid = pn;
          this.logger.debug('Resolved LID to PN via Baileys', { lid: originalLid, pn });
        }
      }

      // Check if this is a self-mention (mentioning the instance owner)
      const ownerJid = sock.user?.id;
      const ownerPhone = ownerJid?.split('@')[0]?.split(':')[0];
      const lookupPhone = lookupJid.split('@')[0]?.split(':')[0];
      if (ownerPhone && lookupPhone && ownerPhone === lookupPhone) {
        const ownerName = sock.user?.name;
        this.logger.debug('Self-mention detected, using instance owner profile', {
          instanceId,
          ownerJid,
          ownerName,
          lookupJid,
        });
        return { name: ownerName, phone: ownerPhone };
      }

      // Extract phone number for normalized cache lookups
      const phoneMatch = lookupJid.match(/^(\d+)(:\d+)?@/);
      const phone = phoneMatch?.[1];
      const normalizedJid = phone ? `${phone}@s.whatsapp.net` : lookupJid;

      // Check caches first
      const cached = this.checkContactCaches(instanceId, lookupJid, normalizedJid, phone);
      if (cached) {
        return cached;
      }

      // Cache miss - try fetching from group metadata if this is a group chat
      if (groupJid?.endsWith('@g.us')) {
        this.logger.debug('Contact not in cache, checking group participants', {
          instanceId,
          jid: lookupJid,
          originalLid,
          normalizedJid,
          groupJid,
        });
        const groupContact = await this.tryFetchFromGroupParticipants(
          sock,
          instanceId,
          groupJid,
          lookupJid,
          normalizedJid,
          originalLid,
        );
        if (groupContact?.name) {
          // Only return if we actually got a name, not just phone
          this.cacheContactInfo(instanceId, lookupJid, groupContact.name, groupContact.phone);
          this.logger.debug('Fetched and cached contact from group metadata', {
            jid: lookupJid,
            name: groupContact.name,
          });
          return groupContact;
        }
      }

      // Still not found - try fetching from WhatsApp directly
      this.logger.debug('Contact not in cache or group, fetching from WhatsApp', { instanceId, jid: lookupJid });

      if (!phone) {
        this.logger.debug('Could not extract phone from JID', { jid: lookupJid });
        return null;
      }

      return await this.tryFetchFromWhatsApp(sock, instanceId, lookupJid, phone);
    } catch (error) {
      this.logger.debug('Failed to get contact info', { instanceId, jid, error: String(error) });
      return null;
    }
  }

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
        existingSocket.ev.removeAllListeners('connection.update');
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
    // Cancel any pending reconnect timers to prevent duplicate sockets
    cancelPendingReconnect(instanceId);

    // Close existing socket if any (critical: prevents duplicate connections)
    const existingSocket = this.sockets.get(instanceId);
    if (existingSocket) {
      this.logger.info('Closing existing socket before reconnect', { instanceId });
      // Remove event listeners BEFORE closing to prevent the close event
      // from triggering another reconnect via the old handler
      existingSocket.ev.removeAllListeners('connection.update');
      await closeSocket(existingSocket, false);
      this.sockets.delete(instanceId);
    }

    // Storage-backed auth state
    const { state, saveCreds } = await createStorageAuthState(this.storage, instanceId);

    // If this instance already has credentials (me.id populated), seed the
    // in-memory authenticatedInstances set so the connection handler knows to
    // auto-reconnect on disconnect instead of falling into the QR-scan path.
    // This is critical after PM2 restarts where the in-memory Set is empty
    // but the instance was previously paired.
    if (state.creds?.me?.id) {
      seedAuthenticated(instanceId);
    }

    // Merge socket options: defaults <- plugin config <- instance options
    const instanceOptions = (config.options?.whatsapp || {}) as WhatsAppConnectionOptions;

    // Store per-instance LID-first flag (DEC-8 rollback)
    this.lidFirstEnabledMap.set(instanceId, instanceOptions.lidFirstEnabled ?? true);

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

    // Create or get the decrypt failure tracker for this instance (#70)
    let decryptTracker = this.decryptTrackers.get(instanceId);
    if (!decryptTracker) {
      decryptTracker = new DecryptFailureTracker();
      this.decryptTrackers.set(instanceId, decryptTracker);
    }

    // Create Baileys socket using wrapper
    const sock = await createSocket({
      auth: state,
      ...socketOptions,
      // Provide cached group metadata so Baileys skips the network fetch
      // inside keys.transaction during message encryption. Without this,
      // the fetch holds ev.buffer() open and triggers the 30s auto-flush
      // that corrupts socket state. See #70.
      cachedGroupMetadata: (jid: string) => this.getCachedGroupMetadata(instanceId, jid),
      // Dynamic JID ignore for broken sessions (#70):
      // Blocks JIDs with repeated decrypt failures to prevent transaction
      // mutex starvation from retry storms.
      shouldIgnoreJid: decryptTracker.shouldIgnore,
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
          oldSocket.ev.removeAllListeners('connection.update');
          await closeSocket(oldSocket, false);
          this.sockets.delete(instanceId);
        }
        await clearAuthState(this.storage, instanceId);
        await this.createConnection(instanceId, config);
      },
    );

    // Create per-instance dedup cache for the lifetime of this connection
    const dedupeCache = createInboundDedupeCache();
    this.dedupeCaches.set(instanceId, dedupeCache);

    // Set up message handlers (pass decrypt tracker for dynamic JID blocking)
    setupMessageHandlers(sock, this, instanceId, decryptTracker, dedupeCache);

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

    // Remove event listeners before closing to prevent ghost reconnects
    sock.ev.removeAllListeners('connection.update');

    // Close socket WITHOUT logging out (preserves session for reconnect)
    await closeSocket(sock, false);
    this.sockets.delete(instanceId);

    this.clearInstanceCaches(instanceId);

    // Emit disconnected event
    await this.emitInstanceDisconnected(instanceId, 'User requested disconnect');
  }

  /** Clear all per-instance caches to prevent memory leaks on reconnect cycles */
  private clearInstanceCaches(instanceId: string): void {
    this.groupMetadataCache.delete(instanceId);
    this.groupsCache.delete(instanceId);
    this.contactsCache.delete(instanceId);
    this.chatNamesCache.delete(instanceId);
    this.chatUnreadCache.delete(instanceId);
    this.sentMessageIds.delete(instanceId);
    this.rateLimitManagers.delete(instanceId);
    this.decryptTrackers.delete(instanceId);
    this.receiptTrackers.delete(instanceId);
    // Clear any pending resend entries — no point retrying after intentional disconnect/logout
    resendStore.clear(instanceId);
    this.lidFirstEnabledMap.delete(instanceId);
    this.lidMappingCache.delete(instanceId);
    this.lastActionTime.delete(instanceId);
    // Dispose and remove per-instance dedup cache
    this.dedupeCaches.get(instanceId)?.dispose();
    this.dedupeCaches.delete(instanceId);
    // recentMessageKeys uses composite keys — clean entries for this instance
    for (const key of this.recentMessageKeys.keys()) {
      if (key.startsWith(`${instanceId}:`)) this.recentMessageKeys.delete(key);
    }
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
   * Build quoted message options for reply-to messages.
   * Baileys requires key.fromMe and a message object for quoted messages.
   */
  private buildQuotedOptions(message: OutgoingMessage, jid: string): { quoted: unknown } | undefined {
    if (!message.replyTo) return undefined;

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
    if (replyToRawPayload) return { quoted: replyToRawPayload };

    // Fallback: construct quoted object with text content for preview
    return {
      quoted: {
        key: { id: message.replyTo, remoteJid: jid, fromMe: replyToFromMe },
        message: replyToText ? { conversation: replyToText } : { conversation: ' ' },
      },
    };
  }

  /**
   * Apply pre-send processing: humanized delay, typing simulation, audio conversion, markdown formatting
   */
  private async preprocessOutgoing(
    instanceId: string,
    jid: string,
    message: OutgoingMessage,
  ): Promise<OutgoingMessage> {
    await this.humanDelay(instanceId);

    // Simulate typing for text/caption messages
    const textContent = message.content.text || message.content.caption || '';
    if (textContent.length > 0) {
      await this.simulateTyping(instanceId, jid, textContent);
    }

    // Handle audio conversion for voice notes (PTT)
    let processed = message;
    if (message.content.type === 'audio' && message.metadata?.ptt === true) {
      processed = await this.processAudioForVoiceNote(message);
    }

    // Apply markdown→WhatsApp format conversion for text messages
    const formatMode = (message.metadata?.messageFormatMode as 'convert' | 'passthrough') ?? 'convert';
    if (processed.content.type === 'text' && formatMode !== 'passthrough' && processed.content.text) {
      const { markdownToWhatsApp } = await import('./utils/markdown-to-whatsapp');
      const converted = markdownToWhatsApp(processed.content.text);
      processed = { ...processed, content: { ...processed.content, text: converted } };
    }

    return processed;
  }

  /**
   * Wait for rate limit backoff if active
   */
  private async waitForRateLimitBackoff(instanceId: string): Promise<RateLimitManager> {
    const rateLimiter = this.getRateLimitManager(instanceId);
    const remainingBackoff = rateLimiter.getRemainingBackoff();
    if (remainingBackoff > 0) {
      this.logger.debug('Waiting for rate limit backoff', { instanceId, remainingBackoff });
      await new Promise<void>((r) => setTimeout(r, remainingBackoff));
    }
    return rateLimiter;
  }

  /**
   * Resolve the send target JID.
   *
   * LID-first: when sending to a phone number, try to resolve to LID via
   * Baileys signalRepository.lidMapping.getLIDForPN. Falls back gracefully
   * to phone JID if no LID mapping exists or the API is unavailable.
   */
  private async resolveSendTarget(sock: WASocket, instanceId: string, to: string): Promise<string> {
    const phoneJid = toJid(to);

    // If already a LID or not a user JID, passthrough
    if (!isUserJid(phoneJid)) return phoneJid;

    // DEC-8: skip LID resolution when lidFirstEnabled is disabled (rollback)
    if (!this.isLidFirstEnabled(instanceId)) return phoneJid;

    // Try LID resolution via Baileys signal repository
    try {
      const lidJid = await sock.signalRepository.lidMapping.getLIDForPN(phoneJid);
      if (lidJid) {
        this.logger.debug('lid_resolution', { phone: phoneJid, resolvedLid: lidJid, instanceId });
        // Cache the phone↔LID mapping so the outbound echo (which arrives before DB persistence)
        // can resolve the LID back to the existing phone chat without creating a duplicate.
        this.storeLidMapping(instanceId, lidJid, phoneJid);
        return lidJid;
      }
    } catch (error) {
      // LID resolution failure is expected when contact hasn't synced yet — fallback to phone is correct.
      // Use debug level to avoid production log noise for this routine fallback path.
      this.logger.debug('lid_send_fallback', {
        originalTarget: to,
        attemptedPhone: phoneJid,
        error: String(error),
        instanceId,
      });
    }

    return phoneJid;
  }

  /**
   * Send a message through WhatsApp
   */
  async sendMessage(instanceId: string, message: OutgoingMessage): Promise<SendResult> {
    const sock = this.getSocket(instanceId);
    const jid = await this.resolveSendTarget(sock, instanceId, message.to);
    const rateLimiter = await this.waitForRateLimitBackoff(instanceId);

    try {
      // ── Reaction dispatch (separate path — not a normal message) ──
      if (message.content.type === 'reaction') {
        return this.dispatchReaction(instanceId, sock, jid, message);
      }

      const processedMessage = await this.preprocessOutgoing(instanceId, jid, message);

      // Build message content based on type
      const content = this.buildContent(processedMessage);
      const quotedOptions = this.buildQuotedOptions(message, jid);

      this.logger.debug('Sending message', { jid, content: summarizeContent(content), hasQuoted: !!quotedOptions });

      // Pre-warm Baileys device + session caches OUTSIDE keys.transaction (#70).
      // Without this, relayMessage acquires a real mutex (meId) and then makes
      // network calls (getUSyncDevices, assertSessions) that hold it for 15-45s,
      // blocking ALL other sends. Pre-warming populates the caches so the
      // transaction finds cached data and releases the mutex in milliseconds.
      if (jid.endsWith('@g.us')) {
        await this.prewarmGroupCaches(instanceId, sock, jid);
      }

      // Journey timing: T10 before platform call, T11 after
      const correlationId = message.metadata?.correlationId as string | undefined;
      correlationId && this.captureT10(correlationId);

      const result = await sock.sendMessage(jid, content, quotedOptions as never);
      correlationId && this.captureT11(correlationId);

      const externalId = result?.key?.id || '';

      // Track this message ID so we can detect the echo when Baileys receives it back
      if (externalId) {
        this.trackSentMessageId(instanceId, externalId);
        // Register in resend store so we can re-send if connection drops before server ACK
        resendStore.register(instanceId, externalId, jid, message);
      }

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

      // Reset rate limit state on successful send
      rateLimiter.reset();

      return {
        success: true,
        messageId: externalId,
        timestamp: Date.now(),
      };
    } catch (error) {
      // ── Rate limit detection ──
      if (isRateLimitError(error)) {
        rateLimiter.handleRateLimit(error, 0);
      }

      const waError = mapBaileysError(error);

      await this.emitMessageFailed({
        instanceId,
        chatId: jid,
        error: waError.message,
        errorCode: waError.code,
        retryable: waError.retryable || isRateLimitError(error),
      });

      return {
        success: false,
        error: waError.message,
        errorCode: waError.code,
        retryable: waError.retryable || isRateLimitError(error),
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Dispatch a reaction message (add or remove).
   *
   * Reactions bypass the normal message pipeline (no typing, no markdown
   * conversion, no emitMessageSent). They use the dedicated Baileys react
   * protocol message which modifies an existing message in-place.
   *
   * @returns SendResult with success (no messageId for reactions)
   */
  private async dispatchReaction(
    instanceId: string,
    sock: WASocket,
    jid: string,
    message: OutgoingMessage,
  ): Promise<SendResult> {
    const { targetMessageId, emoji } = message.content;

    if (!targetMessageId) {
      return {
        success: false,
        error: 'Reaction content missing target message ID',
        errorCode: ErrorCode.SEND_FAILED,
        retryable: false,
        timestamp: Date.now(),
      };
    }

    // Validate emoji — WhatsApp only supports standard Unicode emoji, not custom emoji IDs
    const reactionEmoji = emoji || '';
    if (reactionEmoji && /^\d+$/.test(reactionEmoji)) {
      // Looks like a custom emoji ID (numeric string) — not supported on WhatsApp
      return {
        success: false,
        error: `Custom emoji reactions are not supported on WhatsApp. Use a standard Unicode emoji instead (received ID: ${reactionEmoji})`,
        errorCode: ErrorCode.SEND_FAILED,
        retryable: false,
        timestamp: Date.now(),
      };
    }

    // Determine fromMe: metadata can override, default true
    const fromMe = (message.metadata?.fromMe as boolean) ?? true;

    // Minimal delay for reactions (shorter than full humanDelay)
    await this.humanDelay(instanceId);

    this.logger.debug('Sending reaction', {
      jid,
      targetMessageId,
      emoji: reactionEmoji || '(remove)',
      fromMe,
    });

    const correlationId = message.metadata?.correlationId as string | undefined;
    correlationId && this.captureT10(correlationId);

    await sendReaction(sock, jid, targetMessageId, reactionEmoji, fromMe);

    correlationId && this.captureT11(correlationId);

    return {
      success: true,
      timestamp: Date.now(),
    };
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

  // ────────────────────────────────────────────────────────────
  // Streaming (progressive response edits)
  // ────────────────────────────────────────────────────────────

  /**
   * Create a stream sender for progressive response rendering.
   *
   * Uses Baileys message edits to update a single message as the LLM
   * streams its response. Throttled conservatively (default 2500ms)
   * to avoid WhatsApp anti-bot detection.
   *
   * Config: `streamThrottleMs` in instance options (default 2500)
   */
  createStreamSender(
    instanceId: string,
    chatId: string,
    replyToMessageId?: string,
    chatType?: 'dm' | 'group' | 'channel',
    options?: { formatMode?: 'convert' | 'passthrough' },
  ): StreamSender {
    const jid = toJid(chatId);

    // Read per-instance stream config
    const instanceEntry = this.instances.get(instanceId);
    const streamOpts = instanceEntry?.config?.options ?? {};

    // Pre-warm group caches before streaming starts (#70)
    if (jid.endsWith('@g.us')) {
      this.prewarmGroupCaches(instanceId, this.getSocket(instanceId), jid).catch(() => {});
    }

    // Pass a lazy getter so the sender always uses the current live socket,
    // even if the instance reconnects while the agent response is streaming.
    return new WhatsAppStreamSender(() => this.getSocket(instanceId), jid, replyToMessageId, chatType, {
      formatMode: options?.formatMode,
      editMode: (streamOpts.streamEditMode as boolean) ?? false,
      throttleMs: (streamOpts.streamThrottleMs as number) ?? undefined,
    });
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

  /** Resolve a message key for read receipts, with cache fallback and LID mapping */
  private resolveMessageKey(
    instanceId: string,
    id: string,
    jid: string,
    isGroup: boolean,
    dataByExternalId: Map<string, unknown>,
    lidCache: Map<string, string> | undefined,
  ): { remoteJid: string; id: string; fromMe: boolean; participant?: string } {
    const raw = dataByExternalId.get(id) as { key?: { participant?: string; fromMe?: boolean } } | null | undefined;
    let fromMe = raw?.key?.fromMe ?? false;
    let participant = raw?.key?.participant;

    // Fallback: if rawPayload not in DB yet, check in-memory cache (race with auto-read)
    if (!participant && isGroup) {
      const cached = this.recentMessageKeys.get(`${instanceId}:${id}`);
      if (cached) {
        participant = cached.participant;
        fromMe = cached.fromMe;
      }
    }

    // Resolve LID participant to phone JID if mapping exists
    if (participant && isLidJid(participant) && lidCache) {
      participant = lidCache.get(participant) ?? participant;
    }

    return {
      remoteJid: jid,
      id,
      fromMe,
      ...(isGroup && participant ? { participant } : {}),
    };
  }

  /**
   * Mark messages as read
   *
   * Respects per-instance read receipt mode when provided.
   *
   * @param instanceId - Instance ID
   * @param chatId - Chat ID (JID or phone number)
   * @param messageIds - Array of message IDs, or ['all'] to mark entire chat as read
   * @param messageData - Optional per-message data for group key construction
   * @param readReceiptMode - Optional read receipt mode ('on' | 'off' | 'exclude-self')
   */
  async markAsRead(
    instanceId: string,
    chatId: string,
    messageIds: string[],
    messageData?: Array<{ externalId: string; rawPayload?: Record<string, unknown> | null }>,
    readReceiptMode?: 'on' | 'off' | 'exclude-self',
  ): Promise<void> {
    // Check read receipt config
    if (readReceiptMode === 'off') return;
    if (readReceiptMode === 'exclude-self') {
      const ownerJid = this.instances.get(instanceId)?.status?.metadata?.ownerIdentifier;
      if (ownerJid) {
        const normalize = (jid: string) => (jid.split('@')[0] ?? jid).split(':')[0] ?? jid;
        const chatBase = normalize(chatId);
        const ownerBase = normalize(ownerJid);
        // DM with yourself — skip entirely
        if (chatBase === ownerBase) return;
      }
    }

    const sock = this.getSocket(instanceId);
    const jid = toJid(chatId);

    // Handle 'all' marker - marks entire chat as read
    if (messageIds.length === 1 && messageIds[0] === 'all') {
      await this.markChatAsRead(instanceId, chatId, readReceiptMode);
      return;
    }

    const isGroup = jid.endsWith('@g.us');

    // Build a lookup from messageData for group key construction
    const dataByExternalId = new Map((messageData ?? []).map((m) => [m.externalId, m.rawPayload]));

    const lidCache = isGroup ? this.getLidMappingCache(instanceId) : undefined;
    let missingParticipants = 0;

    const keys = messageIds.map((id) => {
      const resolved = this.resolveMessageKey(instanceId, id, jid, isGroup, dataByExternalId, lidCache);
      if (isGroup && !resolved.participant) missingParticipants++;
      return resolved;
    });

    if (missingParticipants > 0) {
      this.logger.warn('Group read receipt missing participant for some messages', {
        instanceId,
        chatId: jid,
        total: messageIds.length,
        missingParticipants,
      });
    }

    // In exclude-self mode, skip read receipts for self-authored messages
    const filteredKeys = readReceiptMode === 'exclude-self' ? keys.filter((k) => !k.fromMe) : keys;
    if (filteredKeys.length === 0) return;

    await sock.readMessages(filteredKeys);
  }

  /**
   * Mark entire chat as read
   *
   * Uses presence update to mark all unread messages in the chat as read.
   *
   * @param instanceId - Instance ID
   * @param chatId - Chat ID (JID or phone number)
   * @param readReceiptMode - Optional per-instance receipt mode; skips sending if 'off' or 'exclude-self' for own chat
   */
  async markChatAsRead(
    instanceId: string,
    chatId: string,
    readReceiptMode?: 'on' | 'off' | 'exclude-self',
  ): Promise<void> {
    // Respect per-instance read receipt mode
    if (readReceiptMode === 'off') return;
    if (readReceiptMode === 'exclude-self') {
      const ownerJid = this.instances.get(instanceId)?.status?.metadata?.ownerIdentifier;
      if (ownerJid) {
        const normalize = (jid: string) => (jid.split('@')[0] ?? jid).split(':')[0] ?? jid;
        if (normalize(chatId) === normalize(ownerJid)) return;
      }
    }

    const sock = this.getSocket(instanceId);
    const jid = toJid(chatId);

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
    await this.humanDelay(instanceId);
    const sock = this.getSocket(instanceId);
    const jid = toJid(chatId);
    await sock.sendMessage(jid, { delete: { remoteJid: jid, id: messageId, fromMe } });
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
    await this.humanDelay(instanceId);
    const sock = this.getSocket(instanceId);
    const jid = toJid(contactJid);
    await sock.updateBlockStatus(jid, 'block');
    this.logger.info('Contact blocked', { instanceId, jid });
  }

  /**
   * B4: Unblock a contact.
   */
  async unblockContact(instanceId: string, contactJid: string): Promise<void> {
    await this.humanDelay(instanceId);
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
    await this.humanDelay(instanceId);
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
    await this.humanDelay(instanceId);
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
    await this.humanDelay(instanceId);
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
    _depth: number,
    messagesPerChat: Map<string, { count: number; oldest: { key: unknown; timestamp: number } | null }>,
  ): Promise<void> {
    for (const anchor of anchors) {
      try {
        this.logger.debug('Fetching history for anchor', {
          instanceId,
          chatJid: anchor.chatJid,
          hasMessageId: !!anchor.messageKey.id,
          timestamp: anchor.timestamp,
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

    const contacts: SyncContact[] = [];
    const seenIds = new Set<string>();

    // Get cached contacts (from contacts.upsert events)
    this.collectFromContactsCache(instanceId, contacts, seenIds, options);
    // Supplement with chat names (from chats.upsert events, fires on reconnect)
    this.collectFromChatNamesCache(instanceId, contacts, seenIds, options);

    options.onProgress?.(contacts.length);

    this.logger.info('Contacts fetch complete', {
      instanceId,
      totalContacts: contacts.length,
    });

    return { totalFetched: contacts.length, contacts };
  }

  /** Collect contacts from contactsCache into the output array */
  private collectFromContactsCache(
    instanceId: string,
    contacts: SyncContact[],
    seenIds: Set<string>,
    options: FetchContactsOptions,
  ): void {
    const cache = this.contactsCache.get(instanceId);
    if (!cache) return;
    for (const contact of cache.values()) {
      contacts.push(contact);
      seenIds.add(contact.platformUserId);
      options.onContact?.(contact);
    }
  }

  /** Collect DM contacts from chatNamesCache that aren't already in contactsCache */
  private collectFromChatNamesCache(
    instanceId: string,
    contacts: SyncContact[],
    seenIds: Set<string>,
    options: FetchContactsOptions,
  ): void {
    const chatNames = this.chatNamesCache.get(instanceId);
    if (!chatNames) return;
    for (const [jid, name] of chatNames) {
      if (seenIds.has(jid) || jid.includes('@g.us') || jid.includes('@broadcast') || jid.includes('@newsletter'))
        continue;
      const contact: SyncContact = {
        platformUserId: jid,
        name,
        phone: jid.includes('@s.whatsapp.net') ? `+${jid.split('@')[0]}` : undefined,
        isGroup: false,
      };
      contacts.push(contact);
      seenIds.add(jid);
      options.onContact?.(contact);
    }
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

    // Prefetch group metadata in background — populates cachedGroupMetadata
    // so the first send to each group doesn't block inside the buffer.
    this.prefetchGroupMetadata(instanceId, sock).catch((err) => {
      this.logger.warn('Failed to prefetch group metadata', { instanceId, error: String(err) });
    });

    // Re-send any outbound messages that were in-flight when the connection dropped.
    // Only fires on reconnects (when the resend store has pending entries) — new
    // connections always have an empty store for this instanceId.
    this.resendUnackedMessages(instanceId).catch((err) => {
      this.logger.warn('Failed to resend unacked messages on reconnect', { instanceId, error: String(err) });
    });
  }

  /**
   * Re-send outbound messages that were in-flight when the connection dropped.
   *
   * On reconnect we query the ResendStore for messages sent in the last
   * RESEND_WINDOW_MS (5 minutes) that have not yet received a server ACK
   * (status >= 2). Each message is re-sent via the normal sendMessage() path,
   * which will re-register it in the resend store with a fresh sentAt. The old
   * entry was already cleaned up by the new send's register() call (it overwrites
   * the same messageId is NOT reused — Baileys generates a new ID, so the old
   * unacked entry stays until cleared or TTL). We clear it explicitly here after
   * querying to avoid double-sends if handleConnected fires more than once.
   *
   * This is intentionally fire-and-forget (called with .catch) to avoid
   * delaying the connection-open flow.
   */
  private async resendUnackedMessages(instanceId: string): Promise<void> {
    const pending = resendStore.getPendingForResend(instanceId);
    if (pending.length === 0) return;

    this.logger.info('Reconnect: found unacked in-flight messages, re-sending', {
      instanceId,
      count: pending.length,
    });

    // Clear the pending list now — each successful resend will register new entries.
    // If resend fails we won't retry again in this cycle (avoids infinite loops).
    for (const [messageId] of pending) {
      resendStore.ack(instanceId, messageId);
    }

    for (const [messageId, { jid, message, sentAt }] of pending) {
      const ageSeconds = Math.round((Date.now() - sentAt) / 1000);
      this.logger.info('Resending unacked message', { instanceId, messageId, jid, ageSeconds });
      try {
        await this.sendMessage(instanceId, message);
      } catch (err) {
        this.logger.error('Failed to resend unacked message', {
          instanceId,
          messageId,
          jid,
          error: String(err),
        });
      }
    }
  }

  /**
   * Prefetch metadata for all known groups on this instance.
   * Runs in background after connection to warm the cachedGroupMetadata cache.
   */
  private async prefetchGroupMetadata(instanceId: string, sock: WASocket): Promise<void> {
    try {
      const groups = await sock.groupFetchAllParticipating();
      let count = 0;
      for (const [jid, metadata] of Object.entries(groups)) {
        this.setGroupMetadataCache(instanceId, jid, metadata);
        // Also update the display-name cache
        let nameCache = this.groupsCache.get(instanceId);
        if (!nameCache) {
          nameCache = new Map();
          this.groupsCache.set(instanceId, nameCache);
        }
        nameCache.set(jid, { subject: metadata.subject, desc: metadata.desc });
        count++;
      }
      this.logger.info('Prefetched group metadata', { instanceId, groups: count });

      // Pre-warm device + session caches for all group participants (#70).
      // This prevents the first send to any group from holding the
      // keys.transaction mutex while fetching devices/sessions over the network.
      await this.prewarmAllGroupCaches(instanceId, sock, groups);
    } catch (err) {
      this.logger.warn('groupFetchAllParticipating failed', { instanceId, error: String(err) });
    }
  }

  /**
   * Pre-warm Baileys' internal device and session caches for a single group.
   *
   * Baileys' `relayMessage` wraps sends in `keys.transaction(work, meId)` which
   * acquires a real mutex. Inside that transaction, `getUSyncDevices` and
   * `assertSessions` make network queries that can take 15-45s, blocking ALL
   * other sends on the same mutex.
   *
   * By calling these functions OUTSIDE the transaction, their results are cached
   * in Baileys' `userDevicesCache` and `peerSessionsCache`. The subsequent
   * `relayMessage` call finds cached data and the mutex is held for milliseconds.
   */
  private async prewarmGroupCaches(instanceId: string, sock: WASocket, groupJid: string): Promise<void> {
    try {
      const t0 = Date.now();
      let metadata = await this.getCachedGroupMetadata(instanceId, groupJid);

      // Cache miss or expired — fetch fresh metadata NOW (outside the transaction).
      // Without this, relayMessage falls back to groupMetadata(jid) INSIDE
      // keys.transaction, holding the meId mutex during a network round-trip.
      if (!metadata?.participants?.length) {
        const fresh = await sock.groupMetadata(groupJid);
        if (fresh?.participants?.length) {
          this.setGroupMetadataCache(instanceId, groupJid, fresh);
          metadata = fresh;
        }
      }

      if (!metadata?.participants?.length) return;

      const participantJids = metadata.participants.map((p) => p.id);

      // 1. Pre-warm device cache — populates userDevicesCache
      const t1 = Date.now();
      const devices = await sock.getUSyncDevices(participantJids, true, false);
      const t2 = Date.now();

      // 2. Pre-warm session cache — populates peerSessionsCache
      const deviceJids = devices.map((d) => d.jid).filter(Boolean);
      if (deviceJids.length) {
        await sock.assertSessions(deviceJids, false);
      }
      const t3 = Date.now();

      this.logger.debug('Pre-warmed group caches', {
        instanceId,
        group: groupJid,
        participants: participantJids.length,
        devices: deviceJids.length,
        getDevicesMs: t2 - t1,
        assertSessionsMs: t3 - t2,
        totalMs: t3 - t0,
      });
    } catch (err) {
      // Best-effort — if pre-warm fails, relayMessage will fetch inside
      // the transaction (slower but still works)
      this.logger.debug('Group cache pre-warm failed (non-fatal)', {
        instanceId,
        group: groupJid,
        error: String(err),
      });
    }
  }

  /**
   * Pre-warm device and session caches for ALL groups after connection.
   * Runs in background during prefetchGroupMetadata.
   */
  private async prewarmAllGroupCaches(
    instanceId: string,
    sock: WASocket,
    groups: Record<string, GroupMetadata>,
  ): Promise<void> {
    try {
      // Collect ALL unique participant JIDs across all groups
      const allParticipantJids = new Set<string>();
      for (const metadata of Object.values(groups)) {
        for (const p of metadata.participants) {
          allParticipantJids.add(p.id);
        }
      }

      if (allParticipantJids.size === 0) return;

      const jids = [...allParticipantJids];
      const configuredDeviceBatchSize = Number.parseInt(process.env.WHATSAPP_PREWARM_DEVICE_BATCH_SIZE ?? '500', 10);
      const deviceBatchSize =
        Number.isFinite(configuredDeviceBatchSize) && configuredDeviceBatchSize > 0 ? configuredDeviceBatchSize : 500;
      const configuredSessionBatchSize = Number.parseInt(process.env.WHATSAPP_PREWARM_SESSION_BATCH_SIZE ?? '500', 10);
      const sessionBatchSize =
        Number.isFinite(configuredSessionBatchSize) && configuredSessionBatchSize > 0
          ? configuredSessionBatchSize
          : 500;

      // 1. Pre-warm device cache in bounded batches to avoid large single requests.
      const devices: Awaited<ReturnType<WASocket['getUSyncDevices']>> = [];
      for (let i = 0; i < jids.length; i += deviceBatchSize) {
        const batch = jids.slice(i, i + deviceBatchSize);
        const batchDevices = await sock.getUSyncDevices(batch, true, false);
        devices.push(...batchDevices);
      }

      // 2. Pre-warm session cache for all device JIDs (also in batches).
      const deviceJids = devices.map((d) => d.jid).filter((jid): jid is string => Boolean(jid));
      for (let i = 0; i < deviceJids.length; i += sessionBatchSize) {
        const batch = deviceJids.slice(i, i + sessionBatchSize);
        await sock.assertSessions(batch, false);
      }

      this.logger.info('Pre-warmed device/session caches for all groups', {
        instanceId,
        participants: jids.length,
        devices: deviceJids.length,
      });
    } catch (err) {
      this.logger.warn('Bulk group cache pre-warm failed (non-fatal)', {
        instanceId,
        error: String(err),
      });
    }
  }

  /**
   * Handle disconnection
   * @internal
   */
  async handleDisconnected(instanceId: string, reason: string, willReconnect: boolean): Promise<void> {
    // Close and cleanup socket to prevent memory leaks
    const sock = this.sockets.get(instanceId);
    if (sock) {
      sock.ev.removeAllListeners('connection.update');
      await closeSocket(sock, false);
      this.sockets.delete(instanceId);
    }
    this.groupMetadataCache.delete(instanceId);

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
   * Resolve contextInfo from text and caption-bearing message types.
   */
  private getMessageContextInfo(rawMessage: WAMessage): proto.IContextInfo | null | undefined {
    const message = rawMessage.message;
    return (
      message?.extendedTextMessage?.contextInfo ??
      message?.imageMessage?.contextInfo ??
      message?.videoMessage?.contextInfo ??
      message?.documentMessage?.contextInfo
    );
  }

  /**
   * Handle incoming message
   * @internal
   */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Message processing requires many content type checks
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
    platformTimestamp?: number,
  ): Promise<void> {
    // Note: We process fromMe messages to capture messages sent from the phone
    // (synced via WhatsApp multi-device). Messages sent via API emit message.sent separately.

    // Cache message key for markAsRead fallback (race condition with auto-read)
    if (externalId && rawMessage.key) {
      const cacheKey = `${instanceId}:${externalId}`;
      this.recentMessageKeys.set(cacheKey, {
        participant: rawMessage.key.participant ?? undefined,
        fromMe: rawMessage.key.fromMe === true,
      });
      // Auto-expire after TTL
      setTimeout(() => this.recentMessageKeys.delete(cacheKey), WhatsAppPlugin.MESSAGE_KEY_CACHE_TTL_MS);
    }

    // Cache sender's pushName for mention resolution (WAMessage.pushName field)
    const senderPushName = (rawMessage as { pushName?: string }).pushName;
    if (senderPushName && from) {
      // LID-first: accept any JID format for cache keying (including @lid)
      // from might be: "555197285829", "555197285829:73", "555197285829@s.whatsapp.net", or "100000001@lid"
      const normalizedFrom = from.includes('@') ? from : `${from.split(':')[0]}@s.whatsapp.net`;

      // Cache the sender's name so it's available when they're mentioned
      this.cacheContactInfo(instanceId, normalizedFrom, senderPushName, undefined);
      this.logger.debug('Cached sender pushName from message', {
        instanceId,
        from: normalizedFrom,
        originalFrom: from,
        pushName: senderPushName,
      });
    }

    // Build extended raw payload with structured content data
    const extendedPayload: Record<string, unknown> = {
      ...(rawMessage as unknown as Record<string, unknown>),
      isFromMe, // Include for message-persistence to use
    };

    // Extract contextInfo fields for reply detection and mention handling.
    // contextInfo.participant = JID of the message being replied to's author.
    // This is surfaced as quotedParticipant so the dispatcher can determine
    // isReplyToBot without having to traverse the Baileys message tree.
    const contextInfo = this.getMessageContextInfo(rawMessage);
    if (contextInfo?.participant) {
      extendedPayload.quotedParticipant = contextInfo.participant;
    }
    if (contextInfo?.mentionedJid && contextInfo.mentionedJid.length > 0) {
      extendedPayload.mentionedJids = contextInfo.mentionedJid;

      // Resolve contact names for all mentioned JIDs using Baileys (pass chatId for group participant lookup)
      this.logger.debug('Processing mentioned JIDs', {
        instanceId,
        chatId,
        mentionedJids: contextInfo.mentionedJid,
      });

      const mentionedContacts: Array<{ jid: string; name?: string }> = [];
      for (const jid of contextInfo.mentionedJid) {
        this.logger.debug('Calling getContactInfo', { instanceId, jid, chatId });
        const contactInfo = await this.getContactInfo(instanceId, jid, chatId);
        this.logger.debug('getContactInfo result', { jid, contactInfo });
        if (contactInfo?.name) {
          mentionedContacts.push({ jid, name: contactInfo.name });
        }
      }
      this.logger.debug('Finished processing mentioned JIDs', {
        instanceId,
        chatId,
        mentionedContactsCount: mentionedContacts.length,
        mentionedContacts,
      });

      if (mentionedContacts.length > 0) {
        extendedPayload.mentionedContacts = mentionedContacts;
      }

      // Check if any mentioned JID refers to this instance (handles LID→phone resolution)
      try {
        const sock = this.sockets.get(instanceId);
        const ownerJid = sock?.user?.id;
        if (ownerJid) {
          const ownerPhone = ownerJid.replace(/:.*$/, '').replace(/@.*$/, '');
          const lidCache = this.getLidMappingCache(instanceId);
          // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: LID mention resolution requires multiple matching strategies
          const isMentioningInstance = contextInfo.mentionedJid.some((jid) => {
            // Direct match
            if (jid === ownerJid) return true;
            // Phone number match (strip :device and @suffix)
            const mentionPhone = jid.replace(/:.*$/, '').replace(/@.*$/, '');
            if (mentionPhone === ownerPhone) return true;
            // LID resolution: look up LID in cache to get phone JID
            if (jid.endsWith('@lid')) {
              const resolvedPhone = lidCache.get(jid);
              if (resolvedPhone) {
                const resolved = resolvedPhone.replace(/:.*$/, '').replace(/@.*$/, '');
                return resolved === ownerPhone;
              }
            }
            return false;
          });
          if (isMentioningInstance) {
            extendedPayload.isMentioningInstance = true;
          }
        }
      } catch {
        // Non-critical: if socket not available, skip instance mention detection
      }
    }

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

    // Journey timing: capture T0 (platform) and T1 (plugin received)
    const timings = platformTimestamp ? this.captureInboundTimings(platformTimestamp) : undefined;

    const correlationId = await this.emitMessageReceived({
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
    externalId: string,
    chatId: string,
    from: string,
    emoji: string,
    targetMessageId: string,
    isFromMe: boolean,
  ): Promise<void> {
    // Note: We process fromMe reactions to capture reactions made from the phone
    // In WhatsApp, empty emoji string = reaction removed

    if (emoji) {
      await this.emitReactionReceived({
        instanceId,
        messageId: targetMessageId,
        chatId,
        from,
        emoji,
        rawPayload: { externalId, isFromMe },
      });
    } else {
      await this.emitReactionRemoved({
        instanceId,
        messageId: targetMessageId,
        chatId,
        from,
        emoji: '', // WhatsApp doesn't tell us which emoji was removed
      });
    }

    // Dual-emit as message.received for backward compatibility
    // Remove this once all consumers migrate to reaction.* events
    if (process.env.OMNI_DUAL_EMIT_REACTIONS !== 'false') {
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
  }

  /**
   * Handle message delivered receipt
   *
   * Updates in-memory ReceiptTracker so callers (e.g. omni-ktb resend logic)
   * can query delivery state without a DB round-trip, then emits
   * message.delivered on the event bus which triggers the DB update via
   * the message-persistence subscriber.
   *
   * @internal
   */
  /**
   * Handle server ACK (status code 2 — message accepted by WhatsApp server).
   *
   * This is the earliest confirmation that a message was received by WhatsApp.
   * We use it to remove the message from the resend store so it won't be
   * retried if the connection drops shortly after (the server already has it).
   *
   * @internal
   */
  handleServerAck(instanceId: string, externalId: string): void {
    resendStore.ack(instanceId, externalId);
  }

  async handleMessageDelivered(instanceId: string, externalId: string, chatId: string): Promise<void> {
    // Ack from resend store — message reached the recipient's device (status >= 3)
    resendStore.ack(instanceId, externalId);

    // Update in-memory tracker
    let tracker = this.receiptTrackers.get(instanceId);
    if (!tracker) {
      tracker = createReceiptTracker();
      this.receiptTrackers.set(instanceId, tracker);
    }
    tracker.update(externalId, 'delivered');

    await this.emitMessageDelivered({
      instanceId,
      externalId,
      chatId,
      deliveredAt: Date.now(),
    });
  }

  /**
   * Handle message read receipt
   *
   * Updates in-memory ReceiptTracker then emits message.read on the event bus
   * which triggers the DB update via the message-persistence subscriber.
   *
   * @internal
   */
  async handleMessageRead(instanceId: string, externalId: string, chatId: string): Promise<void> {
    // Ack from resend store — message was read (status >= 4)
    resendStore.ack(instanceId, externalId);

    // Update in-memory tracker
    let tracker = this.receiptTrackers.get(instanceId);
    if (!tracker) {
      tracker = createReceiptTracker();
      this.receiptTrackers.set(instanceId, tracker);
    }
    tracker.update(externalId, 'read');

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
  handlePresenceUpdate(instanceId: string, chatId: string, userId: string, presence: string, lastSeen?: number): void {
    const meta = { instanceId, channelType: this.id, source: `channel:${this.id}` };

    if (presence === 'composing' || presence === 'recording') {
      this.eventBus
        .publish('presence.typing', { chatId, from: userId, timestamp: Date.now() }, meta)
        .catch((err) => this.logger.warn('Failed to publish presence.typing', { error: String(err) }));
    } else if (presence === 'available') {
      this.eventBus
        .publish('presence.online', { userId, lastSeen }, meta)
        .catch((err) => this.logger.warn('Failed to publish presence.online', { error: String(err) }));
    } else if (presence === 'unavailable') {
      this.eventBus
        .publish('presence.offline', { userId, lastSeen: lastSeen ?? Date.now() }, meta)
        .catch((err) => this.logger.warn('Failed to publish presence.offline', { error: String(err) }));
    }
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

    let unreadCache = this.chatUnreadCache.get(instanceId);
    if (!unreadCache) {
      unreadCache = new Map();
      this.chatUnreadCache.set(instanceId, unreadCache);
    }

    for (const chat of chats) {
      const c = chat as { id?: string; displayName?: string; name?: string; unreadCount?: number };
      if (!c.id) continue;

      // Always cache the JID — even without a name — so getKnownChatJids() discovers all chats
      const name = c.displayName || c.name;
      cache.set(c.id, name ?? c.id);

      // Sync unread count from WhatsApp and cache for periodic refresh
      if (c.unreadCount !== undefined) {
        unreadCache.set(c.id, c.unreadCount);
        this.emitChatUnreadUpdate(instanceId, c.id, c.unreadCount);
      }
    }

    this.logger.debug('Cached chats from upsert', {
      instanceId,
      totalCached: cache.size,
      newBatch: chats.length,
    });
  }

  /**
   * Handle chats update
   * Updates cached chat display names and syncs unread counts from WhatsApp
   * @internal
   */
  handleChatsUpdate(instanceId: string, updates: unknown[]): void {
    let cache = this.chatNamesCache.get(instanceId);
    if (!cache) {
      cache = new Map();
      this.chatNamesCache.set(instanceId, cache);
    }

    let unreadCache = this.chatUnreadCache.get(instanceId);
    if (!unreadCache) {
      unreadCache = new Map();
      this.chatUnreadCache.set(instanceId, unreadCache);
    }

    for (const update of updates) {
      const u = update as { id?: string; displayName?: string; name?: string; unreadCount?: number };
      if (!u.id) continue;

      // Always ensure the JID is in the cache for discovery
      const name = u.displayName || u.name;
      if (name || !cache.has(u.id)) {
        cache.set(u.id, name ?? u.id);
      }

      // Sync unread count from WhatsApp (fires when user reads on phone or new messages arrive)
      if (u.unreadCount !== undefined) {
        unreadCache.set(u.id, u.unreadCount);
        this.emitChatUnreadUpdate(instanceId, u.id, u.unreadCount);
      }
    }
  }

  /**
   * Emit chat unread count update from platform-native data
   * @internal
   */
  private emitChatUnreadUpdate(instanceId: string, chatId: string, unreadCount: number): void {
    this.eventBus
      .publishGeneric(
        'custom.chat.unread-updated',
        { chatId, unreadCount },
        { instanceId, channelType: this.id, source: `channel:${this.id}`, correlationId: `unread-${chatId}` },
      )
      .catch((err) => this.logger.warn('Failed to publish chat unread update', { error: String(err) }));
  }

  /**
   * Handle chats delete
   * @internal
   */
  handleChatsDelete(_instanceId: string, _chatIds: string[]): void {
    // TODO: Emit chats.delete event
  }

  /**
   * Extract LID↔phone mappings from a contact and store bidirectionally
   */
  private extractContactLidMapping(
    instanceId: string,
    contactId: string,
    lid: string | undefined,
    phoneNumber: string | undefined,
  ): void {
    // Case 1: id=phone@s.whatsapp.net + lid=Y → store Y@lid → phone
    if (lid && isUserJid(contactId)) {
      const lidJid = lid.endsWith('@lid') ? lid : `${lid}@lid`;
      this.storeLidMapping(instanceId, lidJid, contactId);
    }
    // Case 2: id=LID@lid + phoneNumber=X → store LID@lid → X@s.whatsapp.net
    if (contactId.endsWith('@lid') && phoneNumber) {
      const phoneJid = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber.replace(/\D/g, '')}@s.whatsapp.net`;
      this.storeLidMapping(instanceId, contactId, phoneJid);
    }
  }

  /**
   * Build a SyncContact from raw Baileys contact data
   */
  private buildSyncContact(c: {
    id: string;
    phoneNumber?: string;
    name?: string;
    notify?: string;
    verifiedName?: string;
    imgUrl?: string | null;
    status?: string;
    lid?: string;
  }): SyncContact {
    const phone = c.phoneNumber || (c.id.includes('@s.whatsapp.net') ? `+${c.id.split('@')[0]}` : undefined);
    return {
      platformUserId: c.id,
      name: c.name || c.notify || c.verifiedName || undefined,
      phone,
      profilePicUrl: c.imgUrl && c.imgUrl !== 'changed' ? c.imgUrl : undefined,
      isGroup: c.id.endsWith('@g.us'),
      isBusiness: !!c.verifiedName,
      metadata: { lid: c.lid, status: c.status, notify: c.notify, verifiedName: c.verifiedName },
    };
  }

  /**
   * Handle contacts upsert (new contacts)
   * @internal
   */
  handleContactsUpsert(instanceId: string, contacts: unknown[]): void {
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

      const syncContact = this.buildSyncContact(c);
      cache.set(c.id, syncContact);

      this.logger.debug('Cached contact from contacts.upsert', {
        instanceId,
        id: c.id,
        name: syncContact.name,
        phone: syncContact.phone,
        hasLid: !!c.lid,
      });

      this.extractContactLidMapping(instanceId, c.id, c.lid, c.phoneNumber);
    }

    this.logger.debug('Contacts upserted', { instanceId, count: contacts.length, cacheSize: cache.size });
    this.publishLidMappings(instanceId);
    this.publishContactNames(instanceId);
  }

  /**
   * Publish cached contact names for an instance to the event bus for chat name persistence
   */
  private publishContactNames(instanceId: string): void {
    const contactCache = this.contactsCache.get(instanceId);
    if (!contactCache || contactCache.size === 0) return;

    const names: Array<{ jid: string; name: string }> = [];
    for (const [jid, contact] of contactCache) {
      if (contact.name && !jid.includes('@g.us') && !jid.includes('@broadcast')) {
        names.push({ jid, name: contact.name });
      }
    }
    if (names.length === 0) return;

    this.eventBus
      .publishGeneric(
        'custom.contacts.names',
        { names },
        {
          instanceId,
          channelType: this.id,
          source: `channel:${this.id}`,
          correlationId: `contacts-names-${instanceId}`,
        },
      )
      .catch((err) => this.logger.warn('Failed to publish contact names', { error: String(err) }));
  }

  /**
   * Publish all cached LID mappings for an instance to the event bus for DB persistence
   */
  private publishLidMappings(instanceId: string): void {
    const lidCache = this.lidMappingCache.get(instanceId);
    if (!lidCache || lidCache.size === 0) return;

    const mappings = Array.from(lidCache.entries()).map(([lidJid, phoneJid]) => ({ lidJid, phoneJid }));
    this.eventBus
      .publishGeneric(
        'custom.lid-mapping.batch',
        { mappings },
        { instanceId, channelType: this.id, source: `channel:${this.id}`, correlationId: `lid-batch-${instanceId}` },
      )
      .catch((err) => this.logger.warn('Failed to publish LID mappings', { error: String(err) }));
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
      const g = group as GroupMetadata;
      if (g.id && g.subject) {
        cache.set(g.id, { subject: g.subject, desc: g.desc });
        // Also populate full metadata cache if it has participants
        if (g.participants?.length) {
          this.setGroupMetadataCache(instanceId, g.id, g);
        }
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

      // Invalidate full metadata cache — subject/desc changed, participants may have too
      this.invalidateGroupMetadataCache(instanceId, u.id);
    }
  }

  /**
   * Handle group participants update (join/leave/promote/demote)
   * Invalidates cached group metadata so next send fetches fresh participants.
   * @internal
   */
  handleGroupParticipantsUpdate(instanceId: string, update: unknown): void {
    const u = update as { id?: string; action?: string; participants?: { id: string }[] };
    if (u?.id) {
      this.invalidateGroupMetadataCache(instanceId, u.id);
      this.logger.debug('Invalidated group metadata cache (participants changed)', {
        instanceId,
        groupId: u.id,
        action: u.action,
      });
    }
  }

  // ─── Group metadata cache helpers (for cachedGroupMetadata callback) ───

  /** Store full GroupMetadata in the per-instance cache */
  private setGroupMetadataCache(instanceId: string, jid: string, metadata: GroupMetadata): void {
    let cache = this.groupMetadataCache.get(instanceId);
    if (!cache) {
      cache = new Map();
      this.groupMetadataCache.set(instanceId, cache);
    }
    cache.set(jid, { metadata, cachedAt: Date.now() });
  }

  /** Invalidate a single group's metadata (e.g., after participant change) */
  private invalidateGroupMetadataCache(instanceId: string, jid: string): void {
    this.groupMetadataCache.get(instanceId)?.delete(jid);
  }

  /**
   * Callback passed to `makeWASocket({ cachedGroupMetadata })`.
   *
   * Returns cached GroupMetadata if fresh (< TTL), otherwise undefined
   * so Baileys fetches it. When Baileys fetches inside the buffer, the
   * result is automatically available for subsequent calls.
   */
  private async getCachedGroupMetadata(instanceId: string, jid: string): Promise<GroupMetadata | undefined> {
    const entry = this.groupMetadataCache.get(instanceId)?.get(jid);
    if (!entry) return undefined;

    const age = Date.now() - entry.cachedAt;
    if (age > WhatsAppPlugin.GROUP_CACHE_TTL_MS) {
      // Expired — remove and let Baileys fetch fresh
      this.groupMetadataCache.get(instanceId)?.delete(jid);
      return undefined;
    }

    return entry.metadata;
  }

  /**
   * Handle group join request
   * @internal
   */
  handleGroupJoinRequest(_instanceId: string, _request: unknown): void {
    // TODO: Emit group.join-request event
  }

  /**
   * Handle message receipt update (message-receipt.update from Baileys)
   *
   * This event carries per-user read/delivery timestamps for group and 1:1 chats.
   * The receipt object has three optional timestamp fields (in Baileys seconds):
   *   - readTimestamp / playedTimestamp → message was read or voice note played
   *   - receiptTimestamp → message was delivered to the recipient's device
   *
   * We derive the effective status via mapStatusCode so the same enum path
   * is used as in the messages.update handler (processStatusUpdate), then
   * delegate to handleMessageRead / handleMessageDelivered which:
   *   1. Update the in-memory ReceiptTracker
   *   2. Emit message.read / message.delivered on the event bus
   *   3. Trigger the DB deliveryStatus update via message-persistence subscriber
   *
   * @internal
   */
  async handleMessageReceiptUpdate(instanceId: string, update: unknown): Promise<void> {
    const u = update as {
      key?: { id?: string; remoteJid?: string };
      receipt?: { readTimestamp?: number; playedTimestamp?: number; receiptTimestamp?: number };
    };
    const messageExternalId = u.key?.id;
    const chatId = u.key?.remoteJid;
    if (!messageExternalId || !chatId) return;

    const receipt = u.receipt;
    if (!receipt) return;

    // Determine effective status from receipt timestamps, then map to our enum.
    // readTimestamp / playedTimestamp → status code 4 (read) or 5 (played)
    // receiptTimestamp               → status code 3 (delivered)
    // No timestamp fields → unknown delivery, skip.
    let statusCode: number;

    if (receipt.playedTimestamp) {
      statusCode = 5; // played (voice note)
    } else if (receipt.readTimestamp) {
      statusCode = 4; // read
    } else if (receipt.receiptTimestamp) {
      statusCode = 3; // delivered
    } else {
      return; // nothing actionable
    }

    const mappedStatus = mapStatusCode(statusCode);

    if (isRead(mappedStatus)) {
      // Covers status codes 4 (read) and 5 (played)
      await this.handleMessageRead(instanceId, messageExternalId, chatId);
    } else if (isDelivered(mappedStatus)) {
      // Covers status code 3 (delivered)
      await this.handleMessageDelivered(instanceId, messageExternalId, chatId);
    }
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
      chatCount: history.chats.length,
      progress: progress ?? 'unknown',
      isLatest,
      syncType,
    });

    // Process chats from history sync — ensures all chats are discoverable
    if (history.chats.length > 0) {
      this.handleChatsUpsert(instanceId, history.chats);
    }

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
    if (!msg.key?.id || !msg.key?.remoteJid) {
      this.logger.debug('Skipping history message without key', { instanceId, hasKey: !!msg.key });
      return;
    }

    const timestamp = this.getMessageTimestamp(msg);

    // Filter by date range if specified
    if (syncState?.since && timestamp < syncState.since) {
      this.logger.debug('Skipping history message - before since', {
        instanceId,
        messageId: msg.key.id,
        chatId: msg.key.remoteJid,
        timestamp: new Date(timestamp).toISOString(),
        since: new Date(syncState.since).toISOString(),
      });
      return;
    }
    if (syncState?.until && timestamp > syncState.until) {
      this.logger.debug('Skipping history message - after until', {
        instanceId,
        messageId: msg.key.id,
        chatId: msg.key.remoteJid,
        timestamp: new Date(timestamp).toISOString(),
        until: new Date(syncState.until).toISOString(),
      });
      return;
    }

    // Extract basic content info
    const content = this.extractHistoryMessageContent(msg);
    if (!content) {
      this.logger.debug('Skipping history message - no extractable content', {
        instanceId,
        messageId: msg.key.id,
        chatId: msg.key.remoteJid,
        messageKeys: Object.keys(msg.message || {}),
      });
      return;
    }

    // Download media if present (same as realtime messages)
    const mediaResult = await tryDownloadMedia(msg, instanceId, msg.key.id, this.config.apiBaseUrl);
    if (mediaResult) {
      content.mediaUrl = mediaResult.mediaUrl;
      // Note: content doesn't have mediaLocalPath field, but mediaUrl is enough for storage
    }

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

      this.logger.debug('Emitting history message from initial sync', {
        instanceId,
        messageId: msg.key.id,
        chatId,
        from: senderId,
        contentType: content.type,
        isFromMe,
      });

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
        isHistorySync: true,
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
      // Try chatNamesCache first (from chats.upsert), then contactsCache (from contacts.upsert)
      const chatName = this.chatNamesCache.get(instanceId)?.get(chatId);
      if (chatName) {
        payload.chatName = chatName;
      } else {
        const contact = this.contactsCache.get(instanceId)?.get(chatId);
        if (contact?.name) {
          payload.chatName = contact.name;
        }
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
    // Report progress via sync state callbacks (explicit sync jobs)
    if (syncState?.onProgress && progress !== undefined && progress !== null) {
      syncState.onProgress(syncState.totalFetched, progress);
    }

    // Track and publish history-push progress via NATS (initial connection push)
    if (!syncState) {
      const prevCount = this.historyPushFetchCount.get(instanceId) ?? 0;
      const totalFetched = prevCount + messageCount;
      this.historyPushFetchCount.set(instanceId, totalFetched);

      const meta = { instanceId, channelType: this.id };

      // Publish sync.progress event
      this.eventBus
        .publishGeneric(
          'sync.progress' as const,
          { instanceId, jobType: 'history-push', fetched: totalFetched, progress: progress ?? 0 },
          meta,
        )
        .catch((err) => this.logger.warn('Failed to publish sync.progress for history-push', { error: String(err) }));

      // Publish sync.completed when Baileys signals completion
      if (isLatest || progress === 100) {
        this.eventBus
          .publishGeneric('sync.completed' as const, { instanceId, jobType: 'history-push', totalFetched }, meta)
          .catch((err) =>
            this.logger.warn('Failed to publish sync.completed for history-push', { error: String(err) }),
          );
        this.historyPushFetchCount.delete(instanceId);
      }
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
  // Medium Features (C1-C7)
  // ─────────────────────────────────────────────────────────────

  /**
   * C1: Modify chat (archive/unarchive/pin/unpin/mute/unmute)
   *
   * @param instanceId - Instance ID
   * @param chatId - Chat JID or phone number
   * @param action - One of: archive, unarchive, pin, unpin, mute, unmute
   * @param value - For mute: duration in ms (default 8h). Ignored for other actions.
   */
  async chatModifyAction(
    instanceId: string,
    chatId: string,
    action: string,
    value?: number,
    lastMessageKey?: { id: string; fromMe?: boolean; timestamp?: number; participant?: string },
  ): Promise<void> {
    await this.humanDelay(instanceId);
    const sock = this.getSocket(instanceId);
    const jid = toJid(chatId);

    // Build lastMessages array for actions that require it (archive/unarchive)
    // Baileys requires `participant` in the key for group messages not sent by us
    const lastMessages = lastMessageKey
      ? [
          {
            key: {
              remoteJid: jid,
              id: lastMessageKey.id,
              fromMe: lastMessageKey.fromMe ?? false,
              ...(lastMessageKey.participant ? { participant: lastMessageKey.participant } : {}),
            },
            messageTimestamp: lastMessageKey.timestamp ?? Math.floor(Date.now() / 1000),
          },
        ]
      : [{ key: { remoteJid: jid, id: '0', fromMe: false }, messageTimestamp: 0 }];

    let modification: Record<string, unknown>;
    switch (action) {
      case 'archive':
        modification = { archive: true, lastMessages };
        break;
      case 'unarchive':
        modification = { archive: false, lastMessages };
        break;
      case 'pin':
        modification = { pin: true };
        break;
      case 'unpin':
        modification = { pin: false };
        break;
      case 'mute':
        modification = { mute: value ? Date.now() + value : Date.now() + 8 * 60 * 60 * 1000 };
        break;
      case 'unmute':
        modification = { mute: null };
        break;
      default:
        throw new WhatsAppError(ErrorCode.UNKNOWN, `Unknown chat action: ${action}`);
    }

    await (sock.chatModify as (mod: unknown, jid: string) => Promise<void>)(modification, jid);
    this.logger.info('Chat modified', { instanceId, chatId: jid, action });
  }

  /**
   * C2: Update profile picture for the connected account
   *
   * @param instanceId - Instance ID
   * @param imageBuffer - Image data as Buffer
   */
  async updateProfilePicture(instanceId: string, imageBuffer: Buffer): Promise<void> {
    await this.humanDelay(instanceId);
    const sock = this.getSocket(instanceId);
    const user = sock.user;
    if (!user) {
      throw new WhatsAppError(ErrorCode.NOT_CONNECTED, `Instance ${instanceId} not fully connected`);
    }
    await sock.updateProfilePicture(user.id, imageBuffer);
    this.logger.info('Profile picture updated', { instanceId });
  }

  /**
   * Update a group's profile picture.
   *
   * @param instanceId - Instance ID
   * @param groupJid - Group JID
   * @param imageBuffer - Image data as Buffer
   */
  async updateGroupPicture(instanceId: string, groupJid: string, imageBuffer: Buffer): Promise<void> {
    await this.humanDelay(instanceId);
    const sock = this.getSocket(instanceId);
    const jid = toJid(groupJid);
    await sock.updateProfilePicture(jid, imageBuffer);
    this.logger.info('Group picture updated', { instanceId, groupJid: jid });
  }

  /**
   * C2: Remove profile picture for the connected account
   *
   * @param instanceId - Instance ID
   */
  async removeProfilePicture(instanceId: string): Promise<void> {
    await this.humanDelay(instanceId);
    const sock = this.getSocket(instanceId);
    const user = sock.user;
    if (!user) {
      throw new WhatsAppError(ErrorCode.NOT_CONNECTED, `Instance ${instanceId} not fully connected`);
    }
    await sock.removeProfilePicture(user.id);
    this.logger.info('Profile picture removed', { instanceId });
  }

  /**
   * C3: Get group invite code
   *
   * @param instanceId - Instance ID
   * @param groupJid - Group JID
   * @returns Invite code string
   */
  async getGroupInviteCode(instanceId: string, groupJid: string): Promise<string> {
    await this.humanDelay(instanceId);
    const sock = this.getSocket(instanceId);
    const jid = toJid(groupJid);
    const code = await sock.groupInviteCode(jid);
    return code ?? '';
  }

  /**
   * C3: Revoke group invite link and generate a new one
   *
   * @param instanceId - Instance ID
   * @param groupJid - Group JID
   * @returns New invite code string
   */
  async revokeGroupInvite(instanceId: string, groupJid: string): Promise<string> {
    await this.humanDelay(instanceId);
    const sock = this.getSocket(instanceId);
    const jid = toJid(groupJid);
    const newCode = await sock.groupRevokeInvite(jid);
    return newCode ?? '';
  }

  /**
   * C3: Join a group via invite code
   *
   * @param instanceId - Instance ID
   * @param code - Invite code (the part after chat.whatsapp.com/)
   * @returns The JID of the joined group
   */
  async joinGroup(instanceId: string, code: string): Promise<string> {
    await this.humanDelay(instanceId);
    const sock = this.getSocket(instanceId);
    const groupJid = await sock.groupAcceptInvite(code);
    return groupJid ?? '';
  }

  /**
   * Create a new WhatsApp group
   *
   * @param instanceId - Instance ID
   * @param subject - Group name/subject (max 100 chars)
   * @param participants - Array of phone numbers or JIDs to add
   * @returns Group metadata including JID, subject, participants
   */
  async groupCreate(
    instanceId: string,
    subject: string,
    participants: string[],
  ): Promise<{
    id: string;
    subject: string;
    owner: string | undefined;
    creation: number | undefined;
    participants: Array<{ id: string; admin: string | null }>;
  }> {
    await this.humanDelay(instanceId);
    const sock = this.getSocket(instanceId);
    const participantJids = participants.map((p) => toJid(p));
    this.logger.info('Creating group', { instanceId, subject, participantCount: participantJids.length });
    const metadata = await sock.groupCreate(subject, participantJids);
    this.logger.info('Group created', { instanceId, groupId: metadata.id, subject: metadata.subject });
    return {
      id: metadata.id,
      subject: metadata.subject,
      owner: metadata.owner,
      creation: metadata.creation,
      participants: metadata.participants.map((p) => ({
        id: p.id,
        admin: p.admin ?? null,
      })),
    };
  }

  /**
   * C4: Fetch the blocklist for the connected account
   *
  /**
   * C5: Fetch privacy settings for the connected account
   *
   * @param instanceId - Instance ID
   * @returns Privacy settings object
   */
  async fetchPrivacySettings(instanceId: string): Promise<Record<string, unknown>> {
    await this.humanDelay(instanceId);
    const sock = this.getSocket(instanceId);
    const settings = await sock.fetchPrivacySettings(true);
    return (settings as Record<string, unknown>) ?? {};
  }

  /**
   * C6: Reject an incoming call
   *
   * @param instanceId - Instance ID
   * @param callId - Call ID from the call event
   * @param callFrom - JID of the caller
   */
  async rejectCall(instanceId: string, callId: string, callFrom: string): Promise<void> {
    await this.humanDelay(instanceId);
    const sock = this.getSocket(instanceId);
    await sock.rejectCall(callId, callFrom);
    this.logger.info('Call rejected', { instanceId, callId, callFrom });
  }

  /**
   * C7: Edit a previously sent message
   *
   * @param instanceId - Instance ID
   * @param chatJid - Chat JID where the message was sent
   * @param messageId - External message ID to edit
   * @param newText - New text content
   */
  async editMessage(
    instanceId: string,
    chatJid: string,
    messageId: string,
    newText: string,
    fromMe = true,
  ): Promise<void> {
    await this.humanDelay(instanceId);
    const sock = this.getSocket(instanceId);
    const jid = toJid(chatJid);
    await sock.sendMessage(jid, {
      edit: { remoteJid: jid, id: messageId, fromMe } as unknown as proto.IMessageKey,
      text: newText,
    });
    this.logger.info('Message edited', { instanceId, chatJid: jid, messageId, fromMe });
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
