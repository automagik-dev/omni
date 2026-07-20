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
  /** Pre-resolved instance with route overrides applied (avoids double resolution in debounce callback) */
  resolvedInstance?: unknown;
  /** Route ID that matched during early resolution (null = no route matched) */
  routeId?: string | null;
}

export interface DebounceConfig {
  mode: 'disabled' | 'fixed' | 'randomized' | 'presence';
  minMs: number;
  maxMs: number;
  restartOnTyping: boolean;
  groupMs: number | null;
  /**
   * Hard cap on how long a batch may accumulate, measured from the FIRST
   * buffered message. Null = no cap (legacy behavior). When set, the timer is
   * clamped so a continuously-typing user still flushes at
   * `firstBufferedAt + maxWaitMs` instead of restarting forever.
   */
  maxWaitMs: number | null;
}

// ============================================================================
// MessageDebouncer
// ============================================================================

export class MessageDebouncer {
  private buffers: Map<string, BufferedMessage[]> = new Map();
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private inFlight: Set<string> = new Set();
  /** Timestamp of the first buffered message per chat — anchors the maxWaitMs cap. */
  private firstBufferedAt: Map<string, number> = new Map();
  private onFlush: (chatKey: string, messages: BufferedMessage[]) => Promise<void>;
  /** Injectable clock — defaults to Date.now; overridable for deterministic tests. */
  private now: () => number;

  constructor(onFlush: (chatKey: string, messages: BufferedMessage[]) => Promise<void>, now: () => number = Date.now) {
    this.onFlush = onFlush;
    this.now = now;
  }

  private getChatKey(instanceId: string, chatId: string): string {
    return `${instanceId}:${chatId}`;
  }

  buffer(instanceId: string, chatId: string, message: BufferedMessage, config: DebounceConfig): void {
    const chatKey = this.getChatKey(instanceId, chatId);
    const buffer = this.buffers.get(chatKey) ?? [];
    buffer.push(message);
    this.buffers.set(chatKey, buffer);

    // Anchor the max-wait window on the first message of a fresh batch so the
    // cap survives any number of timer restarts (typing or new messages).
    if (!this.firstBufferedAt.has(chatKey)) this.firstBufferedAt.set(chatKey, this.now());

    // If this chat is currently being processed, just accumulate — don't start
    // a new timer. The flush completion handler will pick up these messages.
    if (this.inFlight.has(chatKey)) return;

    this.restartTimer(chatKey, config);
  }

  /**
   * Whether messages are currently buffered for this chat — typically ones
   * that arrived while a flush was in flight. The dispatcher uses this to
   * detect that a reply it is about to deliver was generated from a stale
   * snapshot (newer inbound exists) and may discard it; the finally-block
   * re-flush then answers everything with full context.
   */
  hasPending(instanceId: string, chatId: string): boolean {
    return (this.buffers.get(this.getChatKey(instanceId, chatId))?.length ?? 0) > 0;
  }

  onUserTyping(instanceId: string, chatId: string, config: DebounceConfig): void {
    const chatKey = this.getChatKey(instanceId, chatId);
    // Don't restart the timer if this chat is currently being flushed — the
    // finally-block re-flush will pick up any pending messages.  Restarting
    // here would race with that re-flush and could cause a double-dispatch.
    if (this.inFlight.has(chatKey)) return;
    // 'presence' mode is sugar for fixed + restartOnTyping + a max-wait cap, so
    // typing always restarts its window regardless of the restartOnTyping flag.
    const restarts = config.restartOnTyping || config.mode === 'presence';
    if (restarts && this.buffers.has(chatKey)) {
      log.debug('Restarting debounce timer on user typing', { chatKey });
      this.restartTimer(chatKey, config, true);
    }
  }

  private restartTimer(chatKey: string, config: DebounceConfig, force = false): void {
    const existing = this.timers.get(chatKey);

    // In 'fixed' / 'presence' mode the timer is a fixed collection window from
    // the first message — do NOT restart it when subsequent messages arrive.
    // However, typing events force-restart so the user has time to finish
    // composing before the agent is dispatched.
    const fixedWindow = config.mode === 'fixed' || config.mode === 'presence';
    if (fixedWindow && existing && !force) return;

    if (existing) clearTimeout(existing);

    let delay: number;
    switch (config.mode) {
      case 'disabled':
        delay = 0;
        break;
      case 'fixed':
      case 'presence':
        delay = config.minMs;
        break;
      case 'randomized':
        delay = config.minMs + Math.random() * (config.maxMs - config.minMs);
        break;
      default:
        delay = 0;
    }

    delay = this.applyMaxWaitCap(chatKey, config, delay);

    const timer = setTimeout(() => this.flush(chatKey), delay);
    this.timers.set(chatKey, timer);
  }

  /**
   * Clamp the next fire so a batch never accumulates past
   * `firstBufferedAt + maxWaitMs`. No-op when maxWaitMs is unset, keeping
   * disabled/fixed/randomized behavior byte-identical.
   */
  private applyMaxWaitCap(chatKey: string, config: DebounceConfig, delay: number): number {
    if (config.maxWaitMs == null || config.maxWaitMs <= 0) return delay;
    const firstAt = this.firstBufferedAt.get(chatKey);
    if (firstAt == null) return delay;
    const remaining = firstAt + config.maxWaitMs - this.now();
    return Math.max(0, Math.min(delay, remaining));
  }

  private async flush(chatKey: string): Promise<void> {
    const messages = this.buffers.get(chatKey);
    const timer = this.timers.get(chatKey);
    this.buffers.delete(chatKey);
    this.timers.delete(chatKey);
    this.firstBufferedAt.delete(chatKey);
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

  /**
   * Flush every non-empty buffer, awaiting each dispatch, then drop residual
   * timers. Unlike {@link clear}, buffered messages are DELIVERED rather than
   * discarded — use this on graceful shutdown / connection close so a burst
   * that arrived just before teardown is not lost.
   *
   * Reuses {@link flush} so the in-flight guard + finally-block re-flush
   * semantics are preserved (messages arriving mid-flush are re-flushed).
   */
  async flushAll(): Promise<void> {
    const chatKeys = [...this.buffers.keys()];
    await Promise.all(chatKeys.map((chatKey) => this.flush(chatKey)));
    // flush() already clears per-key state; drop any residual timers/anchors
    // (e.g. empty windows) so the debouncer is left clean.
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.firstBufferedAt.clear();
  }

  clear(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.buffers.clear();
    this.timers.clear();
    this.firstBufferedAt.clear();
    this.inFlight.clear();
  }
}
