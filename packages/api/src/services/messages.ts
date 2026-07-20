/**
 * Message service - manages unified message model (source of truth)
 *
 * Messages are the source of truth for all message data.
 * Event links are OPTIONAL - synced messages have no events.
 *
 * @see unified-messages wish
 */

import type { EventBus } from '@omni/core';
import { NotFoundError } from '@omni/core';
import type { Database } from '@omni/db';
import {
  type DeliveryStatus,
  type EditHistoryEntry,
  type Message,
  type MessageSource,
  type MessageStatus,
  type MessageType,
  type NewMessage,
  type ReactionInfo,
  chats,
  messages,
} from '@omni/db';
import { and, count, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';

export interface ListMessagesOptions {
  chatId?: string;
  instanceIds?: string[];
  source?: MessageSource[];
  messageType?: MessageType[];
  status?: MessageStatus[];
  hasMedia?: boolean;
  senderPersonId?: string;
  externalId?: string;
  since?: Date;
  until?: Date;
  search?: string;
  includeHidden?: boolean;
  limit?: number;
  cursor?: string;
}

export interface CreateMessageOptions {
  chatId: string;
  externalId: string;
  source: MessageSource;
  messageType: MessageType;
  textContent?: string;
  platformTimestamp: Date;
  // Sender info
  senderPersonId?: string;
  senderPlatformIdentityId?: string;
  senderPlatformUserId?: string;
  senderDisplayName?: string;
  isFromMe?: boolean;
  // Media
  hasMedia?: boolean;
  mediaMimeType?: string;
  mediaUrl?: string;
  mediaLocalPath?: string;
  mediaMetadata?: Record<string, unknown>;
  // Pre-processed content
  transcription?: string;
  imageDescription?: string;
  videoDescription?: string;
  documentExtraction?: string;
  // Reply/Forward
  replyToMessageId?: string;
  replyToExternalId?: string;
  quotedText?: string;
  quotedSenderName?: string;
  isForwarded?: boolean;
  forwardedFromExternalId?: string;
  // Actor FK
  senderAgentId?: string | null;
  // Raw data
  rawPayload?: Record<string, unknown>;
  // Event links (optional - only for realtime)
  originalEventId?: string;
}

/** Media type badges for message previews */
const MEDIA_BADGES: Record<string, string> = {
  image: '[Image]',
  audio: '[Audio]',
  video: '[Video]',
  document: '[Document]',
  sticker: '[Sticker]',
  contact: '[Contact]',
  location: '[Location]',
  poll: '[Poll]',
};

/** Build a rich preview string for the chat's lastMessagePreview */
function buildMessagePreview(options: CreateMessageOptions): string {
  const sender = options.isFromMe ? 'You' : (options.senderDisplayName ?? null);

  // Build content part
  let content: string;
  const mediaDesc =
    options.transcription ?? options.imageDescription ?? options.videoDescription ?? options.documentExtraction;
  const badge = MEDIA_BADGES[options.messageType];

  if (options.textContent && !badge) {
    // Pure text message
    content = options.textContent;
  } else if (badge) {
    // Media message — show badge + description or caption
    content = mediaDesc ? `${badge} ${mediaDesc}` : options.textContent ? `${badge} ${options.textContent}` : badge;
  } else {
    content = options.textContent ?? '[Media]';
  }

  // Prefix with sender name
  const preview = sender ? `${sender}: ${content}` : content;
  return preview.substring(0, 500);
}

export class MessageService {
  constructor(
    private db: Database,
    private eventBus: EventBus | null,
  ) {}

  /**
   * List messages with filtering and pagination
   */
  private buildListConditions(options: ListMessagesOptions) {
    const {
      chatId,
      instanceIds,
      source,
      messageType,
      status,
      hasMedia,
      senderPersonId,
      externalId,
      since,
      until,
      search,
      includeHidden = false,
      cursor,
    } = options;

    const conditions = [];
    if (chatId) conditions.push(eq(messages.chatId, chatId));
    // undefined = no scoping, [] = deny-all, [...ids] = filter to those
    if (Array.isArray(instanceIds)) {
      conditions.push(instanceIds.length > 0 ? inArray(chats.instanceId, instanceIds) : sql`1 = 0`);
    }
    if (!includeHidden) conditions.push(sql`chats.visibility = 'visible'`);
    if (source?.length) conditions.push(inArray(messages.source, source));
    if (messageType?.length) conditions.push(inArray(messages.messageType, messageType));
    if (status?.length) conditions.push(inArray(messages.status, status));
    if (hasMedia !== undefined) conditions.push(eq(messages.hasMedia, hasMedia));
    if (senderPersonId) conditions.push(eq(messages.senderPersonId, senderPersonId));
    if (externalId) conditions.push(eq(messages.externalId, externalId));
    if (since) conditions.push(gte(messages.platformTimestamp, since));
    if (until) conditions.push(lte(messages.platformTimestamp, until));
    if (search) {
      const searchPattern = `%${search}%`;
      conditions.push(
        or(
          ilike(messages.textContent, searchPattern),
          ilike(messages.transcription, searchPattern),
          ilike(messages.imageDescription, searchPattern),
          ilike(messages.documentExtraction, searchPattern),
        ),
      );
    }
    conditions.push(sql`${messages.deletedAt} IS NULL`);
    if (cursor) conditions.push(sql`${messages.platformTimestamp} < ${cursor}`);

    return conditions;
  }

  async list(options: ListMessagesOptions = {}): Promise<{
    items: Message[];
    hasMore: boolean;
    cursor?: string;
  }> {
    const { instanceIds, includeHidden = false, limit = 50 } = options;
    const needsJoin = Array.isArray(instanceIds) || !includeHidden;
    const conditions = this.buildListConditions(options);

    const baseQuery = this.db.select({ messages }).from(messages);
    const query = needsJoin ? baseQuery.innerJoin(chats, eq(messages.chatId, chats.id)) : baseQuery;

    const rows = await query
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(messages.platformTimestamp))
      .limit(limit + 1);

    const items = rows.map((row) => row.messages);

    const hasMore = items.length > limit;
    if (hasMore) {
      items.pop();
    }

    const lastItem = items[items.length - 1];
    return {
      items,
      hasMore,
      cursor: lastItem?.platformTimestamp.toISOString(),
    };
  }

  /**
   * Count total messages matching filters
   */
  async count(options: Omit<ListMessagesOptions, 'limit' | 'cursor'> = {}): Promise<number> {
    const { instanceIds, includeHidden = false } = options;
    const needsJoin = Array.isArray(instanceIds) || !includeHidden;
    const conditions = this.buildListConditions(options as ListMessagesOptions);

    const baseQuery = this.db.select({ count: count() }).from(messages);
    const query = needsJoin ? baseQuery.innerJoin(chats, eq(messages.chatId, chats.id)) : baseQuery;

    const result = await query.where(conditions.length ? and(...conditions) : undefined);

    return result[0]?.count ?? 0;
  }

  /**
   * Get messages for a chat (chronological order)
   */
  async getChatMessages(
    chatId: string,
    options: { limit?: number; before?: Date; after?: Date; mediaOnly?: boolean } = {},
  ): Promise<Message[]> {
    const { limit = 100, before, after, mediaOnly } = options;
    const conditions = [eq(messages.chatId, chatId), sql`${messages.deletedAt} IS NULL`];

    if (before) {
      conditions.push(lte(messages.platformTimestamp, before));
    }

    if (after) {
      conditions.push(gte(messages.platformTimestamp, after));
    }

    if (mediaOnly) {
      conditions.push(eq(messages.hasMedia, true));
    }

    return this.db
      .select()
      .from(messages)
      .where(and(...conditions))
      .orderBy(desc(messages.platformTimestamp))
      .limit(limit);
  }

  /**
   * Get message by ID
   */
  async getById(id: string): Promise<Message> {
    const [result] = await this.db.select().from(messages).where(eq(messages.id, id)).limit(1);

    if (!result) {
      throw new NotFoundError('Message', id);
    }

    return result;
  }

  /**
   * Check if the bot has participated in a specific thread.
   * Matches two cases:
   *  1. Bot replied in the thread (replyToExternalId == threadTs)
   *  2. Bot started the thread (externalId == threadTs, root message)
   */
  async hasBotRepliedInThread(chatId: string, threadExternalId: string): Promise<boolean> {
    const [result] = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.chatId, chatId),
          eq(messages.isFromMe, true),
          or(eq(messages.replyToExternalId, threadExternalId), eq(messages.externalId, threadExternalId)),
        ),
      )
      .limit(1);
    return !!result;
  }

  /** Get message by external ID and chat */
  async getByExternalId(chatId: string, externalId: string): Promise<Message | null> {
    const [result] = await this.db
      .select()
      .from(messages)
      .where(and(eq(messages.chatId, chatId), eq(messages.externalId, externalId)))
      .limit(1);

    return result ?? null;
  }

  /**
   * Get an outbound message by provider alias captured in raw_payload.
   *
   * Gupshup native replies may reference provider-generated ids
   * (replyContext.id / gsId / internalId) instead of Omni's external_id. When
   * the send path preserved the provider response, search those aliases before
   * giving up on quoted-message context.
   */
  async findByProviderAlias(chatId: string, aliases: string[]): Promise<Message | null> {
    const candidates = [
      ...new Set(
        aliases.filter((alias) => typeof alias === 'string' && alias.length > 0).map((alias) => alias.slice(0, 255)),
      ),
    ].slice(0, 8);
    if (candidates.length === 0) return null;

    const aliasConditions = candidates.flatMap((alias) => [
      eq(messages.externalId, alias),
      sql`${messages.rawPayload}->'gupshupResponse'->>'messageId' = ${alias}`,
      sql`${messages.rawPayload}->'gupshupResponse'->>'gsId' = ${alias}`,
      sql`${messages.rawPayload}->'gupshupResponse'->>'id' = ${alias}`,
      sql`${messages.rawPayload}->'gupshupResponse'->'messageIds' @> ${JSON.stringify([alias])}::jsonb`,
      sql`${messages.rawPayload}->'gupshupProviderAliases' @> ${JSON.stringify([alias])}::jsonb`,
    ]);

    const [result] = await this.db
      .select()
      .from(messages)
      .where(and(eq(messages.chatId, chatId), eq(messages.isFromMe, true), or(...aliasConditions)))
      .orderBy(desc(messages.platformTimestamp))
      .limit(1);

    return result ?? null;
  }

  /**
   * Best-effort fallback for providers that expose native reply ids on inbound
   * replies but do not return those ids on outbound sends. This is deliberately
   * scoped to recent outbound bot messages in the same chat and is used only
   * after exact external-id and provider-alias lookup fail.
   */
  async findRecentOutboundBefore(chatId: string, before: Date, inboundText?: string): Promise<Message | null> {
    // Gupshup's native reply payload timestamp is second-precision while our
    // outbound rows retain millisecond precision. A customer can reply in the
    // same second as the outbound send; allow a tiny future grace window so the
    // just-quoted outbound is not accidentally excluded in favor of older plans.
    const upperBound = new Date(before.getTime() + 2000);

    const rows = await this.db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.chatId, chatId),
          eq(messages.isFromMe, true),
          lte(messages.platformTimestamp, upperBound),
          sql`${messages.deletedAt} IS NULL`,
        ),
      )
      .orderBy(desc(messages.platformTimestamp))
      .limit(8);

    if (rows.length === 0) return null;

    const hint = (inboundText ?? '').toLocaleLowerCase('pt-BR');
    const wantsPlanLikeTarget = /\b(esse|essa|este|esta|op[cç][aã]o|plano|quero|gostei)\b/i.test(hint);
    if (!wantsPlanLikeTarget) return rows[0] ?? null;

    const score = (message: Message): number => {
      const text = (message.textContent ?? '').toLocaleLowerCase('pt-BR');
      let value = 0;
      if (/op[cç][aã]o|plano/.test(text)) value += 4;
      if (/r\$|mensal|coparticipa|enfermaria|apartamento|ambulatorial|notrelife|hapvida/.test(text)) value += 3;
      if (/\?\s*$/.test(text) && !/r\$/.test(text)) value -= 2;
      return value;
    };

    const ranked = rows
      .map((message) => ({ message, score: score(message) }))
      .sort(
        (a, b) => b.score - a.score || b.message.platformTimestamp.getTime() - a.message.platformTimestamp.getTime(),
      );

    // Ambiguity guard: when two or more candidates tie at the top score AND
    // were sent moments apart (same burst — e.g. two product cards delivered
    // back to back), picking the newest is a coin flip: quoting the WRONG card
    // silently corrupts the reply context downstream (the agent locks onto an
    // option the customer never chose). Returning null is strictly safer — the
    // agent sees no quote and asks which option was meant. Ties against much
    // OLDER messages keep the recency preference (an hours-old duplicate is
    // almost never the quote target; see the second-precision grace test).
    const AMBIGUOUS_TIE_WINDOW_MS = 5 * 60_000;
    const top = ranked[0];
    if (!top) return null;
    const ambiguousTie =
      top.score > 0 &&
      ranked.some(
        (entry, index) =>
          index > 0 &&
          entry.score === top.score &&
          Math.abs(top.message.platformTimestamp.getTime() - entry.message.platformTimestamp.getTime()) <=
            AMBIGUOUS_TIE_WINDOW_MS,
      );
    if (ambiguousTie) return null;
    return top.message;
  }

  /** Get multiple messages by external IDs in a single query */
  async getByExternalIds(chatId: string, externalIds: string[]): Promise<Message[]> {
    if (externalIds.length === 0) return [];
    return this.db
      .select()
      .from(messages)
      .where(and(eq(messages.chatId, chatId), inArray(messages.externalId, externalIds)));
  }

  /**
   * Create a new message
   */
  async create(options: CreateMessageOptions): Promise<Message> {
    return this.db.transaction(async (tx) => {
      // Insert message
      const [created] = await tx
        .insert(messages)
        .values({
          chatId: options.chatId,
          externalId: options.externalId,
          source: options.source,
          messageType: options.messageType,
          textContent: options.textContent,
          platformTimestamp: options.platformTimestamp,
          // Sender
          senderPersonId: options.senderPersonId,
          senderPlatformIdentityId: options.senderPlatformIdentityId,
          senderPlatformUserId: options.senderPlatformUserId,
          senderDisplayName: options.senderDisplayName,
          senderAgentId: options.senderAgentId ?? undefined,
          isFromMe: options.isFromMe ?? false,
          // Media
          hasMedia: options.hasMedia ?? false,
          mediaMimeType: options.mediaMimeType,
          mediaUrl: options.mediaUrl,
          mediaLocalPath: options.mediaLocalPath,
          mediaMetadata: options.mediaMetadata,
          // Pre-processed content
          transcription: options.transcription,
          imageDescription: options.imageDescription,
          videoDescription: options.videoDescription,
          documentExtraction: options.documentExtraction,
          // Reply/Forward
          replyToMessageId: options.replyToMessageId,
          replyToExternalId: options.replyToExternalId,
          quotedText: options.quotedText,
          quotedSenderName: options.quotedSenderName,
          isForwarded: options.isForwarded ?? false,
          forwardedFromExternalId: options.forwardedFromExternalId,
          // Raw data
          rawPayload: options.rawPayload,
          // Event links
          originalEventId: options.originalEventId,
          latestEventId: options.originalEventId,
        })
        .returning();

      if (!created) {
        throw new Error('Failed to create message');
      }

      // Update chat stats (in same transaction - ATOMIC)
      const preview = buildMessagePreview(options);
      await tx
        .update(chats)
        .set({
          lastMessageAt: options.platformTimestamp,
          lastMessagePreview: preview,
          messageCount: sql`${chats.messageCount} + 1`,
          // Unread count is managed by platform-native events (chat.unread-updated)
          updatedAt: new Date(),
        })
        .where(eq(chats.id, options.chatId));

      return created;
    });
  }

  /**
   * Build update data for missing fields from Baileys (source of truth)
   */
  private buildMissingFieldsUpdate(
    existing: Message,
    defaults: Omit<CreateMessageOptions, 'chatId' | 'externalId'>,
  ): Partial<NewMessage> | null {
    const updateData: Partial<NewMessage> = {};
    let hasUpdates = false;

    if (!existing.mediaUrl && defaults.mediaUrl) {
      updateData.mediaUrl = defaults.mediaUrl;
      hasUpdates = true;
    }
    if (!existing.mediaLocalPath && defaults.mediaLocalPath) {
      updateData.mediaLocalPath = defaults.mediaLocalPath;
      hasUpdates = true;
    }
    if (!existing.mediaMimeType && defaults.mediaMimeType) {
      updateData.mediaMimeType = defaults.mediaMimeType;
      hasUpdates = true;
    }
    if (!existing.transcription && defaults.transcription) {
      updateData.transcription = defaults.transcription;
      hasUpdates = true;
    }
    if (!existing.imageDescription && defaults.imageDescription) {
      updateData.imageDescription = defaults.imageDescription;
      hasUpdates = true;
    }
    if (!existing.videoDescription && defaults.videoDescription) {
      updateData.videoDescription = defaults.videoDescription;
      hasUpdates = true;
    }
    if (!existing.documentExtraction && defaults.documentExtraction) {
      updateData.documentExtraction = defaults.documentExtraction;
      hasUpdates = true;
    }

    return hasUpdates ? updateData : null;
  }

  /**
   * Find or create a message by external ID
   *
   * IMPORTANT: If message exists but has missing fields (e.g. mediaUrl was null in old sync),
   * this will UPDATE the existing message with data from Baileys (source of truth).
   * This ensures resyncs can recover incomplete messages.
   */
  async findOrCreate(
    chatId: string,
    externalId: string,
    defaults: Omit<CreateMessageOptions, 'chatId' | 'externalId'>,
  ): Promise<{ message: Message; created: boolean }> {
    const existing = await this.getByExternalId(chatId, externalId);

    if (existing) {
      // Check if Baileys has data that's missing in our DB (Baileys is source of truth)
      const updateData = this.buildMissingFieldsUpdate(existing, defaults);

      if (updateData) {
        const updated = await this.update(existing.id, updateData);
        return { message: updated, created: false };
      }

      return { message: existing, created: false };
    }

    const message = await this.create({
      chatId,
      externalId,
      ...defaults,
    });

    return { message, created: true };
  }

  /**
   * Update a message
   */
  async update(id: string, data: Partial<NewMessage>): Promise<Message> {
    const [updated] = await this.db
      .update(messages)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(messages.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError('Message', id);
    }

    return updated;
  }

  // =========================================================================
  // Edit Tracking
  // =========================================================================

  /**
   * Record a message edit
   */
  async recordEdit(
    id: string,
    newText: string,
    editedAt: Date,
    editedBy?: string,
    latestEventId?: string,
  ): Promise<Message> {
    const message = await this.getById(id);

    // Build edit history entry
    const editEntry: EditHistoryEntry = {
      text: newText,
      at: editedAt.toISOString(),
      by: editedBy,
    };

    // Get current edit history or initialize
    const currentHistory = (message.editHistory as EditHistoryEntry[]) ?? [];
    const newHistory = [...currentHistory, editEntry];

    // If this is the first edit, save original text
    const originalText = message.editCount === 0 ? message.textContent : message.originalText;

    const [updated] = await this.db
      .update(messages)
      .set({
        textContent: newText,
        status: 'edited' as MessageStatus,
        editCount: message.editCount + 1,
        originalText,
        editHistory: newHistory,
        editedAt,
        latestEventId: latestEventId ?? message.latestEventId,
        updatedAt: new Date(),
      })
      .where(eq(messages.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError('Message', id);
    }

    return updated;
  }

  // =========================================================================
  // Reactions
  // =========================================================================

  /**
   * Add a reaction to a message
   */
  async addReaction(id: string, reaction: Omit<ReactionInfo, 'at'>, latestEventId?: string): Promise<Message> {
    const message = await this.getById(id);

    const reactionEntry: ReactionInfo = {
      ...reaction,
      at: new Date().toISOString(),
    };

    // Get current reactions or initialize
    const currentReactions = (message.reactions as ReactionInfo[]) ?? [];

    // Check if this user already has this reaction
    const existingIndex = currentReactions.findIndex(
      (r) => r.platformUserId === reaction.platformUserId && r.emoji === reaction.emoji,
    );

    if (existingIndex >= 0) {
      // Already exists, no change needed
      return message;
    }

    const newReactions = [...currentReactions, reactionEntry];

    // Update reaction counts
    const currentCounts = (message.reactionCounts as Record<string, number>) ?? {};
    const newCounts = { ...currentCounts };
    newCounts[reaction.emoji] = (newCounts[reaction.emoji] ?? 0) + 1;

    const [updated] = await this.db
      .update(messages)
      .set({
        reactions: newReactions,
        reactionCounts: newCounts,
        latestEventId: latestEventId ?? message.latestEventId,
        updatedAt: new Date(),
      })
      .where(eq(messages.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError('Message', id);
    }

    return updated;
  }

  /**
   * Remove a reaction from a message
   */
  async removeReaction(id: string, platformUserId: string, emoji: string, latestEventId?: string): Promise<Message> {
    const message = await this.getById(id);

    const currentReactions = (message.reactions as ReactionInfo[]) ?? [];
    const newReactions = currentReactions.filter((r) => !(r.platformUserId === platformUserId && r.emoji === emoji));

    // Update reaction counts
    const currentCounts = (message.reactionCounts as Record<string, number>) ?? {};
    const newCounts = { ...currentCounts };
    if (newCounts[emoji]) {
      newCounts[emoji] = Math.max(0, newCounts[emoji] - 1);
      if (newCounts[emoji] === 0) {
        delete newCounts[emoji];
      }
    }

    const [updated] = await this.db
      .update(messages)
      .set({
        reactions: newReactions,
        reactionCounts: Object.keys(newCounts).length > 0 ? newCounts : null,
        latestEventId: latestEventId ?? message.latestEventId,
        updatedAt: new Date(),
      })
      .where(eq(messages.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError('Message', id);
    }

    return updated;
  }

  // =========================================================================
  // Status Updates
  // =========================================================================

  /**
   * Update delivery status
   */
  async updateDeliveryStatus(id: string, status: DeliveryStatus, latestEventId?: string): Promise<Message> {
    const [updated] = await this.db
      .update(messages)
      .set({
        deliveryStatus: status,
        latestEventId,
        updatedAt: new Date(),
      })
      .where(eq(messages.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError('Message', id);
    }

    return updated;
  }

  /**
   * Mark message as deleted
   */
  async markDeleted(id: string, latestEventId?: string): Promise<Message> {
    const [updated] = await this.db
      .update(messages)
      .set({
        status: 'deleted' as MessageStatus,
        deletedAt: new Date(),
        latestEventId,
        updatedAt: new Date(),
      })
      .where(eq(messages.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError('Message', id);
    }

    return updated;
  }

  // =========================================================================
  // Pre-processed Content
  // =========================================================================

  /**
   * Update transcription for an audio message
   */
  async updateTranscription(id: string, transcription: string): Promise<Message> {
    const [updated] = await this.db
      .update(messages)
      .set({ transcription, updatedAt: new Date() })
      .where(eq(messages.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError('Message', id);
    }

    return updated;
  }

  /**
   * Update image description
   */
  async updateImageDescription(id: string, description: string): Promise<Message> {
    const [updated] = await this.db
      .update(messages)
      .set({ imageDescription: description, updatedAt: new Date() })
      .where(eq(messages.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError('Message', id);
    }

    return updated;
  }

  /**
   * Update video description
   */
  async updateVideoDescription(id: string, description: string): Promise<Message> {
    const [updated] = await this.db
      .update(messages)
      .set({ videoDescription: description, updatedAt: new Date() })
      .where(eq(messages.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError('Message', id);
    }

    return updated;
  }

  /**
   * Update document extraction
   */
  async updateDocumentExtraction(id: string, extraction: string): Promise<Message> {
    const [updated] = await this.db
      .update(messages)
      .set({ documentExtraction: extraction, updatedAt: new Date() })
      .where(eq(messages.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError('Message', id);
    }

    return updated;
  }

  // =========================================================================
  // Reply Resolution
  // =========================================================================

  /**
   * Resolve reply-to message ID from external ID
   */
  async resolveReplyToMessage(chatId: string, replyToExternalId: string): Promise<string | null> {
    const [replyToMessage] = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.chatId, chatId), eq(messages.externalId, replyToExternalId)))
      .limit(1);

    return replyToMessage?.id ?? null;
  }

  /**
   * Update reply-to message reference (when we later find the referenced message)
   */
  async updateReplyToReference(id: string, replyToMessageId: string): Promise<void> {
    await this.db.update(messages).set({ replyToMessageId, updatedAt: new Date() }).where(eq(messages.id, id));
  }
}
