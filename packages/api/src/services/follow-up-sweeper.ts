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
  type FollowUpSequenceConfig,
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
import { and, eq, gt, isNull, lt, lte, sql } from 'drizzle-orm';
import type { FollowUpLifecycleService } from './follow-up-lifecycle';

const log = createLogger('follow-up-sweeper');

/**
 * Upper bound on how stale a `customer_replied` row may be before the
 * stale-pause pass refuses to re-arm it. 7 days matches typical inbound
 * recency cutoffs across our deployed sequences (longest first interval
 * we have observed is ~24h; 7d gives ~7x safety margin) without re-engaging
 * leads who have effectively gone cold.
 */
const STALE_PAUSE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Lower bound — only consider rows whose customer-inbound timestamp is at
 * least this old. Smaller than every plausible first interval (the smallest
 * we have observed in production is 1 minute) so the per-row check on the
 * row's actual `firstIntervalMinutes` is the binding gate; this just keeps
 * the SQL set small when many chats are in flight.
 */
const STALE_PAUSE_MIN_AGE_MS = 60_000;

/**
 * Cap on rows examined per tick. Picked to bound query+rearm latency at
 * sweeper cadence (15s) — a backlog drains over multiple ticks.
 */
const STALE_PAUSE_MAX_PER_TICK = 100;

export interface SweepStats {
  scanned: number;
  fired: number;
  disarmed: number;
  skipped: number;
  rearmed: number;
  // Index signature so this satisfies `Record<string, unknown>` for the
  // logger's structured-context parameter without a cast at the call site.
  [key: string]: number;
}

export class FollowUpSweeperService {
  private readonly repo: FollowUpStateRepo;
  private readonly messagingWindowProbe: MessagingWindowProbe;
  private lifecycle: FollowUpLifecycleService | null = null;

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
   * Inject the lifecycle service after construction. Required for the
   * stale-pause re-arm pass introduced in #624 — wired by `services/index.ts`
   * after both services exist (avoids a constructor-time circular dep).
   * Calls without lifecycle injected gracefully skip the re-arm pass.
   */
  setLifecycle(lifecycle: FollowUpLifecycleService): void {
    this.lifecycle = lifecycle;
  }

  /**
   * Run a single sweep tick. Two passes per tick:
   *  1. Re-arm stale `customer_replied` rows whose customer-inbound
   *     timestamp has aged past the configured first interval — closes the
   *     hole described in #624 where a sequence stays disarmed indefinitely
   *     when the agent never produces a follow-up outbound.
   *  2. Fire due rows + advance/disarm them — the original sweeper behavior.
   *
   * No-ops when the event bus is not connected.
   */
  async sweep(): Promise<SweepStats> {
    if (!this.eventBus) {
      return { scanned: 0, fired: 0, disarmed: 0, skipped: 0, rearmed: 0 };
    }
    // Pass 1 — re-arm stale customer_replied pauses (#624).
    // Runs before the fire-due pass so any row that newly transitions back
    // to armed is eligible immediately on the next tick.
    const rearmed = await this.sweepStaleCustomerReplied();
    // Pass 2 — original fire-due sweep.
    const fireStats = await sweepFollowUps({
      repo: this.repo,
      eventBus: this.eventBus,
      logger: this.logger,
      messagingWindowProbe: this.messagingWindowProbe,
    });
    return { ...fireStats, rearmed };
  }

