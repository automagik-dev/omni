/**
 * Tests for stream sender stop semantics (#914)
 *
 * cancel() = user pressed Slack's native stop button: halt and KEEP the
 * partial output. abort() = error-path cleanup: delete the placeholder so the
 * fallback reply can replace it. Post-stop deltas must be no-ops either way.
 */

import { describe, expect, it, mock } from 'bun:test';
import type { Logger } from '@omni/channel-sdk';
import type { StreamDelta } from '@omni/core';
import { createSlackStreamSender } from './stream';

function makeLogger(): Logger {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    child: mock(() => makeLogger()),
  } as unknown as Logger;
}

function makeClient() {
  const postMessage = mock(async () => ({ ts: '111.222' }));
  const update = mock(async () => ({}));
  const del = mock(async () => ({}));
  const client = { chat: { postMessage, update, delete: del } };
  return { client, postMessage, update, del };
}

function makeSender(client: unknown, streamMode: 'replace' | 'status_final' | 'off') {
  return createSlackStreamSender({
    client: client as never,
    channelId: 'C12345',
    threadTs: '1234567890.001',
    streamMode,
    throttleMs: 0,
    logger: makeLogger(),
  });
}

const contentDelta = (content: string) => ({ phase: 'content', content }) as StreamDelta & { phase: 'content' };
const thinkingDelta = (thinking: string) => ({ phase: 'thinking', thinking }) as StreamDelta & { phase: 'thinking' };
const finalDelta = (content: string) => ({ phase: 'final', content }) as StreamDelta & { phase: 'final' };

describe('replace-mode cancel', () => {
  it('keeps the partial content: finalizes the draft instead of deleting it', async () => {
    const { client, postMessage, update, del } = makeClient();
    const sender = makeSender(client, 'replace');

    await sender.onContentDelta(contentDelta('partial answer so'));
    expect(postMessage).toHaveBeenCalledTimes(1);

    await sender.cancel?.();

    expect(del).not.toHaveBeenCalled();
    // Draft finalized with the last streamed content
    expect(update).toHaveBeenCalledTimes(1);
    expect((update.mock.calls[0] as unknown[])[0]).toMatchObject({ ts: '111.222', text: 'partial answer so' });
  });

  it('cleans up like abort when only a thinking placeholder was shown', async () => {
    const { client, update, del } = makeClient();
    const sender = makeSender(client, 'replace');

    await sender.onThinkingDelta(thinkingDelta('pondering'));
    await sender.cancel?.();

    expect(del).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  it('drops deltas and finals arriving after cancel', async () => {
    const { client, postMessage, update } = makeClient();
    const sender = makeSender(client, 'replace');

    await sender.onContentDelta(contentDelta('partial'));
    await sender.cancel?.();
    const updatesAfterCancel = update.mock.calls.length;

    // A provider that ignored the abort keeps yielding
    await sender.onContentDelta(contentDelta('partial plus more'));
    await sender.onFinal(finalDelta('full answer'));

    expect(update.mock.calls.length).toBe(updatesAfterCancel);
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it('abort still deletes the draft, and later deltas cannot resurrect it', async () => {
    const { client, postMessage, update, del } = makeClient();
    const sender = makeSender(client, 'replace');

    await sender.onContentDelta(contentDelta('partial'));
    await sender.abort();
    expect(del).toHaveBeenCalledTimes(1);

    await sender.onContentDelta(contentDelta('more'));
    await sender.onFinal(finalDelta('full'));

    // No new message posted, no update against the deleted ts
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  it('does not post a fresh message when a delta arrives after abort with no draft', async () => {
    const { client, postMessage } = makeClient();
    const sender = makeSender(client, 'replace');

    await sender.abort();
    await sender.onContentDelta(contentDelta('late content'));

    expect(postMessage).not.toHaveBeenCalled();
  });
});

describe('status_final-mode cancel', () => {
  it('reveals the partial answer the thinking placeholder was hiding', async () => {
    const { client, postMessage, update, del } = makeClient();
    const sender = makeSender(client, 'status_final');

    await sender.onContentDelta(contentDelta('hidden partial'));
    expect(postMessage).toHaveBeenCalledTimes(1); // the "_Thinking..._" draft

    await sender.cancel?.();

    expect(del).not.toHaveBeenCalled();
    expect((update.mock.calls[0] as unknown[])[0]).toMatchObject({ ts: '111.222', text: 'hidden partial' });
  });

  it('deletes the thinking placeholder when no content arrived', async () => {
    const { client, del } = makeClient();
    const sender = makeSender(client, 'status_final');

    await sender.onThinkingDelta(thinkingDelta('pondering'));
    await sender.cancel?.();

    expect(del).toHaveBeenCalledTimes(1);
  });
});
