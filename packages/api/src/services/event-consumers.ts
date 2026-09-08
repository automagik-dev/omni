/**
 * Durable event consumers (#989, RFC #925 G7 — the durable half; the one-shot
 * half is `omni events wait`, PR #972).
 *
 * A registered consumer is a name + filter + cursor over the JOURNAL
 * (`omni_events`, totally ordered by `journal_seq`). Delivery is
 * at-least-once-with-cursor: `pull` pages events strictly after the stored
 * cursor, `ack` advances it monotonically, disconnect/re-pull resumes exactly
 * after the last ack. The journal is the source of truth (NATS is transport),
 * so offsets older than NATS retention are automatically servable.
 *
 * Filter semantics REUSE the `events wait` contract (#966): the type filter
 * is exact-match or a trailing-* prefix glob (same as EventService.list), and
 * payload conditions run through the automation matcher
 * (`evaluateConditions`, @omni/core) against the row's rawPayload.
 *
 * The `pull` cursor advances over SCANNED rows, not merely matched ones —
 * acking the returned cursor skips filtered-out rows, so a sparse filter
 * never re-scans the same journal range. This is also what keeps the model
 * composable with G6 (waits/continuations): "wake a suspended run when a
 * matching event arrives" is `pull(limit: 1)` from a stored cursor with the
 * same matcher — nothing here assumes a live socket or a NATS subscription.
 */

import { ConflictError, NotFoundError, ValidationError, evaluateConditions } from '@omni/core';
import type { EventBus } from '@omni/core';
import type { AutomationCondition, Database, DurableConsumer, OmniEvent } from '@omni/db';
import { durableConsumers, omniEvents } from '@omni/db';
import { and, asc, eq, gt, like, lte, sql } from 'drizzle-orm';
import { scopedHandle } from '../tenancy/tenant-scope';
import { escapeLikePattern } from './events';

/** Where a new consumer's cursor starts: the journal head (default) or 0 (full replay). */
export type ConsumerStartFrom = 'now' | 'beginning';

export interface CreateConsumerInput {
  name: string;
  eventType: string;
  filters?: AutomationCondition[];
  /** 'now' (default, matches `events wait`) or 'beginning' (projection/backfill replay). */
  startFrom?: ConsumerStartFrom;
}

/** A consumer row plus its live lag (journal head minus cursor). */
export interface ConsumerWithLag extends DurableConsumer {
  /** Highest journal_seq currently in the journal (0 when empty). */
  head: number;
  /** head - cursor, floored at 0. Counts ALL journal rows past the cursor, not only matching ones. */
  lag: number;
}

export interface PullOptions {
  /** Max events to SCAN in this page (matches are <= this). 1..500, default 100. */
  limit?: number;
  /** Long-poll: when the page is empty, wait up to this long for new rows. 0..30000ms. */
  waitMs?: number;
}

export interface PullResult {
  consumer: string;
  /** Rows matching the type filter AND payload conditions, ascending journal_seq. */
  items: OmniEvent[];
  /**
   * Highest journal_seq SCANNED (not merely matched). Ack THIS value: it
   * advances past filtered-out rows so a sparse filter never re-scans.
   * Equals the stored cursor when nothing new was scanned.
   */
  cursor: number;
  head: number;
  /** True when the scan filled the page — more rows are already waiting. */
  hasMore: boolean;
}

const PULL_POLL_INTERVAL_MS = 500;
export const PULL_MAX_LIMIT = 500;
export const PULL_MAX_WAIT_MS = 30_000;

/** True when the row's payload passes the consumer's conditions (wait/automation matcher). */
export function matchesConsumerPayload(
  row: Pick<OmniEvent, 'rawPayload'>,
  filters?: AutomationCondition[] | null,
): boolean {
  if (!filters || filters.length === 0) return true;
  return evaluateConditions(filters, row.rawPayload ?? {});
}

/** Initial cursor for a new consumer. Exported for unit tests. */
export function resolveInitialCursor(startFrom: ConsumerStartFrom, head: number): number {
  return startFrom === 'beginning' ? 0 : head;
}

/** Lag math: journal head minus cursor, floored at 0. Exported for unit tests. */
export function computeLag(head: number, cursor: number): number {
  return Math.max(0, head - cursor);
}

export class EventConsumerService {
  /**
   * The handle every query in this service uses: the request's tenant-stamped
   * transaction inside a tenant scope, the ambient pool otherwise (G4 —
   * `tenancy/tenant-scope.ts`). Under RLS enforcement this is what keeps
   * `pull` tenant-policed: a tenant-scoped request only pages its own
   * tenant's `omni_events` rows.
   */
  private get db(): Database {
    return scopedHandle(this.pool);
  }

  constructor(
    private readonly pool: Database,
    private readonly eventBus: EventBus | null = null,
  ) {}

  /** Highest journal_seq in the journal, 0 when empty. Cheap (backward index scan). */
  async head(): Promise<number> {
    const [row] = await this.db
      .select({ head: sql<number>`coalesce(max(${omniEvents.journalSeq}), 0)::bigint` })
      .from(omniEvents);
    return Number(row?.head ?? 0);
  }

