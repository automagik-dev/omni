/**
 * Follow-up lifecycle event hooks.
 *
 * Subscribes to the message + chat lifecycle events relevant to the idle-chat
 * follow-up feature and drives the `FollowUpLifecycleService`:
 *
 *   message.sent (senderAgentId present) → armForOutbound
 *   message.received (customer origin)   → disarm('customer_replied')
 *   chat.handoff_activated               → disarm('handoff')
 *   chat.archived                        → disarm('archived')
 *
 * Event subscriptions use dedicated durable names so this plugin doesn't
 * interfere with message-persistence or other consumers. All handlers
 * swallow errors — follow-up lifecycle failures must never abort message
 * processing.
 *
 * Tenant boundary (G5, ADR-0008): each handler classifies its envelope ONCE
 * and threads the trusted tenant through every service call — the chat-id
 * resolution runs inside a short worker scope here, and the lifecycle service
 * scopes its own DB blocks from the threaded `tenantId` (it publishes events
 * between blocks, so wrapping the whole handler in one scope would hold a
 * worker transaction across a publish). A legacy envelope threads nothing and
 * every call runs on the ambient pool byte-identically; a quarantined envelope
 * is refused here outright (defense in depth — the subscription layer already
 * terms it before the handler runs).
 *
 * @see issue #404 — Configurable Idle-Chat Follow-Up Sequences
 */

import type {
  ChatArchivedPayload,
  ChatClosedPayload,
  ChatHandoffActivatedPayload,
  EventBus,
  MessageReceivedPayload,
  MessageSentPayload,
  OmniEvent,
} from '@omni/core';
import { classifyEnvelope, createLogger } from '@omni/core';
import type { Database } from '@omni/db';
import type { Services } from '../services';
import { runTenantWorkDb } from '../tenancy/worker-tenant-context';

const log = createLogger('follow-up-hooks');

/**
 * Classify the consumed envelope and return the trusted tenant to thread, or
 * `null` for a legacy envelope. Throws on quarantine — processing globally is
 * the fallback ADR-0008 forbids.
 */
function trustedTenantOf(event: Pick<OmniEvent, 'metadata'>): string | null {
  const classification = classifyEnvelope(event.metadata);
  if (classification.world === 'quarantine') {
    throw new Error(`follow-up-hooks: refusing quarantined envelope (${classification.reason})`);
  }
  return classification.world === 'tenant' ? classification.tenantId : null;
}

/**
 * Resolve the DB chat UUID from a message event's external chat id, inside the
 * work item's world. Returns null when the chat has not been persisted yet —
 * the follow-up row can safely be skipped in that case.
 */
async function resolveChatId(
  services: Services,
  db: Database,
  tenantId: string | null,
  instanceId: string,
  externalId: string,
): Promise<string | null> {
  try {
    const chat = await runTenantWorkDb(db, tenantId, () =>
      services.chats.findByExternalIdSmart(instanceId, externalId),
    );
    return chat?.id ?? null;
  } catch (err) {
    // findByExternalIdSmart returns null for not-found, so anything thrown
    // here is an unexpected infrastructure error (DB connectivity, query
    // failure, etc.) — log at warn so it doesn't get silently buried.
    log.warn('follow-up-hooks: failed to resolve chatId', { instanceId, externalId, error: String(err) });
    return null;
  }
}

