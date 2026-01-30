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
 * Create WebSocket chat handler
 */
export function createChatWebSocketHandler(_db: Database, _eventBus: EventBus | null, instanceId: string) {
  const subscriptions = new Map<
    unknown,
    {
      chatId?: string;
      includeTyping: boolean;
      includePresence: boolean;
      includeReadReceipts: boolean;
    }
  >();

  return {
    /**
     * Handle WebSocket open
     */
    open(ws: unknown): void {
      console.log(`[WS Chats ${instanceId}] Client connected`);
      // Initialize with default subscription options
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
      for (const [ws, sub] of subscriptions) {
        // Check if this client should receive this update
        if (sub.chatId && sub.chatId !== update.chatId) {
          continue;
        }

        // Filter by update type
        if (update.type === 'chat.typing' && !sub.includeTyping) continue;
        if (update.type === 'chat.presence' && !sub.includePresence) continue;
        if (update.type === 'chat.read' && !sub.includeReadReceipts) continue;

        // Send update
        try {
          const socket = ws as { send?: (data: string) => void };
          if (socket?.send) {
            socket.send(JSON.stringify(update));
          }
        } catch (error) {
          console.error(`[WS Chats ${instanceId}] Error sending update:`, error);
        }
      }
    },
  };
}
