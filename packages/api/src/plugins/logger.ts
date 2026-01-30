/**
 * Simple logger implementation for plugins
 *
 * Creates a logger that writes to console with plugin context.
 */

import type { Logger } from '@omni/channel-sdk';

/**
 * Create a logger with given context
 */
export function createLogger(context: Record<string, unknown> = {}): Logger {
  const formatContext = (extra?: Record<string, unknown>) => {
    const combined = { ...context, ...extra };
    if (Object.keys(combined).length === 0) return '';
    return ` ${JSON.stringify(combined)}`;
  };

  const timestamp = () => new Date().toISOString();

  return {
    debug(message: string, data?: Record<string, unknown>) {
      if (process.env.LOG_LEVEL === 'debug') {
        console.debug(`[${timestamp()}] DEBUG: ${message}${formatContext(data)}`);
      }
    },
    info(message: string, data?: Record<string, unknown>) {
      console.log(`[${timestamp()}] INFO: ${message}${formatContext(data)}`);
    },
    warn(message: string, data?: Record<string, unknown>) {
      console.warn(`[${timestamp()}] WARN: ${message}${formatContext(data)}`);
    },
    error(message: string, data?: Record<string, unknown>) {
      console.error(`[${timestamp()}] ERROR: ${message}${formatContext(data)}`);
    },
    child(childContext: Record<string, unknown>): Logger {
      return createLogger({ ...context, ...childContext });
    },
  };
}
