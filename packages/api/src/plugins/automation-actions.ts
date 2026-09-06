/**
 * Automation-engine action callbacks (wish: omni-full-multitenancy, Group G5;
 * ADR-0008).
 *
 * These are the `sendMessage` / `callAgent` / `staleIdleTimeoutGate`
 * dependencies `AutomationService.startEngine` hands the core engine. They
 * used to live inline in `index.ts`; they are extracted here because they are
 * a WORKER surface, not a bootstrap surface: the engine invokes them from a
 * NATS consumer callback, so every DB read they make runs with no request
 * scope. Extraction makes them registrable (the direct `agents` read below
 * gets its own honest db-access-guard site instead of hiding under
 * `index.ts`'s control-plane startup entry) and testable (the worker-scope
 * probes drive exactly the functions production runs).
 *
 * TENANT BOUNDARY (G5, ADR-0008)
 * ------------------------------
 * The engine classifies each consumed envelope (`classifyEnvelope`) and
 * threads the producer-stamped trusted tenant into every callback — never a
 * payload claim. Each callback wraps its DISCRETE DB block in
 * `runTenantWorkDb`:
 *
 *   * tenant world  → the block runs in its own short worker tenant scope
 *     (detached, tenant-stamped, exactly one transaction), and the service
 *     reads inside (`services.instances` / `services.chats` / the direct
 *     `agents` lookup via `scopedHandle`) are RLS-policed to that tenant;
 *   * legacy world  → nothing is threaded and the block runs on the ambient
 *     pool byte-identically to the pre-G5 inline callbacks.
 *
 * The scope NEVER spans the outbound side effect: `plugin.sendMessage` (a
 * channel network call) and `agentRunner.runOrStream` (an 11-14s agent run)
 * execute strictly AFTER the resolution scope closes — a worker transaction
 * must not outlive its work item, and holding one across a network call would
 * pin a pooled connection for the duration (the G4 leg-2 trap).
 */

import type { AgentCallContext, AgentRunResult, CallAgentActionConfig } from '@omni/core';
import { createLogger } from '@omni/core';
import type { Database, EventType } from '@omni/db';
import { agents, omniEvents } from '@omni/db';
import { eq } from 'drizzle-orm';
import type { Services } from '../services';
import { releaseIdleTimeoutClaim } from '../services/follow-up-lifecycle';
import { scopedHandle } from '../tenancy/tenant-scope';
import { runTenantWorkDb } from '../tenancy/worker-tenant-context';
import { getPlugin } from './loader';

const log = createLogger('automation-actions');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve chat UUID → channel-native external_id for a call_agent invocation.
 *
 * Symmetric with the send_message action (below) which already auto-resolves
 * UUIDs for the same reason: system-initiated events (chat.idle_timeout) emit
 * payload.chatId as the internal chats.id UUID, but the seller dispatch path
 * carries the external_id (e.g. WA phone). Without resolution, the agent
 * runner's computeSessionId produces session_ids that diverge from sessions
 * created by the seller path.
 *
 * Also resolves senderId — extractAgentCallContext falls back senderId=chatId
 * when payload.from/senderId are absent (follow-up events).
 *
 * On missing chat row, logs a warning and falls through with the raw UUID so
 * the call still runs (avoids hard-failing the automation action). The chat
 * read runs in its own short worker scope for the threaded tenant: a
 * cross-tenant UUID is simply not found (RLS), which degrades exactly like a
 * missing row. Legacy (nothing threaded) reads the ambient pool as before.
 */
async function resolveCallAgentChatIds(
  services: Services,
  db: Database,
  ctx: { chatId: string; senderId: string; instanceId: string },
  trustedTenantId: string | null,
): Promise<{ chatId: string; senderId: string }> {
  if (!UUID_RE.test(ctx.chatId)) {
    return { chatId: ctx.chatId, senderId: ctx.senderId };
  }
  try {
    const chat = await runTenantWorkDb(db, trustedTenantId, () =>
      services.chats.getById(ctx.chatId, { includeHidden: true }),
    );
    return {
      chatId: chat.externalId,
      senderId: ctx.senderId === ctx.chatId ? chat.externalId : ctx.senderId,
    };
  } catch {
    log.warn('call_agent: chat UUID not resolvable, using raw value (session may diverge)', {
      chatId: ctx.chatId,
      instanceId: ctx.instanceId,
    });
    return { chatId: ctx.chatId, senderId: ctx.senderId };
  }
}

