/**
 * Follow-up sweeper — fires `chat.idle_timeout` for every due row and
 * advances the sequence.
 *
 * The sweeper is invoked by the API's in-process `Scheduler` on a `*\/15 * * * * *`
 * cron. This module is pure logic: data access is injected via `FollowUpStateRepo`
 * so the core package stays free of `@omni/db` and the handler is trivial to unit
 * test.
 *
 * Concurrency:
 * - `findAndLockDue` is responsible for returning only rows this worker "owns"
 *   (atomic `UPDATE ... RETURNING` or `FOR UPDATE SKIP LOCKED`). The sweeper
 *   itself is therefore idempotent under overlapping ticks.
 *
 * @see issue #404 — Configurable Idle-Chat Follow-Up Sequences
 */

import type { EventBus } from '../../events/bus';
import type {
  ChatIdleTimeoutPayload,
  FollowUpArmedPayload,
  FollowUpDisarmReason,
  FollowUpDisarmedPayload,
  FollowUpFiredPayload,
  FollowUpSkippedPayload,
} from '../../events/types';
import type { Logger } from '../../logger';
import type { FollowUpSequenceConfig } from '../../schemas/follow-up';
import type { ChannelType } from '../../types/channel';
import { computeNextFireAt } from './schedule';

/**
 * Durable follow-up row as the sweeper understands it. Independent of the
 * Drizzle row shape so the core module stays DB-agnostic.
 *
 * `channelType` and `lastInboundCustomerMessageAt` are optional because they
 * are only required by the 24h messaging-window guard. Rows originating from
 * channels without a messaging window can leave them null.
 */
export interface FollowUpStateRow {
  id: string;
  chatId: string;
  instanceId: string;
  agentId: string | null;
  chatName: string | null;
  sequenceConfig: FollowUpSequenceConfig;
  sequenceIndex: number;
  lastAgentMessageAt: Date;
  /** Channel type of the instance — needed for channel-capability probes. */
  channelType?: ChannelType | null;
  /** Timestamp of the most recent inbound customer message — consumed by the 24h BSP window guard. */
  lastInboundCustomerMessageAt?: Date | null;
  /**
   * Most recent message timestamp on the chat (any direction). Consumed
   * by `HumanActiveProbe` implementations to detect out-of-band activity
   * — when this is more recent than `lastAgentMessageAt` AND
   * `chatLastMessageFromMe` is `true`, it strongly suggests a human
   * operator replied directly in the channel inbox without going through
   * the bot pipeline.
   */
  chatLastMessageAt?: Date | null;
  /**
   * Direction of the most recent message on the chat. Companion to
   * `chatLastMessageAt` — see field doc above for usage.
   */
  chatLastMessageFromMe?: boolean | null;
}

/**
 * Advance input — everything `recordFired` needs to commit a successful fire.
 */
export interface AdvanceInput {
  id: string;
  nextSequenceIndex: number;
  /** Null when the sequence has completed (sequence_complete). */
  nextFireAt: Date | null;
  /** Non-null when the sequence is being disarmed after this fire. */
  disarmReason: FollowUpDisarmReason | null;
  /** Wall-clock reference for `updatedAt` / `disarmedAt`. */
  firedAt: Date;
}

/**
 * Data-access contract implemented by the API layer.
 */
export interface FollowUpStateRepo {
  /**
   * Return up to `limit` rows that are due (`nextFireAt <= now`) and still
   * armed (`disarmReason IS NULL`). Implementations should use row-level
   * locking (`FOR UPDATE SKIP LOCKED`) or an atomic claim pattern so
   * concurrent sweeper ticks don't double-fire.
   */
  findAndLockDue(now: Date, limit: number): Promise<FollowUpStateRow[]>;

  /** Persist the result of a successful fire. */
  recordFired(input: AdvanceInput): Promise<void>;

  /** Mark a row disarmed without firing (e.g. `window_expired`). */
  recordDisarmed(id: string, reason: FollowUpDisarmReason, at: Date): Promise<void>;
}

/**
 * Channel capability probe. Allows the sweeper to honor the 24h BSP messaging
 * window without coupling to any specific channel package. Defaults to "no
 * constraint" when the helper is not provided.
 *
 * Returning `'within'` means the fire should proceed; `'expired'` means the
 * sweeper should disarm with `window_expired` and not emit `chat.idle_timeout`.
 */
export type MessagingWindowProbe = (row: FollowUpStateRow, now: Date) => 'within' | 'expired' | 'unknown';

/**
 * Out-of-band human-agent probe. Lets the sweeper detect that a human agent
 * is actively handling the chat outside the bot pipeline (e.g. an operator
 * took over the conversation directly in the channel's agent inbox without
 * going through our `human_handoff` tool).
 *
 * - `'active'`  — a human agent is currently handling the chat; the sweeper
 *                 disarms with reason `human_active` and does NOT emit
 *                 `chat.idle_timeout`. Re-arm happens normally on the next
 *                 genuine `message.sent` from the configured agent.
 * - `'inactive'` — no human-agent activity detected; the fire proceeds.
 * - `'unknown'` — probe is unable to decide (channel doesn't expose the
 *                 signal, transient error). Treated as `'inactive'` —
 *                 fire-on-uncertainty preserves the existing behaviour for
 *                 channels/configurations without the probe wired in.
 *
 * Implementations are expected to be cheap (read DB columns the sweeper
 * already has access to) OR to apply their own pre-filter before doing any
 * expensive lookup (HTTP to a channel API). The sweeper does not pre-filter.
 *
 * See: brain/snapshots/cego-historico-gupshup-2026-05-28 (Caso B) for the
 * production incident this probe addresses.
 */
