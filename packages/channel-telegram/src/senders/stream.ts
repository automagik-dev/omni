/**
 * TelegramStreamSender — progressive response rendering via editMessageText
 *
 * Implements the StreamSender interface for Telegram:
 * - Thinking: collapsible <blockquote expandable> with 🧠 header
 * - Content: progressive edits with █ cursor, throttled at 900ms
 * - Final: clean multi-chunk split via splitMessage()
 * - Error/abort: delete placeholder message
 *
 * Key behaviors:
 * - 900ms edit throttle to avoid Telegram 429 rate limits
 * - Tail window for content > 3800 chars (keeps last 3800 visible)
 * - Short thinking (<2s) is skipped visually
 * - HTML parse_mode for <blockquote expandable> support (Bot API 7.10+)
 * - Exponential backoff on 429 errors
 */

import type { StreamSender } from '@omni/channel-sdk';
import { createLogger } from '@omni/core';
import type { StreamDelta } from '@omni/core';
import type { Bot } from 'grammy';
import { splitMessage } from '../utils/formatting';

const log = createLogger('telegram:sender:stream');

/** Escape HTML special characters for Telegram HTML parse_mode */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Max chars for streaming content display (leave room for HTML tags + cursor) */
const MAX_STREAM_CHARS = 3800;
/** Max chars for thinking text in final blockquote */
const MAX_THINKING_CHARS = 600;
/** Minimum thinking duration to show in UI (skip visual noise for fast responses) */
const MIN_THINKING_DISPLAY_MS = 2000;
/** Edit throttle interval */
const THROTTLE_MS = 900;
/** Maximum retries for 429 errors */
const MAX_RETRIES = 3;
/** Telegram max message length */
const TELEGRAM_MAX_LENGTH = 4096;

export class TelegramStreamSender implements StreamSender {
  private messageId: number | null = null;
  private lastEditAt = 0;
  private phase: 'idle' | 'thinking' | 'content' | 'done' = 'idle';
  private thinkingText = '';
  private thinkingStartMs = 0;
  private thinkingDurationMs: number | undefined;
  private pendingEditTimer: ReturnType<typeof setTimeout> | null = null;
  private lastRenderedText = '';
  private retryDelay = 1000;

  constructor(
    private readonly bot: Bot,
    private readonly chatId: string,
    private readonly replyToMessageId?: number,
  ) {}

  async onThinkingDelta(delta: StreamDelta & { phase: 'thinking' }): Promise<void> {
    if (this.phase === 'done') return;

    if (this.phase === 'idle') {
      this.phase = 'thinking';
      this.thinkingStartMs = Date.now();
    }

    this.thinkingText = delta.thinking;

    // Only render thinking if we've been thinking for MIN_THINKING_DISPLAY_MS
    const elapsed = Date.now() - this.thinkingStartMs;
    if (elapsed < MIN_THINKING_DISPLAY_MS) return;

    const html = this.buildThinkingHtml(delta.thinking);
    await this.throttledEdit(html);
  }

  async onContentDelta(delta: StreamDelta & { phase: 'content' }): Promise<void> {
    if (this.phase === 'done') return;

    if (this.phase !== 'content') {
      this.phase = 'content';
      if (delta.thinkingDurationMs !== undefined) {
        this.thinkingDurationMs = delta.thinkingDurationMs;
      }
    }

    // Build display text with tail window if needed
    const contentText = delta.content;
    let displayHtml: string;

    const escapedContent = escapeHtml(contentText);
    if (escapedContent.length > MAX_STREAM_CHARS) {
      // Tail window: show last MAX_STREAM_CHARS with ellipsis header
      const header = '⏳ ...\n';
      const budget = MAX_STREAM_CHARS - header.length;
      const tail = escapedContent.slice(-budget);
      displayHtml = `${header}${tail}█`;
    } else {
      displayHtml = `${escapedContent}█`;
    }

    await this.throttledEdit(displayHtml);
  }

  async onFinal(delta: StreamDelta & { phase: 'final' }): Promise<void> {
    this.phase = 'done';
    this.clearPendingEdit();

    const finalContent = delta.content;
    if (!finalContent) {
      await this.deleteIfExists();
      return;
    }

    const thinkingBlock = this.buildFinalThinkingBlock(delta.thinking, delta.thinkingDurationMs);
    const fullText = thinkingBlock ? `${thinkingBlock}\n\n${finalContent}` : finalContent;
    const chunks = splitMessage(fullText, TELEGRAM_MAX_LENGTH);
    const hasHtml = !!thinkingBlock;

    if (this.messageId) {
      await this.finalizeWithEdit(chunks, hasHtml);
    } else {
      await this.finalizeWithNewMessages(chunks, hasHtml);
    }
  }

  /** Edit placeholder to first chunk, send rest as new messages. */
  private async finalizeWithEdit(chunks: string[], hasHtml: boolean): Promise<void> {
    const firstChunk = chunks[0];
    if (!firstChunk) return;

    try {
      if (hasHtml) {
        await this.editMessageHtml(firstChunk);
      } else {
        await this.editMessagePlain(firstChunk);
      }
    } catch (err) {
      log.warn('Failed to edit final message, sending as new', { chatId: this.chatId, error: String(err) });
      await this.deleteIfExists();
      await this.finalizeWithNewMessages(chunks, hasHtml);
      return;
    }

    await this.sendRemainingChunks(chunks);
  }

