import { describe, expect, it, mock } from 'bun:test';
import type { OutgoingMessage, PluginContext } from '@omni/channel-sdk';
import { ValidationError } from '@omni/core';
import { SlackPlugin } from '../plugin';

const noop = () => {};
const logger = { debug: noop, info: noop, warn: noop, error: noop, child: () => logger };

async function setup() {
  const plugin = new SlackPlugin();
  await plugin.initialize({
    eventBus: { publish: async () => {}, subscribe: () => {} },
    storage: {},
    logger,
    config: {},
    db: {},
  } as unknown as PluginContext);
  const postMessage = mock(async (_args: Record<string, unknown>) => ({ ok: true, ts: '123.456' }));
  const postEphemeral = mock(async (_args: Record<string, unknown>) => ({ ok: true, message_ts: '123.789' }));
  const internals = plugin as unknown as { attachments: Map<string, unknown> };
  internals.attachments.set('inst', { instanceId: 'inst', actingClient: { chat: { postMessage, postEphemeral } } });
  return { plugin, postMessage, postEphemeral };
}

const message = (text: string, metadata?: Record<string, unknown>): OutgoingMessage => ({
  to: 'C123',
  content: { type: 'text', text },
  metadata,
});

describe('Slack outbound mentions', () => {
  it('retains an explicit structured here when a link URL contains broadcast-shaped text', async () => {
    const { plugin, postMessage } = await setup();
    await plugin.sendMessage('inst', message('[x](<!here>)', { mentions: [{ id: 'here', type: 'here' }] }));
    expect(postMessage.mock.calls[0]?.[0].text).toBe('<!here> <&lt;!here&gt;|x>');
  });

  it('does not treat tokens inside link labels as live mentions', async () => {
    const { plugin, postMessage } = await setup();
    await plugin.sendMessage(
      'inst',
      message('[<@U123> and <@U456>](https://x.example)', {
        mentions: [{ id: 'U123' }, { id: 'U456' }],
      }),
    );
    expect(postMessage.mock.calls[0]?.[0].text).toBe('<@U123> <@U456> <https://x.example|<@U123> and <@U456>>');
  });

  it('keeps structured broadcasts live while escaping broadcasts in the converted body', async () => {
    const { plugin, postMessage } = await setup();
    await plugin.sendMessage(
      'inst',
      message('**hello** <!everyone> <!subteam^S456>', {
        mentions: [
          { id: 'here', type: 'here' },
          { id: 'S123', type: 'role' },
        ],
      }),
    );
    expect(postMessage.mock.calls[0]?.[0].text).toBe(
      '<!here> <!subteam^S123> *hello* &lt;!everyone&gt; &lt;!subteam^S456&gt;',
    );
  });

  it('de-duplicates structured mentions against each other and live inline mentions', async () => {
    const { plugin, postMessage } = await setup();
    await plugin.sendMessage(
      'inst',
      message('<@U123|alice> <#C123|general> hello', {
        mentions: [
          { id: 'U123' },
          { id: 'U123' },
          { id: 'C123', type: 'channel' },
          { id: 'S123', type: 'role' },
          { id: 'S123', type: 'role' },
          { id: 'one', type: 'here' },
          { id: 'two', type: 'here' },
        ],
      }),
    );
    expect(postMessage.mock.calls[0]?.[0].text).toBe('<!subteam^S123> <!here> <@U123|alice> <#C123|general> hello');
  });

  it('does not treat a mention inside a code span as a live inline mention', async () => {
    const { plugin, postMessage } = await setup();
    await plugin.sendMessage('inst', message('`<@U123>`', { mentions: [{ id: 'U123' }] }));
    expect(postMessage.mock.calls[0]?.[0].text).toBe('<@U123> `<@U123>`');
  });

  it('does not add a trailing space when the text is empty', async () => {
    const { plugin, postMessage } = await setup();
    await plugin.sendMessage('inst', message('', { mentions: [{ id: 'U123' }, { id: 'U123' }] }));
    expect(postMessage.mock.calls[0]?.[0].text).toBe('<@U123>');
  });

  it('does not duplicate a live passthrough broadcast', async () => {
    const { plugin, postMessage } = await setup();
    await plugin.sendMessage(
      'inst',
      message('<!here> raw', {
        messageFormatMode: 'passthrough',
        mentions: [{ id: 'here', type: 'here' }],
      }),
    );
    expect(postMessage.mock.calls[0]?.[0].text).toBe('<!here> raw');
  });

  it('sends exactly one native inline mention in convert mode', async () => {
    const { plugin, postMessage } = await setup();
    expect((await plugin.sendMessage('inst', message('**hello** <@U123> & a < b'))).success).toBe(true);
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0]?.[0].text).toBe('*hello* <@U123> &amp; a &lt; b');
  });

  it('prepends structured user, channel, role and broadcast mentions', async () => {
    const { plugin, postMessage } = await setup();
    const result = await plugin.sendMessage(
      'inst',
      message('**hello**', {
        mentions: [
          { id: 'U123' },
          { id: 'W456', type: 'user' },
          { id: 'C789', type: 'channel' },
          { id: 'S123', type: 'role' },
          { id: 'here', type: 'here' },
          { id: 'everyone', type: 'everyone' },
        ],
      }),
    );
    expect(result.success).toBe(true);
    expect(postMessage.mock.calls[0]?.[0].text).toBe(
      '<@U123> <@W456> <#C789> <!subteam^S123> <!here> <!everyone> *hello*',
    );
  });

  it('carries structured mentions into ephemeral thread replies', async () => {
    const { plugin, postEphemeral } = await setup();
    const result = await plugin.sendMessage('inst', {
      ...message('**private**', { mentions: [{ id: 'U123', type: 'user' }], ephemeral: true, ephemeralUserId: 'U456' }),
      replyTo: '111.222',
    });
    expect(result.success).toBe(true);
    expect(postEphemeral.mock.calls[0]?.[0]).toMatchObject({
      text: '<@U123> *private*',
      thread_ts: '111.222',
      user: 'U456',
    });
  });

  it('keeps passthrough text byte-for-byte unchanged', async () => {
    const { plugin, postMessage } = await setup();
    const text = '**literal** <@U123> <#C456> <!channel> <https://example.com|label> & <stray>';
    expect((await plugin.sendMessage('inst', message(text, { messageFormatMode: 'passthrough' }))).success).toBe(true);
    expect(postMessage.mock.calls[0]?.[0].text).toBe(text);
  });

  it('does not convert the passthrough body when structured mentions are supplied', async () => {
    const { plugin, postMessage } = await setup();
    const result = await plugin.sendMessage(
      'inst',
      message('**literal** & <stray>', {
        messageFormatMode: 'passthrough',
        mentions: [{ id: 'U123', type: 'user' }],
      }),
    );
    expect(result.success).toBe(true);
    expect(postMessage.mock.calls[0]?.[0].text).toBe('<@U123> **literal** & <stray>');
  });

  it('an empty mentions array does not change the text', async () => {
    const { plugin, postMessage } = await setup();
    expect((await plugin.sendMessage('inst', message('**hello**', { mentions: [] }))).success).toBe(true);
    expect(postMessage.mock.calls[0]?.[0].text).toBe('*hello*');
  });

  it('rejects a malformed mention id before it can inject additional control tokens', async () => {
    const { plugin, postMessage } = await setup();
    await expect(
      plugin.sendMessage('inst', message('hello', { mentions: [{ id: 'U123> <!everyone', type: 'user' }] })),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(postMessage).not.toHaveBeenCalled();
  });
});
