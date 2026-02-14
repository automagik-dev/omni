/**
 * WhatsAppStreamSender — progressive response rendering via Baileys message edits
 *
 * Implements the StreamSender interface for WhatsApp:
 * - Sends initial message, then edits it with progressive content
 * - Conservative 2500ms default throttle (WhatsApp has stricter rate limits than Telegram)
 * - Robust fallback: if edit fails, sends a new message and stops editing
 * - No humanDelay or typing simulation during streaming (avoids anti-bot double-penalty)
 * - Uses a tail window while streaming; splits into multiple messages on final render if needed
 * - Markdown→WhatsApp syntax conversion on final render
 *
 * Config: `streamThrottleMs` per instance (default 2500ms)
 */

import type { StreamSender } from '@omni/channel-sdk';
import { createLogger } from '@omni/core';
import type { StreamDelta } from '@omni/core';
import type { WASocket, proto } from '@whiskeysockets/baileys';

import { markdownToWhatsApp } from '../utils/markdown-to-whatsapp';
import { splitWhatsAppMessage } from '../utils/split-message';

const log = createLogger('whatsapp:sender:stream');

/** Default edit throttle interval (ms). Conservative for WhatsApp. */
export const DEFAULT_THROTTLE_MS = 2500;

/** Max chars to show during streaming (tail window if exceeded) */
const MAX_STREAM_CHARS = 3800;

/** WhatsApp max message length */
const MAX_MESSAGE_LENGTH = 65_536;

/** Cursor character shown during streaming */
const CURSOR = '▍';

export interface WhatsAppStreamSenderOptions {
  /** Throttle interval for edits in ms (default 2500) */
  throttleMs?: number;
}

export class WhatsAppStreamSender implements StreamSender {
  private messageId: string | null = null;
  private lastEditAt = 0;
  private phase: 'idle' | 'thinking' | 'content' | 'done' = 'idle';
  private pendingEditTimer: ReturnType<typeof setTimeout> | null = null;
  private lastRenderedText = '';
  private editFailed = false;
  private readonly throttleMs: number;

  constructor(
    private readonly sock: WASocket,
    private readonly jid: string,
    private readonly replyToMessageId?: string,
    _chatType?: 'dm' | 'group' | 'channel',
    options?: WhatsAppStreamSenderOptions,
  ) {
    this.throttleMs = options?.throttleMs ?? DEFAULT_THROTTLE_MS;
  }

  async onThinkingDelta(_delta: StreamDelta & { phase: 'thinking' }): Promise<void> {
    // WhatsApp doesn't support expandable blockquotes, so we skip
    // thinking display entirely. Content phase will handle everything.
    if (this.phase === 'done') return;
    if (this.phase === 'idle') {
      this.phase = 'thinking';
    }
  }

  async onContentDelta(delta: StreamDelta & { phase: 'content' }): Promise<void> {
    if (this.phase === 'done') return;

    if (this.phase !== 'content') {
      this.phase = 'content';
    }

    const contentText = delta.content;
    let displayText: string;

    if (contentText.length > MAX_STREAM_CHARS) {
      // Tail window: show last MAX_STREAM_CHARS chars with ellipsis
      const header = '⏳ ...\n';
      const budget = MAX_STREAM_CHARS - header.length;
      const tail = contentText.slice(-budget);
      displayText = `${header}${tail}${CURSOR}`;
    } else {
      displayText = `${contentText}${CURSOR}`;
    }

    await this.throttledEdit(displayText);
  }

  async onFinal(delta: StreamDelta & { phase: 'final' }): Promise<void> {
    this.phase = 'done';
    this.clearPendingEdit();

    const finalContent = delta.content;
    if (!finalContent) {
      // Nothing to send — if we had a placeholder, leave it (WhatsApp can't reliably delete)
      return;
    }

    // Convert markdown to WhatsApp syntax for final render
    const converted = markdownToWhatsApp(finalContent);
    const chunks = splitWhatsAppMessage(converted, MAX_MESSAGE_LENGTH);

    if (this.messageId && !this.editFailed) {
      await this.finalizeWithEdit(chunks);
    } else {
      await this.finalizeWithNewMessages(chunks);
    }
  }

