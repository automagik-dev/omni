import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';
import type { OutgoingMessage, PluginContext } from '@omni/channel-sdk';
import { SlackPlugin } from '../plugin';

const noop = () => {};
const logger = { debug: noop, info: noop, warn: noop, error: noop, child: () => logger };
const bytes = Buffer.from('media fixture');
const input = '**hello** <@U123> <#C123> <!here> <!channel> <!everyone> <!subteam^S123> & stray < >';
const converted =
  '*hello* <@U123> <#C123> &lt;!here&gt; &lt;!channel&gt; &lt;!everyone&gt; &lt;!subteam^S123&gt; &amp; stray &lt; &gt;';
let restoreFetch: (() => void) | undefined;

afterEach(() => {
  restoreFetch?.();
  restoreFetch = undefined;
});

async function setup(source: 'base64' | 'url') {
  const plugin = new SlackPlugin();
  await plugin.initialize({
    eventBus: { publish: async () => {}, subscribe: () => {} },
    storage: {},
    logger,
    config: {},
    db: {},
  } as unknown as PluginContext);
  const uploadV2 = mock(async (_args: Record<string, unknown>) => ({
    ok: true,
    files: [{ id: 'F123', shares: { private: { C123: [{ ts: '111.222' }] } } }],
  }));
  (plugin as unknown as { attachments: Map<string, unknown> }).attachments.set('inst', {
    instanceId: 'inst',
    actingClient: { files: { uploadV2 } },
  });
  if (source === 'url') {
    const fetchMock = spyOn(globalThis, 'fetch').mockResolvedValue(new Response(bytes));
    restoreFetch = () => fetchMock.mockRestore();
  }
  return { plugin, uploadV2 };
}

describe('Slack media caption formatting', () => {
  for (const source of ['base64', 'url'] as const) {
    for (const type of ['image', 'audio', 'video', 'document'] as const) {
      for (const formatMode of [undefined, 'convert', 'passthrough'] as const) {
        it(`${source} ${type} honors ${formatMode ?? 'default'} captions once`, async () => {
          const { plugin, uploadV2 } = await setup(source);
          const message: OutgoingMessage = {
            to: 'C123',
            replyTo: '100.200',
            content: {
              type,
              caption: input,
              filename: 'fixture.bin',
              ...(source === 'url' ? { mediaUrl: 'https://fixture.invalid/media' } : {}),
            },
            metadata: {
              messageFormatMode: formatMode,
              ...(source === 'base64' ? { base64: bytes.toString('base64') } : {}),
            },
          };
          const result = await plugin.sendMessage('inst', message);
          expect(result.success).toBe(true);
          expect(result.messageId).toBe('111.222');
          expect(uploadV2).toHaveBeenCalledTimes(1);
          const args = uploadV2.mock.calls[0]?.[0];
          expect(args?.initial_comment).toBe(formatMode === 'passthrough' ? input : converted);
          expect(args?.thread_ts).toBe('100.200');
          expect(args?.filename).toBe('fixture.bin');
          expect(args?.file).toEqual(bytes);
        });
      }
    }
    for (const [text, caption, expected] of [
      ['**text**', '**caption**', '*text*'],
      ['', '**caption**', '*caption*'],
      [undefined, undefined, undefined],
      [undefined, '', ''],
    ] as const) {
      it(`${source} retains text/caption selection for ${JSON.stringify([text, caption])}`, async () => {
        const { plugin, uploadV2 } = await setup(source);
        const result = await plugin.sendMessage('inst', {
          to: 'C123',
          content: {
            type: 'image',
            text,
            caption,
            mediaUrl: source === 'url' ? 'https://fixture.invalid/media' : undefined,
          },
          metadata: source === 'base64' ? { base64: bytes.toString('base64') } : {},
        });
        expect(result.success).toBe(true);
        expect(uploadV2.mock.calls[0]?.[0].initial_comment).toBe(expected);
      });
    }
  }
});
