/**
 * Chat service - manages unified chat/conversation model
 *
 * @see unified-messages wish
 */

import type { EventBus } from '@omni/core';
import { NotFoundError } from '@omni/core';
import type { Database } from '@omni/db';
import {
  type ChannelType,
  type Chat,
  type ChatParticipant,
  type ChatType,
  type NewChat,
  type NewChatParticipant,
  chatIdMappings,
  chatParticipants,
  chats,
  omniGroups,
} from '@omni/db';
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';

export interface ChatWithParticipants extends Chat {
  participants: ChatParticipant[];
}

export interface ChatSummary extends Chat {
  participantCount: number;
  lastMessage?: {
    textContent: string | null;
    senderDisplayName: string | null;
    platformTimestamp: Date;
  };
}

export interface ListChatsOptions {
  instanceId?: string;
  channel?: ChannelType[];
  chatType?: ChatType[];
  excludeChatTypes?: ChatType[];
  search?: string;
  includeArchived?: boolean;
  limit?: number;
  cursor?: string;
}

export interface AddParticipantOptions {
  chatId: string;
  platformUserId: string;
  displayName?: string;
  avatarUrl?: string;
  role?: string;
  personId?: string;
  platformIdentityId?: string;
  platformMetadata?: Record<string, unknown>;
}

export class ChatService {
  constructor(
    private db: Database,
    private eventBus: EventBus | null,
  ) {}

  /**
   * List chats with filtering and pagination
   */
  async list(options: ListChatsOptions = {}): Promise<{
    items: Chat[];
    hasMore: boolean;
    cursor?: string;
  }> {
    const {
      instanceId,
      channel,
      chatType,
      excludeChatTypes,
      search,
      includeArchived = false,
      limit = 50,
      cursor,
    } = options;

    const conditions = [];

    if (instanceId) {
      conditions.push(eq(chats.instanceId, instanceId));
    }

    if (channel?.length) {
      conditions.push(inArray(chats.channel, channel));
    }

    if (chatType?.length) {
      conditions.push(inArray(chats.chatType, chatType));
    }

    if (excludeChatTypes?.length) {
      conditions.push(
        sql`${chats.chatType} NOT IN (${sql.join(
          excludeChatTypes.map((t) => sql`${t}`),
          sql`, `,
        )})`,
      );
    }

    if (search) {
      const searchPattern = `%${search}%`;
      conditions.push(
        or(
          ilike(chats.name, searchPattern),
          ilike(chats.description, searchPattern),
          ilike(chats.externalId, searchPattern),
          ilike(chats.canonicalId, searchPattern),
        ),
      );
    }

    if (!includeArchived) {
      conditions.push(sql`${chats.archivedAt} IS NULL`);
    }

    conditions.push(sql`${chats.deletedAt} IS NULL`);

    if (cursor) {
      conditions.push(sql`${chats.lastMessageAt} < ${cursor}`);
    }

    const items = await this.db
      .select()
      .from(chats)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(chats.lastMessageAt))
      .limit(limit + 1);

    const hasMore = items.length > limit;
    if (hasMore) {
      items.pop();
    }

    // Enrich group chats with names from omni_groups when chat name is missing
    await this.enrichGroupNames(items);

