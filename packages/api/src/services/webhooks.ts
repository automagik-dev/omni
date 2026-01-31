/**
 * Webhook service - manages webhook sources and receives webhooks
 */

import { NotFoundError } from '@omni/core';
import type { CustomEventType, EventBus } from '@omni/core';
import { generateId } from '@omni/core';
import type { Database } from '@omni/db';
import { type NewWebhookSource, type WebhookSource, webhookSources } from '@omni/db';
import { eq, sql } from 'drizzle-orm';

export interface WebhookReceiveResult {
  received: boolean;
  eventId: string;
  source: string;
  eventType: string;
}

export class WebhookService {
  constructor(
    private db: Database,
    private eventBus: EventBus | null,
  ) {}

  /**
   * List all webhook sources
   */
  async list(options: { enabled?: boolean } = {}): Promise<WebhookSource[]> {
    let query = this.db.select().from(webhookSources).$dynamic();

    if (options.enabled !== undefined) {
      query = query.where(eq(webhookSources.enabled, options.enabled));
    }

    return query.orderBy(webhookSources.name);
  }

  /**
   * Get webhook source by ID
   */
  async getById(id: string): Promise<WebhookSource> {
    const [result] = await this.db.select().from(webhookSources).where(eq(webhookSources.id, id)).limit(1);

    if (!result) {
      throw new NotFoundError('WebhookSource', id);
    }

    return result;
  }

  /**
   * Get webhook source by name
   */
  async getByName(name: string): Promise<WebhookSource | null> {
    const [result] = await this.db.select().from(webhookSources).where(eq(webhookSources.name, name)).limit(1);
    return result ?? null;
  }

  /**
   * Create a new webhook source
   */
  async create(data: NewWebhookSource): Promise<WebhookSource> {
    const [created] = await this.db.insert(webhookSources).values(data).returning();

    if (!created) {
      throw new Error('Failed to create webhook source');
    }

    return created;
  }

  /**
   * Update a webhook source
   */
  async update(id: string, data: Partial<NewWebhookSource>): Promise<WebhookSource> {
    const [updated] = await this.db
      .update(webhookSources)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(webhookSources.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError('WebhookSource', id);
    }

    return updated;
  }

  /**
   * Delete a webhook source
   */
  async delete(id: string): Promise<void> {
    const result = await this.db.delete(webhookSources).where(eq(webhookSources.id, id)).returning();

    if (!result.length) {
      throw new NotFoundError('WebhookSource', id);
    }
  }

  /**
   * Receive a webhook and publish as event
   * If source doesn't exist and autoCreate is true, creates it
   */
  async receive(
    sourceName: string,
    payload: Record<string, unknown>,
    headers: Record<string, string>,
    options: { autoCreate?: boolean } = {},
  ): Promise<WebhookReceiveResult> {
    const { autoCreate = true } = options;

    // Get or create source
    let source = await this.getByName(sourceName);

    if (!source && autoCreate) {
      source = await this.create({
        name: sourceName,
        description: `Auto-created from webhook: ${sourceName}`,
      });
    }

    if (!source) {
      throw new NotFoundError('WebhookSource', sourceName);
    }

    if (!source.enabled) {
      throw new Error(`Webhook source '${sourceName}' is disabled`);
    }

    // Validate expected headers if configured
    if (source.expectedHeaders) {
      for (const headerName of Object.keys(source.expectedHeaders)) {
        if (!headers[headerName.toLowerCase()]) {
          throw new Error(`Missing required header: ${headerName}`);
        }
      }
    }

    // Generate event ID
    const eventId = generateId();
    const eventType = `custom.webhook.${sourceName}` as CustomEventType;

    // Update stats
    await this.db
      .update(webhookSources)
      .set({
        lastReceivedAt: new Date(),
        totalReceived: sql`${webhookSources.totalReceived} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(webhookSources.id, source.id));

    // Publish event
    if (this.eventBus) {
      await this.eventBus.publishGeneric(
        eventType,
        {
          source: sourceName,
          ...payload,
        },
        {
          correlationId: eventId,
          source: 'webhook',
        },
      );
    }

    return {
      received: true,
      eventId,
      source: sourceName,
      eventType,
    };
  }

  /**
   * Manually trigger a custom event
   */
  async trigger(
    eventType: CustomEventType,
    payload: Record<string, unknown>,
    metadata?: { correlationId?: string; instanceId?: string },
  ): Promise<{ eventId: string; published: boolean }> {
    const eventId = metadata?.correlationId ?? generateId();

    if (this.eventBus) {
      await this.eventBus.publishGeneric(eventType, payload, {
        correlationId: eventId,
        instanceId: metadata?.instanceId,
        source: 'manual-trigger',
      });

      return { eventId, published: true };
    }

    return { eventId, published: false };
  }
}