/** The dependency shape `AutomationService.startEngine` accepts. */
export interface AutomationEngineDeps {
  sendMessage: (instanceId: string, to: string, content: string, trustedTenantId?: string | null) => Promise<void>;
  callAgent: (
    context: AgentCallContext,
    config: CallAgentActionConfig,
    trustedTenantId?: string | null,
  ) => Promise<AgentRunResult>;
  staleIdleTimeoutGate: (
    chatId: string,
    instanceId: string,
    eventSequenceIndex: number | null,
    trustedTenantId?: string | null,
  ) => Promise<{ skip: boolean; reason?: string; claimToken?: string }>;
  releaseIdleTimeoutClaim: (claimToken: string) => void | Promise<void>;
  claimEmittedEvent: (
    claim: { idempotencyKey: string; eventId: string; eventType: string; payload: Record<string, unknown> },
    trustedTenantId?: string | null,
  ) => Promise<boolean>;
  releaseEmittedEventClaim: (eventId: string) => Promise<void>;
}

/** Injectable seams (tests only — production uses the module defaults). */
export interface AutomationEngineDepsOptions {
  resolvePlugin?: typeof getPlugin;
}

/**
 * Build the automation-engine action callbacks over the real services.
 *
 * `db` is the ambient pool handle; it is only ever used through the tenancy
 * bridges (`runTenantWorkDb` / `scopedHandle`), so a legacy invocation
 * reaches it exactly as the inline callbacks did.
 */
