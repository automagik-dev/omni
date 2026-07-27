/**
 * Follow-up lifecycle service — Drizzle-backed arm/disarm hooks.
 *
 * Wires `armSequence` / `disarmSequence` (pure core logic) to the
 * `chat_follow_up_state` table, and exposes a `resolveConfig` helper that
 * reads the per-agent / per-instance / per-chat config columns exposed by
 * Group 6 and runs the closest-wins resolver.
 *
 * See `packages/core/src/automations/follow-up/lifecycle.ts` for the
 * transition rules; this service only owns the persistence + config read.
 *
 * @see issue #404 — Configurable Idle-Chat Follow-Up Sequences
 */

import {
  type ArmInput,
  type ArmSequenceInput,
  type DisarmSequenceInput,
  type EventBus,
  type FollowUpConfigInputs,
  type FollowUpDisarmReason,
  type FollowUpLifecycleRepo,
  type FollowUpSequenceConfig,
  type Logger,
  armSequence,
  createLogger,
  disarmSequence,
  resolveFollowUpConfig,
} from '@omni/core';
import {
  type Agent,
  type Chat,
  type ChatSettings,
  type Database,
  type Instance,
  agents,
  chatFollowUpState,
  chats,
  instances,
} from '@omni/db';
import { and, eq, isNull, notInArray, or, sql } from 'drizzle-orm';
import { isChatInActiveCloseState } from '../lib/close-contact-state';

const log = createLogger('follow-up-lifecycle');

/**
 * Disarm reasons that represent a terminal user/operator intent to stop the
 * conversation. An agent-origin message received after one of these should
 * NOT resurrect the sequence unless a customer message arrived in between
 * (see `armForOutbound` re-arm guard). Tail-stream chunks, NATS redeliveries,
 * or any agent activity that predates the disarm would otherwise re-arm a
 * sequence the user explicitly terminated — that was #419.
 *
 * `customer_replied`, `sequence_complete`, `agent_error`, `send_failed` are
 * *not* terminal intent: the former resumes on the very next agent reply
 * (normal flow), the latter three mean the sequence ran its course or
 * errored out and a brand-new agent reply can legitimately arm afresh.
 */
// ─────────────────────────────────────────────────────────────
// Idle-timeout delivery identity dedupe
// ─────────────────────────────────────────────────────────────
//
// The sweeper emits exactly one `chat.idle_timeout` per
// (chatId, instanceId, sequenceIndex) — it publishes the PRE-increment index
// and then advances the row — so that triple IS the event's identity. Tracking
// which triples were already handed to the automation engine lets the gate
// discriminate the two cases a sequence-distance comparison cannot tell apart:
//
//   • first delivery of event N while the row already reads N+1 → legitimate
//     (the publish/consume race that dropped ~14% of follow-ups, f149179a);
//   • JetStream redelivery of event N after an ack timeout, row also at N+1 →
//     duplicate, must be dropped or the chat gets the same follow-up twice.
//
// The triple alone is NOT stable enough to key a claim: `upsertArmed` resets
// `sequenceIndex` to 0 on every re-arm, so the extremely common
// fire → customer replies (disarm) → agent replies (re-arm) → idles again cycle
// produces a second, entirely legitimate event 0 for the same chat — which a
// (chat, instance, index) claim from the previous cycle would have swallowed for
// the claim's whole 6h TTL. The key therefore carries an ARM EPOCH: the row's
// `lastAgentMessageAt`, which `upsertArmed` rewrites on every arm and which
// `recordFired` never touches. That makes the epoch constant across an event's
// own redeliveries (the property the dedupe needs) and distinct across re-arms
// (the property that keeps legitimate follow-ups flowing).
//
// In-memory and best-effort by design: a process restart forgets the claims and
// the gate degrades to fail-open (a redundant follow-up), which is the same
// trade-off the rest of this gate already makes.
const IDLE_TIMEOUT_CLAIM_TTL_MS = 6 * 60 * 60 * 1000;
const IDLE_TIMEOUT_CLAIM_MAX_ENTRIES = 20_000;
const idleTimeoutClaims = new Map<string, number>();

