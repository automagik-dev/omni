/**
 * Typing indicator helpers
 *
 * Utilities for managing typing indicators with automatic timeout.
 */

/**
 * Typing indicator state for a chat
 */
interface TypingState {
  /** Timeout handle for auto-stop */
  timeout: ReturnType<typeof setTimeout>;

  /** When typing started */
  startedAt: Date;
}

/**
 * Manages typing indicators for multiple chats
 */
export class TypingManager {
  /** Active typing states by chatId */
  private typing = new Map<string, TypingState>();

  /** Default typing duration in ms */
  private defaultDuration: number;

  /** Callback to actually send typing to the platform */
  private sendTyping: (chatId: string, isTyping: boolean) => Promise<void>;

  constructor(options: {
    defaultDuration?: number;
    sendTyping: (chatId: string, isTyping: boolean) => Promise<void>;
  }) {
    this.defaultDuration = options.defaultDuration ?? 5000;
    this.sendTyping = options.sendTyping;
  }

  /**
   * Start or extend typing indicator for a chat
   *
   * @param chatId - Chat to show typing in
   * @param duration - Duration in ms (0 = stop, undefined = default)
   */
  async startTyping(chatId: string, duration?: number): Promise<void> {
    const effectiveDuration = duration ?? this.defaultDuration;

    // Stop means duration = 0
    if (effectiveDuration === 0) {
      await this.stopTyping(chatId);
      return;
    }

    // Clear existing timeout if any
    const existing = this.typing.get(chatId);
    if (existing) {
      clearTimeout(existing.timeout);
    }

    // Send typing indicator
    await this.sendTyping(chatId, true);

    // Set up auto-stop
    const timeout = setTimeout(() => {
      this.stopTypingSync(chatId);
    }, effectiveDuration);

    this.typing.set(chatId, {
      timeout,
      startedAt: new Date(),
    });
  }

  /**
   * Stop typing indicator for a chat
   */
  async stopTyping(chatId: string): Promise<void> {
    const state = this.typing.get(chatId);
    if (!state) return;

    clearTimeout(state.timeout);
    this.typing.delete(chatId);

    await this.sendTyping(chatId, false);
  }

  /**
   * Stop typing synchronously (for cleanup)
   */
  private stopTypingSync(chatId: string): void {
    const state = this.typing.get(chatId);
    if (!state) return;

    clearTimeout(state.timeout);
    this.typing.delete(chatId);

    // Fire and forget
    this.sendTyping(chatId, false).catch(() => {
      // Ignore errors on cleanup
    });
  }

  /**
   * Stop all typing indicators
   */
  async stopAll(): Promise<void> {
    const chatIds = Array.from(this.typing.keys());
    await Promise.all(chatIds.map((id) => this.stopTyping(id)));
  }

  /**
   * Check if typing is active for a chat
   */
  isTyping(chatId: string): boolean {
    return this.typing.has(chatId);
  }

  /**
   * Get all chats with active typing
   */
  getActiveChats(): string[] {
    return Array.from(this.typing.keys());
  }
}