  async list(): Promise<ConsumerWithLag[]> {
    const [rows, head] = await Promise.all([
      this.db.select().from(durableConsumers).orderBy(asc(durableConsumers.name)),
      this.head(),
    ]);
    return rows.map((row) => ({ ...row, head, lag: computeLag(head, row.cursor) }));
  }

  async getByName(name: string): Promise<DurableConsumer> {
    const [row] = await this.db.select().from(durableConsumers).where(eq(durableConsumers.name, name)).limit(1);
    if (!row) throw new NotFoundError('DurableConsumer', name);
    return row;
  }

  /** getByName plus live head/lag — the `inspect` surface. */
  async inspect(name: string): Promise<ConsumerWithLag> {
    const row = await this.getByName(name);
    const head = await this.head();
    return { ...row, head, lag: computeLag(head, row.cursor) };
  }

  async create(input: CreateConsumerInput): Promise<ConsumerWithLag> {
    const head = await this.head();
    const cursor = resolveInitialCursor(input.startFrom ?? 'now', head);

    const [created] = await this.db
      .insert(durableConsumers)
      .values({ name: input.name, eventType: input.eventType, filters: input.filters ?? null, cursor })
      .onConflictDoNothing({ target: durableConsumers.name })
      .returning();
    if (!created) {
      throw new ConflictError('DurableConsumer', `a consumer named '${input.name}' already exists`, {
        name: input.name,
      });
    }

    // State change → event (repo contract). webhook_sources CRUD publishes
    // nothing; the local pattern followed here is the agents CRUD one
    // (`system.agent.registered`). system.* events live on the bus, not in
    // the journal — journaling every registry mutation would be noise.
    if (this.eventBus) {
      await this.eventBus.publishGeneric('system.consumer.created', {
        consumerId: created.id,
        name: created.name,
        eventType: created.eventType,
        cursor: created.cursor,
      });
    }

    return { ...created, head, lag: computeLag(head, created.cursor) };
  }

  async delete(name: string): Promise<void> {
    const [deleted] = await this.db.delete(durableConsumers).where(eq(durableConsumers.name, name)).returning();
    if (!deleted) throw new NotFoundError('DurableConsumer', name);

    if (this.eventBus) {
      await this.eventBus.publishGeneric('system.consumer.deleted', {
        consumerId: deleted.id,
        name: deleted.name,
        eventType: deleted.eventType,
        cursor: deleted.cursor,
      });
    }
  }

  /**
   * Page journal events strictly after the stored cursor. Does NOT advance
   * the cursor — that is `ack`'s job (at-least-once: a client that crashes
   * mid-page re-pulls the same page).
   */
  async pull(name: string, options: PullOptions = {}): Promise<PullResult> {
    const limit = Math.min(Math.max(options.limit ?? 100, 1), PULL_MAX_LIMIT);
    const waitMs = Math.min(Math.max(options.waitMs ?? 0, 0), PULL_MAX_WAIT_MS);
    const consumer = await this.getByName(name);

    const deadline = Date.now() + waitMs;
    let scanned = await this.scanPage(consumer, limit);
    while (scanned.length === 0 && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, PULL_POLL_INTERVAL_MS));
      scanned = await this.scanPage(consumer, limit);
    }

    const items = scanned.filter((row) => matchesConsumerPayload(row, consumer.filters));
    const last = scanned[scanned.length - 1];
    const head = await this.head();
    return {
      consumer: consumer.name,
      items,
      cursor: last ? Number(last.journalSeq) : consumer.cursor,
      head,
      hasMore: scanned.length === limit,
    };
  }

  /**
   * Advance the cursor. Monotonic: an ack equal to the stored cursor is an
   * idempotent no-op (client retry), an ack BEHIND it is refused with a 400 —
   * a durable cursor never moves backwards.
   */
  async ack(name: string, cursor: number): Promise<ConsumerWithLag> {
    const [updated] = await this.db
      .update(durableConsumers)
      .set({ cursor, updatedAt: new Date() })
      .where(and(eq(durableConsumers.name, name), lte(durableConsumers.cursor, cursor)))
      .returning();

    if (!updated) {
      const existing = await this.getByName(name); // throws NotFoundError when absent
      throw new ValidationError(
        `ack cursor ${cursor} is behind the stored cursor ${existing.cursor} — acks are monotonic`,
        undefined,
        { name, cursor, storedCursor: existing.cursor },
      );
    }

    const head = await this.head();
    return { ...updated, head, lag: computeLag(head, updated.cursor) };
  }

  /**
   * One ascending journal page after the consumer's cursor, pre-filtered by
   * the type filter in SQL (exact match, or trailing-* prefix glob — the
   * EventService.list / #966 contract; keep the two in sync).
   */
  private async scanPage(consumer: DurableConsumer, limit: number): Promise<OmniEvent[]> {
    const typeClause = consumer.eventType.endsWith('*')
      ? like(omniEvents.eventType, `${escapeLikePattern(consumer.eventType.slice(0, -1))}%`)
      : eq(omniEvents.eventType, consumer.eventType as OmniEvent['eventType']);

    return this.db
      .select()
      .from(omniEvents)
      .where(and(gt(omniEvents.journalSeq, consumer.cursor), typeClause))
      .orderBy(asc(omniEvents.journalSeq))
      .limit(limit);
  }
}
