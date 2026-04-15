/**
 * Follow-up lifecycle — pure arm/disarm orchestration.
 *
 * The arm/disarm primitives live here as functions that take a repo interface
 * (`FollowUpLifecycleRepo`) plus an event bus. The API layer wires them to a
 * Drizzle-backed repo in `packages/api/src/services/follow-up-lifecycle.ts`.
 *
 * Transitions:
 *  - `armSequence`: called on every outbound agent message. Upserts a row
 *    with `sequenceIndex = 0` and `nextFireAt = now + intervals[0]`. Emits
 *    `follow_up.armed`.
 *  - `disarmSequence`: called on customer reply / handoff / archive. Sets
 *    `disarmReason` and emits `follow_up.disarmed`.
 *
 * Idempotency:
 *  - `armSequence` upserts: re-arming an already-armed chat is a refresh
 *    (resets `sequenceIndex`, recalculates `nextFireAt`). Rationale: each
 *    outbound agent reply restarts the idle clock, which is the intuitive
 *    behavior for a "customer has gone idle" timer.
 *  - `disarmSequence` is a no-op if the row is already disarmed — returns
 *    `{ disarmed: false }` without emitting.
 *
 * @see issue #404 — Configurable Idle-Chat Follow-Up Sequences
 */

import type { EventBus } from '../../events/bus';
import type { FollowUpArmedPayload, FollowUpDisarmReason, FollowUpDisarmedPayload } from '../../events/types';
import type { Logger } from '../../logger';
import type { FollowUpSequenceConfig } from '../../schemas/follow-up';
import { computeInitialFireAt } from './schedule';

/**
 * Arm input — everything the repo needs to upsert a `chat_follow_up_state` row.
 */
export interface ArmInput {
  chatId: string;
  instanceId: string;
  agentId: string | null;
  config: FollowUpSequenceConfig;
  /** Timestamp of the outbound agent message — becomes `lastAgentMessageAt`. */
  lastAgentMessageAt: Date;
  /** Computed first fire timestamp. */
  nextFireAt: Date;
}

/**
 * Lifecycle repo contract — implemented by the API layer against Drizzle.
 *
 * Return type of `armSequence` distinguishes fresh arm from refresh so the
 * lifecycle can emit the right observability event.
 */
export interface FollowUpLifecycleRepo {
  /**
   * Upsert a follow-up state row. Returns `created: true` when a new row was
   * inserted, `false` when an existing row was refreshed.
   */
  upsertArmed(input: ArmInput): Promise<{ created: boolean }>;

  /**
   * Disarm the active row for a (chatId, instanceId) pair with the given
   * reason. Returns `disarmed: false` if the row is missing or already
   * disarmed — callers should skip event emission in that case.
   *
   * `lastInboundCustomerMessageAt` is a convenience for the
   * `customer_replied` path: the inbound hook has the timestamp in hand, so
   * the repo can persist it atomically.
   */
  disarmActive(input: {
    chatId: string;
    instanceId: string;
    reason: FollowUpDisarmReason;
    at: Date;
    lastInboundCustomerMessageAt?: Date;
  }): Promise<{ disarmed: boolean }>;

  /**
   * Record an inbound customer message timestamp on any active row without
   * disarming. Used by channels that want the 24h messaging-window guard to
   * keep an up-to-date `lastInboundCustomerMessageAt` even when the current
   * design always disarms on inbound — keeps the door open for future policy
   * tweaks without schema changes.
   *
   * Implementations may be a no-op.
   */
  touchInboundTimestamp?(input: { chatId: string; instanceId: string; at: Date }): Promise<void>;
}

export interface LifecycleDeps {
  repo: FollowUpLifecycleRepo;
  eventBus: Pick<EventBus, 'publish'>;
  logger: Pick<Logger, 'debug' | 'info' | 'warn' | 'error'>;
  now?: () => Date;
}

export interface ArmSequenceInput {
  chatId: string;
  instanceId: string;
  agentId: string | null;
  config: FollowUpSequenceConfig;
  /** Wall-clock timestamp of the outbound agent message. */
  lastAgentMessageAt: Date;
}

export interface ArmResult {
  armed: boolean;
  /** Whether a fresh row was created (false = existing row was refreshed). */
  created: boolean;
  nextFireAt: Date;
}

/**
 * Arm (or refresh) a follow-up sequence after an outbound agent message.
 *
 * No-op returning `{ armed: false }` when config is disabled.
 */
export async function armSequence(deps: LifecycleDeps, input: ArmSequenceInput): Promise<ArmResult> {
  if (input.config.enabled === false) {
    return { armed: false, created: false, nextFireAt: input.lastAgentMessageAt };
  }

  const nextFireAtMs = computeInitialFireAt(input.config, input.lastAgentMessageAt.getTime());
  const nextFireAt = new Date(nextFireAtMs);

  const { created } = await deps.repo.upsertArmed({
    chatId: input.chatId,
    instanceId: input.instanceId,
    agentId: input.agentId,
    config: input.config,
    lastAgentMessageAt: input.lastAgentMessageAt,
    nextFireAt,
  });

  const payload: FollowUpArmedPayload = {
    chatId: input.chatId,
    instanceId: input.instanceId,
    agentId: input.agentId,
    sequenceIndex: 0,
    nextFireAt: nextFireAtMs,
  };

  try {
    await deps.eventBus.publish('follow_up.armed', payload, {
      instanceId: input.instanceId,
      ...(input.agentId ? { agentId: input.agentId } : {}),
    });
  } catch (err) {
    deps.logger.warn('follow-up lifecycle: failed to emit follow_up.armed', {
      chatId: input.chatId,
      instanceId: input.instanceId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { armed: true, created, nextFireAt };
}

export interface DisarmSequenceInput {
  chatId: string;
  instanceId: string;
  agentId?: string | null;
  reason: FollowUpDisarmReason;
  /** Only meaningful for `reason === 'customer_replied'`. */
  lastInboundCustomerMessageAt?: Date;
}

export interface DisarmResult {
  disarmed: boolean;
}

/**
 * Disarm the active follow-up sequence for a chat. No-op when no active row
 * exists — callers can safely fire this on every inbound/handoff/archive.
 */
export async function disarmSequence(deps: LifecycleDeps, input: DisarmSequenceInput): Promise<DisarmResult> {
  const now = (deps.now ?? (() => new Date()))();

  const { disarmed } = await deps.repo.disarmActive({
    chatId: input.chatId,
    instanceId: input.instanceId,
    reason: input.reason,
    at: now,
    ...(input.lastInboundCustomerMessageAt ? { lastInboundCustomerMessageAt: input.lastInboundCustomerMessageAt } : {}),
  });

  if (!disarmed) {
    return { disarmed: false };
  }

  const payload: FollowUpDisarmedPayload = {
    chatId: input.chatId,
    instanceId: input.instanceId,
    agentId: input.agentId ?? null,
    // sequenceIndex unknown without another read — use -1 to mark "unknown at
    // disarm emission time"; consumers that need the exact index should
    // correlate via the prior `follow_up.armed` event.
    sequenceIndex: -1,
    reason: input.reason,
  };

  try {
    await deps.eventBus.publish('follow_up.disarmed', payload, {
      instanceId: input.instanceId,
      ...(input.agentId ? { agentId: input.agentId } : {}),
    });
  } catch (err) {
    deps.logger.warn('follow-up lifecycle: failed to emit follow_up.disarmed', {
      chatId: input.chatId,
      instanceId: input.instanceId,
      reason: input.reason,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { disarmed: true };
}
