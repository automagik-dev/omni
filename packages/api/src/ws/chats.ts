/**
 * WebSocket handler for real-time chat updates
 *
 * Streams chat messages, typing indicators, and presence updates.
 */

import { type EventBus, createLogger } from '@omni/core';
import type { Database } from '@omni/db';
import { TenantStreamRegistry } from '../tenancy/tenant-stream-subscriptions';

/**
 * Subscribe to chat updates
 */
interface SubscribeChatMessage {
  type: 'subscribe';
  chatId?: string;
  includeTyping?: boolean;
  includePresence?: boolean;
  includeReadReceipts?: boolean;
}

/**
 * Unsubscribe from chat updates
 */
interface UnsubscribeChatMessage {
  type: 'unsubscribe';
}

/**
 * Client message type
 */
type ClientMessage = SubscribeChatMessage | UnsubscribeChatMessage;

/**
 * Chat update message types
 */
type ChatUpdateType =
  | 'message.new'
  | 'message.status'
  | 'message.deleted'
  | 'message.edited'
  | 'chat.typing'
  | 'chat.presence'
  | 'chat.read'
  | 'media.processed';

/**
 * Chat update message to client
 */
interface ChatUpdateMessage {
  type: ChatUpdateType;
  chatId: string;
  [key: string]: unknown;
}

/**
 * The tenancy of one connection, established at `open()` from the authenticated
 * upgrade — NEVER from a socket message (G5 deliverable (e); WISH "Streaming and
 * long-lived state"). A connection with no binding is a legacy/flag-off one.
 */
export interface ChatConnectionBinding {
  /** Trusted tenant of the connection. */
  tenantId: string;
  /** Tenant revocation epoch observed when the connection was authorized. */
  revocationEpoch: number;
  /** Terminate the transport — used by the revocation sweep. */
  close?: (reason: string) => void;
}

/**
 * Subscription options
 */
interface SubscriptionOptions {
  chatId?: string;
  includeTyping: boolean;
  includePresence: boolean;
  includeReadReceipts: boolean;
  /**
   * The connection's trusted tenant, copied from its `open()` binding on every
   * (re)subscribe. It is deliberately NOT read from the client message: a
   * `subscribe` payload carrying a `tenantId` is ignored, so a caller cannot
   * widen what it receives.
   */
  tenantId: string | null;
}

/**
 * Check if a subscriber should receive an update based on their filter settings
 *
 * `updateTenantId` is the TRUSTED tenant of the update (null for a legacy/
 * flag-off update). It must equal the subscriber's own trusted tenant: a
 * tenant-bound update never reaches a legacy subscriber and vice versa, so the
 * two worlds cannot mix even while both exist.
 */
function shouldReceiveUpdate(
  sub: SubscriptionOptions,
  update: ChatUpdateMessage,
  updateTenantId: string | null,
): boolean {
  // Tenant gate first — a chat id is not authority to receive a chat.
  if (sub.tenantId !== updateTenantId) {
    return false;
  }

  // Check chat filter
  if (sub.chatId && sub.chatId !== update.chatId) {
    return false;
  }

  // Check type-specific filters
  const typeFilters: Record<ChatUpdateType, keyof SubscriptionOptions | null> = {
    'chat.typing': 'includeTyping',
    'chat.presence': 'includePresence',
    'chat.read': 'includeReadReceipts',
    'message.new': null,
    'message.status': null,
    'message.deleted': null,
    'message.edited': null,
    'media.processed': null,
  };

  const filterKey = typeFilters[update.type];
  if (filterKey && !sub[filterKey]) {
    return false;
  }

  return true;
}

/**
 * Safely send a message to a WebSocket
 */
function sendToSocket(ws: unknown, data: string, instanceId: string): void {
  const log = createLogger('ws:chats');
  try {
    const socket = ws as { send?: (data: string) => void };
    socket?.send?.(data);
  } catch (error) {
    log.error('Error sending update', { instanceId, error: String(error) });
  }
}

