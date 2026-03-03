/**
 * Conversation service - manages channel-agnostic conversation containers
 */

import { type EventBus, NotFoundError, createLogger } from '@omni/core';
import type { Database } from '@omni/db';
import { type Chat, type Conversation, type NewConversation, chats, conversations } from '@omni/db';
import { desc, eq } from 'drizzle-orm';

const log = createLogger('services:conversations');

export class ConversationService {
  constructor(
    private db: Database,
    private eventBus: EventBus | null = null,
  ) {}

  /**
   * List conversations ordered by most recently updated
   */
  async list(options: { limit?: number } = {}): Promise<Conversation[]> {
    const { limit = 50 } = options;

    return this.db.select().from(conversations).orderBy(desc(conversations.updatedAt)).limit(limit);
  }

  /**
   * Get conversation by ID
   */
  async getById(id: string): Promise<Conversation> {
    const [result] = await this.db.select().from(conversations).where(eq(conversations.id, id)).limit(1);

    if (!result) {
      throw new NotFoundError('Conversation', id);
    }

    return result;
  }

  /**
   * Create a new conversation
   */
  async create(data: NewConversation): Promise<Conversation> {
    const [created] = await this.db.insert(conversations).values(data).returning();

    if (!created) {
      throw new Error('Failed to create conversation');
    }

    if (this.eventBus) {
      this.eventBus
        .publish(
          'conversation.created',
          { conversationId: created.id, title: created.title },
          { instanceId: undefined },
        )
        .catch((err) => log.warn('Failed to publish conversation.created', { error: String(err) }));
    }

    return created;
  }

  /**
   * Update a conversation
   */
  async update(id: string, data: Partial<NewConversation>): Promise<Conversation> {
    const [updated] = await this.db
      .update(conversations)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(conversations.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError('Conversation', id);
    }

    if (this.eventBus) {
      this.eventBus
        .publish(
          'conversation.updated',
          { conversationId: updated.id, title: updated.title },
          { instanceId: undefined },
        )
        .catch((err) => log.warn('Failed to publish conversation.updated', { error: String(err) }));
    }

    return updated;
  }

  /**
   * Delete a conversation (hard delete — ON DELETE SET NULL handles chats)
   */
  async delete(id: string): Promise<void> {
    const [deleted] = await this.db
      .delete(conversations)
      .where(eq(conversations.id, id))
      .returning({ id: conversations.id });

    if (!deleted) {
      throw new NotFoundError('Conversation', id);
    }

    if (this.eventBus) {
      this.eventBus
        .publish('conversation.deleted', { conversationId: deleted.id }, { instanceId: undefined })
        .catch((err) => log.warn('Failed to publish conversation.deleted', { error: String(err) }));
    }
  }

  /**
   * Get all chats belonging to a conversation
   */
  async getChats(conversationId: string): Promise<Chat[]> {
    return this.db.select().from(chats).where(eq(chats.conversationId, conversationId));
  }
}
