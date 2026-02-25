/**
 * Reaction Acknowledgment System
 *
 * Provides instant visual feedback across all channels when bot receives a message.
 * Adds an emoji reaction (configurable per-channel) when message received,
 * removes it after bot responds or after a hard timeout (120s).
 *
 * Features:
 * - Per-instance on/off toggle
 * - Per-channel emoji configuration
 * - Rate limiting with separate bucket (10 acks/min)
 * - WhatsApp fallback to typing indicator when reactions unsupported
 * - Fire-and-forget (non-blocking)
 * - Auto-removal after response or 120s timeout
 */

import type { ChannelPlugin } from './types/plugin';

// ============================================================================
// Types
// ============================================================================

/**
 * Interface that channel plugins implement to support reaction acknowledgment
 */
export interface AckProvider {
  /** Add an ack reaction to a message */
  ack(instanceId: string, chatId: string, messageId: string, emoji: string): Promise<void>;
  /** Remove an ack reaction from a message */
  removeAck(instanceId: string, chatId: string, messageId: string, emoji: string): Promise<void>;
}

/**
 * Reaction ack configuration (per-instance)
 */
export interface ReactionAckConfig {
  /** Whether ack is enabled */
  reactionAck: 'off' | 'on';
  /** Per-channel emoji overrides */
  reactionAckEmoji?: {
    whatsapp?: string;
    telegram?: string;
    discord?: string;
    [key: string]: string | undefined;
  };
  /** Timeout in ms before ack is auto-removed (hard cap 120s) */
  ackTimeoutMs?: number;
}

/**
 * Handle returned by startAck() for removing the ack later
 */
export interface AckHandle {
  /** Remove the ack reaction (call after agent responds) */
  remove(): void;
}

// ============================================================================
// Ack Rate Limiter (separate bucket from message rate limiter)
// ============================================================================

/** DEC-9: 10 acks per minute, hardcoded, per-instance */
const ACK_RATE_LIMIT = 10;
const ACK_RATE_WINDOW_MS = 60_000;

class AckRateLimiter {
  private counters: Map<string, number[]> = new Map();

  /**
   * Check if an ack is allowed for the given instance
   * Returns true if under rate limit, false if exceeded
   */
  isAllowed(instanceId: string): boolean {
    const key = `ack:${instanceId}`;
    const now = Date.now();

    let timestamps = this.counters.get(key) ?? [];
    timestamps = timestamps.filter((ts) => now - ts < ACK_RATE_WINDOW_MS);

    if (timestamps.length >= ACK_RATE_LIMIT) {
      return false;
    }

    timestamps.push(now);
    this.counters.set(key, timestamps);
    return true;
  }

  /** Clean up expired entries */
  cleanup(): void {
    const now = Date.now();
    for (const [key, timestamps] of this.counters.entries()) {
      const active = timestamps.filter((ts) => now - ts < ACK_RATE_WINDOW_MS);
      if (active.length === 0) {
        this.counters.delete(key);
      } else {
        this.counters.set(key, active);
      }
    }
  }
}

// ============================================================================
// Ack Orchestrator
// ============================================================================

/** Hard cap on ack timeout: 120 seconds */
const MAX_ACK_TIMEOUT_MS = 120_000;

/** Singleton rate limiter for all ack operations */
const ackRateLimiter = new AckRateLimiter();

/** Periodic cleanup interval */
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

function ensureCleanup(): void {
  if (!cleanupInterval) {
    cleanupInterval = setInterval(() => ackRateLimiter.cleanup(), 60_000);
  }
}

/**
 * Start an ack reaction on a message.
 *
 * Returns an AckHandle that the caller uses to remove the ack after agent responds.
 * If config is 'off', rate limit exceeded, or ack fails, returns a no-op handle.
 *
 * @param plugin - Channel plugin (must have sendTyping for WhatsApp fallback)
 * @param ackProvider - AckProvider implementation (or null if channel doesn't support)
 * @param instanceId - Instance ID
 * @param chatId - Chat ID
 * @param messageId - External message ID to react to
 * @param channel - Channel type string
 * @param config - Reaction ack configuration from instance
 */
export function startAck(
  plugin: ChannelPlugin | null,
  ackProvider: AckProvider | null,
  instanceId: string,
  chatId: string,
  messageId: string,
  channel: string,
  config: ReactionAckConfig,
): AckHandle {
  const noopHandle: AckHandle = { remove() {} };

  // DEC-5: Missing config defaults to 'off'
  if (config.reactionAck !== 'on') {
    return noopHandle;
  }

  // DEC-9: Rate limit check (separate bucket)
  ensureCleanup();
  if (!ackRateLimiter.isAllowed(instanceId)) {
    // Rate limit exceeded — silently skip ack (DEC-9: cosmetic, no error)
    return noopHandle;
  }

  const emoji = config.reactionAckEmoji?.[channel] ?? '👀';
  const timeoutMs = Math.min(config.ackTimeoutMs ?? MAX_ACK_TIMEOUT_MS, MAX_ACK_TIMEOUT_MS);

  let removed = false;

  // Fire-and-forget: add ack reaction (RISK-3: don't await, handle failure silently)
  if (ackProvider) {
    ackProvider.ack(instanceId, chatId, messageId, emoji).catch(() => {
      // ASM-1: WhatsApp fallback to typing indicator when reaction fails
      if (
        (channel === 'whatsapp' || channel === 'whatsapp-baileys' || channel === 'whatsapp-cloud') &&
        plugin?.sendTyping
      ) {
        plugin.sendTyping(instanceId, chatId, timeoutMs).catch(() => {});
      }
    });
  } else if (
    (channel === 'whatsapp' || channel === 'whatsapp-baileys' || channel === 'whatsapp-cloud') &&
    plugin?.sendTyping
  ) {
    // No ack provider available, use typing indicator as fallback
    plugin.sendTyping(instanceId, chatId, timeoutMs).catch(() => {});
  }

  // DEC-8: Hard timeout — remove ack after 120s regardless
  const timer = setTimeout(() => {
    if (!removed && ackProvider) {
      removed = true;
      ackProvider.removeAck(instanceId, chatId, messageId, emoji).catch(() => {});
    }
  }, timeoutMs);

  return {
    remove() {
      if (removed) return;
      removed = true;
      clearTimeout(timer);
      if (ackProvider) {
        ackProvider.removeAck(instanceId, chatId, messageId, emoji).catch(() => {});
      }
    },
  };
}

/**
 * Shutdown the ack system (cleanup interval)
 */
export function shutdownAckSystem(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

// Export for testing
export { AckRateLimiter, ACK_RATE_LIMIT, ACK_RATE_WINDOW_MS, MAX_ACK_TIMEOUT_MS };
