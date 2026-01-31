/**
 * Message debounce system for automation
 *
 * Groups rapid messages from the same conversation before processing.
 * Supports multiple debounce modes:
 * - none: Process immediately
 * - fixed: Wait exactly N ms
 * - range: Wait random time between min-max ms
 * - presence: Extend timer on composing/recording events
 */

import { createLogger } from '../logger';
import type { DebounceConfig } from './types';

const logger = createLogger('automations:debounce');

/**
 * A message waiting to be processed
 */
export interface DebouncedMessage {
  type: string;
  text?: string;
  timestamp: number;
  payload: Record<string, unknown>;
}

/**
 * Key for grouping messages: instanceId + personId
 */
export type ConversationKey = string;

/**
 * Build conversation key from instanceId and personId
 */
export function buildConversationKey(instanceId: string, personId: string): ConversationKey {
  return `${instanceId}:${personId}`;
}

/**
 * Parse conversation key back to components
 */
export function parseConversationKey(key: ConversationKey): { instanceId: string; personId: string } {
  const parts = key.split(':');
  return { instanceId: parts[0] ?? '', personId: parts[1] ?? '' };
}

/**
 * State for a debounce window
 */
interface DebounceWindow {
  messages: DebouncedMessage[];
  firstMessageAt: number;
  lastActivityAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  from: {
    id: string;
    name?: string;
  };
  instanceId: string;
}

/**
 * Callback when debounce window fires
 */
export type DebounceCallback = (
  key: ConversationKey,
  messages: DebouncedMessage[],
  from: { id: string; name?: string },
  instanceId: string,
) => void;

/**
 * Debounce manager for a set of conversations
 */
export class DebounceManager {
  private windows = new Map<ConversationKey, DebounceWindow>();

  constructor(
    private config: DebounceConfig,
    private callback: DebounceCallback,
  ) {}

  /**
   * Add a message to the debounce queue
   */
  addMessage(
    key: ConversationKey,
    message: DebouncedMessage,
    from: { id: string; name?: string },
    instanceId: string,
  ): void {
    // If mode is none, fire immediately
    if (this.config.mode === 'none') {
      this.callback(key, [message], from, instanceId);
      return;
    }

    let window = this.windows.get(key);

    if (!window) {
      window = {
        messages: [],
        firstMessageAt: Date.now(),
        lastActivityAt: Date.now(),
        timer: null,
        from,
        instanceId,
      };
      this.windows.set(key, window);
    }

    // Add message
    window.messages.push(message);
    window.lastActivityAt = Date.now();

    // Reset timer
    this.resetTimer(key, window);
  }

  /**
   * Handle a presence event (for presence-based debounce)
   */
  handlePresenceEvent(key: ConversationKey, eventType: string): void {
    if (this.config.mode !== 'presence') {
      return;
    }

    const window = this.windows.get(key);
    if (!window) {
      return;
    }

    // Check if this event should extend the timer
    if (this.config.extendOnEvents.includes(eventType)) {
      window.lastActivityAt = Date.now();
      this.resetTimer(key, window);
      logger.debug('Debounce extended on presence event', { key, eventType });
    }
  }

  /**
   * Calculate delay based on config
   */
  private calculateDelay(window: DebounceWindow): number {
    switch (this.config.mode) {
      case 'none':
        return 0;

      case 'fixed':
        return this.config.delayMs;

      case 'range': {
        const { minMs, maxMs } = this.config;
        return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
      }

      case 'presence': {
        // Check if we've exceeded max wait time
        if (this.config.maxWaitMs) {
          const elapsed = Date.now() - window.firstMessageAt;
          if (elapsed >= this.config.maxWaitMs) {
            return 0; // Fire immediately
          }
        }
        return this.config.baseDelayMs;
      }

      default:
        return 0;
    }
  }

  /**
   * Reset the timer for a window
   */
  private resetTimer(key: ConversationKey, window: DebounceWindow): void {
    // Clear existing timer
    if (window.timer) {
      clearTimeout(window.timer);
    }

    const delay = this.calculateDelay(window);

    if (delay === 0) {
      // Fire immediately
      this.fireWindow(key);
      return;
    }

    // Set new timer
    window.timer = setTimeout(() => {
      this.fireWindow(key);
    }, delay);

    logger.debug('Debounce timer reset', { key, delayMs: delay, messageCount: window.messages.length });
  }

  /**
   * Fire a debounce window (process all messages)
   */
  private fireWindow(key: ConversationKey): void {
    const window = this.windows.get(key);
    if (!window) {
      return;
    }

    // Clear timer
    if (window.timer) {
      clearTimeout(window.timer);
    }

    // Remove from map
    this.windows.delete(key);

    // Callback with all messages
    const { messages, from, instanceId } = window;
    logger.debug('Debounce window fired', { key, messageCount: messages.length });
    this.callback(key, messages, from, instanceId);
  }

  /**
   * Force flush all windows (e.g., on shutdown)
   */
  flushAll(): void {
    for (const key of this.windows.keys()) {
      this.fireWindow(key);
    }
  }

  /**
   * Get the number of active debounce windows
   */
  getActiveWindowCount(): number {
    return this.windows.size;
  }

  /**
   * Get pending message count for a conversation
   */
  getPendingCount(key: ConversationKey): number {
    return this.windows.get(key)?.messages.length ?? 0;
  }
}

/**
 * Create a debounce manager with default config
 */
export function createDebounceManager(
  config: DebounceConfig | null | undefined,
  callback: DebounceCallback,
): DebounceManager {
  const defaultConfig: DebounceConfig = { mode: 'none' };
  return new DebounceManager(config ?? defaultConfig, callback);
}