  /** Send all chunks as new messages (no placeholder to edit). */
  private async finalizeWithNewMessages(chunks: string[], hasHtml: boolean): Promise<void> {
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk) continue;
      // First chunk uses HTML if thinking block present; rest are plain
      const useHtml = hasHtml && i === 0;
      if (useHtml) {
        await this.sendNewMessageHtml(chunk);
      } else {
        await this.sendNewMessage(chunk, true);
      }
    }
  }

  /** Send chunks[1..n] as new messages. */
  private async sendRemainingChunks(chunks: string[]): Promise<void> {
    for (let i = 1; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (chunk) {
        await this.sendNewMessage(chunk, true);
      }
    }
  }

  async onError(delta: StreamDelta & { phase: 'error' }): Promise<void> {
    this.phase = 'done';
    this.clearPendingEdit();
    log.error('Stream error', { chatId: this.chatId, error: delta.error });
    await this.deleteIfExists();
  }

  async abort(): Promise<void> {
    this.phase = 'done';
    this.clearPendingEdit();
    await this.deleteIfExists();
  }

  // ─── Private helpers ────────────────────────────────────────

  private buildThinkingHtml(thinking: string): string {
    const escaped = escapeHtml(thinking);
    const truncated = escaped.length > MAX_THINKING_CHARS ? `...${escaped.slice(-MAX_THINKING_CHARS)}` : escaped;
    return `<blockquote expandable>🧠 Thinking...\n${truncated}</blockquote>`;
  }

  private buildFinalThinkingBlock(thinking: string | undefined, durationMs: number | undefined): string | null {
    if (!thinking) return null;
    // Skip thinking display if it was very short
    const duration = durationMs ?? this.thinkingDurationMs;
    if (duration !== undefined && duration < MIN_THINKING_DISPLAY_MS) return null;

    const escaped = escapeHtml(thinking);
    const truncated = escaped.length > MAX_THINKING_CHARS ? `...${escaped.slice(-MAX_THINKING_CHARS)}` : escaped;

    const durationLabel = duration ? ` (${(duration / 1000).toFixed(1)}s)` : '';
    return `<blockquote expandable>🧠 Thought${durationLabel}\n${truncated}</blockquote>`;
  }

  private async throttledEdit(html: string): Promise<void> {
    // Don't edit if text hasn't changed
    if (html === this.lastRenderedText) return;

    const now = Date.now();
    const elapsed = now - this.lastEditAt;

    if (elapsed >= THROTTLE_MS) {
      // Safe to edit immediately
      this.clearPendingEdit();
      await this.doEdit(html);
    } else {
      // Schedule edit for when throttle window expires
      this.clearPendingEdit();
      const delay = THROTTLE_MS - elapsed;
      this.pendingEditTimer = setTimeout(async () => {
        this.pendingEditTimer = null;
        if (this.phase !== 'done') {
          await this.doEdit(html);
        }
      }, delay);
    }
  }

  private async doEdit(html: string): Promise<void> {
    try {
      if (!this.messageId) {
        // Create placeholder message
        const result = await this.bot.api.sendMessage(this.chatId, html, {
          parse_mode: 'HTML',
          ...(this.replyToMessageId ? { reply_parameters: { message_id: this.replyToMessageId } } : {}),
        });
        this.messageId = result.message_id;
      } else {
        await this.bot.api.editMessageText(this.chatId, this.messageId, html, {
          parse_mode: 'HTML',
        });
      }
      this.lastRenderedText = html;
      this.lastEditAt = Date.now();
      this.retryDelay = 1000; // Reset backoff on success
    } catch (err: unknown) {
      const errStr = String(err);
      // Handle 429 Too Many Requests
      if (errStr.includes('429') || errStr.includes('Too Many Requests')) {
        log.warn('Telegram rate limit hit, backing off', {
          chatId: this.chatId,
          retryDelay: this.retryDelay,
        });
        this.retryDelay = Math.min(this.retryDelay * 2, 10000);
        this.lastEditAt = Date.now() + this.retryDelay; // Push next edit further out
        return;
      }
      // Handle "message is not modified" (no-op)
      if (errStr.includes('message is not modified')) return;
      log.error('Failed to edit/send stream message', { chatId: this.chatId, error: errStr });
    }
  }

  private async editMessageHtml(html: string): Promise<void> {
    const msgId = this.messageId;
    if (!msgId) return;
    await this.retryOnRateLimit(async () => {
      await this.bot.api.editMessageText(this.chatId, msgId, html, {
        parse_mode: 'HTML',
      });
    });
  }

  private async editMessagePlain(text: string): Promise<void> {
    const msgId = this.messageId;
    if (!msgId) return;
    await this.retryOnRateLimit(async () => {
      await this.bot.api.editMessageText(this.chatId, msgId, text);
    });
  }

  private async sendNewMessage(text: string, plain = true): Promise<void> {
    await this.retryOnRateLimit(async () => {
      await this.bot.api.sendMessage(this.chatId, text, plain ? {} : { parse_mode: 'HTML' });
    });
  }

  private async sendNewMessageHtml(html: string): Promise<void> {
    await this.retryOnRateLimit(async () => {
      await this.bot.api.sendMessage(this.chatId, html, { parse_mode: 'HTML' });
    });
  }

  private async deleteIfExists(): Promise<void> {
    if (!this.messageId) return;
    try {
      await this.bot.api.deleteMessage(this.chatId, this.messageId);
    } catch {
      // Best effort — message may already be gone
    }
    this.messageId = null;
  }

  private clearPendingEdit(): void {
    if (this.pendingEditTimer) {
      clearTimeout(this.pendingEditTimer);
      this.pendingEditTimer = null;
    }
  }

  private async retryOnRateLimit(fn: () => Promise<void>): Promise<void> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await fn();
        return;
      } catch (err: unknown) {
        const errStr = String(err);
        if ((errStr.includes('429') || errStr.includes('Too Many Requests')) && attempt < MAX_RETRIES - 1) {
          const delay = this.retryDelay * (attempt + 1);
          log.warn('Rate limit retry', { chatId: this.chatId, attempt, delay });
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }
  }
}
