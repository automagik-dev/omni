/**
 * Media Group Buffer for Telegram
 *
 * Batches album photos (messages with same media_group_id) into a single context.
 * Uses a configurable timeout window (default 500ms) with hard caps:
 * - Max 50 messages per group
 * - Max 10MB total payload
 *
 * Flush trigger: "Timeout OR 50 messages OR 10MB, whichever comes first"
 */

import { createLogger } from '@omni/core';

const log = createLogger('telegram:media-group');

const MAX_MESSAGES = 50;
const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024; // 10MB

export interface MediaGroupMessage {
  externalId: string;
  chatId: string;
  from: string;
  content: {
    type: string;
    text?: string;
    caption?: string;
    mediaUrl?: string;
    mediaFileId?: string;
    mimeType?: string;
    localPath?: string;
    filename?: string;
  };
  replyToId?: string;
  rawPayload: Record<string, unknown>;
  platformTimestamp?: number;
  /** Estimated payload size in bytes (approximate for cap checking) */
  estimatedSize?: number;
}

export interface MediaGroupResult {
  mediaGroupId: string;
  messages: MediaGroupMessage[];
  /** Combined caption from all messages in the group */
  combinedCaption: string;
  /** Combined media references */
  mediaRefs: Array<{
    type: string;
    mediaFileId?: string;
    mediaUrl?: string;
    mimeType?: string;
    localPath?: string;
    filename?: string;
  }>;
}

interface BufferEntry {
  mediaGroupId: string;
  messages: MediaGroupMessage[];
  totalBytes: number;
  timer: ReturnType<typeof setTimeout>;
}

export type FlushCallback = (result: MediaGroupResult) => void | Promise<void>;

export class MediaGroupBuffer {
  private readonly buffers = new Map<string, BufferEntry>();
  private readonly timeoutMs: number;
  private readonly onFlush: FlushCallback;

  constructor(onFlush: FlushCallback, timeoutMs = 500) {
    this.onFlush = onFlush;
    this.timeoutMs = Math.max(timeoutMs, 200); // 200ms minimum safety
  }

  /**
   * Add a message to the buffer. If the message has no media_group_id,
   * returns false (should be processed immediately).
   */
  add(mediaGroupId: string, message: MediaGroupMessage): boolean {
    const existing = this.buffers.get(mediaGroupId);

    if (existing) {
      existing.messages.push(message);
      existing.totalBytes += message.estimatedSize ?? 0;

      // Check hard caps
      if (existing.messages.length >= MAX_MESSAGES || existing.totalBytes >= MAX_PAYLOAD_BYTES) {
        log.debug('Media group hard cap hit, flushing early', {
          mediaGroupId,
          messageCount: existing.messages.length,
          totalBytes: existing.totalBytes,
        });
        this.flush(mediaGroupId);
      }

      return true;
    }

    // New group — start buffer with timeout
    const timer = setTimeout(() => {
      this.flush(mediaGroupId);
    }, this.timeoutMs);

    this.buffers.set(mediaGroupId, {
      mediaGroupId,
      messages: [message],
      totalBytes: message.estimatedSize ?? 0,
      timer,
    });

    return true;
  }

  /**
   * Force-flush a specific media group.
   */
  flush(mediaGroupId: string): void {
    const entry = this.buffers.get(mediaGroupId);
    if (!entry) return;

    clearTimeout(entry.timer);
    this.buffers.delete(mediaGroupId);

    const result = buildGroupResult(mediaGroupId, entry.messages);

    log.debug('Flushing media group', {
      mediaGroupId,
      messageCount: entry.messages.length,
      totalBytes: entry.totalBytes,
    });

    // Fire async — don't block
    Promise.resolve(this.onFlush(result)).catch((err) => {
      log.error('Media group flush callback error', { mediaGroupId, error: String(err) });
    });
  }

  /**
   * Flush all pending buffers (for shutdown/cleanup).
   */
  flushAll(): void {
    for (const mediaGroupId of [...this.buffers.keys()]) {
      this.flush(mediaGroupId);
    }
  }

  /**
   * Cancel all pending buffers without calling onFlush.
   * Use on instance disconnect to prevent stale processing after teardown.
   */
  destroy(): void {
    for (const entry of this.buffers.values()) {
      clearTimeout(entry.timer);
    }
    this.buffers.clear();
  }

  /**
   * Get the number of pending media groups.
   */
  get pendingCount(): number {
    return this.buffers.size;
  }
}

function buildGroupResult(mediaGroupId: string, messages: MediaGroupMessage[]): MediaGroupResult {
  const captions: string[] = [];
  const mediaRefs: MediaGroupResult['mediaRefs'] = [];

  for (const msg of messages) {
    const caption = msg.content.caption ?? msg.content.text;
    if (caption) captions.push(caption);

    if (msg.content.mediaFileId || msg.content.mediaUrl) {
      mediaRefs.push({
        type: msg.content.type,
        mediaFileId: msg.content.mediaFileId,
        mediaUrl: msg.content.mediaUrl,
        mimeType: msg.content.mimeType,
        localPath: msg.content.localPath,
        filename: msg.content.filename,
      });
    }
  }

  return {
    mediaGroupId,
    messages,
    combinedCaption: captions.join('\n'),
    mediaRefs,
  };
}