/** Test-only: clears the in-memory idle-timeout delivery claims. */
export function resetIdleTimeoutClaims(): void {
  idleTimeoutClaims.clear();
}

function pruneIdleTimeoutClaims(now: number): void {
  for (const [key, ts] of idleTimeoutClaims) {
    if (now - ts > IDLE_TIMEOUT_CLAIM_TTL_MS) idleTimeoutClaims.delete(key);
  }
  // Hard bound: Map iterates in insertion order, so the head is the oldest.
  while (idleTimeoutClaims.size > IDLE_TIMEOUT_CLAIM_MAX_ENTRIES) {
    const oldest = idleTimeoutClaims.keys().next();
    if (oldest.done) break;
    idleTimeoutClaims.delete(oldest.value);
  }
}

/**
 * Compose the claim key for an idle-timeout delivery. `armEpoch` is the arm
 * generation (the row's `lastAgentMessageAt` in ms); 0 when no row could be
 * read, which degrades to the old triple-only behaviour for that event.
 */
function idleTimeoutClaimKey(chatId: string, instanceId: string, armEpoch: number, eventSequenceIndex: number): string {
  return `${instanceId}:${chatId}:${armEpoch}:${eventSequenceIndex}`;
}

/**
 * Claim a composed key. Returns `true` on the first delivery, `false` when the
 * exact key was already claimed (redelivery).
 */
function claimIdleTimeoutKey(key: string, now: number = Date.now()): boolean {
  pruneIdleTimeoutClaims(now);
  if (idleTimeoutClaims.has(key)) return false;
  idleTimeoutClaims.set(key, now);
  return true;
}

/**
 * Release a previously granted claim so the event can be processed again.
 *
 * The gate records the claim BEFORE the engine executes the delivery, so a
 * delivery that fails (queue full → `msg.nak()`, dispatcher throw) would meet
 * its own claim on redelivery and be dropped forever — failing CLOSED, the
 * exact opposite of this gate's contract. The engine therefore releases the
 * claim whenever the post-gate handling throws; the redelivery then claims
 * afresh.
 */
export function releaseIdleTimeoutClaim(claimToken: string): void {
  idleTimeoutClaims.delete(claimToken);
}

/**
 * Claim a `chat.idle_timeout` delivery for its
 * (chat, instance, arm epoch, sequence) identity. Returns `true` on the first
 * delivery, `false` when this exact event was already processed (redelivery).
 *
 * Events without a sequence index carry no identity, so they always claim.
 */
export function claimIdleTimeoutDelivery(
  chatId: string,
  instanceId: string,
  eventSequenceIndex: number | null,
  now: number = Date.now(),
  armEpoch = 0,
): boolean {
  if (typeof eventSequenceIndex !== 'number') return true;
  return claimIdleTimeoutKey(idleTimeoutClaimKey(chatId, instanceId, armEpoch, eventSequenceIndex), now);
}

const TERMINAL_DISARM_REASONS: ReadonlySet<FollowUpDisarmReason> = new Set<FollowUpDisarmReason>([
  'session_cleared',
  'handoff',
  'archived',
  'window_expired',
]);

/**
 * Reasons strong enough to refuse a terminal override (#542 + gemini review).
 * Any terminal disarm (`handoff`, `session_cleared`, `archived`,
 * `window_expired`) must advance a row whose prior reason is non-terminal
 * (e.g., `customer_replied`, `sequence_complete`, `agent_error`,
 * `send_failed`) — those don't block re-arms via the terminal-disarm guard,
 * so a later tail-stream chunk would resurrect the sequence (the "Mario leak"
 * pattern).
 *
 * It must NOT downgrade a row that is already terminal-or-stronger:
 * `TERMINAL_DISARM_REASONS` plus `contact_closed` (close-contact set the
 * row deliberately; preserving the audit trail matters more than swapping
 * the bookkeeping label).
 *
 * Held as an array (not a Set) so the `notInArray` query operator can use
 * it directly without spreading on every disarm call.
 */
