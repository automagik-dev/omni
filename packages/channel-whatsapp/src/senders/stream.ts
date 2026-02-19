/**
 * WhatsAppStreamSender — progressive paragraph-based streaming for WhatsApp
 *
 * Implements the StreamSender interface for WhatsApp:
 * - Content deltas are cumulative — we track what was already sent
 * - As complete paragraphs (separated by \n\n) arrive, they're sent as new messages
 * - No message editing — each paragraph goes out as a fresh message
 * - On final: sends any remaining unsent content, with markdown→WhatsApp conversion
 * - First message quotes the original trigger
 * - Optional edit-based progressive mode (disabled by default — too buggy on WhatsApp)
 */

import type { StreamSender } from '@omni/channel-sdk';
import { createLogger } from '@omni/core';
import type { StreamDelta } from '@omni/core';
import type { WASocket, proto } from '@whiskeysockets/baileys';

import { markdownToWhatsApp } from '../utils/markdown-to-whatsapp';
import { splitWhatsAppMessage } from '../utils/split-message';

const log = createLogger('whatsapp:sender:stream');

/** Paragraph separator — two newlines */
const PARAGRAPH_SEP = '\n\n';

/** WhatsApp max message length */
const MAX_MESSAGE_LENGTH = 65_536;

/** Default edit throttle interval (ms). Conservative for WhatsApp. */
const DEFAULT_THROTTLE_MS = 2500;

/** Max chars to show during edit-based streaming (tail window if exceeded) */
const MAX_STREAM_CHARS = 3800;

/** Cursor character shown during edit-based streaming */
const CURSOR = '▍';

export interface WhatsAppStreamSenderOptions {
  /** Format mode: 'convert' applies markdown→WhatsApp syntax, 'passthrough' sends raw text */
  formatMode?: 'convert' | 'passthrough';
  /**
   * Enable edit-based progressive rendering (WhatsApp message edits).
   * Disabled by default — WhatsApp edits are buggy and cause duplicate/garbled messages.
   * When disabled, uses paragraph-based streaming: sends each complete paragraph as a new message.
   */
  editMode?: boolean;
  /** Throttle interval for edits in ms (default 2500). Only applies when editMode is true. */
  throttleMs?: number;
}

export class WhatsAppStreamSender implements StreamSender {
  private phase: 'idle' | 'thinking' | 'content' | 'done' = 'idle';
  private readonly formatMode: 'convert' | 'passthrough';
  private readonly editMode: boolean;

  // ─── Paragraph-based streaming state ────────────────────────
  /** How many characters of cumulative content we've already sent */
  private sentLength = 0;
  /** Whether the first message has been sent (for quoting) */
  private firstMessageSent = false;

