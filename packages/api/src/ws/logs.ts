/**
 * WebSocket handler for real-time logs
 *
 * Streams service logs to connected clients.
 */

import { createLogger } from '@omni/core';
import type { Database } from '@omni/db';

const log = createLogger('ws:logs');

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
 * Subscription options
 */
interface LogSubscriptionOptions {
  services: string[];
  level: LogLevel;
  search?: string;
}

// Log level ordering for filtering
const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warning: 2,
  error: 3,
};

/**
 * Check if a subscriber should receive a log based on their filter settings
 */
function shouldReceiveLog(sub: LogSubscriptionOptions, log: LogMessage): boolean {
  // Check service filter
  if (!sub.services.includes('*') && !sub.services.includes(log.service)) {
    return false;
  }

  // Check log level filter (show this level and above)
  if (LOG_LEVEL_ORDER[log.level] < LOG_LEVEL_ORDER[sub.level]) {
    return false;
  }

  // Check search filter
  if (sub.search && !log.message.toLowerCase().includes(sub.search.toLowerCase())) {
    return false;
  }

  return true;
}

/**
 * Safely send a message to a WebSocket
 */
function sendToSocket(ws: unknown, data: string): void {
  try {
    const socket = ws as { send?: (data: string) => void };
    socket?.send?.(data);
  } catch (error) {
    log.error('Error sending log', { error: String(error) });
  }
}

/**
 * Create WebSocket logs handler
 */
export function createLogsWebSocketHandler(_db: Database) {
  const subscriptions = new Map<unknown, LogSubscriptionOptions>();

  return {
    /**
     * Handle WebSocket open
     */
    open(_ws: unknown): void {
      log.debug('Client connected');
    },

    /**
     * Handle WebSocket message
     */
    message(ws: unknown, message: string | Buffer): void {
      try {
        const data = JSON.parse(message.toString()) as ClientMessage;

        switch (data.type) {
          case 'subscribe':
            log.debug('Client subscribed', { services: data.services, level: data.level });
            subscriptions.set(ws, {
              services: data.services ?? ['*'],
              level: data.level ?? 'info',
            });
            // TODO: Send initial tail lines
            break;

          case 'filter': {
            log.debug('Client updated filter', { services: data.services, level: data.level });
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
            log.debug('Client unsubscribed');
            subscriptions.delete(ws);
            break;

          default:
            log.debug('Unknown message type', { data });
        }
      } catch (error) {
        log.error('Error parsing message', { error: String(error) });
      }
    },

    /**
     * Handle WebSocket close
     */
    close(ws: unknown): void {
      log.debug('Client disconnected');
      subscriptions.delete(ws);
    },

    /**
     * Broadcast a log entry to relevant subscribers
     */
    broadcast(log: LogMessage): void {
      const payload = JSON.stringify(log);

      for (const [ws, sub] of subscriptions) {
        if (shouldReceiveLog(sub, log)) {
          sendToSocket(ws, payload);
        }
      }
    },
  };
}
