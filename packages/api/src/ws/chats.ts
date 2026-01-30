/**
 * WebSocket handler for real-time chat updates
 *
 * Streams chat messages, typing indicators, and presence updates.
 */

import type { EventBus } from '@omni/core';
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
  try {
    const socket = ws as { send?: (data: string) => void };
    socket?.send?.(data);
  } catch (error) {
    console.error(`[WS Chats ${instanceId}] Error sending update:`, error);
  }
}

/**
 * Create WebSocket chat handler
 */
export function createChatWebSocketHandler(_db: Database, _eventBus: EventBus | null, instanceId: string) {
  const subscriptions = new Map<unknown, SubscriptionOptions>();

  return {
    /**
     * Handle WebSocket open
     */
    open(ws: unknown): void {
      console.log(`[WS Chats ${instanceId}] Client connected`);
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
            console.log(`[WS Chats ${instanceId}] Client subscribed:`, data);
            subscriptions.set(ws, {
              chatId: data.chatId,
              includeTyping: data.includeTyping ?? true,
              includePresence: data.includePresence ?? true,
              includeReadReceipts: data.includeReadReceipts ?? true,
            });
            break;

          case 'unsubscribe':
            console.log(`[WS Chats ${instanceId}] Client unsubscribed`);
            subscriptions.delete(ws);
            break;

          default:
            console.log(`[WS Chats ${instanceId}] Unknown message type:`, data);
        }
      } catch (error) {
        console.error(`[WS Chats ${instanceId}] Error parsing message:`, error);
      }
    },

    /**
     * Handle WebSocket close
     */
    close(ws: unknown): void {
      console.log(`[WS Chats ${instanceId}] Client disconnected`);
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
