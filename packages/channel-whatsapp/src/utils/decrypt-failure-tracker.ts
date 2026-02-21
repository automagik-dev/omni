/**
 * Tracks JIDs with repeated decrypt failures and temporarily ignores them.
 *
 * When a JID exceeds `threshold` failures within `windowMs`, it's blocked
 * for `blockDurationMs`. During the block period, `shouldIgnore(jid)` returns
 * true, causing Baileys to ACK the message without attempting decrypt —
 * no transaction mutex acquired, no retry storm.
 *
 * After the block period expires, the JID is unblocked and given another chance.
 * If it fails again, it gets re-blocked (with the same threshold).
 *
 * JIDs are normalized (device suffix stripped) so that:
 * - `messages.upsert` records failures for `178035101794451@lid`
 * - `shouldIgnoreJid` checks `178035101794451:23@lid`
 * Both resolve to the same key: `178035101794451@lid`
 *
 * See: #70
 */

import { createLogger } from '@omni/core';

const log = createLogger('whatsapp:decrypt-tracker');

/**
 * Strip device suffix from JID: `178035101794451:23@lid` → `178035101794451@lid`
 * This ensures recording (from msg.key.remoteJid) and checking (from node.attrs.from)
 * match even when one includes the `:device` part and the other doesn't.
 */
function normalizeJid(jid: string): string {
  return jid.replace(/:\d+@/, '@');
}

interface JidState {
  /** Timestamps of recent failures (within windowMs) */
  failures: number[];
  /** If blocked, the timestamp when the block expires */
  blockedUntil: number;
}

export interface DecryptFailureTrackerOptions {
  /** Number of failures within windowMs before blocking (default: 3) */
  threshold?: number;
  /** Time window for counting failures in ms (default: 30_000) */
  windowMs?: number;
  /** How long to block a JID in ms (default: 60_000) */
  blockDurationMs?: number;
}

export class DecryptFailureTracker {
  private readonly state = new Map<string, JidState>();
  private readonly threshold: number;
  private readonly windowMs: number;
  private readonly blockDurationMs: number;

  constructor(options?: DecryptFailureTrackerOptions) {
    this.threshold = options?.threshold ?? 3;
    this.windowMs = options?.windowMs ?? 30_000;
    this.blockDurationMs = options?.blockDurationMs ?? 60_000;
  }

  /**
   * Record a decrypt failure for a JID.
   * Call this from the messages.upsert handler when a message has CIPHERTEXT stub.
   */
  recordFailure(jid: string): void {
    const key = normalizeJid(jid);
    const now = Date.now();
    let entry = this.state.get(key);
    if (!entry) {
      entry = { failures: [], blockedUntil: 0 };
      this.state.set(key, entry);
    }

    // Prune old failures outside the window
    entry.failures = entry.failures.filter((t) => now - t < this.windowMs);
    entry.failures.push(now);

    if (entry.failures.length >= this.threshold && entry.blockedUntil < now) {
      entry.blockedUntil = now + this.blockDurationMs;
      log.warn('Blocking JID due to repeated decrypt failures', {
        jid: key,
        failures: entry.failures.length,
        blockedForMs: this.blockDurationMs,
      });
    }
  }

  /**
   * Check if a JID should be ignored.
   * Pass this as the `shouldIgnoreJid` callback to Baileys.
   * Normalizes the JID to match regardless of device suffix.
   */
  shouldIgnore = (jid: string): boolean => {
    if (!jid) return false;
    const key = normalizeJid(jid);
    const entry = this.state.get(key);
    if (!entry) return false;

    const now = Date.now();
    if (entry.blockedUntil > now) {
      return true;
    }

    // Block expired — delete the entry entirely to prevent memory leak.
    // JID gets a fresh start; if it fails again, a new entry will be created.
    if (entry.blockedUntil > 0 && entry.blockedUntil <= now) {
      this.state.delete(key);
    }

    return false;
  };

  /** Clear tracking for a specific JID (e.g., on session recreation) */
  clear(jid: string): void {
    this.state.delete(normalizeJid(jid));
  }

  /** Clear all tracking state */
  clearAll(): void {
    this.state.clear();
  }
}
