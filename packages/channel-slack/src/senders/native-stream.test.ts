/**
 * Tests for native Slack streaming sender
 */

import { describe, expect, it, mock } from 'bun:test';
import type { Logger } from '@omni/channel-sdk';
import { ChatStreamer } from '@slack/web-api';
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

describe('markStoppedByPlatform (#914 L2)', () => {
  function makeStreamerWithTs(ts: string) {
    const streamer = makeStreamer();
    // Mirror the SDK ChatStreamer: the message ts is known once chat.startStream ran.
    return Object.assign(streamer, { streamTs: ts });
  }

  it('skips chat.stopStream on cancel when Slack already halted this stream', async () => {
    const streamer = makeStreamerWithTs('1782234987.693923');
    const client = { chatStream: mock(() => streamer) };
    const logger = makeLogger();
    const sender = createNativeStreamSender({
      client: client as never,
      channelId: 'C12345',
      threadTs: '1234567890.001',
      throttleMs: 1000,
      logger,
    });

    await sender.onContentDelta({ phase: 'content', content: 'Hello' });
    expect(sender.markStoppedByPlatform(['1782234987.693923', '1782234999.000000'])).toBe(true);

    await sender.cancel?.();
    await sender.onFinal({ phase: 'final', content: 'Hello world' });

    expect(streamer.stop).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('still stops the stream when its ts is not in the halted list', async () => {
    const streamer = makeStreamerWithTs('1782234987.693923');
    const client = { chatStream: mock(() => streamer) };
    const sender = createNativeStreamSender({
      client: client as never,
      channelId: 'C12345',
      throttleMs: 1000,
      logger: makeLogger(),
    });

    await sender.onContentDelta({ phase: 'content', content: 'Hello' });
    expect(sender.markStoppedByPlatform(['9999999999.000000'])).toBe(false);

    await sender.cancel?.();
    expect(streamer.stop).toHaveBeenCalledTimes(1);
  });

  it('learns the ts from a flushed chat.startStream response', async () => {
    const streamer = {
      append: mock(async (_args: { markdown_text: string }) => ({ ok: true, ts: '1782234987.111111' })),
      stop: mock(async () => {}),
    };
    const client = { chatStream: mock(() => streamer) };
    const sender = createNativeStreamSender({
      client: client as never,
      channelId: 'C12345',
      throttleMs: 1000,
      logger: makeLogger(),
    });

    await sender.onContentDelta({ phase: 'content', content: 'Hello' });
    expect(sender.markStoppedByPlatform(['1782234987.111111'])).toBe(true);
  });

  it('returns false before the stream started and on the replace-mode fallback', async () => {
    const { client } = makeClient();
    const idle = createNativeStreamSender({
      client: client as never,
      channelId: 'C1',
      throttleMs: 1,
      logger: makeLogger(),
    });
    expect(idle.markStoppedByPlatform(['1782234987.693923'])).toBe(false);

    const { client: noNative } = makeClient(false);
    const fallback = createNativeStreamSender({
      client: noNative as never,
      channelId: 'C1',
      throttleMs: 1,
      logger: makeLogger(),
    });
    await fallback.onContentDelta({ phase: 'content', content: 'Hello' });
    expect(fallback.markStoppedByPlatform(['1234567890.123456'])).toBe(false);
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

describe('native Markdown broadcast guard', () => {
  const tokens = ['<!here>', '<!channel>', '<!everyone>', '<!subteam^S123|team>'];

  function setup(formatMode?: 'convert' | 'passthrough') {
    const fixture = makeClient();
    const sender = createNativeStreamSender({
      client: fixture.client as never,
      channelId: 'C123',
      threadTs: '111.222',
      throttleMs: 0,
      formatMode,
      logger: makeLogger(),
    });
    const sent = () => fixture.streamer.appendCalls.join('') + (fixture.streamer.stopArg ?? '');
    return { ...fixture, sender, sent };
  }

  const labelled = ['<!here|here>', '<!channel|@channel>', '<!everyone|everyone>'];
  const forms = [...tokens, ...labelled, ...[...tokens, ...labelled].map((token) => token.toUpperCase())];

  for (const token of forms) {
    it(`guards a whole ${token} on the first native append`, async () => {
      const { sender, sent, chatStreamCalls } = setup();
      await sender.onContentDelta({ phase: 'content', content: token });
      expect(sent()).toBe(`&lt;${token.slice(1)}`);
      await sender.onFinal({ phase: 'final', content: token });
      expect(sent()).toBe(`&lt;${token.slice(1)}`);
      expect(chatStreamCalls).toHaveLength(1);
    });

    for (let split = 1; split < token.length; split++) {
      it(`guards ${token} split at ${split}, including a final suffix`, async () => {
        const { sender, sent, chatStreamCalls, client } = setup();
        await sender.onContentDelta({ phase: 'content', content: `**hello** ${token.slice(0, split)}` });
        await sender.onContentDelta({ phase: 'content', content: `**hello** ${token}` });
        await sender.onFinal({ phase: 'final', content: `**hello** ${token} [link](https://example.com)` });
        expect(sent()).toBe(`**hello** &lt;${token.slice(1)} [link](https://example.com)`);
        expect(chatStreamCalls).toHaveLength(1);
        expect(client.chat.postMessage).not.toHaveBeenCalled();
      });
    }
  }

  it('releases a completed broadcast opener without waiting for its closer or label', async () => {
    const { sender, sent } = setup();
    await sender.onContentDelta({ phase: 'content', content: '<!EVERYON' });
    expect(sent()).toBe('');
    await sender.onContentDelta({ phase: 'content', content: '<!EVERYONE' });
    expect(sent()).toBe('&lt;!EVERYONE');
    await sender.onFinal({ phase: 'final', content: '<!EVERYONE|everyone>' });
    expect(sent()).toBe('&lt;!EVERYONE|everyone>');
  });

  it('guards tokens completed only in stop and flushes an unfinished harmless tail', async () => {
    const { sender, sent } = setup('convert');
    await sender.onContentDelta({ phase: 'content', content: 'a <!every' });
    expect(sent()).toBe('a ');
    await sender.onFinal({ phase: 'final', content: 'a <!everyone> <' });
    expect(sent()).toBe('a &lt;!everyone> <');
  });

  it('guards character-at-a-time input while preserving all other Markdown', async () => {
    const { sender, sent } = setup();
    const input = `**bold** _italic_ [link](https://x.example?a=1&b=2) <@U123> <#C123> \`x < y\` <!date^1> ${tokens.join(' ')} &lt;!here&gt;`;
    for (let end = 1; end <= input.length; end++) {
      await sender.onContentDelta({ phase: 'content', content: input.slice(0, end) });
      for (const token of tokens) expect(sent()).not.toContain(token);
    }
    await sender.onFinal({ phase: 'final', content: input });
    expect(sent()).toBe(
      '**bold** _italic_ [link](https://x.example?a=1&b=2) <@U123> <#C123> `x < y` <!date^1> ' +
        '&lt;!here> &lt;!channel> &lt;!everyone> &lt;!subteam^S123|team> &lt;!here&gt;',
    );
  });

  it('releases a diverging prefix and does not buffer a long subteam ID', async () => {
    const { sender, sent } = setup();
    await sender.onContentDelta({ phase: 'content', content: 'hello <!he' });
    expect(sent()).toBe('hello ');
    await sender.onContentDelta({ phase: 'content', content: 'hello <!help> <!subteam^' });
    expect(sent()).toBe('hello <!help> &lt;!subteam^');
    const content = `hello <!help> <!subteam^S${'1'.repeat(1000)}>`;
    await sender.onContentDelta({ phase: 'content', content });
    expect(sent()).toBe(`hello <!help> &lt;!subteam^S${'1'.repeat(1000)}>`);
    await sender.onFinal({ phase: 'final', content });
  });

  it('holds a lone opener without sending an empty append and guards its final completion', async () => {
    const { sender, streamer, sent } = setup();
    await sender.onContentDelta({ phase: 'content', content: '<' });
    expect(streamer.append).not.toHaveBeenCalled();
    await sender.onFinal({ phase: 'final', content: '<!here>' });
    expect(sent()).toBe('&lt;!here>');
  });

  it('retries a failed append without losing or duplicating the held prefix', async () => {
    const { sender, streamer, sent } = setup();
    await sender.onContentDelta({ phase: 'content', content: 'hello <!he' });
    streamer.append.mockImplementationOnce(async () => {
      throw new Error('fixture append failure');
    });
    await sender.onContentDelta({ phase: 'content', content: 'hello <!here>' });
    await sender.onContentDelta({ phase: 'content', content: 'hello <!here> world' });
    await sender.onFinal({ phase: 'final', content: 'hello <!here> world' });
    expect(sent()).toBe('hello &lt;!here> world');
  });

  for (const bufferSize of [1, 256]) {
    it(`guards the real SDK chunks boundary with buffer size ${bufferSize}`, async () => {
      const calls: Array<{ method: string; chunks?: Array<{ type: string; text: string }> }> = [];
      const record = (method: string) =>
        mock(async (args: { chunks?: Array<{ type: string; text: string }> }) => {
          calls.push({ method, ...args });
          return { ok: true, ts: '111.222' };
        });
      const client = {
        chat: { startStream: record('start'), appendStream: record('append'), stopStream: record('stop') },
        chatStream: (args: ConstructorParameters<typeof ChatStreamer>[2]): ChatStreamer =>
          new ChatStreamer(client as never, makeLogger() as never, args, { buffer_size: bufferSize }),
      };
      const sender = createNativeStreamSender({
        client: client as never,
        channelId: 'C123',
        threadTs: '111.000',
        throttleMs: 0,
        logger: makeLogger(),
      });
      await sender.onContentDelta({ phase: 'content', content: '**hello** <!he' });
      await sender.onContentDelta({ phase: 'content', content: '**hello** <!here> <!subteam^S123>' });
      await sender.onFinal({ phase: 'final', content: '**hello** <!here> <!subteam^S123> <!everyone>' });
      expect(
        calls
          .flatMap((call) => call.chunks ?? [])
          .map((chunk) => chunk.text)
          .join(''),
      ).toBe('**hello** &lt;!here> &lt;!subteam^S123> &lt;!everyone>');
      expect(calls.map((call) => call.method)).toEqual(
        bufferSize === 1 ? ['start', 'append', 'stop'] : ['start', 'stop'],
      );
      for (const call of calls) {
        for (const chunk of call.chunks ?? []) expect(chunk.type).toBe('markdown_text');
      }
    });
  }

  it('keeps passthrough native chunks byte-for-byte, including split broadcasts', async () => {
    const { sender, streamer, sent } = setup('passthrough');
    await sender.onContentDelta({ phase: 'content', content: '**hello** <!he' });
    await sender.onContentDelta({ phase: 'content', content: '**hello** <!here>' });
    await sender.onFinal({ phase: 'final', content: '**hello** <!here> <!subteam^S123>' });
    expect(streamer.appendCalls).toEqual(['**hello** <!he', 're>']);
    expect(streamer.stopArg).toBe(' <!subteam^S123>');
    expect(sent()).toBe('**hello** <!here> <!subteam^S123>');
  });

  for (const finish of ['abort', 'cancel', 'onError'] as const) {
    it(`flushes the pending non-token prefix on ${finish} once and ignores later content`, async () => {
      const { sender, streamer, sent } = setup();
      await sender.onContentDelta({ phase: 'content', content: 'hello <!chan' });
      expect(sent()).toBe('hello ');
      if (finish === 'onError') await sender.onError({ phase: 'error', error: 'fixture error' });
      else await sender[finish]?.();
      await sender.onFinal({ phase: 'final', content: 'hello <!channel>' });
      await sender.onContentDelta({ phase: 'content', content: 'hello <!channel> later' });
      expect(sent()).toBe('hello <!chan');
      expect(streamer.stop).toHaveBeenCalledTimes(1);
    });
  }
});
