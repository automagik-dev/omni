/**
 * Event service - queries omniEvents (message traces)
 */

import { NotFoundError } from '@omni/core';
import type { Database } from '@omni/db';
import { type ChannelType, type ContentType, type EventType, type OmniEvent, omniEvents } from '@omni/db';
import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import { scopedHandle } from '../tenancy/tenant-scope';

export interface ListEventsOptions {
  channel?: ChannelType[];
  instanceId?: string;
  instanceIds?: string[];
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

/** Caps for the trace walk — see EventService.trace. */
const TRACE_MAX_ANCESTORS = 50;
const TRACE_MAX_DEPTH = 10;
const TRACE_MAX_NODES = 200;

export interface EventTraceDescendant {
  event: OmniEvent;
  /** Distance below the focus event (1 = direct child). */
  depth: number;
}

export interface EventTraceResult {
  /** The event the trace was requested for. */
  event: OmniEvent;
  /** Chain above the focus event, ROOT FIRST, ending at the immediate parent. */
  ancestors: OmniEvent[];
  /** Fan-out below the focus event, breadth-first. */
  descendants: EventTraceDescendant[];
  /** True when an ancestor/depth/node cap cut the walk short. */
  truncated: boolean;
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
  byChannel: Record<string, number>;
  byDirection: { inbound: number; outbound: number };
  timeline?: Array<{ bucket: string; count: number }>;
}

export class EventService {
  /**
   * The handle every query in this service uses.
   *
   * Inside a tenant-scoped request this is the request's tenant-stamped
   * transaction (wish: omni-full-multitenancy, G4 — see `tenancy/tenant-scope.ts`);
   * for a legacy credential, a worker, or the CLI it is the ambient pool and
   * the query issued is byte-for-byte the one issued before the conversion.
   */
  private get db(): Database {
    return scopedHandle(this.pool);
  }

  constructor(private readonly pool: Database) {}

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
    } else if (options.instanceIds?.length) {
      conditions.push(inArray(omniEvents.instanceId, options.instanceIds));
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
   * Walk the causality chain around one event (#957, RFC #925 G3).
   *
   * UP: follows `causation_id` parent-by-parent to the root (or to the first
   * parent that was never persisted / was pruned — the chain is best-effort
   * by design, causation_id is not an FK). DOWN: breadth-first over children
   * (`causation_id = id`) through fan-out. Iterative queries, bounded by
   * depth/node caps so a pathological chain cannot run away; `truncated`
   * reports when a cap was hit.
   */
  async trace(id: string): Promise<EventTraceResult> {
    const focus = await this.getById(id);

    const seen = new Set<string>([focus.id]);

    // Walk UP to the root.
    const ancestors: OmniEvent[] = [];
    let current: OmniEvent = focus;
    let truncated = false;
    while (current.causationId && ancestors.length < TRACE_MAX_ANCESTORS) {
      if (seen.has(current.causationId)) break; // cycle guard — malformed data must not loop forever
      const [parent] = await this.db.select().from(omniEvents).where(eq(omniEvents.id, current.causationId)).limit(1);
      if (!parent) break; // parent never persisted or pruned — chain ends here
      seen.add(parent.id);
      ancestors.unshift(parent);
      current = parent;
    }
    if (current.causationId && ancestors.length >= TRACE_MAX_ANCESTORS) truncated = true;

    // Walk DOWN through fan-out (children = events whose causation_id = this id).
    const descendants: EventTraceDescendant[] = [];
    let frontier = [focus.id];
    let depth = 0;
    while (frontier.length > 0 && depth < TRACE_MAX_DEPTH && descendants.length < TRACE_MAX_NODES) {
      depth++;
      const children = await this.db
        .select()
        .from(omniEvents)
        .where(inArray(omniEvents.causationId, frontier))
        .orderBy(omniEvents.receivedAt)
        .limit(TRACE_MAX_NODES + 1);
      const fresh = children.filter((c) => !seen.has(c.id));
      for (const child of fresh) seen.add(child.id);
      for (const child of fresh) descendants.push({ event: child, depth });
      if (descendants.length > TRACE_MAX_NODES) {
        descendants.length = TRACE_MAX_NODES;
        truncated = true;
        break;
      }
      frontier = fresh.map((c) => c.id);
    }
    if (frontier.length > 0 && depth >= TRACE_MAX_DEPTH) truncated = true;

    return { event: focus, ancestors, descendants, truncated };
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
  async getAnalytics(
    options: {
      since?: Date;
      until?: Date;
      instanceId?: string;
      granularity?: 'hourly' | 'daily';
    } = {},
  ): Promise<EventAnalytics> {
    const { since, until, instanceId, granularity } = options;

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

    // Get counts by channel
    const channelCounts = await this.db
      .select({
        channel: omniEvents.channel,
        count: sql<number>`count(*)::int`,
      })
      .from(omniEvents)
      .where(whereClause)
      .groupBy(omniEvents.channel);

    // Get counts by direction
    const directionCounts = await this.db
      .select({
        direction: omniEvents.direction,
        count: sql<number>`count(*)::int`,
      })
      .from(omniEvents)
      .where(whereClause)
      .groupBy(omniEvents.direction);

    const total = counts?.total ?? 0;
    const successful = counts?.successful ?? 0;
    const failed = counts?.failed ?? 0;

    // Get timeline data if granularity is specified
    let timeline: Array<{ bucket: string; count: number }> | undefined;
    if (granularity) {
      const truncFunc = granularity === 'hourly' ? 'hour' : 'day';
      const timelineCounts = await this.db
        .select({
          bucket: sql<string>`date_trunc('${sql.raw(truncFunc)}', ${omniEvents.receivedAt})::text`,
          count: sql<number>`count(*)::int`,
        })
        .from(omniEvents)
        .where(whereClause)
        .groupBy(sql`date_trunc('${sql.raw(truncFunc)}', ${omniEvents.receivedAt})`)
        .orderBy(sql`date_trunc('${sql.raw(truncFunc)}', ${omniEvents.receivedAt})`);

      timeline = timelineCounts.map((t) => ({ bucket: t.bucket, count: t.count }));
    }

    // Calculate direction breakdown
    const inboundCount = directionCounts.find((d) => d.direction === 'inbound')?.count ?? 0;
    const outboundCount = directionCounts.find((d) => d.direction === 'outbound')?.count ?? 0;

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
      byChannel: Object.fromEntries(
        channelCounts
          .filter((c): c is typeof c & { channel: NonNullable<typeof c.channel> } => c.channel != null)
          .map((c) => [c.channel, c.count]),
      ),
      byDirection: {
        inbound: inboundCount,
        outbound: outboundCount,
      },
      timeline,
    };
  }
}