/**
 * Create WebSocket chat handler
 */
export function createChatWebSocketHandler(_db: Database, _eventBus: EventBus | null, instanceId: string) {
  const subscriptions = new Map<unknown, SubscriptionOptions>();
  const bindings = new Map<unknown, ChatConnectionBinding>();
  /** Tenancy bookkeeping for the revocation sweep (RELEASE_SLOS ≤ 30s). */
  const streamRegistry = new TenantStreamRegistry<unknown>();
  const log = createLogger('ws:chats');

  function forget(ws: unknown): void {
    subscriptions.delete(ws);
    bindings.delete(ws);
    streamRegistry.remove(ws);
  }

  return {
    /** The live tenancy view, for the revocation sweep. */
    streamRegistry,

    /**
     * Handle WebSocket open
     *
     * `binding` carries the connection's TRUSTED tenant, derived by the upgrade
     * handler from the authenticated credential. Omitted ⇒ a legacy/flag-off
     * connection, byte-identical to pre-G5.
     */
    open(ws: unknown, binding?: ChatConnectionBinding): void {
      log.debug('Client connected', { instanceId });
      if (binding) bindings.set(ws, binding);
      subscriptions.set(ws, {
        includeTyping: true,
        includePresence: true,
        includeReadReceipts: true,
        tenantId: binding?.tenantId ?? null,
      });
      streamRegistry.add(ws, {
        tenantId: binding?.tenantId ?? null,
        resourceId: instanceId,
        revocationEpoch: binding?.revocationEpoch ?? 0,
        close: (reason) => binding?.close?.(reason),
      });
    },

    /**
     * Close and drop every subscription of a revoked tenant (RELEASE_SLOS
     * `websocket_sse_channel_provider_session_termination_seconds_max`).
     * Legacy/tenantless connections are untouched.
     */
    terminateTenant(tenantId: string, reason: string): number {
      let closed = 0;
      for (const [ws, sub] of [...subscriptions]) {
        if (sub.tenantId !== tenantId) continue;
        try {
          bindings.get(ws)?.close?.(reason);
        } catch {
          // Socket already gone — the drop below is what matters.
        }
        forget(ws);
        closed += 1;
      }
      return closed;
    },

    /**
     * Handle WebSocket message
     */
    message(ws: unknown, message: string | Buffer): void {
      try {
        const data = JSON.parse(message.toString()) as ClientMessage;

        switch (data.type) {
          case 'subscribe':
            log.debug('Client subscribed', { instanceId, chatId: data.chatId });
            subscriptions.set(ws, {
              chatId: data.chatId,
              includeTyping: data.includeTyping ?? true,
              includePresence: data.includePresence ?? true,
              includeReadReceipts: data.includeReadReceipts ?? true,
              // From the CONNECTION's binding, never from `data` — a tenant in
              // the payload is ignored.
              tenantId: bindings.get(ws)?.tenantId ?? null,
            });
            break;

          case 'unsubscribe':
            log.debug('Client unsubscribed', { instanceId });
            subscriptions.delete(ws);
            break;

          default:
            log.debug('Unknown message type', { instanceId, data });
        }
      } catch (error) {
        log.error('Error parsing message', { instanceId, error: String(error) });
      }
    },

    /**
     * Handle WebSocket close
     */
    close(ws: unknown): void {
      log.debug('Client disconnected', { instanceId });
      forget(ws);
    },

    /**
     * Broadcast a chat update to relevant subscribers
     *
     * @param updateTenantId - the TRUSTED tenant that owns this update, derived
     *   by the producer from the chat's persisted ownership. Omitted ⇒ a
     *   legacy/flag-off update, delivered only to legacy subscribers.
     */
    broadcast(update: ChatUpdateMessage, updateTenantId: string | null = null): void {
      const payload = JSON.stringify(update);

      for (const [ws, sub] of subscriptions) {
        if (shouldReceiveUpdate(sub, update, updateTenantId)) {
          sendToSocket(ws, payload, instanceId);
        }
      }
    },
  };
}
