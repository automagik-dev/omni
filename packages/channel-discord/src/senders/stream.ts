/**
 * DiscordStreamSender — progressive response rendering via message editing
 *
 * Implements the StreamSender interface for Discord:
 * - Thinking: Discord blockquote (> 🧠 Thinking...) with truncation
 * - Content: progressive edits with █ cursor, throttled at 1200ms
 * - Final: clean multi-chunk split via chunkMessage()
 * - Error/abort: delete placeholder message
 *
 * Key behaviors:
 * - 1200ms edit throttle to stay within Discord rate limits (5 req/5s)
 * - Tail window for content > 1800 chars (keeps last 1800 visible)
 * - Short thinking (<2s) is skipped visually
 * - Discord markdown format (blockquote via >, bold via **)
 * - Exponential backoff on 429 errors (2^attempt multiplier)
 * - All sends/edits use allowedMentions: { parse: [] } to prevent mention injection
 * - Streaming edits are best-effort (retried on 429); finalization edits use retryOnRateLimit
 */

import type { StreamSender } from '@omni/channel-sdk';
import { createLogger } from '@omni/core';
import type { StreamDelta } from '@omni/core';
import type { Client, Message, SendableChannels } from 'discord.js';
import { chunkMessage } from '../utils/chunking';
import { markdownToDiscord } from '../utils/markdown-to-discord';

const log = createLogger('discord:sender:stream');

/** Max chars for streaming content display (leave room for cursor) */
const MAX_STREAM_CHARS = 1800;
/** Max chars for thinking text in final blockquote */
const MAX_THINKING_CHARS = 500;
/** Minimum thinking duration to show in UI */
const MIN_THINKING_DISPLAY_MS = 2000;
/** Edit throttle interval (Discord rate limit: 5 req/5s per channel) */
const THROTTLE_MS = 1200;
/** Maximum retries for 429 errors */
const MAX_RETRIES = 3;
/** Base retry delay in ms */
const BASE_RETRY_DELAY_MS = 1000;

export class DiscordStreamSender implements StreamSender {
  private message: Message | null = null;
  private channel: SendableChannels | null = null;
  private lastEditAt = 0;
  private phase: 'idle' | 'thinking' | 'content' | 'done' = 'idle';
  private thinkingStartMs = 0;
  private thinkingDurationMs: number | undefined;
  private pendingEditTimer: ReturnType<typeof setTimeout> | null = null;
  private lastRenderedText = '';
  private retryDelay = BASE_RETRY_DELAY_MS;

  constructor(
    private readonly client: Client,
    private readonly channelId: string,
    private readonly replyToMessageId?: string,
    private readonly formatMode: 'convert' | 'passthrough' = 'convert',
  ) {}

  async onThinkingDelta(delta: StreamDelta & { phase: 'thinking' }): Promise<void> {
    if (this.phase === 'done') return;

    if (this.phase === 'idle') {
      this.phase = 'thinking';
      this.thinkingStartMs = Date.now();
    }

    const elapsed = Date.now() - this.thinkingStartMs;
    if (elapsed < MIN_THINKING_DISPLAY_MS) return;

    const text = this.buildThinkingText(delta.thinking);
    await this.throttledEdit(text);
  }

  async onContentDelta(delta: StreamDelta & { phase: 'content' }): Promise<void> {
    if (this.phase === 'done') return;

    if (this.phase !== 'content') {
      this.phase = 'content';
      if (delta.thinkingDurationMs !== undefined) {
        this.thinkingDurationMs = delta.thinkingDurationMs;
      }
    }

    const contentText = delta.content;
    let displayText: string;

    if (contentText.length > MAX_STREAM_CHARS) {
      const header = '⏳ ...\n';
      const budget = MAX_STREAM_CHARS - header.length;
      displayText = `${header}${contentText.slice(-budget)}█`;
    } else {
      displayText = `${contentText}█`;
    }

    await this.throttledEdit(displayText);
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
    const formattedContent = this.formatMode === 'passthrough' ? finalContent : markdownToDiscord(finalContent);
    const fullText = thinkingBlock ? `${thinkingBlock}\n\n${formattedContent}` : formattedContent;
    const chunks = chunkMessage(fullText);

    if (this.message) {
      await this.finalizeWithEdit(chunks);
    } else {
      await this.finalizeWithNewMessages(chunks);
    }
  }

  async onError(delta: StreamDelta & { phase: 'error' }): Promise<void> {
    this.phase = 'done';
    this.clearPendingEdit();
    log.error('Stream error', { channelId: this.channelId, error: delta.error });
    await this.deleteIfExists();
  }

  async abort(): Promise<void> {
    this.phase = 'done';
    this.clearPendingEdit();
    await this.deleteIfExists();
  }

  // ─── Private helpers ────────────────────────────────────────

  private buildThinkingText(thinking: string): string {
    const truncated = thinking.length > MAX_THINKING_CHARS ? `...${thinking.slice(-MAX_THINKING_CHARS)}` : thinking;
    return `> 🧠 Thinking...\n> ${truncated.replace(/\n/g, '\n> ')}`;
  }