export type HumanActiveProbe = (row: FollowUpStateRow, now: Date) => Promise<'active' | 'inactive' | 'unknown'>;

/**
 * Dependencies for a single sweep invocation.
 */
export interface SweeperDeps {
  repo: FollowUpStateRepo;
  eventBus: Pick<EventBus, 'publish'>;
  logger: Pick<Logger, 'debug' | 'info' | 'warn' | 'error'>;
  /** Optional window probe — if omitted, the window guard is skipped. */
  messagingWindowProbe?: MessagingWindowProbe;
  /**
   * Optional human-active probe — if omitted, the human-active guard is
   * skipped (current behaviour preserved). When provided, the sweeper
   * disarms candidate rows where the probe returns `'active'` instead of
   * firing `chat.idle_timeout`.
   */
  humanActiveProbe?: HumanActiveProbe;
  /**
   * Max rows processed per tick. Defaults to 100 — enough to keep 6k/min of
   * throughput on a single worker while bounding DB load per query.
   */
  batchLimit?: number;
  /** Override the wall clock — used in tests. */
  now?: () => Date;
}

export interface SweepStats {
  scanned: number;
  fired: number;
  disarmed: number;
  skipped: number;
}

const DEFAULT_BATCH_LIMIT = 100;
const MINUTES_PER_MS = 1 / 60_000;

/**
 * Render the synthetic prompt from `sequenceConfig.promptTemplate`.
 *
 * Supported placeholders (simple string replacement):
 *   - `{{minutes}}` — minutes since the agent's last reply
 *   - `{{sequenceIndex}}` — zero-based index of the follow-up about to fire
 *   - `{{attemptNumber}}` — one-based attempt number (`sequenceIndex + 1`)
 *   - `{{totalAttempts}}` — total attempts configured (`maxFollowUps`)
 *   - `{{chatName}}` — chat display name, or an empty string if unknown
 *
 * `attemptNumber` / `totalAttempts` exist so prompts can read naturally
 * ("Attempt 2 of 3") instead of exposing the zero-based index to the LLM,
 * which was shown to confuse agents into hallucinating a stop condition
 * from their own session memory.
 */
export function renderSyntheticPrompt(
  template: string,
  context: {
    minutes: number;
    sequenceIndex: number;
    totalAttempts: number;
    chatName: string | null;
  },
): string {
  return template
    .replace(/\{\{\s*minutes\s*\}\}/g, String(context.minutes))
    .replace(/\{\{\s*sequenceIndex\s*\}\}/g, String(context.sequenceIndex))
    .replace(/\{\{\s*attemptNumber\s*\}\}/g, String(context.sequenceIndex + 1))
    .replace(/\{\{\s*totalAttempts\s*\}\}/g, String(context.totalAttempts))
    .replace(/\{\{\s*chatName\s*\}\}/g, context.chatName ?? '');
}

/**
 * Run one sweep tick. Safe to call concurrently thanks to the repo's locking
 * contract (see `findAndLockDue`).
 */
export async function sweepFollowUps(deps: SweeperDeps): Promise<SweepStats> {
  const limit = deps.batchLimit ?? DEFAULT_BATCH_LIMIT;
  const clock = deps.now ?? (() => new Date());
  const now = clock();

  const due = await deps.repo.findAndLockDue(now, limit);

  const stats: SweepStats = {
    scanned: due.length,
    fired: 0,
    disarmed: 0,
    skipped: 0,
  };

  if (due.length === 0) {
    return stats;
  }

  for (const row of due) {
    try {
      await processRow(row, now, deps, stats);
    } catch (err) {
      stats.skipped += 1;
      deps.logger.error('follow-up sweeper: failed to process row', {
        id: row.id,
        chatId: row.chatId,
        error: err instanceof Error ? err.message : String(err),
      });
      await emitSkipped(deps, row, err instanceof Error ? err.message : String(err));
    }
  }

  deps.logger.debug('follow-up sweeper tick', {
    scanned: stats.scanned,
    fired: stats.fired,
    disarmed: stats.disarmed,
    skipped: stats.skipped,
  });

  return stats;
}