  async onError(_delta: StreamDelta & { phase: 'error' }): Promise<void> {
    this.phase = 'done';
    this.clearPendingEdit();
    // WhatsApp doesn't support reliable message deletion for cleanup.
    // Leave the partial message as-is — better than a failed delete attempt.
    log.warn('Stream error, leaving partial message', { jid: this.jid });
  }

  async abort(): Promise<void> {
    this.phase = 'done';
    this.clearPendingEdit();
    log.debug('Stream aborted', { jid: this.jid });
  }

  // ─── Private helpers ────────────────────────────────────────

  /** Edit placeholder to first chunk, send rest as new messages. */
  private async finalizeWithEdit(chunks: string[]): Promise<void> {
    const firstChunk = chunks[0];
    if (!firstChunk) return;

    try {
      await this.doEditRaw(firstChunk);
    } catch (err) {
      log.warn('Failed to edit final message, sending as new', {
        jid: this.jid,
        error: String(err),
      });
      await this.finalizeWithNewMessages(chunks);
      return;
    }

    await this.sendRemainingChunks(chunks);
  }

  /** Send all chunks as new messages (no placeholder to edit). */
  private async finalizeWithNewMessages(chunks: string[]): Promise<void> {
    for (const chunk of chunks) {
      if (chunk) {
        await this.sendNewMessage(chunk);
      }
    }
  }

  /** Send chunks[1..n] as new messages. */
  private async sendRemainingChunks(chunks: string[]): Promise<void> {
    for (let i = 1; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (chunk) {
        await this.sendNewMessage(chunk);
      }
    }
  }

  private async throttledEdit(text: string): Promise<void> {
    // Don't edit if text hasn't changed
    if (text === this.lastRenderedText) return;
    // Don't try to edit if a previous edit already failed
    if (this.editFailed && this.messageId) return;

    const now = Date.now();
    const elapsed = now - this.lastEditAt;

    if (elapsed >= this.throttleMs) {
      this.clearPendingEdit();
      await this.doEdit(text);
    } else {
      // Schedule edit for when throttle window expires
      this.clearPendingEdit();
      const delay = this.throttleMs - elapsed;
      this.pendingEditTimer = setTimeout(async () => {
        this.pendingEditTimer = null;
        if (this.phase !== 'done') {
          await this.doEdit(text).catch((err: unknown) => {
            // Defensive: doEdit already swallows send/edit errors, but we never want an unhandled rejection
            log.warn('Scheduled edit failed', { jid: this.jid, error: String(err) });
          });
        }
      }, delay);
    }
  }

  private async doEdit(text: string): Promise<void> {
    try {
      if (!this.messageId) {
        // Create initial message
        const quoted = this.replyToMessageId
          ? {
              quoted: {
                key: { id: this.replyToMessageId, remoteJid: this.jid, fromMe: false },
                message: {},
              },
            }
          : undefined;
        const result = await this.sock.sendMessage(this.jid, { text }, quoted);
        this.messageId = result?.key?.id ?? null;
      } else {
        // Edit existing message
        await this.sock.sendMessage(this.jid, {
          text,
          edit: {
            remoteJid: this.jid,
            id: this.messageId,
            fromMe: true,
          } as unknown as proto.IMessageKey,
        });
      }
      this.lastRenderedText = text;
      this.lastEditAt = Date.now();
    } catch (err: unknown) {
      const errStr = String(err);
      log.warn('Edit failed, switching to fallback mode', {
        jid: this.jid,
        messageId: this.messageId,
        error: errStr,
      });
      // Mark edits as failed — onFinal will send as new message
      this.editFailed = true;
    }
  }

  /** Direct edit without throttle — used for final message. */
  private async doEditRaw(text: string): Promise<void> {
    if (!this.messageId) throw new Error('No message to edit');
    await this.sock.sendMessage(this.jid, {
      text,
      edit: {
        remoteJid: this.jid,
        id: this.messageId,
        fromMe: true,
      } as unknown as proto.IMessageKey,
    });
    this.lastRenderedText = text;
    this.lastEditAt = Date.now();
  }

  private async sendNewMessage(text: string): Promise<void> {
    try {
      await this.sock.sendMessage(this.jid, { text });
    } catch (err) {
      log.error('Failed to send new message during stream finalize', {
        jid: this.jid,
        error: String(err),
      });
    }
  }

  private clearPendingEdit(): void {
    if (this.pendingEditTimer) {
      clearTimeout(this.pendingEditTimer);
      this.pendingEditTimer = null;
    }
  }
}
