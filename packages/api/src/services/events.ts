/**
 * Event service - queries omniEvents (message traces)
 */

import { NotFoundError } from '@omni/core';
import type { Database } from '@omni/db';
import { type ChannelType, type ContentType, type EventType, type OmniEvent, omniEvents } from '@omni/db';
import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';

export interface ListEventsOptions {
  channel?: ChannelType[];
  instanceId?: string;
  personId?: string;
  eventType?: EventType[];
  contentType?: ContentType[];
  direction?: 'inbound' | 'outbound';
  since?: Date;
  until?: Date;
  search?: string;
  limit?: number;
  cursor?: string;
}

export interface EventAnalytics {
  totalMessages: number;
  successfulMessages: number;
  failedMessages: number;
  successRate: number;
  avgProcessingTimeMs: number | null;
  avgAgentTimeMs: number | null;
  messageTypes: Record<string, number>;
  errorStages: Record<string, number>;
  instances: Record<string, number>;
}

export class EventService {
  constructor(private db: Database) {}

  /**
   * List events with filtering
   */
  async list(options: ListEventsOptions = {}): Promise<{
    items: OmniEvent[];
    hasMore: boolean;
    cursor?: string;
    total?: number;
  }> {
    const {
      channel,
      instanceId,
      personId,
      eventType,
      contentType,
      direction,
      since,
      until,
      search,
      limit = 50,
      cursor,
    } = options;

    const conditions = [];

    if (channel?.length) {
      conditions.push(inArray(omniEvents.channel, channel));
    }

    if (instanceId) {
      conditions.push(eq(omniEvents.instanceId, instanceId));
    }

    if (personId) {
      conditions.push(eq(omniEvents.personId, personId));
    }

    if (eventType?.length) {
      conditions.push(inArray(omniEvents.eventType, eventType));
    }

    if (contentType?.length) {
      conditions.push(inArray(omniEvents.contentType, contentType));
    }

    if (direction) {
      conditions.push(eq(omniEvents.direction, direction));
    }

    if (since) {
      conditions.push(gte(omniEvents.receivedAt, since));
    }

    if (until) {
      conditions.push(lte(omniEvents.receivedAt, until));
    }

    if (search) {
      const searchPattern = `%${search}%`;
      conditions.push(
        or(
          ilike(omniEvents.textContent, searchPattern),
          ilike(omniEvents.transcription, searchPattern),
          ilike(omniEvents.imageDescription, searchPattern),
        ),
      );
    }

    if (cursor) {
      // Cursor is the last receivedAt timestamp
      conditions.push(sql`${omniEvents.receivedAt} < ${cursor}`);
    }

    const whereClause = conditions.length ? and(...conditions) : undefined;

    const items = await this.db
      .select()
      .from(omniEvents)
      .where(whereClause)
      .orderBy(desc(omniEvents.receivedAt))
      .limit(limit + 1);

    const hasMore = items.length > limit;
    if (hasMore) {
      items.pop();
    }

    const lastItem = items[items.length - 1];
    return {
      items,
      hasMore,
      cursor: lastItem?.receivedAt.toISOString(),
    };
  }

  /**
   * Get event by ID
   */
  async getById(id: string): Promise<OmniEvent> {
    const [result] = await this.db.select().from(omniEvents).where(eq(omniEvents.id, id)).limit(1);

    if (!result) {
      throw new NotFoundError('Event', id);
    }

    return result;
  }

