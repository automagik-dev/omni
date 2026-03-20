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
import type { WASocket, proto } from 'baileys';

import { isGroupJid } from '../jid';
import { markdownToWhatsApp } from '../utils/markdown-to-whatsapp';
import { splitWhatsAppMessage } from '../utils/split-message';

const log = createLogger('whatsapp:sender:stream');

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

  // ─── Progressive streaming state ────────────────────────────
  /** How many characters of cumulative content we've already sent */
  private sentLength = 0;
  /** Whether the first message has been sent (for quoting) */
  private firstMessageSent = false;
  /** Send queue — serializes async sends to prevent out-of-order delivery */
  private sendQueue: Promise<void> = Promise.resolve();

  // ─── Edit-based streaming state ─────────────────────────────
  private messageId: string | null = null;
  private lastEditAt = 0;
  private pendingEditTimer: ReturnType<typeof setTimeout> | null = null;
  private lastRenderedText = '';
  private editFailed = false;
  private readonly throttleMs: number;

  constructor(
    /** Lazy socket getter — called at send time to always use the current live socket */
    private readonly getSock: () => WASocket,
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
   * Each content delta represents a completed block from the provider
   * (emitted on content_block_stop, not on every token).
   * Send the new portion immediately — no buffering, no risk of mid-sentence breaks.
   */
  private async handleParagraphModeDelta(cumulativeContent: string): Promise<void> {
    const unsent = cumulativeContent.slice(this.sentLength).trimStart();
    if (!unsent.trim()) return;

    await this.sendFormattedChunks(unsent);
    this.sentLength = cumulativeContent.length;
  }

  /** Format text and send as one or more WhatsApp messages. */
  private async sendFormattedChunks(text: string): Promise<void> {
    const formatted = this.formatMode !== 'passthrough' ? markdownToWhatsApp(text) : text;
    const chunks = splitWhatsAppMessage(formatted, MAX_MESSAGE_LENGTH);
    for (const chunk of chunks) {
      if (chunk) {
        await this.sendMessage(chunk);
      }
    }
  }

  /** Send any remaining unsent content on stream completion. */
  private async handleParagraphModeFinal(finalContent: string): Promise<void> {
    const unsent = finalContent.slice(this.sentLength).trimStart();
    if (!unsent.trim()) return;
    await this.sendFormattedChunks(unsent);
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

    if (!(this.messageId && !this.editFailed)) {
      await this.sendAllChunks(chunks);
      return;
    }

    const firstChunk = chunks[0];
    if (!firstChunk) return;

    try {
      await this.doEditRaw(firstChunk);
    } catch {
      // Edit failed — fall back to sending all chunks as new messages
      await this.sendAllChunks(chunks);
      return;
    }

    await this.sendChunksFrom(chunks, 1);
  }

  /** Send all non-empty chunks as new messages. */
  private async sendAllChunks(chunks: string[]): Promise<void> {
    for (const chunk of chunks) {
      if (chunk) await this.sendMessage(chunk);
    }
  }

  /** Send non-empty chunks starting from startIndex as new messages. */
  private async sendChunksFrom(chunks: string[], startIndex: number): Promise<void> {
    for (let i = startIndex; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (chunk) await this.sendMessage(chunk);
    }
  }

  // ─── Shared helpers ─────────────────────────────────────────

  /**
   * Queue a message send — serializes all sends to prevent out-of-order delivery.
   * Each send waits for the previous one to complete before starting.
   */
  private async sendMessage(text: string): Promise<void> {
    this.sendQueue = this.sendQueue.then(() => this.doSend(text));
    await this.sendQueue;
  }

  /** Actually send a single message to WhatsApp. */
  private async doSend(text: string): Promise<void> {
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
      await this.getSock().sendMessage(this.jid, { text }, quoted);
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
        const result = await this.getSock().sendMessage(this.jid, { text }, quoted);
        this.messageId = result?.key?.id ?? null;
        this.firstMessageSent = true;
      } else {
        const sock = this.getSock();
        const editKey: proto.IMessageKey = {
          remoteJid: this.jid,
          id: this.messageId,
          fromMe: true,
        };
        if (isGroupJid(this.jid)) {
          editKey.participant = sock.user?.id;
        }
        await sock.sendMessage(this.jid, { text, edit: editKey });
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
    const sock = this.getSock();
    const editKey: proto.IMessageKey = {
      remoteJid: this.jid,
      id: this.messageId,
      fromMe: true,
    };
    if (isGroupJid(this.jid)) {
      editKey.participant = sock.user?.id;
    }
    await sock.sendMessage(this.jid, { text, edit: editKey });
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
