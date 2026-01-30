/**
 * WebSocket handler for real-time logs
 *
 * Streams service logs to connected clients.
 */

import type { Database } from '@omni/db';

/**
 * Log level type
 */
type LogLevel = 'debug' | 'info' | 'warning' | 'error';

/**
 * Subscribe to logs
 */
interface SubscribeLogsMessage {
  type: 'subscribe';
  services?: string[] | ['*'];
  level?: LogLevel;
  tail?: number;
}

/**
 * Filter logs dynamically
 */
interface FilterLogsMessage {
  type: 'filter';
  services?: string[];
  level?: LogLevel;
  search?: string;
}

/**
 * Unsubscribe from logs
 */
interface UnsubscribeLogsMessage {
  type: 'unsubscribe';
}

/**
 * Client message type
 */
type ClientMessage = SubscribeLogsMessage | FilterLogsMessage | UnsubscribeLogsMessage;

/**
 * Log entry message to client
 */
interface LogMessage {
  type: 'log';
  service: string;
  level: LogLevel;
  timestamp: string;
  message: string;
  metadata?: Record<string, unknown>;
}

/**
 * Create WebSocket logs handler
 */
export function createLogsWebSocketHandler(_db: Database) {
  const subscriptions = new Map<
    unknown,
    {
      services: string[];
      level: LogLevel;
      search?: string;
    }
  >();

  // Log level ordering for filtering
  const logLevelOrder: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warning: 2,
    error: 3,
  };

  return {
    /**
     * Handle WebSocket open
     */
    open(_ws: unknown): void {
      console.log('[WS Logs] Client connected');
    },

    /**
     * Handle WebSocket message
     */
    message(ws: unknown, message: string | Buffer): void {
      try {
        const data = JSON.parse(message.toString()) as ClientMessage;

        switch (data.type) {
          case 'subscribe':
            console.log('[WS Logs] Client subscribed:', data);
            subscriptions.set(ws, {
              services: data.services ?? ['*'],
              level: data.level ?? 'info',
            });
            // TODO: Send initial tail lines
            break;

          case 'filter': {
            console.log('[WS Logs] Client updated filter:', data);
            const existing = subscriptions.get(ws);
            if (existing) {
              subscriptions.set(ws, {
                services: data.services ?? existing.services,
                level: data.level ?? existing.level,
                search: data.search,
              });
            }
            break;
          }

          case 'unsubscribe':
            console.log('[WS Logs] Client unsubscribed');
            subscriptions.delete(ws);
            break;

          default:
            console.log('[WS Logs] Unknown message type:', data);
        }
      } catch (error) {
        console.error('[WS Logs] Error parsing message:', error);
      }
    },

    /**
     * Handle WebSocket close
     */
    close(ws: unknown): void {
      console.log('[WS Logs] Client disconnected');
      subscriptions.delete(ws);
    },

    /**
     * Broadcast a log entry to relevant subscribers
     */
    broadcast(log: LogMessage): void {
      for (const [ws, sub] of subscriptions) {
        // Check service filter
        if (!sub.services.includes('*') && !sub.services.includes(log.service)) {
          continue;
        }

        // Check log level filter (show this level and above)
        if (logLevelOrder[log.level] < logLevelOrder[sub.level]) {
          continue;
        }

        // Check search filter
        if (sub.search && !log.message.toLowerCase().includes(sub.search.toLowerCase())) {
          continue;
        }

        // Send log
        try {
          const socket = ws as { send?: (data: string) => void };
          if (socket?.send) {
            socket.send(JSON.stringify(log));
          }
        } catch (error) {
          console.error('[WS Logs] Error sending log:', error);
        }
      }
    },
  };
}
