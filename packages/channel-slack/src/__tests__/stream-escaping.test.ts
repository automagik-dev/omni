/** Untrusted streamed replies must not page a whole Slack channel (#889, #1415). */
import { describe, expect, it, mock } from 'bun:test';
import type { Logger } from '@omni/channel-sdk';
import type { StreamDelta } from '@omni/core';
import type { WebClient } from '@slack/web-api';
import { createSlackStreamSender } from '../senders/stream';

const noop = () => {};
const logger: Logger = { debug: noop, info: noop, warn: noop, error: noop, child: () => logger };
const text = '**hello** <@U123> <!here> <!channel> <!everyone> <!subteam^S123>';
const formatted = '*hello* <@U123> &lt;!here&gt; &lt;!channel&gt; &lt;!everyone&gt; &lt;!subteam^S123&gt;';

describe('Slack stream broadcast escaping', () => {
  for (const streamMode of ['replace', 'status_final', 'off'] as const) {
    it(`escapes broadcasts and user groups on ${streamMode} posts and updates`, async () => {
      const postMessage = mock(async (_args: Record<string, unknown>) => ({ ts: '111.222' }));
      const update = mock(async (_args: Record<string, unknown>) => ({}));
      const sender = createSlackStreamSender({
        client: { chat: { postMessage, update } } as unknown as WebClient,
        channelId: 'C123',
        streamMode,
        throttleMs: 0,
        logger,
      });
      try {
        await sender.onContentDelta({ phase: 'content', content: text } as StreamDelta & { phase: 'content' });
        await sender.onContentDelta({ phase: 'content', content: `${text}!` } as StreamDelta & { phase: 'content' });
        await sender.onFinal({ phase: 'final', content: text } as StreamDelta & { phase: 'final' });
        const sent = [...postMessage.mock.calls, ...update.mock.calls].map(([args]) => args.text);
        expect(sent).toContain(formatted);
        for (const value of sent) {
          for (const token of ['<!here>', '<!channel>', '<!everyone>', '<!subteam^S123>']) {
            expect(value).not.toContain(token);
          }
        }
      } finally {
        await sender.abort();
      }
    });
  }
});