async function processRow(row: FollowUpStateRow, now: Date, deps: SweeperDeps, stats: SweepStats): Promise<void> {
  // 24h messaging-window guard (if the row lives on a channel where it applies).
  if (row.sequenceConfig.stopOutsideMessagingWindow && deps.messagingWindowProbe) {
    const verdict = deps.messagingWindowProbe(row, now);
    if (verdict === 'expired') {
      await disarm(deps, row, 'window_expired', now);
      stats.disarmed += 1;
      return;
    }
  }

  // Out-of-band human-agent guard. If a human is actively handling the
  // chat outside the bot pipeline, disarm instead of firing — otherwise
  // the proactive nudge would step on the live human conversation. See
  // brain/snapshots/cego-historico-gupshup-2026-05-28 (Caso B).
  if (deps.humanActiveProbe) {
    const verdict = await deps.humanActiveProbe(row, now);
    if (verdict === 'active') {
      await disarm(deps, row, 'human_active', now);
      stats.disarmed += 1;
      return;
    }
  }

  const minutesSince = Math.max(0, Math.round((now.getTime() - row.lastAgentMessageAt.getTime()) * MINUTES_PER_MS));
  const totalAttempts = row.sequenceConfig.maxFollowUps;
  const syntheticPrompt = renderSyntheticPrompt(row.sequenceConfig.promptTemplate, {
    minutes: minutesSince,
    sequenceIndex: row.sequenceIndex,
    totalAttempts,
    chatName: row.chatName,
  });

  const idlePayload: ChatIdleTimeoutPayload = {
    chatId: row.chatId,
    instanceId: row.instanceId,
    agentId: row.agentId,
    sequenceIndex: row.sequenceIndex,
    attemptNumber: row.sequenceIndex + 1,
    totalAttempts,
    minutesSinceLastAgentReply: minutesSince,
    syntheticPrompt,
    ...(row.chatName ? { chatName: row.chatName } : {}),
  };

  await deps.eventBus.publish('chat.idle_timeout', idlePayload, {
    instanceId: row.instanceId,
    ...(row.agentId ? { agentId: row.agentId } : {}),
  });

  const firedPayload: FollowUpFiredPayload = {
    chatId: row.chatId,
    instanceId: row.instanceId,
    agentId: row.agentId,
    sequenceIndex: row.sequenceIndex,
    firedAt: now.getTime(),
    syntheticPrompt,
  };
  await deps.eventBus.publish('follow_up.fired', firedPayload, {
    instanceId: row.instanceId,
    ...(row.agentId ? { agentId: row.agentId } : {}),
  });

  // Advance the sequence — compute next fire or complete.
  const nextFireAtMs = computeNextFireAt(row.sequenceConfig, row.sequenceIndex, now.getTime());
  const nextIndex = row.sequenceIndex + 1;

  if (nextFireAtMs === null) {
    await deps.repo.recordFired({
      id: row.id,
      nextSequenceIndex: nextIndex,
      nextFireAt: null,
      disarmReason: 'sequence_complete',
      firedAt: now,
    });
    await emitDisarmed(deps, row, 'sequence_complete', nextIndex);
    stats.fired += 1;
    stats.disarmed += 1;
    return;
  }

  await deps.repo.recordFired({
    id: row.id,
    nextSequenceIndex: nextIndex,
    nextFireAt: new Date(nextFireAtMs),
    disarmReason: null,
    firedAt: now,
  });

  // A follow-up that fired successfully and re-armed for the next tick is a
  // distinct observability event from the initial arm. The wish reserves
  // `follow_up.armed` for arm/refresh events; we emit it here as well so
  // consumers see the refreshed `nextFireAt`.
  const armedPayload: FollowUpArmedPayload = {
    chatId: row.chatId,
    instanceId: row.instanceId,
    agentId: row.agentId,
    sequenceIndex: nextIndex,
    nextFireAt: nextFireAtMs,
  };
  await deps.eventBus.publish('follow_up.armed', armedPayload, {
    instanceId: row.instanceId,
    ...(row.agentId ? { agentId: row.agentId } : {}),
  });

  stats.fired += 1;
}

async function disarm(
  deps: SweeperDeps,
  row: FollowUpStateRow,
  reason: FollowUpDisarmReason,
  now: Date,
): Promise<void> {
  await deps.repo.recordDisarmed(row.id, reason, now);
  await emitDisarmed(deps, row, reason, row.sequenceIndex);
}

async function emitDisarmed(
  deps: SweeperDeps,
  row: FollowUpStateRow,
  reason: FollowUpDisarmReason,
  sequenceIndex: number,
): Promise<void> {
  const payload: FollowUpDisarmedPayload = {
    chatId: row.chatId,
    instanceId: row.instanceId,
    agentId: row.agentId,
    sequenceIndex,
    reason,
  };
  await deps.eventBus.publish('follow_up.disarmed', payload, {
    instanceId: row.instanceId,
    ...(row.agentId ? { agentId: row.agentId } : {}),
  });
}

async function emitSkipped(deps: SweeperDeps, row: FollowUpStateRow, reason: string): Promise<void> {
  const payload: FollowUpSkippedPayload = {
    chatId: row.chatId,
    instanceId: row.instanceId,
    agentId: row.agentId,
    sequenceIndex: row.sequenceIndex,
    reason,
  };
  try {
    await deps.eventBus.publish('follow_up.skipped', payload, {
      instanceId: row.instanceId,
      ...(row.agentId ? { agentId: row.agentId } : {}),
    });
  } catch (err) {
    deps.logger.error('follow-up sweeper: failed to emit follow_up.skipped', {
      id: row.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