const TERMINAL_OVERRIDE_PROTECTED: FollowUpDisarmReason[] = [...TERMINAL_DISARM_REASONS, 'contact_closed'];

/**
 * Typed reads across the three storage locations — the resolver is DB-agnostic,
 * so the API service does the column/jsonb lookup here and hands plain
 * `FollowUpSequenceConfig | null | undefined` to the resolver.
 */
function readAgentFollowUpConfig(row: Agent | null | undefined): FollowUpSequenceConfig | null | undefined {
  return row?.followUpConfig;
}

function readInstanceFollowUpConfig(row: Instance | null | undefined): FollowUpSequenceConfig | null | undefined {
  return row?.followUpConfig;
}

function readChatFollowUpConfig(row: Chat | null | undefined): FollowUpSequenceConfig | null | undefined {
  return (row?.settings as ChatSettings | null | undefined)?.followUpConfig;
}

export class FollowUpLifecycleService {
  private readonly repo: FollowUpLifecycleRepo;

  constructor(
    private db: Database,
    private eventBus: EventBus | null,
    private logger: Logger = log,
  ) {
    this.repo = {
      upsertArmed: async (input) => this.upsertArmed(input),
      disarmActive: async (input) =>
        this.disarmActive(input.chatId, input.instanceId, input.reason, input.at, input.lastInboundCustomerMessageAt),
    };
  }

  /**
   * Resolve the active config for a chat by reading the three config scopes
   * and running the closest-wins resolver. Returns `null` when no sequence
   * should arm.
   */
  async resolveConfig(
    chatId: string,
    instanceId: string,
    agentId: string | null,
  ): Promise<FollowUpSequenceConfig | null> {
    const [chat] = await this.db.select().from(chats).where(eq(chats.id, chatId)).limit(1);
    const [instance] = await this.db.select().from(instances).where(eq(instances.id, instanceId)).limit(1);
    const agent = agentId ? (await this.db.select().from(agents).where(eq(agents.id, agentId)).limit(1))[0] : undefined;

    const inputs: FollowUpConfigInputs = {
      chat: readChatFollowUpConfig(chat),
      instance: readInstanceFollowUpConfig(instance),
      agent: readAgentFollowUpConfig(agent),
    };

    return resolveFollowUpConfig(inputs);
  }