export function buildAutomationEngineDeps(
  services: Services,
  db: Database,
  options: AutomationEngineDepsOptions = {},
): AutomationEngineDeps {
  const resolvePlugin = options.resolvePlugin ?? getPlugin;
  return {
    sendMessage: async (instanceId, to, content, trustedTenantId = null) => {
      // Discrete read block #1: the instance row. One short worker scope in
      // the tenant world; ambient passthrough in legacy.
      const instance = await runTenantWorkDb(db, trustedTenantId, () => services.instances.getById(instanceId));
      if (!instance) throw new Error(`Instance not found: ${instanceId}`);
      const plugin = await resolvePlugin(instance.channel);
      if (!plugin) throw new Error(`No plugin for channel: ${instance.channel}`);
      // Resolve internal chat UUID → channel-native external_id (e.g. WA JID).
      // Automation payloads carry chat UUIDs; plugins expect channel JIDs.
      let recipient = to;
      if (UUID_RE.test(to)) {
        // Discrete read block #2 — kept a SEPARATE scope so the plugin lookup
        // between the reads stays outside any transaction and the legacy
        // error ordering (no-plugin before chat-not-found) is preserved.
        try {
          const chat = await runTenantWorkDb(db, trustedTenantId, () =>
            services.chats.getById(to, { includeHidden: true }),
          );
          recipient = chat.externalId;
        } catch {
          throw new Error(`Chat not found for UUID: ${to}`);
        }
      }
      // Outbound side effect strictly AFTER the resolution scopes closed — a
      // worker transaction must never span a channel network call.
      await plugin.sendMessage(instanceId, { to: recipient, content: { type: 'text', text: content } });
    },

    callAgent: async (ctx, cfg, trustedTenantId = null) => {
      // Discrete read block #1: the instance row.
      const instance = await runTenantWorkDb(db, trustedTenantId, () => services.instances.getById(ctx.instanceId));
      if (!instance) throw new Error(`Instance not found: ${ctx.instanceId}`);

      // System-initiated events (chat.idle_timeout) emit payload.chatId as
      // the internal chats.id UUID; the seller dispatch path carries the
      // channel-native external_id. Resolve UUID → external_id so the
      // computed session_id matches sessions created by the seller path.
      // (Discrete read block #2, inside the resolver.)
      const { chatId: resolvedChatId, senderId: resolvedSenderId } = await resolveCallAgentChatIds(
        services,
        db,
        ctx,
        trustedTenantId,
      );

      const agentFkId = ctx.agentId ?? instance.agentId;
      if (!agentFkId) throw new Error(`No agent configured for instance ${instance.id}`);

      // Discrete read block #3: the DIRECT agents lookup. `scopedHandle` lands
      // it on the worker scope's transaction in the tenant world and on the
      // ambient pool (byte-identical) in legacy.
      const [agentRow] = await runTenantWorkDb(db, trustedTenantId, () =>
        scopedHandle(db)
          .select({
            name: agents.name,
            agentProviderId: agents.agentProviderId,
            agentType: agents.agentType,
            metadata: agents.metadata,
            configPath: agents.configPath,
          })
          .from(agents)
          .where(eq(agents.id, agentFkId))
          .limit(1),
      );
      if (!agentRow) throw new Error(`Agent not found: ${agentFkId}`);

      const typeMap: Record<string, 'agent' | 'team' | 'workflow'> = {
        assistant: 'agent',
        tool: 'agent',
        workflow: 'workflow',
        team: 'team',
      };
      const providerAgentId =
        ((agentRow.metadata as Record<string, unknown> | null)?.providerAgentId as string | undefined) ??
        agentRow.configPath ??
        agentRow.name;

      const runInstance = {
        ...instance,
        agentProviderId: agentRow.agentProviderId ?? null,
        agentType: cfg.agentType ?? typeMap[agentRow.agentType] ?? 'agent',
        agentInternalId: providerAgentId,
        agentSessionStrategy: cfg.sessionStrategy ?? instance.agentSessionStrategy,
        agentPrefixSenderName: cfg.prefixSenderName ?? instance.agentPrefixSenderName,
        agentTimeout: cfg.timeoutMs ? Math.ceil(cfg.timeoutMs / 1000) : instance.agentTimeout,
      };

      // Honor instance.agentStreamMode — sync mode waits for the full agent run
      // before sending anything (11-14s on some providers); stream mode returns
      // progressively. See issue #410. Runs strictly OUTSIDE the resolution
      // scopes: a worker transaction must never span an agent run.
      const result = await services.agentRunner.runOrStream({
        instance: runInstance,
        chatId: resolvedChatId,
        threadId: ctx.threadId,
        senderId: resolvedSenderId,
        senderName: ctx.senderName,
        chatType: 'dm',
        messages: ctx.messages,
      });
      return {
        parts: result.parts,
        fullResponse: result.parts.join('\n'),
        metadata: {
          runId: result.metadata.runId,
          sessionId: result.metadata.sessionId,
          status: result.metadata.status,
        },
      };
    },

    // Consumer-side stale-event gate — see engine.handleEvent comment.
    // Skips chat.idle_timeout events whose row has been disarmed since the
    // sweeper published the event, or whose chat is in active close-contact
    // state. Fail-open on errors so a flaky DB doesn't drop legitimate
    // events.
    staleIdleTimeoutGate: async (chatId, instanceId, eventSequenceIndex, trustedTenantId) => {
      return services.followUpLifecycle.evaluateIdleTimeoutFreshness(
        chatId,
        instanceId,
        eventSequenceIndex,
        trustedTenantId,
      );
    },

    // Give the delivery claim back when handling failed (queue full → nak),
    // so the NATS redelivery is a first delivery and not a "duplicate". The
    // claim registry is in-memory (no DB), so no tenant scope applies.
    releaseIdleTimeoutClaim: (claimToken) => releaseIdleTimeoutClaim(claimToken),

    // Derived-key emission idempotency (#958). The claim IS the journal row:
    // inserting it makes the `omni_events.idempotency_key` unique index the
    // dedup authority for automation re-publishes, exactly as webhook ingress
    // does in `WebhookService.receive`. An empty RETURNING means the key was
    // already journaled — a NATS redelivery/replay of the same
    // (event, automation, action) slot — and the emission is skipped.
    claimEmittedEvent: async (claim, trustedTenantId = null) => {
      const claimed = await runTenantWorkDb(db, trustedTenantId, () =>
        scopedHandle(db)
          .insert(omniEvents)
          .values({
            id: claim.eventId,
            channel: 'internal',
            eventType: claim.eventType.slice(0, 255) as EventType,
            direction: 'inbound',
            status: 'received',
            rawPayload: claim.payload,
            idempotencyKey: claim.idempotencyKey,
            receivedAt: new Date(),
            metadata: { emittedBy: 'automation', idempotencyKey: claim.idempotencyKey },
          })
          .onConflictDoNothing({ target: omniEvents.idempotencyKey })
          .returning({ id: omniEvents.id }),
      );
      return claimed.length > 0;
    },

    // Release a claim whose publish then failed — leaving it would drop the
    // retry's emission as a "duplicate" of an event that never reached the
    // bus. Best-effort ambient delete (additive tenancy phase).
    releaseEmittedEventClaim: async (eventId) => {
      await scopedHandle(db).delete(omniEvents).where(eq(omniEvents.id, eventId));
    },
  };
}
