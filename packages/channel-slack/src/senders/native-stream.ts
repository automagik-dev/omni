/**
 * Native Slack streaming sender using chat.startStream API
 *
 * Uses the Slack SDK's ChatStreamer (via client.chatStream()) to render
 * AI responses word-by-word without showing the "edited" indicator.
 *
 * Falls back to replace-mode sender if chat.startStream is unavailable
 * (requires "Agents & AI Apps" feature flag on the Slack App).
 *
 * @see https://docs.slack.dev/ai/developing-ai-apps#streaming
 */

import type { Logger } from '@omni/channel-sdk';
import type { StreamSender } from '@omni/channel-sdk';
import type { StreamDelta } from '@omni/core';
import type { WebClient } from '@slack/web-api';
import { createSlackStreamSender } from './stream';
import type { StreamSenderOptions } from './stream';

export interface NativeStreamSenderOptions {
  client: WebClient;
  channelId: string;
  threadTs?: string;
  throttleMs: number;
  username?: string;
  iconUrl?: string;
  iconEmoji?: string;
  formatMode?: 'convert' | 'passthrough';
  logger: Logger;
}

/**
 * Create a native Slack StreamSender using chat.startStream.
 *
 * If chat.startStream is unavailable (API throws on first append),
 * falls back silently to replace-mode sender and logs a warning once.
 */
export function createNativeStreamSender(options: NativeStreamSenderOptions): StreamSender {
  const {
    client,
    channelId,
    threadTs,
    throttleMs,
    username,
    iconUrl,
    iconEmoji,
    formatMode = 'convert',
    logger,
  } = options;

  // ChatStreamer instance — created lazily on first content delta
  let streamer:
    | {
        append: (args: { markdown_text: string }) => Promise<void>;
        stop: (args?: { markdown_text?: string }) => Promise<void>;
      }
    | undefined;
  /** Content accumulated so far — used to compute append deltas */
  let lastSentContent = '';
  /** True once stop() has been called */
  let stopped = false;
  /** Fallback sender — used if chatStream() is not available */
  let fallback: StreamSender | undefined;

  function buildFallback(): StreamSender {
    const fallbackOptions: StreamSenderOptions = {
      client,
      channelId,
      threadTs,
      streamMode: 'replace',
      throttleMs,
      username,
      iconUrl,
      iconEmoji,
      formatMode,
      logger,
    };
    return createSlackStreamSender(fallbackOptions);
  }

  /** Initialize the native streamer and send first chunk */
  async function initStreamer(firstChunk: string): Promise<void> {
    const clientAny = client as unknown as Record<string, unknown>;
    if (typeof clientAny.chatStream !== 'function') {
      logger.warn('native-stream: client.chatStream() not available, falling back to replace mode');
      fallback = buildFallback();
      return;
    }

    try {
      const chatStream = clientAny.chatStream as (args: {
        channel: string;
        thread_ts?: string;
      }) => {
        append: (a: { markdown_text: string }) => Promise<void>;
        stop: (a?: { markdown_text?: string }) => Promise<void>;
      };

      streamer = chatStream.call(client, {
        channel: channelId,
        ...(threadTs ? { thread_ts: threadTs } : {}),
      });

      await streamer.append({ markdown_text: firstChunk });
      lastSentContent = firstChunk;
    } catch (err) {
      logger.warn('native-stream: chat.startStream failed, falling back to replace mode', {
        error: String(err),
      });
      streamer = undefined;
      fallback = buildFallback();
    }
  }

  async function appendDelta(newContent: string): Promise<void> {
    const delta = newContent.slice(lastSentContent.length);
    if (!delta) return;
    try {
      await streamer?.append({ markdown_text: delta });
      lastSentContent = newContent;
    } catch (err) {
      logger.warn('native-stream: append failed', { error: String(err) });
    }
  }

  async function stopStream(finalContent?: string): Promise<void> {
    if (stopped) return;
    stopped = true;

    if (!streamer) return;

    const remainingDelta = finalContent ? finalContent.slice(lastSentContent.length) : undefined;
    try {
      await streamer.stop(remainingDelta ? { markdown_text: remainingDelta } : undefined);
    } catch (err) {
      logger.warn('native-stream: stop failed', { error: String(err) });
    }
  }

  return {
    async onThinkingDelta(_delta: StreamDelta & { phase: 'thinking' }) {
      // Native streaming doesn't render thinking phase — wait for content
      if (fallback) return fallback.onThinkingDelta(_delta);
    },

    async onContentDelta(delta: StreamDelta & { phase: 'content' }) {
      if (fallback) return fallback.onContentDelta(delta);

      // A stopped stream stays stopped: a provider that ignored the abort
      // signal keeps yielding, and appending after chat.stopStream only
      // produces an API error per delta (#914).
      if (stopped) return;

      const content = delta.content;
      if (!content) return;

      if (!streamer) {
        // First chunk — initialize the streamer
        await initStreamer(content);
        // Re-read fallback — cast to reset TS narrowing (early return above narrows to undefined)
        const fb = fallback as StreamSender | undefined;
        if (fb) return fb.onContentDelta(delta);
        return;
      }

      await appendDelta(content);
    },

    async onFinal(delta: StreamDelta & { phase: 'final' }) {
      if (fallback) return fallback.onFinal(delta);

      await stopStream(delta.content);
    },

    async onError(delta: StreamDelta & { phase: 'error' }) {
      if (fallback) return fallback.onError(delta);

      // Best-effort: stop the stream
      await stopStream();
    },

    async abort() {
      if (fallback) return fallback.abort();

      await stopStream();
    },

    async cancel() {
      // Native streaming already halts-and-keeps: chat.stopStream leaves the
      // streamed content in place. Only the fallback needs distinct handling.
      if (fallback) return fallback.cancel ? fallback.cancel() : fallback.abort();

      await stopStream();
    },
  };
}