  // ─── Edit-based streaming state ─────────────────────────────
  private messageId: string | null = null;
  private lastEditAt = 0;
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
    this.formatMode = options?.formatMode ?? 'convert';
    this.editMode = options?.editMode ?? false;
    this.throttleMs = options?.throttleMs ?? DEFAULT_THROTTLE_MS;
  }

  async onThinkingDelta(_delta: StreamDelta & { phase: 'thinking' }): Promise<void> {
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

    if (this.editMode) {
      await this.handleEditModeDelta(delta.content);
    } else {
      await this.handleParagraphModeDelta(delta.content);
    }
  }

  async onFinal(delta: StreamDelta & { phase: 'final' }): Promise<void> {
    this.phase = 'done';
    this.clearPendingEdit();

    const finalContent = delta.content;
    if (!finalContent) return;

    if (this.editMode) {
      await this.handleEditModeFinal(finalContent);
    } else {
      await this.handleParagraphModeFinal(finalContent);
    }
  }

  async onError(_delta: StreamDelta & { phase: 'error' }): Promise<void> {
    this.phase = 'done';
    this.clearPendingEdit();
    log.warn('Stream error', { jid: this.jid });
  }

  async abort(): Promise<void> {
    this.phase = 'done';
    this.clearPendingEdit();
    log.debug('Stream aborted', { jid: this.jid });
  }

  // ═══════════════════════════════════════════════════════════════
  // Paragraph-based streaming (default)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Check cumulative content for new complete paragraphs and send them.
   * A paragraph is considered "complete" when followed by \n\n.
   */
  private async handleParagraphModeDelta(cumulativeContent: string): Promise<void> {
    const unsent = cumulativeContent.slice(this.sentLength);
    if (!unsent) return;

    // Find complete paragraphs (everything before the last \n\n)
    const lastSep = unsent.lastIndexOf(PARAGRAPH_SEP);
    if (lastSep === -1) return; // No complete paragraph yet

    const completedText = unsent.slice(0, lastSep);
    if (!completedText.trim()) return;

    // Format and send
    const formatted = this.formatMode !== 'passthrough' ? markdownToWhatsApp(completedText) : completedText;
    const chunks = splitWhatsAppMessage(formatted, MAX_MESSAGE_LENGTH);

    for (const chunk of chunks) {
      if (chunk) {
        await this.sendMessage(chunk);
      }
    }

    // Advance the sent cursor past the completed text + separator
    this.sentLength += lastSep + PARAGRAPH_SEP.length;
  }

  /** Send any remaining unsent content on stream completion. */
  private async handleParagraphModeFinal(finalContent: string): Promise<void> {
    const unsent = finalContent.slice(this.sentLength);

    if (!unsent.trim()) return;

    const formatted = this.formatMode !== 'passthrough' ? markdownToWhatsApp(unsent) : unsent;
    const chunks = splitWhatsAppMessage(formatted, MAX_MESSAGE_LENGTH);

    for (const chunk of chunks) {
      if (chunk) {
        await this.sendMessage(chunk);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Edit-based streaming (opt-in via editMode: true)
  // ═══════════════════════════════════════════════════════════════

  private async handleEditModeDelta(contentText: string): Promise<void> {
    let displayText: string;

    if (contentText.length > MAX_STREAM_CHARS) {
      const header = '⏳ ...\n';
      const budget = MAX_STREAM_CHARS - header.length;
      const tail = contentText.slice(-budget);
      displayText = `${header}${tail}${CURSOR}`;
    } else {
      displayText = `${contentText}${CURSOR}`;
    }

    await this.throttledEdit(displayText);
  }

  private async handleEditModeFinal(finalContent: string): Promise<void> {
    const text = this.formatMode !== 'passthrough' ? markdownToWhatsApp(finalContent) : finalContent;
    const chunks = splitWhatsAppMessage(text, MAX_MESSAGE_LENGTH);

    if (this.messageId && !this.editFailed) {
      // Edit the placeholder with first chunk, send rest as new
      const firstChunk = chunks[0];
      if (!firstChunk) return;
      try {
        await this.doEditRaw(firstChunk);
      } catch {
        // Fall back to new messages
        for (const c of chunks) {
          if (c) await this.sendMessage(c);
        }
        return;
      }
      for (let i = 1; i < chunks.length; i++) {
        if (chunks[i]) await this.sendMessage(chunks[i]!);
      }
    } else {
      for (const c of chunks) {
        if (c) await this.sendMessage(c);
      }
    }
  }

  // ─── Shared helpers ─────────────────────────────────────────

  private async sendMessage(text: string): Promise<void> {
    try {
      const quoteId = !this.firstMessageSent ? this.replyToMessageId : undefined;
      const quoted = quoteId
        ? {
            quoted: {
              key: { id: quoteId, remoteJid: this.jid, fromMe: false },
              message: {},
            },
          }
        : undefined;
      await this.sock.sendMessage(this.jid, { text }, quoted);
      this.firstMessageSent = true;
    } catch (err) {
      log.error('Failed to send message during stream', {
        jid: this.jid,
        error: String(err),
      });
    }
  }

  // ─── Edit-mode helpers ──────────────────────────────────────

  private async throttledEdit(text: string): Promise<void> {
    if (text === this.lastRenderedText) return;
    if (this.editFailed && this.messageId) return;

    const now = Date.now();
    const elapsed = now - this.lastEditAt;

    if (elapsed >= this.throttleMs) {
      this.clearPendingEdit();
      await this.doEdit(text);
    } else {
      this.clearPendingEdit();
      const delay = this.throttleMs - elapsed;
      this.pendingEditTimer = setTimeout(async () => {
        this.pendingEditTimer = null;
        if (this.phase !== 'done') {
          await this.doEdit(text).catch((err: unknown) => {
            log.warn('Scheduled edit failed', { jid: this.jid, error: String(err) });
          });
        }
      }, delay);
    }
  }

  private async doEdit(text: string): Promise<void> {
    try {
      if (!this.messageId) {
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
        this.firstMessageSent = true;
      } else {
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
      log.warn('Edit failed, switching to fallback mode', {
        jid: this.jid,
        messageId: this.messageId,
        error: String(err),
      });
      this.editFailed = true;
    }
  }

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

  private clearPendingEdit(): void {
    if (this.pendingEditTimer) {
      clearTimeout(this.pendingEditTimer);
      this.pendingEditTimer = null;
    }
  }
}
