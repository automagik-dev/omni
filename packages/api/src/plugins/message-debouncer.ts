/**
 * MessageDebouncer — extracted from agent-dispatcher for testability.
 *
 * Buffers incoming messages per chat key and flushes them after a configurable
 * delay window, grouping rapid sequential messages into a single batch.
 */

import { createLogger } from '@omni/core';
import type { MessageReceivedPayload } from '@omni/core';

const log = createLogger('message-debouncer');

// ============================================================================
// Types
// ============================================================================

export interface BufferedMessage {
  payload: MessageReceivedPayload;
  metadata: DispatchMetadata;
  timestamp: number;
}

export interface DispatchMetadata {
  instanceId: string;
  channelType?: string;
  personId?: string;
  platformIdentityId?: string;
  traceId: string;
  /** Original NATS event correlationId for journey tracking */
  correlationId?: string;
  /** Whether this message is being journey-tracked (has timings) */
  journeyTracked?: boolean;
}

export interface DebounceConfig {
  mode: 'disabled' | 'fixed' | 'randomized';
  minMs: number;
  maxMs: number;
  restartOnTyping: boolean;
  groupMs: number | null;
}

// ============================================================================
// MessageDebouncer
// ============================================================================

export class MessageDebouncer {
  private buffers: Map<string, BufferedMessage[]> = new Map();
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private inFlight: Set<string> = new Set();
  private onFlush: (chatKey: string, messages: BufferedMessage[]) => Promise<void>;

  constructor(onFlush: (chatKey: string, messages: BufferedMessage[]) => Promise<void>) {
    this.onFlush = onFlush;
  }

  private getChatKey(instanceId: string, chatId: string): string {
    return `${instanceId}:${chatId}`;
  }

  buffer(instanceId: string, chatId: string, message: BufferedMessage, config: DebounceConfig): void {
    const chatKey = this.getChatKey(instanceId, chatId);
    const buffer = this.buffers.get(chatKey) ?? [];
    buffer.push(message);
    this.buffers.set(chatKey, buffer);

    // If this chat is currently being processed, just accumulate — don't start
    // a new timer. The flush completion handler will pick up these messages.
    if (this.inFlight.has(chatKey)) return;

    this.restartTimer(chatKey, config);
  }

  onUserTyping(instanceId: string, chatId: string, config: DebounceConfig): void {
    const chatKey = this.getChatKey(instanceId, chatId);
    if (config.restartOnTyping && this.buffers.has(chatKey)) {
      log.debug('Restarting debounce timer on user typing', { chatKey });
      this.restartTimer(chatKey, config);
    }
  }

  private restartTimer(chatKey: string, config: DebounceConfig): void {
    const existing = this.timers.get(chatKey);

    // In 'fixed' mode, the timer is a fixed collection window from the first
    // message — do NOT restart it when subsequent messages arrive.
    if (config.mode === 'fixed' && existing) return;

    if (existing) clearTimeout(existing);

    let delay: number;
    switch (config.mode) {
      case 'disabled':
        delay = 0;
        break;
      case 'fixed':
        delay = config.minMs;
        break;
      case 'randomized':
        delay = config.minMs + Math.random() * (config.maxMs - config.minMs);
        break;
      default:
        delay = 0;
    }

    const timer = setTimeout(() => this.flush(chatKey), delay);
    this.timers.set(chatKey, timer);
  }

  private async flush(chatKey: string): Promise<void> {
    const messages = this.buffers.get(chatKey);
    const timer = this.timers.get(chatKey);
    this.buffers.delete(chatKey);
    this.timers.delete(chatKey);
    if (timer) clearTimeout(timer);

    if (!messages?.length) return;

    this.inFlight.add(chatKey);
    try {
      await this.onFlush(chatKey, messages);
    } catch (error) {
      log.error('Error flushing debounced messages', { chatKey, error: String(error) });
    } finally {
      this.inFlight.delete(chatKey);

      // Check if new messages arrived while we were processing.
      // If so, flush them now (they've been accumulating in the buffer).
      const pending = this.buffers.get(chatKey);
      if (pending?.length) {
        // Use setTimeout(0) to avoid deep recursion
        setTimeout(() => this.flush(chatKey), 0);
      }
    }
  }

  clear(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.buffers.clear();
    this.timers.clear();
    this.inFlight.clear();
  }
}
