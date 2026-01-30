/**
 * Typing indicators for WhatsApp
 *
 * Provides typing indicator functionality with auto-pause.
 */

import type { WASocket } from '@whiskeysockets/baileys';

/**
 * Typing state
 */
export type TypingState = 'composing' | 'recording' | 'paused';

/**
 * Default typing duration in milliseconds
 */
export const DEFAULT_TYPING_DURATION = 3000;

/**
 * Active typing timers per chat
 */
const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Send typing indicator
 *
 * Shows "typing..." in the chat. Auto-pauses after the specified duration.
 *
 * @param sock - Baileys socket
 * @param jid - Chat JID
 * @param duration - Duration in milliseconds before auto-pause (default: 3000)
 */
export async function sendTyping(sock: WASocket, jid: string, duration = DEFAULT_TYPING_DURATION): Promise<void> {
  // Clear any existing timer for this chat
  clearTypingTimer(jid);

  // Send composing presence
  await sock.sendPresenceUpdate('composing', jid);

  // Set auto-pause timer
  const timer = setTimeout(async () => {
    try {
      await sock.sendPresenceUpdate('paused', jid);
    } catch {
      // Ignore errors when auto-pausing
    }
    typingTimers.delete(jid);
  }, duration);

  typingTimers.set(jid, timer);
}

/**
 * Send recording indicator
 *
 * Shows "recording..." in the chat (for voice notes). Auto-pauses after duration.
 *
 * @param sock - Baileys socket
 * @param jid - Chat JID
 * @param duration - Duration in milliseconds before auto-pause
 */
export async function sendRecording(sock: WASocket, jid: string, duration = DEFAULT_TYPING_DURATION): Promise<void> {
  // Clear any existing timer for this chat
  clearTypingTimer(jid);

  // Send recording presence
  await sock.sendPresenceUpdate('recording', jid);

  // Set auto-pause timer
  const timer = setTimeout(async () => {
    try {
      await sock.sendPresenceUpdate('paused', jid);
    } catch {
      // Ignore errors when auto-pausing
    }
    typingTimers.delete(jid);
  }, duration);

  typingTimers.set(jid, timer);
}

/**
 * Stop typing/recording indicator
 *
 * Immediately pauses the typing indicator.
 *
 * @param sock - Baileys socket
 * @param jid - Chat JID
 */
export async function stopTyping(sock: WASocket, jid: string): Promise<void> {
  // Clear any existing timer
  clearTypingTimer(jid);

  // Send paused presence
  await sock.sendPresenceUpdate('paused', jid);
}

/**
 * Clear typing timer for a chat
 */
function clearTypingTimer(jid: string): void {
  const existingTimer = typingTimers.get(jid);
  if (existingTimer) {
    clearTimeout(existingTimer);
    typingTimers.delete(jid);
  }
}

/**
 * Clear all typing timers
 *
 * Call this when disconnecting to clean up.
 */
export function clearAllTypingTimers(): void {
  for (const timer of typingTimers.values()) {
    clearTimeout(timer);
  }
  typingTimers.clear();
}

/**
 * Typing indicator wrapper with fluent API
 */
export class TypingIndicator {
  private sock: WASocket;
  private jid: string;

  constructor(sock: WASocket, jid: string) {
    this.sock = sock;
    this.jid = jid;
  }

  /**
   * Start showing typing indicator
   */
  async start(duration = DEFAULT_TYPING_DURATION): Promise<void> {
    await sendTyping(this.sock, this.jid, duration);
  }

  /**
   * Start showing recording indicator
   */
  async startRecording(duration = DEFAULT_TYPING_DURATION): Promise<void> {
    await sendRecording(this.sock, this.jid, duration);
  }

  /**
   * Stop the indicator
   */
  async stop(): Promise<void> {
    await stopTyping(this.sock, this.jid);
  }
}

/**
 * Create a typing indicator for a chat
 */
export function createTypingIndicator(sock: WASocket, jid: string): TypingIndicator {
  return new TypingIndicator(sock, jid);
}