  /**
   * Arm a sequence if config resolves to an enabled policy. No-op otherwise.
   */
  async armForOutbound(input: Omit<ArmSequenceInput, 'config'> & { config?: FollowUpSequenceConfig }): Promise<void> {
    if (!this.eventBus) return;

    // Close-contact guard — see `isInActiveCloseState` for the rationale.
    if (await this.isInActiveCloseState(input.chatId, input.instanceId)) return;

    const config = input.config ?? (await this.resolveConfig(input.chatId, input.instanceId, input.agentId ?? null));
    if (!config || config.enabled === false) return;

    // Refuse to arm when the triggering message is already older than the
    // first follow-up interval — the initial wait window has elapsed, so
    // the sequence would fire immediately. Guards against NATS redelivery
    // re-arming chats whose outbound happened long ago.
    const firstIntervalMinutes =
      config.schedule.kind === 'fixed' ? config.schedule.intervalsMinutes[0] : config.schedule.initialMinutes;
    if (typeof firstIntervalMinutes === 'number' && firstIntervalMinutes > 0) {
      const maxAgeMs = firstIntervalMinutes * 60_000;
      const ageMs = Date.now() - input.lastAgentMessageAt.getTime();
      if (ageMs > maxAgeMs) {
        this.logger.warn('follow-up lifecycle: refusing to arm on stale message', {
          chatId: input.chatId,
          instanceId: input.instanceId,
          ageMs,
          maxAgeMs,
          firstIntervalMinutes,
        });
        return;
      }
    }

    if (await this.shouldRefuseForTerminalDisarm(input)) return;

    try {
      await armSequence(
        { repo: this.repo, eventBus: this.eventBus, logger: this.logger },
        {
          chatId: input.chatId,
          instanceId: input.instanceId,
          agentId: input.agentId ?? null,
          config,
          lastAgentMessageAt: input.lastAgentMessageAt,
        },
      );
    } catch (err) {
      this.logger.error('follow-up lifecycle: arm failed', {
        chatId: input.chatId,
        instanceId: input.instanceId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Re-arm a `customer_replied` row anchored on the customer's last inbound
   * timestamp. Used by the sweeper's stale-pause pass (#624): when the
   * customer replied, the row was disarmed with `reason='customer_replied'`,
   * but if the agent never produced a follow-up `message.sent` (any
   * combination of `senderAgentId` plumbing skip, dispatcher error, content
   * filter reject, manual pause without `chat.handoff_activated`, chatId
   * mismatch from #536, or condition-engine silent skip from #566), the row
   * stays disarmed indefinitely and the lead is silently abandoned.
   *
   * Mirrors `armForOutbound`'s gates: close-state, config resolution,
   * terminal-disarm guard. Differs in two ways:
   *  - The schedule anchor is the customer's inbound timestamp, not an
   *    outbound — there is no fresh `message.sent` event driving this path.
   *    `lastAgentMessageAt` on the persisted row is set to the inbound
   *    timestamp; the next genuine outbound (if any) overwrites it.
   *  - There is no per-message staleness check — the sweeper applies a
   *    `<max_pause>` upper bound at the SQL level so this method only sees
   *    rows fresh enough to re-arm.
   *
   * The terminal-disarm guard already short-circuits when the row's
   * `disarmReason` is in `TERMINAL_DISARM_REASONS` (handoff / archived /
   * session_cleared / window_expired). `customer_replied` is intentionally
   * NOT terminal — see lifecycle.ts:54-58 — so the guard returns false and
   * we proceed to re-arm.
   */
  async armForInbound(input: {
    chatId: string;
    instanceId: string;
    agentId: string | null;
    config?: FollowUpSequenceConfig;
    lastInboundCustomerMessageAt: Date;
  }): Promise<void> {
    if (!this.eventBus) return;

    if (await this.isInActiveCloseState(input.chatId, input.instanceId)) return;

    const config = input.config ?? (await this.resolveConfig(input.chatId, input.instanceId, input.agentId));
    if (!config || config.enabled === false) return;

    if (
      await this.shouldRefuseForTerminalDisarm({
        chatId: input.chatId,
        instanceId: input.instanceId,
        lastAgentMessageAt: input.lastInboundCustomerMessageAt,
      })
    ) {
      return;
    }

    try {
      await armSequence(
        { repo: this.repo, eventBus: this.eventBus, logger: this.logger },
        {
          chatId: input.chatId,
          instanceId: input.instanceId,
          agentId: input.agentId,
          config,
          // Anchor the schedule on the inbound timestamp. The persisted
          // `lastAgentMessageAt` will reflect this; that's intentional —
          // `nextFireAt = inbound + intervalsMinutes[0]` is what matters
          // for the sweeper, and the field's name lies for at most one
          // outbound, which then overwrites it via `armForOutbound`.
          lastAgentMessageAt: input.lastInboundCustomerMessageAt,
        },
      );
      this.logger.info('follow-up lifecycle: re-armed from inbound', {
        chatId: input.chatId,
        instanceId: input.instanceId,
        lastInboundCustomerMessageAt: input.lastInboundCustomerMessageAt.toISOString(),
      });
    } catch (err) {
      this.logger.error('follow-up lifecycle: armForInbound failed', {
        chatId: input.chatId,
        instanceId: input.instanceId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Record an inbound customer message timestamp on an existing row
   * regardless of its disarm state. Used by the inbound hook so a
   * terminally-disarmed row can be "reactivated" for arming when the
   * customer genuinely returns (see `armForOutbound` terminal-disarm guard).
   * No-op when no row exists yet — the first outbound agent message will
   * create one.
   */
  async touchInboundTimestamp(input: { chatId: string; instanceId: string; at: Date }): Promise<void> {
    try {
      await this.db
        .update(chatFollowUpState)
        .set({ lastInboundCustomerMessageAt: input.at, updatedAt: input.at })
        .where(and(eq(chatFollowUpState.chatId, input.chatId), eq(chatFollowUpState.instanceId, input.instanceId)));
    } catch (err) {
      this.logger.warn('follow-up lifecycle: touchInboundTimestamp failed', {
        chatId: input.chatId,
        instanceId: input.instanceId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Disarm any active sequence for a chat. Safe to call unconditionally —
   * a missing or already-disarmed row no-ops.
   */
  async disarm(input: DisarmSequenceInput): Promise<void> {
    if (!this.eventBus) return;

    try {
      await disarmSequence({ repo: this.repo, eventBus: this.eventBus, logger: this.logger }, input);
    } catch (err) {
      this.logger.error('follow-up lifecycle: disarm failed', {
        chatId: input.chatId,
        instanceId: input.instanceId,
        reason: input.reason,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Returns true when the chat has been deliberately closed via
   * `POST /messages/send/close-contact` (any outcome — `redirected_sac`,
   * `unqualified`, `no_response`, `other`, `won`, `lost`). Callers that arm
   * a proactive follow-up must short-circuit on `true`: nudging a customer
   * the seller agent already redirected to support is exactly what the
   * close-contact endpoint exists to prevent.
   *
   * Why a dedicated guard instead of relying on `disarm({reason:'contact_closed'})`:
   * the inline disarm in the close-contact handler only kills the *current*
   * row. Any later `message.sent` (a customer comeback that the reactive
   * agent answers, a tail-stream chunk, a NATS redelivery) re-enters
   * `armForOutbound` and re-arms a fresh sequence — `TERMINAL_DISARM_REASONS`
   * does not cover `contact_closed`, and even when it did the guard would
   * let re-arms through whenever the customer's last inbound is more recent
   * than the disarm timestamp, which is the comeback case.
   *
   * The canonical close marker is `chats.settings.closeOutcome`. The
   * dispatcher's `applyCloseContactGate` already reads it; the follow-up arm
   * path now does too. `POST /chats/:id/reopen-contact` clears it,
   * restoring proactive follow-up alongside the reactive agent.
   */
  /**
   * Terminal-disarm guard (#419): if the chat was disarmed with a terminal
   * intent (user cleared the session, operator took handoff, chat archived,
   * or the messaging window expired), refuse to re-arm unless the customer
   * has actually sent a new message since the disarm. Without this check,
   * any agent-origin `message.sent` that lands after the disarm (tail stream
   * chunks, split-message tails, NATS redelivery of in-flight events) will
   * resurrect a sequence the user explicitly terminated.
   */
  private async shouldRefuseForTerminalDisarm(
    input: Pick<ArmSequenceInput, 'chatId' | 'instanceId' | 'lastAgentMessageAt'>,
  ): Promise<boolean> {
    const existing = await this.readExistingRow(input.chatId, input.instanceId);
    if (!existing?.disarmReason || !existing.disarmedAt) return false;
    if (!TERMINAL_DISARM_REASONS.has(existing.disarmReason)) return false;
    const lastInbound = existing.lastInboundCustomerMessageAt?.getTime() ?? 0;
    if (lastInbound > existing.disarmedAt.getTime()) return false;
    this.logger.info('follow-up lifecycle: refusing to arm — terminal disarm awaiting customer return', {
      chatId: input.chatId,
      instanceId: input.instanceId,
      disarmReason: existing.disarmReason,
      disarmedAt: existing.disarmedAt.toISOString(),
      lastAgentMessageAt: input.lastAgentMessageAt.toISOString(),
      lastInboundCustomerMessageAt: existing.lastInboundCustomerMessageAt?.toISOString() ?? null,
    });
    return true;
  }

  /**
   * Returns true when the chat is *currently* in an active close-contact
   * state (hard terminal `closed: true` OR soft cooldown `closeUntil` still
   * in window). Mirrors the dispatcher's `applyCloseContactGate` predicate
   * — see `lib/close-contact-state.ts` for the rationale and why
   * `closeOutcome` (audit data, preserved across cooldown expiry) is the
   * wrong signal for this gate.
   *
   * Why a guard here: the inline `disarm({reason:'contact_closed'})` in the
   * close-contact handler only kills the *current* row. Any later
   * `message.sent` from the reactive agent (a customer comeback the agent
   * answers within the cooldown, a tail-stream chunk, a NATS redelivery)
   * re-enters armForOutbound and re-arms a fresh sequence — `TERMINAL_DISARM_REASONS`
   * does not include `'contact_closed'`, and even when it did the
   * existing terminal-disarm guard lets re-arms through whenever the
   * customer's last inbound is newer than the disarm timestamp (which is
   * exactly the comeback case). Once the cooldown expires the dispatcher
   * gate clears `closeUntil`, this predicate flips to false, and a future
   * agent reply legitimately re-arms.
   */
  private async isInActiveCloseState(chatId: string, instanceId: string): Promise<boolean> {
    const [chatRow] = await this.db
      .select({ settings: chats.settings })
      .from(chats)
      .where(eq(chats.id, chatId))
      .limit(1);
    const settings = chatRow?.settings as ChatSettings | null | undefined;
    if (!isChatInActiveCloseState(settings)) return false;
    const closeOutcome = (settings as { closeOutcome?: unknown } | null | undefined)?.closeOutcome;
    this.logger.info('follow-up lifecycle: refusing to arm — chat in active close-contact state', {
      chatId,
      instanceId,
      closed: (settings as { closed?: unknown } | null | undefined)?.closed === true,
      closeUntil: (settings as { closeUntil?: unknown } | null | undefined)?.closeUntil ?? null,
      closeOutcome: closeOutcome ?? null,
    });
    return true;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Repo implementation (private — exposed via `this.repo`)
  // ──────────────────────────────────────────────────────────────────────────

  private async upsertArmed(input: ArmInput): Promise<{ created: boolean }> {
    // Upsert by (chatId, instanceId). Refresh on conflict: zero the sequence
    // index, reset `nextFireAt`, clear any prior disarm reason so a completed
    // or customer-replied row can re-arm on the next outbound agent message.
    const values = {
      chatId: input.chatId,
      instanceId: input.instanceId,
      agentId: input.agentId,
      sequenceConfig: input.config,
      sequenceIndex: 0,
      lastAgentMessageAt: input.lastAgentMessageAt,
      nextFireAt: input.nextFireAt,
      disarmReason: null,
      disarmedAt: null,
      updatedAt: new Date(),
    };

    const result = await this.db
      .insert(chatFollowUpState)
      .values(values)
      .onConflictDoUpdate({
        target: [chatFollowUpState.chatId, chatFollowUpState.instanceId],
        set: {
          agentId: values.agentId,
          sequenceConfig: values.sequenceConfig,
          sequenceIndex: values.sequenceIndex,
          lastAgentMessageAt: values.lastAgentMessageAt,
          nextFireAt: values.nextFireAt,
          disarmReason: values.disarmReason,
          disarmedAt: values.disarmedAt,
          updatedAt: values.updatedAt,
        },
      })
      .returning({
        // Postgres sets `xmax = 0` on rows produced by INSERT and a non-zero
        // xid on rows produced by UPDATE inside an INSERT ... ON CONFLICT.
        // This is the canonical way to distinguish the two — more reliable
        // than comparing timestamps, which can collide within a single ms.
        xmax: sql<string>`xmax::text`,
      });

    const row = result[0];
    const created = row?.xmax === '0';
    return { created };
  }

  /**
   * Consumer-side freshness check for `chat.idle_timeout` events. Mirrors
   * the publish-time guards in the sweeper but runs at delivery time so the
   * automation engine can drop events whose chat state has changed since
   * the sweeper enqueued them — the case that bit us when the durable
   * consumer's ack state was reset by a deploy and the SYSTEM stream
   * replayed historical idle-timeout events from days ago (2026-05-01).
   *
   * Returns `{ skip: true, reason }` when the engine MUST drop the event:
   *  - chat is in active close-contact state (`closed: true` or
   *    `closeUntil` still in window) — agent should not nudge a closed chat
   *  - follow-up row's `disarmReason` is set — sequence is in a terminal
   *    state and any further fire would re-spam a chat the system already
   *    finished/handed-off/archived
   *  - the event's identity (chat + instance + arm epoch + `eventSequenceIndex`)
   *    was already delivered to the engine in this process — a redelivery of an
   *    event that already fired. The arm epoch (the row's `lastAgentMessageAt`)
   *    scopes the claim to one arm cycle, so a disarm + re-arm — which resets
   *    `sequenceIndex` to 0 — does not collide with the previous cycle's
   *    claims. This replaced the old
   *    `row.sequenceIndex > eventSequenceIndex` distance test, which could
   *    not tell a JetStream redelivery of event N (row at N+1) from a healthy
   *    first delivery of event N (row also at N+1, because the sweeper
   *    publishes N then immediately records N+1) — the confusion that dropped
   *    ~14% of legitimate follow-ups (f149179a).
   *  - row's `sequenceIndex` is 2+ ahead of the event's — a bulk replay of
   *    historical events (e.g. a durable-consumer reset re-delivering days-old
   *    events after this process started, so no claim exists for them).
   *    Without this check, replays of events 0..N-2 keep firing while the row
   *    is at sequenceIndex N.
   *
   * Returns `{ skip: false }` when the event should proceed normally.
   *
   * Fail-open: callers should swallow exceptions from this method and let
   * the event flow through. The engine logs the failure but doesn't drop —
   * a flaky DB at consumer time is less harmful than silently dropping
   * legitimate idle-timeout events.
   *
   * The returned `claimToken` (present only when the event claimed its
   * identity) MUST be handed to `releaseIdleTimeoutClaim` if the delivery then
   * fails — otherwise the claim recorded here would make the NATS redelivery
   * of a follow-up that never actually ran look like a duplicate, and the
   * follow-up would be lost. The engine does this for us.
   */
  async evaluateIdleTimeoutFreshness(
    chatId: string,
    instanceId: string,
    eventSequenceIndex: number | null,
  ): Promise<{ skip: boolean; reason?: string; claimToken?: string }> {
    if (await this.isInActiveCloseState(chatId, instanceId)) {
      return { skip: true, reason: 'chat_closed' };
    }
    const row = await this.readExistingRow(chatId, instanceId);
    if (row?.disarmReason) {
      return { skip: true, reason: `disarmed_${row.disarmReason}` };
    }
    // The sweeper publishes the event carrying the PRE-increment index and then
    // immediately advances the row (publish(N) → recordFired(N+1)). By the time a
    // consumer handles the event the row is legitimately one step ahead, so
    // `row > event` also matches every healthy first-delivery — dropping real
    // follow-ups in a publish/consume race. A gap of 2+ can only be a replay of
    // an event this process never claimed (durable-consumer reset, old backlog).
    if (
      row !== null &&
      typeof eventSequenceIndex === 'number' &&
      typeof row.sequenceIndex === 'number' &&
      row.sequenceIndex > eventSequenceIndex + 1
    ) {
      return {
        skip: true,
        reason: `sequence_advanced_row_at_${row.sequenceIndex}_event_${eventSequenceIndex}`,
      };
    }
    // Gap of 0 or 1 is ambiguous by sequence alone — discriminate by identity:
    // only the first delivery of this exact event proceeds, a redelivery of it
    // (ack timeout, consumer restart mid-flight) is dropped. The identity is
    // scoped to the ARM EPOCH so a disarm + re-arm (which resets sequenceIndex
    // to 0) starts a fresh claim space instead of colliding with the previous
    // cycle's event 0.
    if (typeof eventSequenceIndex !== 'number') return { skip: false };
    const armEpoch = row?.lastAgentMessageAt?.getTime() ?? 0;
    const claimToken = idleTimeoutClaimKey(chatId, instanceId, armEpoch, eventSequenceIndex);
    if (!claimIdleTimeoutKey(claimToken)) {
      return {
        skip: true,
        reason: `duplicate_delivery_event_${eventSequenceIndex}`,
      };
    }
    return { skip: false, claimToken };
  }

  /**
   * Read the minimum fields required by the terminal-disarm guard in
   * `armForOutbound`. Returns `null` when no row exists yet.
   */
  private async readExistingRow(
    chatId: string,
    instanceId: string,
  ): Promise<{
    disarmReason: FollowUpDisarmReason | null;
    disarmedAt: Date | null;
    lastInboundCustomerMessageAt: Date | null;
    sequenceIndex: number;
    lastAgentMessageAt: Date | null;
  } | null> {
    const [row] = await this.db
      .select({
        disarmReason: chatFollowUpState.disarmReason,
        disarmedAt: chatFollowUpState.disarmedAt,
        lastInboundCustomerMessageAt: chatFollowUpState.lastInboundCustomerMessageAt,
        sequenceIndex: chatFollowUpState.sequenceIndex,
        lastAgentMessageAt: chatFollowUpState.lastAgentMessageAt,
      })
      .from(chatFollowUpState)
      .where(and(eq(chatFollowUpState.chatId, chatId), eq(chatFollowUpState.instanceId, instanceId)))
      .limit(1);

    if (!row) return null;
    return {
      disarmReason: (row.disarmReason ?? null) as FollowUpDisarmReason | null,
      disarmedAt: row.disarmedAt ?? null,
      lastInboundCustomerMessageAt: row.lastInboundCustomerMessageAt ?? null,
      sequenceIndex: row.sequenceIndex,
      lastAgentMessageAt: row.lastAgentMessageAt ?? null,
    };
  }

  private async disarmActive(
    chatId: string,
    instanceId: string,
    reason: FollowUpDisarmReason,
    at: Date,
    lastInboundCustomerMessageAt?: Date,
  ): Promise<{ disarmed: boolean }> {
    const set: {
      disarmReason: FollowUpDisarmReason;
      disarmedAt: Date;
      nextFireAt: null;
      updatedAt: Date;
      lastInboundCustomerMessageAt?: Date;
    } = {
      disarmReason: reason,
      disarmedAt: at,
      nextFireAt: null,
      updatedAt: at,
    };
    if (lastInboundCustomerMessageAt) {
      set.lastInboundCustomerMessageAt = lastInboundCustomerMessageAt;
    }

    // Default disarm semantics are idempotent: only update when the row has
    // no prior disarm reason. Terminal reasons are the exception (#542 +
    // gemini review on PR #588): any reason in `TERMINAL_DISARM_REASONS`
    // (`handoff`, `session_cleared`, `archived`, `window_expired`) must
    // override a row that's already disarmed with a non-terminal reason
    // (`customer_replied`, `sequence_complete`, `agent_error`, `send_failed`),
    // so the terminal-disarm guard in `armForOutbound` blocks a later tail
    // chunk or NATS redelivery from re-arming the sequence. Strong reasons
    // (`TERMINAL_OVERRIDE_PROTECTED`) still win — a terminal disarm never
    // downgrades another terminal row or a `contact_closed` row, and
    // re-applying the same reason stays a no-op.
    const reasonGuard = TERMINAL_DISARM_REASONS.has(reason)
      ? or(
          isNull(chatFollowUpState.disarmReason),
          notInArray(chatFollowUpState.disarmReason, TERMINAL_OVERRIDE_PROTECTED),
        )
      : isNull(chatFollowUpState.disarmReason);

    const result = await this.db
      .update(chatFollowUpState)
      .set(set)
      .where(and(eq(chatFollowUpState.chatId, chatId), eq(chatFollowUpState.instanceId, instanceId), reasonGuard))
      .returning({ id: chatFollowUpState.id });

    return { disarmed: result.length > 0 };
  }
}
