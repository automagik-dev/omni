/**
 * WebSocket handler for real-time chat updates
 *
 * Streams chat messages, typing indicators, and presence updates.
 */

import { type EventBus, createLogger } from '@omni/core';
import type { Database } from '@omni/db';

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
 * Subscription options
 */
interface SubscriptionOptions {
  chatId?: string;
  includeTyping: boolean;
  includePresence: boolean;
  includeReadReceipts: boolean;
}

/**
 * Check if a subscriber should receive an update based on their filter settings
 */
function shouldReceiveUpdate(sub: SubscriptionOptions, update: ChatUpdateMessage): boolean {
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
  const log = createLogger('ws:chats');

  return {
    /**
     * Handle WebSocket open
     */
    open(ws: unknown): void {
      log.debug('Client connected', { instanceId });
      subscriptions.set(ws, {
        includeTyping: true,
        includePresence: true,
        includeReadReceipts: true,
      });
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
      subscriptions.delete(ws);
    },

    /**
     * Broadcast a chat update to relevant subscribers
     */
    broadcast(update: ChatUpdateMessage): void {
      const payload = JSON.stringify(update);

      for (const [ws, sub] of subscriptions) {
        if (shouldReceiveUpdate(sub, update)) {
          sendToSocket(ws, payload, instanceId);
        }
      }
    },
  };
}
