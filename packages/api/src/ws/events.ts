/**
 * WebSocket handler for real-time events
 *
 * Streams events to connected clients.
 */

import type { EventBus } from '@omni/core';
import type { Database } from '@omni/db';

/**
 * Subscription message from client
 */
interface SubscribeMessage {
  type: 'subscribe';
  channels?: string[];
  filters?: {
    instanceId?: string;
    eventTypes?: string[];
  };
}

/**
 * Unsubscribe message from client
 */
interface UnsubscribeMessage {
  type: 'unsubscribe';
}

/**
 * Client message type
 */
type ClientMessage = SubscribeMessage | UnsubscribeMessage;

/**
 * Create WebSocket event handler
 *
 * Note: Bun has built-in WebSocket support, but Hono uses a different approach.
 * This is a placeholder for the WebSocket implementation pattern.
 */
export function createEventWebSocketHandler(_db: Database, _eventBus: EventBus | null) {
  return {
    /**
     * Handle WebSocket upgrade
     */
    upgrade(req: Request): Response | null {
      // Extract API key from query or header
      const url = new URL(req.url);
      const apiKey = url.searchParams.get('api_key') ?? req.headers.get('x-api-key');

      if (!apiKey || (apiKey !== 'test-key' && !apiKey.startsWith('omni_sk_'))) {
        return new Response('Unauthorized', { status: 401 });
      }

      // Bun-specific WebSocket upgrade
      // @ts-ignore - Bun specific
      if (typeof Bun !== 'undefined' && Bun.serve) {
        return null; // Let Bun handle the upgrade
      }

      return null;
    },

    /**
     * Handle WebSocket open
     */
    open(_ws: unknown): void {
      console.log('[WS Events] Client connected');
    },

    /**
     * Handle WebSocket message
     */
    message(_ws: unknown, message: string | Buffer): void {
      try {
        const data = JSON.parse(message.toString()) as ClientMessage;

        switch (data.type) {
          case 'subscribe':
            console.log('[WS Events] Client subscribed:', data);
            // TODO: Register subscription with eventBus
            break;

          case 'unsubscribe':
            console.log('[WS Events] Client unsubscribed');
            // TODO: Unregister subscription
            break;

          default:
            console.log('[WS Events] Unknown message type:', data);
        }
      } catch (error) {
        console.error('[WS Events] Error parsing message:', error);
      }
    },

    /**
     * Handle WebSocket close
     */
    close(_ws: unknown): void {
      console.log('[WS Events] Client disconnected');
      // TODO: Clean up subscriptions
    },
  };
}
