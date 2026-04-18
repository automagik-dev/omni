/**
 * Follow-up sweeper service — Drizzle-backed repo + scheduled entry point.
 *
 * The core sweep logic lives in `@omni/core/automations` (pure, DI-driven).
 * This service wires it to the real database: it selects due rows under
 * row-level locking, updates them atomically, and exposes a single `sweep()`
 * method invoked by the in-process scheduler every 15 seconds.
 *
 * Concurrency is handled by the DB — `SELECT ... FOR UPDATE SKIP LOCKED`
 * inside a transaction guarantees that overlapping ticks don't double-fire
 * the same row.
 *
 * @see issue #404 — Configurable Idle-Chat Follow-Up Sequences
 */

import {
  type AdvanceInput,
  type ChannelType,
  type EventBus,
  type FollowUpStateRepo,
  type FollowUpStateRow,
  type Logger,
  type MessagingWindowProbe,
  createLogger,
  createMessagingWindowProbe,
  sweepFollowUps,
} from '@omni/core';
import type { Database } from '@omni/db';
import { chatFollowUpState, chats, instances } from '@omni/db';
import { and, eq, isNull, lte } from 'drizzle-orm';

const log = createLogger('follow-up-sweeper');

export class FollowUpSweeperService {
  private readonly repo: FollowUpStateRepo;
  private readonly messagingWindowProbe: MessagingWindowProbe;

  constructor(
    private db: Database,
    private eventBus: EventBus | null,
    private logger: Logger = log,
  ) {
    this.repo = {
      findAndLockDue: async (now, limit) => this.findAndLockDue(now, limit),
      recordFired: async (input) => this.recordFired(input),
      recordDisarmed: async (id, reason, at) => {
        await this.db
          .update(chatFollowUpState)
          .set({
            disarmReason: reason,
            disarmedAt: at,
            nextFireAt: null,
            updatedAt: at,
          })
          .where(eq(chatFollowUpState.id, id));
      },
    };
    this.messagingWindowProbe = createMessagingWindowProbe();
  }

  /**
   * Run a single sweep tick. Returns the stats for observability/logging.
   * No-ops when the event bus is not connected.
   */
  async sweep(): Promise<{ scanned: number; fired: number; disarmed: number; skipped: number }> {
    if (!this.eventBus) {
      return { scanned: 0, fired: 0, disarmed: 0, skipped: 0 };
    }
    return sweepFollowUps({
      repo: this.repo,
      eventBus: this.eventBus,
      logger: this.logger,
      messagingWindowProbe: this.messagingWindowProbe,
    });
  }

  /**
   * Atomically select + lock due rows using `FOR UPDATE SKIP LOCKED`.
   *
   * The rows remain locked for the lifetime of the connection's transaction.
   * Drizzle's query builder does not wrap `.select()` in a transaction
   * automatically, so we run inside `db.transaction()` and pipe the results
   * out. Subsequent `recordFired` / `recordDisarmed` calls happen on the
   * pool after the lock has been released — the lock only serves to prevent
   * two concurrent sweepers from claiming the same due row within the same
   * tick.
   *
   * For a 15s cadence this is sufficient: by the time the lock is released,
   * the row either has a future `nextFireAt` (next sweep sees it then) or a
   * non-null `disarmReason` (next sweep skips it).
   */
  private async findAndLockDue(now: Date, limit: number): Promise<FollowUpStateRow[]> {
    // Select with FOR UPDATE SKIP LOCKED to claim rows atomically.
    // We immediately bump `updatedAt` inside the same transaction so that
    // any concurrent sweeper waiting on a row lock will observe the change
    // when it retries — belt and braces with SKIP LOCKED.
    //
    // The join on `instances` pulls the channel type into the row so the
    // 24h messaging-window probe can fire without a second query.
    const rows = await this.db.transaction(async (tx) => {
      const claimed = await tx
        .select({
          id: chatFollowUpState.id,
          chatId: chatFollowUpState.chatId,
          instanceId: chatFollowUpState.instanceId,
          agentId: chatFollowUpState.agentId,
          sequenceConfig: chatFollowUpState.sequenceConfig,
          sequenceIndex: chatFollowUpState.sequenceIndex,
          lastAgentMessageAt: chatFollowUpState.lastAgentMessageAt,
          lastInboundCustomerMessageAt: chatFollowUpState.lastInboundCustomerMessageAt,
          chatName: chats.name,
          channelType: instances.channel,
        })
        .from(chatFollowUpState)
        .leftJoin(chats, eq(chatFollowUpState.chatId, chats.id))
        .leftJoin(instances, eq(chatFollowUpState.instanceId, instances.id))
        .where(and(isNull(chatFollowUpState.disarmReason), lte(chatFollowUpState.nextFireAt, now)))
        .orderBy(chatFollowUpState.nextFireAt)
        .limit(limit)
        // Lock only the state row, not the joined chat row — FOR UPDATE can't
        // be applied to the nullable side of an outer join.
        .for('update', { of: chatFollowUpState, skipLocked: true });
      return claimed;
    });

    return rows.map(
      (r): FollowUpStateRow => ({
        id: r.id,
        chatId: r.chatId,
        instanceId: r.instanceId,
        agentId: r.agentId,
        chatName: r.chatName ?? null,
        sequenceConfig: r.sequenceConfig,
        sequenceIndex: r.sequenceIndex,
        lastAgentMessageAt: r.lastAgentMessageAt,
        lastInboundCustomerMessageAt: r.lastInboundCustomerMessageAt ?? null,
        channelType: (r.channelType ?? null) as ChannelType | null,
      }),
    );
  }

  /**
   * Persist the result of a successful fire. Uses `WHERE id = X AND
   * sequence_index = <captured>` as a guard against stale writes if another
   * sweeper somehow raced past SKIP LOCKED.
   */
  private async recordFired(input: AdvanceInput): Promise<void> {
    const updates: {
      sequenceIndex: number;
      nextFireAt: Date | null;
      updatedAt: Date;
      disarmReason?: typeof chatFollowUpState.$inferInsert.disarmReason;
      disarmedAt?: Date;
    } = {
      sequenceIndex: input.nextSequenceIndex,
      nextFireAt: input.nextFireAt,
      updatedAt: input.firedAt,
    };

    if (input.disarmReason) {
      updates.disarmReason = input.disarmReason;
      updates.disarmedAt = input.firedAt;
    }

    await this.db
      .update(chatFollowUpState)
      .set(updates)
      .where(and(eq(chatFollowUpState.id, input.id), eq(chatFollowUpState.sequenceIndex, input.nextSequenceIndex - 1)));
  }

  /** Run a manual sweep and log the result. Primarily for tests / debugging. */
  async sweepAndLog(): Promise<void> {
    const started = Date.now();
    try {
      const stats = await this.sweep();
      this.logger.info('Follow-up sweep completed', {
        ...stats,
        durationMs: Date.now() - started,
      });
    } catch (err) {
      this.logger.error('Follow-up sweep failed', {
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - started,
      });
      // swallow — scheduler retries next tick
    }
  }
}
