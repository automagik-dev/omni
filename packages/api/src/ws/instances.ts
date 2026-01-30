/**
 * WebSocket handler for instance status updates
 *
 * Streams instance connection status and QR codes.
 */

import type { EventBus } from '@omni/core';
import type { Database } from '@omni/db';

/**
 * Subscribe to instance status
 */
interface SubscribeInstancesMessage {
  type: 'subscribe';
  instances?: string[] | ['*'];
}

/**
 * Unsubscribe from instance status
 */
interface UnsubscribeInstancesMessage {
  type: 'unsubscribe';
}

/**
 * Client message type
 */
type ClientMessage = SubscribeInstancesMessage | UnsubscribeInstancesMessage;

/**
 * Instance status update to client
 */
interface InstanceStatusMessage {
  type: 'status';
  instanceId: string;
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
  qr?: string;
  error?: string;
  timestamp: string;
}

/**
 * Create WebSocket instances handler
 */
export function createInstancesWebSocketHandler(_db: Database, _eventBus: EventBus | null) {
  const subscriptions = new Map<
    unknown,
    {
      instances: string[];
    }
  >();

  return {
    /**
     * Handle WebSocket open
     */
    open(_ws: unknown): void {
      console.log('[WS Instances] Client connected');
    },

    /**
     * Handle WebSocket message
     */
    message(ws: unknown, message: string | Buffer): void {
      try {
        const data = JSON.parse(message.toString()) as ClientMessage;

        switch (data.type) {
          case 'subscribe':
            console.log('[WS Instances] Client subscribed:', data);
            subscriptions.set(ws, {
              instances: data.instances ?? ['*'],
            });
            break;

          case 'unsubscribe':
            console.log('[WS Instances] Client unsubscribed');
            subscriptions.delete(ws);
            break;

          default:
            console.log('[WS Instances] Unknown message type:', data);
        }
      } catch (error) {
        console.error('[WS Instances] Error parsing message:', error);
      }
    },

    /**
     * Handle WebSocket close
     */
    close(ws: unknown): void {
      console.log('[WS Instances] Client disconnected');
      subscriptions.delete(ws);
    },

    /**
     * Broadcast an instance status update
     */
    broadcast(status: InstanceStatusMessage): void {
      for (const [ws, sub] of subscriptions) {
        // Check instance filter
        if (!sub.instances.includes('*') && !sub.instances.includes(status.instanceId)) {
          continue;
        }

        // Send status
        try {
          const socket = ws as { send?: (data: string) => void };
          if (socket?.send) {
            socket.send(JSON.stringify(status));
          }
        } catch (error) {
          console.error('[WS Instances] Error sending status:', error);
        }
      }
    },
  };
}