export async function setupFollowUpHooks(eventBus: EventBus, services: Services, db: Database): Promise<void> {
  try {
    // ── Outbound agent message → arm sequence ──────────────────────────────
    await eventBus.subscribe(
      'message.sent',
      async (event) => {
        const payload = event.payload as MessageSentPayload;
        const metadata = event.metadata;
        const instanceId = metadata.instanceId;
        if (!instanceId) return;

        const senderAgentId = payload.senderAgentId;
        if (!senderAgentId) return; // Only arm on agent-origin messages.

        const tenantId = trustedTenantOf(event);
        const chatId = await resolveChatId(services, db, tenantId, instanceId, payload.chatId);
        if (!chatId) return;

        await services.followUpLifecycle.armForOutbound({
          chatId,
          instanceId,
          agentId: senderAgentId,
          lastAgentMessageAt: new Date(event.timestamp),
          tenantId,
        });
      },
      {
        durable: 'follow-up-hooks-message-sent',
        queue: 'follow-up-hooks',
        maxRetries: 2,
        retryDelayMs: 500,
        startFrom: 'new',
        concurrency: 5,
      },
    );

    // ── Inbound customer message → disarm(customer_replied) ───────────────
    await eventBus.subscribe(
      'message.received',
      async (event) => {
        const payload = event.payload as MessageReceivedPayload;
        const metadata = event.metadata;
        const instanceId = metadata.instanceId;
        if (!instanceId) return;

        const isFromMe = payload.rawPayload?.isFromMe === true;
        if (isFromMe) return; // Only disarm on customer-origin messages.

        const tenantId = trustedTenantOf(event);
        const chatId = await resolveChatId(services, db, tenantId, instanceId, payload.chatId);
        if (!chatId) return;

        const at = new Date(event.timestamp);

        // Touch the inbound timestamp unconditionally — the disarm below is
        // a no-op when the row is already terminally disarmed (e.g. by
        // session_cleared), so without this the row's
        // `lastInboundCustomerMessageAt` would never advance and the
        // terminal-disarm guard in `armForOutbound` would refuse to re-arm
        // even after the customer genuinely returns. See #419.
        await services.followUpLifecycle.touchInboundTimestamp({ chatId, instanceId, at, tenantId });

        await services.followUpLifecycle.disarm({
          chatId,
          instanceId,
          reason: 'customer_replied',
          lastInboundCustomerMessageAt: at,
          tenantId,
        });
      },
      {
        durable: 'follow-up-hooks-message-received',
        queue: 'follow-up-hooks',
        maxRetries: 2,
        retryDelayMs: 500,
        startFrom: 'new',
        concurrency: 5,
      },
    );

    // ── Handoff activation → disarm(handoff) ──────────────────────────────
    await eventBus.subscribe(
      'chat.handoff_activated',
      async (event) => {
        const payload = event.payload as ChatHandoffActivatedPayload;
        await services.followUpLifecycle.disarm({
          chatId: payload.chatId,
          instanceId: payload.instanceId,
          agentId: payload.agentId ?? null,
          reason: 'handoff',
          tenantId: trustedTenantOf(event),
        });
      },
      {
        durable: 'follow-up-hooks-handoff',
        queue: 'follow-up-hooks',
        maxRetries: 2,
        retryDelayMs: 500,
        startFrom: 'new',
      },
    );

    // ── Archive / mute → disarm(archived) ─────────────────────────────────
    await eventBus.subscribe(
      'chat.archived',
      async (event) => {
        const payload = event.payload as ChatArchivedPayload;
        await services.followUpLifecycle.disarm({
          chatId: payload.chatId,
          instanceId: payload.instanceId,
          reason: 'archived',
          tenantId: trustedTenantOf(event),
        });
      },
      {
        durable: 'follow-up-hooks-archived',
        queue: 'follow-up-hooks',
        maxRetries: 2,
        retryDelayMs: 500,
        startFrom: 'new',
      },
    );

    // ── Close-contact → disarm(contact_closed) ───────────────────────────
    await eventBus.subscribe(
      'chat.closed',
      async (event) => {
        const payload = event.payload as ChatClosedPayload;
        await services.followUpLifecycle.disarm({
          chatId: payload.chatId,
          instanceId: payload.instanceId,
          agentId: payload.agentId ?? null,
          reason: 'contact_closed',
          tenantId: trustedTenantOf(event),
        });
      },
      {
        durable: 'follow-up-hooks-closed',
        queue: 'follow-up-hooks',
        maxRetries: 2,
        retryDelayMs: 500,
        startFrom: 'new',
      },
    );

    log.info('Follow-up hooks active (message.sent/received, chat.handoff_activated, chat.archived, chat.closed)');
  } catch (error) {
    log.error('Failed to set up follow-up hooks', { error: String(error) });
  }
}