  private buildFinalThinkingBlock(thinking: string | undefined, durationMs: number | undefined): string | null {
    if (!thinking) return null;
    const duration = durationMs ?? this.thinkingDurationMs;
    if (duration !== undefined && duration < MIN_THINKING_DISPLAY_MS) return null;

    const truncated = thinking.length > MAX_THINKING_CHARS ? `...${thinking.slice(-MAX_THINKING_CHARS)}` : thinking;

    const durationLabel = duration ? ` (${(duration / 1000).toFixed(1)}s)` : '';
    return `> 🧠 Thought${durationLabel}\n> ${truncated.replace(/\n/g, '\n> ')}`;
  }

  private async getOrFetchChannel(): Promise<SendableChannels> {
    if (this.channel) return this.channel;
    const ch = await this.client.channels.fetch(this.channelId);
    if (!ch || !('send' in ch)) {
      throw new Error(`Discord channel ${this.channelId} is not sendable`);
    }
    this.channel = ch as SendableChannels;
    return this.channel;
  }

  private async throttledEdit(text: string): Promise<void> {
    if (text === this.lastRenderedText) return;

    const now = Date.now();
    const elapsed = now - this.lastEditAt;

    if (elapsed >= THROTTLE_MS) {
      this.clearPendingEdit();
      await this.doEdit(text);
    } else {
      this.clearPendingEdit();
      const delay = THROTTLE_MS - elapsed;
      this.pendingEditTimer = setTimeout(() => {
        this.pendingEditTimer = null;
        if (this.phase !== 'done') {
          this.doEdit(text).catch((err) => {
            log.error('Pending edit failed', { channelId: this.channelId, error: String(err) });
          });
        }
      }, delay);
    }
  }

  private async doEdit(text: string): Promise<void> {
    try {
      if (!this.message) {
        const ch = await this.getOrFetchChannel();
        const options: Parameters<typeof ch.send>[0] = {
          content: text,
          allowedMentions: { parse: [] },
        };
        if (this.replyToMessageId) {
          (options as { reply?: { messageReference: string } }).reply = {
            messageReference: this.replyToMessageId,
          };
        }
        this.message = await ch.send(options);
      } else {
        await this.message.edit({ content: text, allowedMentions: { parse: [] } });
      }
      this.lastRenderedText = text;
      this.lastEditAt = Date.now();
      this.retryDelay = BASE_RETRY_DELAY_MS;
    } catch (err: unknown) {
      const errStr = String(err);
      if (errStr.includes('429') || errStr.includes('Too Many Requests')) {
        const delay = this.retryDelay;
        log.warn('Discord rate limit hit, scheduling retry', {
          channelId: this.channelId,
          retryDelay: delay,
        });
        this.retryDelay = Math.min(this.retryDelay * 2, 10000);
        this.lastEditAt = Date.now();
        // Retry the same edit after backoff instead of dropping it
        this.clearPendingEdit();
        this.pendingEditTimer = setTimeout(() => {
          this.pendingEditTimer = null;
          if (this.phase !== 'done') {
            this.doEdit(text).catch((retryErr) => {
              log.error('Retry after rate limit failed', { channelId: this.channelId, error: String(retryErr) });
            });
          }
        }, delay);
        return;
      }
      if (errStr.includes('Cannot edit a message authored by another user')) return;
      log.error('Failed to edit/send stream message', { channelId: this.channelId, error: errStr });
    }
  }

  private async finalizeWithEdit(chunks: string[]): Promise<void> {
    const firstChunk = chunks[0];
    if (!firstChunk) return;

    try {
      await this.retryOnRateLimit(async () => {
        await this.message?.edit({ content: firstChunk, allowedMentions: { parse: [] } });
      });
    } catch (err) {
      log.warn('Failed to edit final message, sending as new', {
        channelId: this.channelId,
        error: String(err),
      });
      await this.deleteIfExists();
      await this.finalizeWithNewMessages(chunks);
      return;
    }

    await this.sendRemainingChunks(chunks);
  }

  private async finalizeWithNewMessages(chunks: string[]): Promise<void> {
    const ch = await this.getOrFetchChannel();
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk) continue;
      const options: Parameters<typeof ch.send>[0] = {
        content: chunk,
        allowedMentions: { parse: [] },
      };
      if (i === 0 && this.replyToMessageId) {
        (options as { reply?: { messageReference: string } }).reply = {
          messageReference: this.replyToMessageId,
        };
      }
      await this.retryOnRateLimit(async () => {
        await ch.send(options);
      });
    }
  }

  private async sendRemainingChunks(chunks: string[]): Promise<void> {
    const ch = await this.getOrFetchChannel();
    for (let i = 1; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (chunk) {
        await this.retryOnRateLimit(async () => {
          await ch.send({ content: chunk, allowedMentions: { parse: [] } });
        });
      }
    }
  }

  private async deleteIfExists(): Promise<void> {
    if (!this.message) return;
    try {
      await this.message.delete();
    } catch {
      // Best effort — message may already be gone
    }
    this.message = null;
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
          const delay = this.retryDelay * 2 ** attempt;
          log.warn('Rate limit retry', { channelId: this.channelId, attempt, delay });
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }
  }
}
