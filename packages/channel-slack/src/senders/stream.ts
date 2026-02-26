/**
 * Streaming draft message sender for Slack
 *
 * Implements three stream modes:
 * - replace: Send initial → edit progressively → finalize
 * - status_final: Send "thinking..." → replace with final
 * - off: Wait for complete response, send once
 *
 * Uses cumulative prefix tracking for append mode.
 */

import type { Logger } from '@omni/channel-sdk';
import type { StreamSender } from '@omni/channel-sdk';
import type { StreamDelta } from '@omni/core';
import type { ChatPostMessageArguments, WebClient } from '@slack/web-api';
import { chunkMessage, markdownToMrkdwn } from '../markdown';
import type { StreamMode } from '../types';

export interface StreamSenderOptions {
  client: WebClient;
  channelId: string;
  threadTs?: string;
  streamMode: StreamMode;
  throttleMs: number;
  username?: string;
  iconUrl?: string;
  iconEmoji?: string;
  formatMode?: 'convert' | 'passthrough';
  logger: Logger;
}

/**
 * Create a StreamSender for Slack
 */
export function createSlackStreamSender(options: StreamSenderOptions): StreamSender {
  const {
    client,
    channelId,
    threadTs,
    streamMode,
    throttleMs,
    username,
    iconUrl,
    iconEmoji,
    formatMode = 'convert',
    logger,
  } = options;

  /** Message TS for the draft message being edited */
  let draftTs: string | undefined;
  /** Last time we sent an update */
  let lastUpdateTime = 0;
  /** Whether the stream has been finalized */
  let finalized = false;
  /** Pending content for throttled updates */
  let pendingContent: string | undefined;
  /** Throttle timer handle */
  let throttleTimer: ReturnType<typeof setTimeout> | undefined;

  function formatText(text: string): string {
    return formatMode === 'passthrough' ? text : markdownToMrkdwn(text);
  }

  /**
   * Send the initial draft message
   */
  async function sendInitial(text: string): Promise<void> {
    if (!text.trim()) return;
    try {
      const args = {
        channel: channelId,
        text: formatText(text),
        thread_ts: threadTs,
        username,
        icon_url: iconUrl,
        icon_emoji: iconEmoji,
      } as ChatPostMessageArguments;
      const result = await client.chat.postMessage(args);
      draftTs = result.ts as string | undefined;
      lastUpdateTime = Date.now();
    } catch (error) {
      logger.error('Stream: failed to send initial message', { error: String(error) });
    }
  }

  /**
   * Update the draft message
   */
  async function updateDraft(text: string): Promise<void> {
    if (!draftTs) return;

    const now = Date.now();
    const elapsed = now - lastUpdateTime;

    if (elapsed < throttleMs) {
      // Throttled — store pending content
      pendingContent = text;
      if (!throttleTimer) {
        throttleTimer = setTimeout(async () => {
          throttleTimer = undefined;
          if (pendingContent && !finalized) {
            const content = pendingContent;
            pendingContent = undefined;
            await doUpdate(content);
          }
        }, throttleMs - elapsed);
      }
      return;
    }

    await doUpdate(text);
  }

  async function doUpdate(text: string): Promise<void> {
    if (!draftTs || finalized) return;

    try {
      await client.chat.update({
        channel: channelId,
        ts: draftTs,
        text: formatText(text),
      });
      lastUpdateTime = Date.now();
    } catch (error) {
      logger.warn('Stream: failed to update draft', { error: String(error) });
    }
  }

  /**
   * Finalize the message with the complete content.
   * Chunks text to Slack's 4000-char limit: first chunk updates the draft
   * (or becomes the initial message), overflow chunks are posted as new messages.
   */
  async function finalize(text: string): Promise<void> {
    finalized = true;
    if (throttleTimer) {
      clearTimeout(throttleTimer);
      throttleTimer = undefined;
    }
    pendingContent = undefined;

    const chunks = chunkMessage(text);
    const [firstChunk = '', ...overflowChunks] = chunks;

    if (draftTs) {
      // Update the existing draft with the first chunk
      try {
        await client.chat.update({
          channel: channelId,
          ts: draftTs,
          text: formatText(firstChunk),
        });
      } catch (error) {
        logger.error('Stream: failed to finalize message', { error: String(error) });
      }
    } else {
      // No draft yet, send first chunk as new message
      await sendInitial(firstChunk);
    }

    // Post overflow chunks as new messages in the same thread
    for (const chunk of overflowChunks) {
      await sendInitial(chunk);
    }
  }

  // Different behavior based on stream mode
  if (streamMode === 'off') {
    // Off mode: collect everything, send once on final
    return {
      async onThinkingDelta(_delta: StreamDelta & { phase: 'thinking' }) {
        // No-op: don't show thinking in off mode
      },
      async onContentDelta(_delta: StreamDelta & { phase: 'content' }) {
        // No-op: wait for final
      },
      async onFinal(delta: StreamDelta & { phase: 'final' }) {
        await sendInitial(delta.content);
        finalized = true;
      },
      async onError(delta: StreamDelta & { phase: 'error' }) {
        await sendInitial(`Error: ${delta.error}`);
        finalized = true;
      },
      async abort() {
        finalized = true;
      },
    };
  }

  if (streamMode === 'status_final') {
    // Status-final mode: show "thinking..." then replace with final
    return {
      async onThinkingDelta(_delta: StreamDelta & { phase: 'thinking' }) {
        if (!draftTs) {
          await sendInitial('_Thinking..._');
        }
      },
      async onContentDelta(_delta: StreamDelta & { phase: 'content' }) {
        if (!draftTs) {
          await sendInitial('_Thinking..._');
        }
      },
      async onFinal(delta: StreamDelta & { phase: 'final' }) {
        await finalize(delta.content);
      },
      async onError(delta: StreamDelta & { phase: 'error' }) {
        await finalize(`Error: ${delta.error}`);
      },
      async abort() {
        if (draftTs && !finalized) {
          try {
            await client.chat.delete({ channel: channelId, ts: draftTs });
          } catch {
            // Best effort cleanup
          }
        }
        finalized = true;
      },
    };
  }

  // Replace mode (default): send initial → edit progressively → finalize
  return {
    async onThinkingDelta(delta: StreamDelta & { phase: 'thinking' }) {
      const text = `_${delta.thinking}_`;
      if (!draftTs) {
        await sendInitial(text);
      } else {
        await updateDraft(text);
      }
    },
    async onContentDelta(delta: StreamDelta & { phase: 'content' }) {
      const text = delta.content;
      if (!draftTs) {
        await sendInitial(text);
      } else {
        await updateDraft(text);
      }
    },
    async onFinal(delta: StreamDelta & { phase: 'final' }) {
      await finalize(delta.content);
    },
    async onError(delta: StreamDelta & { phase: 'error' }) {
      await finalize(`Error: ${delta.error}`);
    },
    async abort() {
      if (draftTs && !finalized) {
        try {
          await client.chat.delete({ channel: channelId, ts: draftTs });
        } catch {
          // Best effort cleanup
        }
      }
      finalized = true;
    },
  };
}