  /**
   * Re-arm `customer_replied` rows whose customer-inbound timestamp has
   * aged past the row's configured first interval. Called from `sweep()`
   * (#624). Does NOT run when the lifecycle service hasn't been wired —
   * keeps the sweeper compatible with bare-bones constructions (tests that
   * don't exercise this path can omit `setLifecycle`).
   *
   * Gates (matched against `findAndLockDue` so we don't re-introduce the
   * #528 race in chats that were paused after the disarm):
   *  - `disarm_reason = 'customer_replied'`
   *  - `last_inbound_customer_message_at` set, and within
   *    `[STALE_PAUSE_MIN_AGE_MS, STALE_PAUSE_MAX_AGE_MS]`
   *  - `chats.settings->>'agentPaused'` not `'true'`
   *
   * Per-row it then defers to `lifecycle.armForInbound`, which checks
   * close-state, resolves config, runs the terminal-disarm guard, and emits
   * `follow_up.armed`. Rows whose first interval is larger than the actual
   * inbound age are skipped (will be picked up next tick).
   */
  private async sweepStaleCustomerReplied(): Promise<number> {
    if (!this.lifecycle) return 0;

    const now = new Date();
    const minBoundary = new Date(now.getTime() - STALE_PAUSE_MAX_AGE_MS);
    const maxBoundary = new Date(now.getTime() - STALE_PAUSE_MIN_AGE_MS);

    // Wrap the SELECT in a transaction with `FOR UPDATE SKIP LOCKED` to
    // mirror `findAndLockDue` (line ~100). Two reasons:
    //  1. Concurrent workers (multiple API instances OR overlapping ticks
    //     within a single instance when sweep latency exceeds the 15s
    //     cadence) would otherwise both read the same `customer_replied`
    //     rows and both call `armForInbound` on each. The DB write is
    //     idempotent (`upsertArmed` is `INSERT ... ON CONFLICT DO UPDATE`)
    //     but `armSequence` publishes `follow_up.armed` once per call —
    //     two workers ⇒ duplicate observability events.
    //  2. Architectural parity with `findAndLockDue`: both passes claim
    //     work units from the same table; both should use the same
    //     concurrency primitive so a future maintainer doesn't have to
    //     reason about two different locking models.
    const candidates = await this.db.transaction(async (tx) => {
      return (
        tx
          .select({
            chatId: chatFollowUpState.chatId,
            instanceId: chatFollowUpState.instanceId,
            agentId: chatFollowUpState.agentId,
            sequenceConfig: chatFollowUpState.sequenceConfig,
            lastInboundCustomerMessageAt: chatFollowUpState.lastInboundCustomerMessageAt,
          })
          .from(chatFollowUpState)
          .leftJoin(chats, eq(chatFollowUpState.chatId, chats.id))
          .where(
            and(
              eq(chatFollowUpState.disarmReason, 'customer_replied'),
              gt(chatFollowUpState.lastInboundCustomerMessageAt, minBoundary),
              lt(chatFollowUpState.lastInboundCustomerMessageAt, maxBoundary),
              // Same null-safe agentPaused gate as `findAndLockDue` —
              // preserves the #528 race fix for the re-arm path.
              sql`(${chats.settings}->>'agentPaused') IS DISTINCT FROM 'true'`,
            ),
          )
          .orderBy(chatFollowUpState.lastInboundCustomerMessageAt)
          .limit(STALE_PAUSE_MAX_PER_TICK)
          // Lock only the state row, not the joined chat row — `FOR UPDATE`
          // can't be applied to the nullable side of an outer join.
          .for('update', { of: chatFollowUpState, skipLocked: true })
      );
    });

    let rearmed = 0;
    for (const row of candidates) {
      if (!row.lastInboundCustomerMessageAt) continue;
      const config = row.sequenceConfig as FollowUpSequenceConfig | null;
      if (!config) continue;

      const firstIntervalMinutes =
        config.schedule.kind === 'fixed' ? config.schedule.intervalsMinutes[0] : config.schedule.initialMinutes;
      if (typeof firstIntervalMinutes !== 'number' || firstIntervalMinutes <= 0) continue;

      const ageMs = now.getTime() - row.lastInboundCustomerMessageAt.getTime();
      if (ageMs < firstIntervalMinutes * 60_000) {
        // Row's customer inbound is more recent than the row's own first
        // interval — not stale enough for THIS row's config. Will surface
        // again on a future tick once the threshold elapses.
        continue;
      }

      try {
        await this.lifecycle.armForInbound({
          chatId: row.chatId,
          instanceId: row.instanceId,
          agentId: row.agentId,
          config,
          lastInboundCustomerMessageAt: row.lastInboundCustomerMessageAt,
        });
        rearmed += 1;
      } catch (err) {
        // Swallow — failure of one row must not abort the rest of the pass.
        // `armForInbound` already logs internally.
        this.logger.warn('follow-up sweeper: stale-pause re-arm failed for row', {
          chatId: row.chatId,
          instanceId: row.instanceId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return rearmed;
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
        .where(
          and(
            isNull(chatFollowUpState.disarmReason),
            lte(chatFollowUpState.nextFireAt, now),
            // Skip chats with agentPaused=true — closes the race where the
            // sweeper fires idle_timeout after `/send/handoff` has set
            // agentPaused but before the `chat.handoff_activated` disarm
            // has committed. See issue #528.
            //
            // Compare the JSONB text form directly rather than casting to
            // boolean — `->>` returns NULL for missing keys and `'true'` /
            // `'false'` for booleans. `IS DISTINCT FROM 'true'` is null-safe
            // and avoids a runtime cast error if a non-boolean value ever
            // lands in `settings.agentPaused`.
            sql`(${chats.settings}->>'agentPaused') IS DISTINCT FROM 'true'`,
          ),
        )
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
