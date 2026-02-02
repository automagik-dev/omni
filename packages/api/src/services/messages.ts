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
  source?: MessageSource[];
  messageType?: MessageType[];
  status?: MessageStatus[];
  hasMedia?: boolean;
  senderPersonId?: string;
  since?: Date;
  until?: Date;
  search?: string;
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
  // Raw data
  rawPayload?: Record<string, unknown>;
  // Event links (optional - only for realtime)
  originalEventId?: string;
}

export class MessageService {
  constructor(
    private db: Database,
    private eventBus: EventBus | null,
  ) {}

  /**
   * List messages with filtering and pagination
   */
  async list(options: ListMessagesOptions = {}): Promise<{
    items: Message[];
    hasMore: boolean;
    cursor?: string;
  }> {
    const {
      chatId,
      source,
      messageType,
      status,
      hasMedia,
      senderPersonId,
      since,
      until,
      search,
      limit = 50,
      cursor,
    } = options;

    const conditions = [];

    if (chatId) {
      conditions.push(eq(messages.chatId, chatId));
    }

    if (source?.length) {
      conditions.push(inArray(messages.source, source));
    }

    if (messageType?.length) {
      conditions.push(inArray(messages.messageType, messageType));
    }

    if (status?.length) {
      conditions.push(inArray(messages.status, status));
    }

    if (hasMedia !== undefined) {
      conditions.push(eq(messages.hasMedia, hasMedia));
    }

    if (senderPersonId) {
      conditions.push(eq(messages.senderPersonId, senderPersonId));
    }

    if (since) {
      conditions.push(gte(messages.platformTimestamp, since));
    }

    if (until) {
      conditions.push(lte(messages.platformTimestamp, until));
    }

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

    // Exclude deleted messages by default
    conditions.push(sql`${messages.deletedAt} IS NULL`);

    if (cursor) {
      conditions.push(sql`${messages.platformTimestamp} < ${cursor}`);
    }

    const items = await this.db
      .select()
      .from(messages)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(messages.platformTimestamp))
      .limit(limit + 1);

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
    const { chatId, source, messageType, status, hasMedia, senderPersonId, since, until, search } = options;

    const conditions = [];

    if (chatId) {
      conditions.push(eq(messages.chatId, chatId));
    }

    if (source?.length) {
      conditions.push(inArray(messages.source, source));
    }

    if (messageType?.length) {
      conditions.push(inArray(messages.messageType, messageType));
    }

    if (status?.length) {
      conditions.push(inArray(messages.status, status));
    }

    if (hasMedia !== undefined) {
      conditions.push(eq(messages.hasMedia, hasMedia));
    }

    if (senderPersonId) {
      conditions.push(eq(messages.senderPersonId, senderPersonId));
    }

    if (since) {
      conditions.push(gte(messages.platformTimestamp, since));
    }

    if (until) {
      conditions.push(lte(messages.platformTimestamp, until));
    }

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

    // Exclude deleted messages by default
    conditions.push(sql`${messages.deletedAt} IS NULL`);

    const result = await this.db
      .select({ count: count() })
      .from(messages)
      .where(conditions.length ? and(...conditions) : undefined);

    return result[0]?.count ?? 0;
  }

  /**
   * Get messages for a chat (chronological order)
   */
  async getChatMessages(
    chatId: string,
    options: { limit?: number; before?: Date; after?: Date } = {},
  ): Promise<Message[]> {
    const { limit = 100, before, after } = options;
    const conditions = [eq(messages.chatId, chatId), sql`${messages.deletedAt} IS NULL`];

    if (before) {
      conditions.push(lte(messages.platformTimestamp, before));
    }

    if (after) {
      conditions.push(gte(messages.platformTimestamp, after));
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
   * Get message by external ID and chat
   */
  async getByExternalId(chatId: string, externalId: string): Promise<Message | null> {
    const [result] = await this.db
      .select()
      .from(messages)
      .where(and(eq(messages.chatId, chatId), eq(messages.externalId, externalId)))
      .limit(1);

    return result ?? null;
  }

  /**
   * Create a new message
   */
  async create(options: CreateMessageOptions): Promise<Message> {
    const [created] = await this.db
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

    // Update chat's last message
    await this.db
      .update(chats)
      .set({
        lastMessageAt: options.platformTimestamp,
        lastMessagePreview: (options.textContent ?? '[Media]').substring(0, 500),
        messageCount: sql`${chats.messageCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(chats.id, options.chatId));

    return created;
  }

  /**
   * Find or create a message by external ID
   */
  async findOrCreate(
    chatId: string,
    externalId: string,
    defaults: Omit<CreateMessageOptions, 'chatId' | 'externalId'>,
  ): Promise<{ message: Message; created: boolean }> {
    const existing = await this.getByExternalId(chatId, externalId);
    if (existing) {
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
