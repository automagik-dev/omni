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
 * @see issue #404 — Configurable Idle-Chat Follow-Up Sequences
 */

import type {
  ChatArchivedPayload,
  ChatHandoffActivatedPayload,
  EventBus,
  MessageReceivedPayload,
  MessageSentPayload,
} from '@omni/core';
import { createLogger } from '@omni/core';
import type { Services } from '../services';

const log = createLogger('follow-up-hooks');

/**
 * Resolve the DB chat UUID from a message event's external chat id.
 * Returns null when the chat has not been persisted yet — the follow-up row
 * can safely be skipped in that case.
 */
async function resolveChatId(services: Services, instanceId: string, externalId: string): Promise<string | null> {
  try {
    const chat = await services.chats.findByExternalIdSmart(instanceId, externalId);
    return chat?.id ?? null;
  } catch (err) {
    log.debug('follow-up-hooks: failed to resolve chatId', { instanceId, externalId, error: String(err) });
    return null;
  }
}

export async function setupFollowUpHooks(eventBus: EventBus, services: Services): Promise<void> {
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

        const chatId = await resolveChatId(services, instanceId, payload.chatId);
        if (!chatId) return;

        await services.followUpLifecycle.armForOutbound({
          chatId,
          instanceId,
          agentId: senderAgentId,
          lastAgentMessageAt: new Date(event.timestamp),
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

        const chatId = await resolveChatId(services, instanceId, payload.chatId);
        if (!chatId) return;

        await services.followUpLifecycle.disarm({
          chatId,
          instanceId,
          reason: 'customer_replied',
          lastInboundCustomerMessageAt: new Date(event.timestamp),
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

    log.info('Follow-up hooks active (message.sent/received, chat.handoff_activated, chat.archived)');
  } catch (error) {
    log.error('Failed to set up follow-up hooks', { error: String(error) });
  }
}