    const lastItem = items[items.length - 1];
    return {
      items,
      hasMore,
      cursor: lastItem?.lastMessageAt?.toISOString(),
    };
  }

  /**
   * Enrich group/community chats that have no name with names from omni_groups
   */
  private async enrichGroupNames(items: Chat[]): Promise<void> {
    const nameless = items.filter((c) => !c.name && (c.chatType === 'group' || c.chatType === 'community'));
    if (nameless.length === 0) return;

    const externalIds = nameless.map((c) => c.externalId);
    const groups = await this.db
      .select({ externalId: omniGroups.externalId, name: omniGroups.name })
      .from(omniGroups)
      .where(inArray(omniGroups.externalId, externalIds));

    const nameMap = new Map(groups.filter((g) => g.name).map((g) => [g.externalId, g.name as string]));
    for (const chat of nameless) {
      const groupName = nameMap.get(chat.externalId);
      if (groupName) {
        chat.name = groupName;
      }
    }
  }

  /**
   * Get chat by ID
   */
  async getById(id: string): Promise<Chat> {
    const [result] = await this.db.select().from(chats).where(eq(chats.id, id)).limit(1);

    if (!result) {
      throw new NotFoundError('Chat', id);
    }

    return result;
  }

  /**
   * Get chat by external ID and instance
   */
  async getByExternalId(instanceId: string, externalId: string): Promise<Chat | null> {
    const [result] = await this.db
      .select()
      .from(chats)
      .where(and(eq(chats.instanceId, instanceId), eq(chats.externalId, externalId)))
      .limit(1);

    return result ?? null;
  }

  /**
   * Get chat with all participants
   */
  async getWithParticipants(id: string): Promise<ChatWithParticipants> {
    const chat = await this.getById(id);

    const participants = await this.db.select().from(chatParticipants).where(eq(chatParticipants.chatId, id));

    return { ...chat, participants };
  }

  /**
   * Create a new chat
   */
  async create(data: NewChat): Promise<Chat> {
    const [created] = await this.db.insert(chats).values(data).returning();

    if (!created) {
      throw new Error('Failed to create chat');
    }

    return created;
  }

  /**
   * Find or create a chat by external ID.
   * Performs secondary lookups via canonicalId and chatIdMappings
   * to prevent duplicate chats from LID/phone JID addressing.
   */
  async findOrCreate(
    instanceId: string,
    externalId: string,
    defaults: Omit<NewChat, 'instanceId' | 'externalId'>,
  ): Promise<{ chat: Chat; created: boolean }> {
    // Primary lookup: exact externalId match
    const existing = await this.getByExternalId(instanceId, externalId);
    if (existing) {
      return { chat: existing, created: false };
    }

    // Secondary lookup: check if another chat has this as its canonicalId
    // (e.g., an @lid chat that was previously resolved to this phone JID)
    const [byCanonical] = await this.db
      .select()
      .from(chats)
      .where(and(eq(chats.instanceId, instanceId), eq(chats.canonicalId, externalId)))
      .limit(1);
    if (byCanonical) {
      return { chat: byCanonical, created: false };
    }

    // Secondary lookup: check chatIdMappings for a LID→phone mapping
    // If the externalId is a phone JID, check if any LID maps to it
    if (externalId.endsWith('@s.whatsapp.net')) {
      const [mapping] = await this.db
        .select()
        .from(chatIdMappings)
        .where(and(eq(chatIdMappings.instanceId, instanceId), eq(chatIdMappings.phoneId, externalId)))
        .limit(1);
      if (mapping) {
        // A LID chat exists for this phone — find it
        const lidChat = await this.getByExternalId(instanceId, mapping.lidId);
        if (lidChat) {
          return { chat: lidChat, created: false };
        }
      }
    }

    const chat = await this.create({
      instanceId,
      externalId,
      ...defaults,
    });

    return { chat, created: true };
  }

  /**
   * Upsert a LID→phone JID mapping into the chatIdMappings table.
   */
  async upsertLidMapping(instanceId: string, lidId: string, phoneId: string): Promise<void> {
    await this.db
      .insert(chatIdMappings)
      .values({
        instanceId,
        lidId,
        phoneId,
        discoveredFrom: 'message_key',
      })
      .onConflictDoUpdate({
        target: [chatIdMappings.instanceId, chatIdMappings.lidId],
        set: { phoneId, discoveredAt: new Date() },
      });
  }

  /**
   * Update a chat
   */
  async update(id: string, data: Partial<NewChat>): Promise<Chat> {
    const [updated] = await this.db
      .update(chats)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(chats.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError('Chat', id);
    }

    return updated;
  }

  /**
   * Update last message preview
   */
  async updateLastMessage(chatId: string, preview: string, timestamp: Date): Promise<void> {
    await this.db
      .update(chats)
      .set({
        lastMessageAt: timestamp,
        lastMessagePreview: preview.substring(0, 500),
        messageCount: sql`${chats.messageCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(chats.id, chatId));
  }

  /**
   * Reset unread count for a chat (e.g., when marked as read)
   */
  async resetUnreadCount(chatId: string): Promise<void> {
    await this.db.update(chats).set({ unreadCount: 0, updatedAt: new Date() }).where(eq(chats.id, chatId));
  }

  /**
   * Archive a chat
   */
  async archive(id: string): Promise<Chat> {
    const [updated] = await this.db
      .update(chats)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(chats.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError('Chat', id);
    }

    return updated;
  }

  /**
   * Unarchive a chat
   */
  async unarchive(id: string): Promise<Chat> {
    const [updated] = await this.db
      .update(chats)
      .set({ archivedAt: null, updatedAt: new Date() })
      .where(eq(chats.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError('Chat', id);
    }

    return updated;
  }

  /**
   * Soft delete a chat
   */
  async delete(id: string): Promise<void> {
    await this.db.update(chats).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(chats.id, id));
  }

  // =========================================================================
  // Participant Management
  // =========================================================================

  /**
   * Get participants for a chat
   */
  async getParticipants(chatId: string): Promise<ChatParticipant[]> {
    return this.db
      .select()
      .from(chatParticipants)
      .where(and(eq(chatParticipants.chatId, chatId), eq(chatParticipants.isActive, true)))
      .orderBy(chatParticipants.joinedAt);
  }

  /**
   * Add a participant to a chat
   */
  async addParticipant(options: AddParticipantOptions): Promise<ChatParticipant> {
    // Check if participant already exists
    const [existing] = await this.db
      .select()
      .from(chatParticipants)
      .where(
        and(eq(chatParticipants.chatId, options.chatId), eq(chatParticipants.platformUserId, options.platformUserId)),
      )
      .limit(1);

    if (existing) {
      return this.updateExistingParticipant(existing, options);
    }

    return this.createNewParticipant(options);
  }

  /**
   * Update an existing participant (re-activate or update)
   */
  private async updateExistingParticipant(
    existing: ChatParticipant,
    options: AddParticipantOptions,
  ): Promise<ChatParticipant> {
    const { chatId, displayName, avatarUrl, role, personId, platformIdentityId, platformMetadata } = options;

    const updateData = {
      displayName: displayName ?? existing.displayName,
      avatarUrl: avatarUrl ?? existing.avatarUrl,
      role: role ?? existing.role,
      personId: personId ?? existing.personId,
      platformIdentityId: platformIdentityId ?? existing.platformIdentityId,
      platformMetadata: platformMetadata ?? existing.platformMetadata,
      updatedAt: new Date(),
    };

    // Re-activate if previously left
    if (!existing.isActive) {
      const [updated] = await this.db
        .update(chatParticipants)
        .set({ ...updateData, isActive: true, leftAt: null })
        .where(eq(chatParticipants.id, existing.id))
        .returning();

      // Update participant count
      await this.db
        .update(chats)
        .set({ participantCount: sql`${chats.participantCount} + 1` })
        .where(eq(chats.id, chatId));

      if (!updated) {
        throw new Error('Failed to update participant');
      }
      return updated;
    }

    // Update existing active participant
    const [updated] = await this.db
      .update(chatParticipants)
      .set(updateData)
      .where(eq(chatParticipants.id, existing.id))
      .returning();

    if (!updated) {
      throw new Error('Failed to update participant');
    }
    return updated;
  }

  /**
   * Create a new participant
   */
  private async createNewParticipant(options: AddParticipantOptions): Promise<ChatParticipant> {
    const { chatId, platformUserId, displayName, avatarUrl, role, personId, platformIdentityId, platformMetadata } =
      options;

    const [created] = await this.db
      .insert(chatParticipants)
      .values({
        chatId,
        platformUserId,
        displayName,
        avatarUrl,
        role,
        personId,
        platformIdentityId,
        platformMetadata,
      })
      .returning();

    if (!created) {
      throw new Error('Failed to add participant');
    }

    // Update participant count
    await this.db
      .update(chats)
      .set({ participantCount: sql`${chats.participantCount} + 1` })
      .where(eq(chats.id, chatId));

    return created;
  }

  /**
   * Update participant with identity links if missing
   */
  private async updateParticipantIdentity(
    existing: ChatParticipant,
    defaults: Partial<NewChatParticipant>,
  ): Promise<ChatParticipant> {
    const [updated] = await this.db
      .update(chatParticipants)
      .set({
        personId: defaults.personId ?? existing.personId,
        platformIdentityId: defaults.platformIdentityId ?? existing.platformIdentityId,
        displayName: defaults.displayName ?? existing.displayName,
        updatedAt: new Date(),
      })
      .where(eq(chatParticipants.id, existing.id))
      .returning();
    return updated ?? existing;
  }

  /**
   * Find or create a participant
   */
  async findOrCreateParticipant(
    chatId: string,
    platformUserId: string,
    defaults: Partial<NewChatParticipant> = {},
  ): Promise<{ participant: ChatParticipant; created: boolean }> {
    const [existing] = await this.db
      .select()
      .from(chatParticipants)
      .where(and(eq(chatParticipants.chatId, chatId), eq(chatParticipants.platformUserId, platformUserId)))
      .limit(1);

    if (existing) {
      // Update identity links if provided and missing on existing record
      const hasNewIdentity = defaults.personId || defaults.platformIdentityId;
      const missingIdentity = !existing.personId || !existing.platformIdentityId;
      if (hasNewIdentity && missingIdentity) {
        const updated = await this.updateParticipantIdentity(existing, defaults);
        return { participant: updated, created: false };
      }
      return { participant: existing, created: false };
    }

    const participant = await this.addParticipant({
      chatId,
      platformUserId,
      displayName: defaults.displayName ?? undefined,
      avatarUrl: defaults.avatarUrl ?? undefined,
      role: defaults.role ?? undefined,
      personId: defaults.personId ?? undefined,
      platformIdentityId: defaults.platformIdentityId ?? undefined,
      platformMetadata: defaults.platformMetadata ?? undefined,
    });

    return { participant, created: true };
  }

  /**
   * Remove a participant from a chat
   */
  async removeParticipant(chatId: string, platformUserId: string): Promise<void> {
    const [updated] = await this.db
      .update(chatParticipants)
      .set({ isActive: false, leftAt: new Date(), updatedAt: new Date() })
      .where(and(eq(chatParticipants.chatId, chatId), eq(chatParticipants.platformUserId, platformUserId)))
      .returning();

    if (updated) {
      // Update participant count
      await this.db
        .update(chats)
        .set({ participantCount: sql`${chats.participantCount} - 1` })
        .where(eq(chats.id, chatId));
    }
  }

  /**
   * Update participant's last seen time and increment message count
   */
  async recordParticipantActivity(chatId: string, platformUserId: string): Promise<void> {
    await this.db
      .update(chatParticipants)
      .set({
        lastSeenAt: new Date(),
        messageCount: sql`${chatParticipants.messageCount} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(chatParticipants.chatId, chatId), eq(chatParticipants.platformUserId, platformUserId)));
  }

  /**
   * Update participant role
   */
  async updateParticipantRole(chatId: string, platformUserId: string, role: string): Promise<ChatParticipant> {
    const [updated] = await this.db
      .update(chatParticipants)
      .set({ role, updatedAt: new Date() })
      .where(and(eq(chatParticipants.chatId, chatId), eq(chatParticipants.platformUserId, platformUserId)))
      .returning();

    if (!updated) {
      throw new NotFoundError('ChatParticipant', `${chatId}/${platformUserId}`);
    }

    return updated;
  }

  /**
   * Link participant to a person
   */
  async linkParticipantToPerson(participantId: string, personId: string): Promise<ChatParticipant> {
    const [updated] = await this.db
      .update(chatParticipants)
      .set({ personId, updatedAt: new Date() })
      .where(eq(chatParticipants.id, participantId))
      .returning();

    if (!updated) {
      throw new NotFoundError('ChatParticipant', participantId);
    }

    return updated;
  }
}
