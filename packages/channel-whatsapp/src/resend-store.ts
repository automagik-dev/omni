/**
 * Resend Store — tracks outbound messages awaiting server ACK
 *
 * When WhatsApp drops mid-stream, sock.sendMessage() calls may return a message
 * ID but never receive a server ACK (status >= 2). On reconnect, we query this
 * store and re-send any messages sent in the last N minutes that still lack ACK.
 *
 * Design:
 *  - Pure in-memory: no DB dependency, survives only for the process lifetime
 *  - Keyed by instanceId → messageId → PendingMessage
 *  - Messages are removed when server_ack (status >= 2) is received
 *  - All messages for an instance are cleared on disconnect/logout
 */

import type { OutgoingMessage } from '@omni/channel-sdk';
import { createLogger } from '@omni/core';

const log = createLogger('whatsapp:resend-store');

/** How long we keep unacked messages eligible for resend (5 minutes) */
export const RESEND_WINDOW_MS = 5 * 60 * 1000;

/**
 * A single pending (unacked) outbound message.
 */
export interface PendingMessage {
  /** Resolved JID that was used for the send (e.g. "5511999@s.whatsapp.net") */
  jid: string;
  /** Original OutgoingMessage so we can reproduce the send exactly */
  message: OutgoingMessage;
  /** Unix timestamp (ms) when the message was first sent */
  sentAt: number;
}

/**
 * In-memory store for outbound messages awaiting server ACK.
 *
 * One ResendStore instance is shared across all WhatsApp plugin instances.
 * State is keyed first by instanceId, then by messageId (the Baileys-assigned
 * external ID returned by sock.sendMessage).
 */
export class ResendStore {
  /** instanceId → messageId → PendingMessage */
  private readonly store = new Map<string, Map<string, PendingMessage>>();

  /**
   * Register an outbound message as pending ACK.
   *
   * @param instanceId - WhatsApp instance ID
   * @param messageId  - Baileys-assigned message ID (result.key.id)
   * @param jid        - Resolved JID used for the send
   * @param message    - Original OutgoingMessage
   */
  register(instanceId: string, messageId: string, jid: string, message: OutgoingMessage): void {
    let pending = this.store.get(instanceId);
    if (!pending) {
      pending = new Map();
      this.store.set(instanceId, pending);
    }
    pending.set(messageId, { jid, message, sentAt: Date.now() });
    log.debug('Registered pending message', { instanceId, messageId, jid });
  }

  /**
   * Acknowledge a message — removes it from the pending store.
   * Call this when status >= 2 (server_ack, delivered, read, played) is received.
   *
   * @param instanceId - WhatsApp instance ID
   * @param messageId  - Message ID to acknowledge
   */
  ack(instanceId: string, messageId: string): void {
    const pending = this.store.get(instanceId);
    if (!pending) return;
    if (pending.delete(messageId)) {
      log.debug('Acked pending message', { instanceId, messageId });
    }
  }

  /**
   * Get all pending messages for an instance that were sent within the resend
   * window and have not yet been ACKed.
   *
   * @param instanceId - WhatsApp instance ID
   * @param windowMs   - How far back to look (default: RESEND_WINDOW_MS = 5 min)
   * @returns Array of [messageId, PendingMessage] pairs eligible for resend
   */
  getPendingForResend(instanceId: string, windowMs = RESEND_WINDOW_MS): Array<[string, PendingMessage]> {
    const pending = this.store.get(instanceId);
    if (!pending || pending.size === 0) return [];

    const cutoff = Date.now() - windowMs;
    const eligible: Array<[string, PendingMessage]> = [];
    for (const [msgId, entry] of pending.entries()) {
      if (entry.sentAt >= cutoff) {
        eligible.push([msgId, entry]);
      }
    }
    return eligible;
  }

  /**
   * Clear all pending messages for an instance.
   * Call on disconnect, logout, or manual clear.
   *
   * @param instanceId - WhatsApp instance ID
   */
  clear(instanceId: string): void {
    const had = this.store.get(instanceId)?.size ?? 0;
    this.store.delete(instanceId);
    if (had > 0) {
      log.debug('Cleared pending messages for instance', { instanceId, count: had });
    }
  }

  /**
   * Return the count of pending (unacked) messages for an instance.
   * Useful for diagnostics / logging.
   */
  size(instanceId: string): number {
    return this.store.get(instanceId)?.size ?? 0;
  }
}

/** Singleton resend store — shared across all plugin instances in this process */
export const resendStore = new ResendStore();
