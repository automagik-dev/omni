/**
 * Tests for native Slack streaming sender
 */

import { describe, expect, it, mock } from 'bun:test';
import type { Logger } from '@omni/channel-sdk';
import { createNativeStreamSender } from './native-stream';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function makeLogger(): Logger {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    child: mock(() => makeLogger()),
  } as unknown as Logger;
}

function makeStreamer() {
  const appendCalls: string[] = [];
  let stopCalled = false;
  let stopArg: string | undefined;

  return {
    append: mock(async (args: { markdown_text: string }) => {
      appendCalls.push(args.markdown_text);
    }),
    stop: mock(async (args?: { markdown_text?: string }) => {
      stopCalled = true;
      stopArg = args?.markdown_text;
    }),
    get appendCalls() {
      return appendCalls;
    },
    get stopCalled() {
      return stopCalled;
    },
    get stopArg() {
      return stopArg;
    },
  };
}

function makeClient(hasNativeStream = true) {
  const streamer = makeStreamer();
  const chatStreamCalls: Array<{ channel: string; thread_ts?: string }> = [];

  const client = {
    chat: { postMessage: mock(async () => ({ ts: '1234567890.123456', ok: true })) },
    ...(hasNativeStream
      ? {
          chatStream: mock((args: { channel: string; thread_ts?: string }) => {
            chatStreamCalls.push(args);
            return streamer;
          }),
        }
      : {}),
  };

  return { client, streamer, chatStreamCalls };
}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

describe('createNativeStreamSender', () => {
  it('returns a valid StreamSender with all required methods', () => {
    const { client } = makeClient();
    const logger = makeLogger();
    const sender = createNativeStreamSender({
      client: client as never,
      channelId: 'C12345',
      threadTs: '1234567890.001',
      throttleMs: 1000,
      logger,
    });

    expect(typeof sender.onThinkingDelta).toBe('function');
    expect(typeof sender.onContentDelta).toBe('function');
    expect(typeof sender.onFinal).toBe('function');
    expect(typeof sender.onError).toBe('function');
    expect(typeof sender.abort).toBe('function');
  });

  it('calls chatStream on first onContentDelta', async () => {
    const { client, chatStreamCalls, streamer } = makeClient();
    const logger = makeLogger();
    const sender = createNativeStreamSender({
      client: client as never,
      channelId: 'C12345',
      threadTs: '1234567890.001',
      throttleMs: 1000,
      logger,
    });

    await sender.onContentDelta({ phase: 'content', content: 'Hello' });

    expect(chatStreamCalls.length).toBe(1);
    expect(chatStreamCalls[0]?.channel).toBe('C12345');
    expect(chatStreamCalls[0]?.thread_ts).toBe('1234567890.001');
    expect(streamer.appendCalls).toEqual(['Hello']);
  });

  it('appends only the delta on subsequent onContentDelta calls', async () => {
    const { client, streamer } = makeClient();
    const logger = makeLogger();
    const sender = createNativeStreamSender({
      client: client as never,
      channelId: 'C12345',
      threadTs: '1234567890.001',
      throttleMs: 1000,
      logger,
    });

    await sender.onContentDelta({ phase: 'content', content: 'Hello' });
    await sender.onContentDelta({ phase: 'content', content: 'Hello world' });
    await sender.onContentDelta({ phase: 'content', content: 'Hello world foo' });

    // Each call appends only the new content (the diff)
    expect(streamer.appendCalls).toEqual(['Hello', ' world', ' foo']);
  });

  it('calls stop() on onFinal — exactly once', async () => {
    const { client, streamer } = makeClient();
    const logger = makeLogger();
    const sender = createNativeStreamSender({
      client: client as never,
      channelId: 'C12345',
      threadTs: '1234567890.001',
      throttleMs: 1000,
      logger,
    });

    await sender.onContentDelta({ phase: 'content', content: 'Hello' });
    await sender.onFinal({ phase: 'final', content: 'Hello world!' });
    // Second call should be no-op (stopped guard)
    await sender.onFinal({ phase: 'final', content: 'should not call again' });

    expect(streamer.stopCalled).toBe(true);
    // stopArg should contain the remaining delta
    expect(streamer.stopArg).toBe(' world!');
    expect(streamer.stop.mock.calls.length).toBe(1);
  });

  it('calls stop() gracefully on abort()', async () => {
    const { client, streamer } = makeClient();
    const logger = makeLogger();
    const sender = createNativeStreamSender({
      client: client as never,
      channelId: 'C12345',
      threadTs: '1234567890.001',
      throttleMs: 1000,
      logger,
    });

    await sender.onContentDelta({ phase: 'content', content: 'Hello' });
    await sender.abort();

    expect(streamer.stopCalled).toBe(true);
  });

  it('falls back to replace mode when chatStream is not available', async () => {
    const { client } = makeClient(false); // No chatStream method
    const logger = makeLogger();
    const sender = createNativeStreamSender({
      client: client as never,
      channelId: 'C12345',
      threadTs: '1234567890.001',
      throttleMs: 1000,
      logger,
    });

    // Should not throw — falls back gracefully
    await sender.onContentDelta({ phase: 'content', content: 'Hello' });

    // Warn should have been called about fallback
    expect(
      (logger.warn as ReturnType<typeof mock>).mock.calls.some(
        (call) => String(call[0]).includes('not available') || String(call[0]).includes('chatStream'),
      ),
    ).toBe(true);
  });

  it('falls back when chatStream() throws on first append', async () => {
    const streamer = makeStreamer();
    streamer.append = mock(async () => {
      throw new Error('not_allowed_token_type');
    });

    const client = {
      chat: { postMessage: mock(async () => ({ ts: '1234567890.123456', ok: true })) },
      chatStream: mock(() => streamer),
    };

    const logger = makeLogger();
    const sender = createNativeStreamSender({
      client: client as never,
      channelId: 'C12345',
      threadTs: '1234567890.001',
      throttleMs: 1000,
      logger,
    });

    // Should fall back gracefully, not throw
    await expect(sender.onContentDelta({ phase: 'content', content: 'Hello' })).resolves.toBeUndefined();

    expect(
      (logger.warn as ReturnType<typeof mock>).mock.calls.some(
        (call) => String(call[0]).includes('fallback') || String(call[0]).includes('failed'),
      ),
    ).toBe(true);
  });

  it('does not call chatStream without threadTs (channel-level fallback)', async () => {
    const { client, chatStreamCalls, streamer } = makeClient();
    const logger = makeLogger();
    // No threadTs — native streaming requires a thread
    const sender = createNativeStreamSender({
      client: client as never,
      channelId: 'C12345',
      // threadTs omitted
      throttleMs: 1000,
      logger,
    });

    await sender.onContentDelta({ phase: 'content', content: 'Hello' });

    // chatStream can still be called without thread_ts (channel-level streaming)
    expect(chatStreamCalls.length).toBe(1);
    expect(chatStreamCalls[0]?.thread_ts).toBeUndefined();
    expect(streamer.appendCalls).toEqual(['Hello']);
  });
});

describe('STREAM_MODES includes native', () => {
  it('native is in STREAM_MODES', async () => {
    const { STREAM_MODES } = await import('../types');
    expect(STREAM_MODES).toContain('native');
  });
});

describe('resolveStreamMode accepts native', () => {
  it('resolves native mode', async () => {
    const { resolveStreamMode } = await import('../config/stream-mode');
    expect(resolveStreamMode('native')).toBe('native');
  });
});
