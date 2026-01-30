/**
 * Presence management for WhatsApp
 *
 * Handles online/offline status and presence updates.
 */

import type { WASocket } from '@whiskeysockets/baileys';

/**
 * Presence types supported by WhatsApp
 */
export type PresenceType = 'available' | 'unavailable' | 'composing' | 'recording' | 'paused';

/**
 * Presence manager for a WhatsApp instance
 */
export class PresenceManager {
  private sock: WASocket;
  private currentPresence: PresenceType = 'unavailable';

  constructor(sock: WASocket) {
    this.sock = sock;
  }

  /**
   * Get current presence state
   */
  get presence(): PresenceType {
    return this.currentPresence;
  }

  /**
   * Set presence to available (online)
   */
  async setAvailable(): Promise<void> {
    await this.sock.sendPresenceUpdate('available');
    this.currentPresence = 'available';
  }

  /**
   * Set presence to unavailable (offline)
   */
  async setUnavailable(): Promise<void> {
    await this.sock.sendPresenceUpdate('unavailable');
    this.currentPresence = 'unavailable';
  }

  /**
   * Set presence for a specific chat
   *
   * @param jid - Chat JID
   * @param presence - Presence type
   */
  async setPresenceForChat(jid: string, presence: PresenceType): Promise<void> {
    await this.sock.sendPresenceUpdate(presence, jid);
  }

  /**
   * Subscribe to presence updates for a contact
   *
   * @param jid - Contact JID to subscribe to
   */
  async subscribeToPresence(jid: string): Promise<void> {
    await this.sock.presenceSubscribe(jid);
  }
}

/**
 * Create a presence manager for a socket
 */
export function createPresenceManager(sock: WASocket): PresenceManager {
  return new PresenceManager(sock);
}

/**
 * Set presence to online
 */
export async function setOnline(sock: WASocket): Promise<void> {
  await sock.sendPresenceUpdate('available');
}

/**
 * Set presence to offline
 */
export async function setOffline(sock: WASocket): Promise<void> {
  await sock.sendPresenceUpdate('unavailable');
}
