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
import { and, eq, isNull, sql } from 'drizzle-orm';

const log = createLogger('follow-up-lifecycle');

/**
 * Refuse to arm a follow-up when the triggering message is older than this.
 * Guards against NATS redelivery / consumer replay from re-arming historical
 * chats long after the fact.
 */
const MAX_ARM_MESSAGE_AGE_MS = 5 * 60_000;

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

    const ageMs = Date.now() - input.lastAgentMessageAt.getTime();
    if (ageMs > MAX_ARM_MESSAGE_AGE_MS) {
      this.logger.warn('follow-up lifecycle: refusing to arm on stale message', {
        chatId: input.chatId,
        instanceId: input.instanceId,
        ageMs,
        maxAgeMs: MAX_ARM_MESSAGE_AGE_MS,
      });
      return;
    }

    const config = input.config ?? (await this.resolveConfig(input.chatId, input.instanceId, input.agentId ?? null));
    if (!config || config.enabled === false) return;

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

    const result = await this.db
      .update(chatFollowUpState)
      .set(set)
      .where(
        and(
          eq(chatFollowUpState.chatId, chatId),
          eq(chatFollowUpState.instanceId, instanceId),
          isNull(chatFollowUpState.disarmReason),
        ),
      )
      .returning({ id: chatFollowUpState.id });

    return { disarmed: result.length > 0 };
  }
}