  /**
   * Get timeline for a person (cross-channel)
   */
  async getTimeline(
    personId: string,
    options: { channels?: ChannelType[]; since?: Date; until?: Date; limit?: number; cursor?: string } = {},
  ): Promise<{ items: OmniEvent[]; hasMore: boolean; cursor?: string }> {
    const { channels, since, until, limit = 50, cursor } = options;

    const conditions = [eq(omniEvents.personId, personId)];

    if (channels?.length) {
      conditions.push(inArray(omniEvents.channel, channels));
    }

    if (since) {
      conditions.push(gte(omniEvents.receivedAt, since));
    }

    if (until) {
      conditions.push(lte(omniEvents.receivedAt, until));
    }

    if (cursor) {
      conditions.push(sql`${omniEvents.receivedAt} < ${cursor}`);
    }

    const items = await this.db
      .select()
      .from(omniEvents)
      .where(and(...conditions))
      .orderBy(desc(omniEvents.receivedAt))
      .limit(limit + 1);

    const hasMore = items.length > limit;
    if (hasMore) {
      items.pop();
    }

    const lastItem = items[items.length - 1];
    return {
      items,
      hasMore,
      cursor: lastItem?.receivedAt.toISOString(),
    };
  }

  /**
   * Get analytics summary
   */
  async getAnalytics(options: { since?: Date; until?: Date; instanceId?: string } = {}): Promise<EventAnalytics> {
    const { since, until, instanceId } = options;

    const conditions = [];

    if (since) {
      conditions.push(gte(omniEvents.receivedAt, since));
    }

    if (until) {
      conditions.push(lte(omniEvents.receivedAt, until));
    }

    if (instanceId) {
      conditions.push(eq(omniEvents.instanceId, instanceId));
    }

    const whereClause = conditions.length ? and(...conditions) : undefined;

    // Get basic counts
    const countResults = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        successful: sql<number>`count(*) filter (where ${omniEvents.status} = 'completed')::int`,
        failed: sql<number>`count(*) filter (where ${omniEvents.status} = 'failed')::int`,
        avgProcessingTime: sql<number>`avg(${omniEvents.processingTimeMs})::int`,
        avgAgentTime: sql<number>`avg(${omniEvents.agentLatencyMs})::int`,
      })
      .from(omniEvents)
      .where(whereClause);

    const counts = countResults[0];

    // Get counts by content type
    const contentTypeCounts = await this.db
      .select({
        contentType: omniEvents.contentType,
        count: sql<number>`count(*)::int`,
      })
      .from(omniEvents)
      .where(whereClause)
      .groupBy(omniEvents.contentType);

    // Get counts by error stage
    const errorStageCounts = await this.db
      .select({
        errorStage: omniEvents.errorStage,
        count: sql<number>`count(*)::int`,
      })
      .from(omniEvents)
      .where(and(whereClause, sql`${omniEvents.errorStage} is not null`))
      .groupBy(omniEvents.errorStage);

    // Get counts by instance
    const instanceCounts = await this.db
      .select({
        instanceId: omniEvents.instanceId,
        count: sql<number>`count(*)::int`,
      })
      .from(omniEvents)
      .where(whereClause)
      .groupBy(omniEvents.instanceId);

    const total = counts?.total ?? 0;
    const successful = counts?.successful ?? 0;
    const failed = counts?.failed ?? 0;

    return {
      totalMessages: total,
      successfulMessages: successful,
      failedMessages: failed,
      successRate: total > 0 ? (successful / total) * 100 : 0,
      avgProcessingTimeMs: counts?.avgProcessingTime ?? null,
      avgAgentTimeMs: counts?.avgAgentTime ?? null,
      messageTypes: Object.fromEntries(
        contentTypeCounts
          .filter((c): c is typeof c & { contentType: NonNullable<typeof c.contentType> } => c.contentType != null)
          .map((c) => [c.contentType, c.count]),
      ),
      errorStages: Object.fromEntries(
        errorStageCounts
          .filter((c): c is typeof c & { errorStage: NonNullable<typeof c.errorStage> } => c.errorStage != null)
          .map((c) => [c.errorStage, c.count]),
      ),
      instances: Object.fromEntries(
        instanceCounts
          .filter((c): c is typeof c & { instanceId: NonNullable<typeof c.instanceId> } => c.instanceId != null)
          .map((c) => [c.instanceId, c.count]),
      ),
    };
  }
}
