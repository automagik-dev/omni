/**
 * Gupshup interactive — buttons, lists and WhatsApp Flows.
 *
 * Outbound: each one is its own Custom Integration event (`msg_type`
 * BUTTONS / LIST / FLOW) with Meta's limits already applied, so the partner
 * Journey can map it onto a Bot Studio node without re-validating.
 */

import { describe, expect, it, spyOn } from 'bun:test';
import { GUPSHUP_CAPABILITIES } from '../capabilities';
import { GupshupClient } from '../client';
import { DEFAULT_LIST_BUTTON_LABEL, sendFlow, sendInteractive } from '../senders/interactive';
import { GupshupError } from '../utils/errors';

const TO = '5500000000001';

function makeClient(): GupshupClient {
  return new GupshupClient('https://callbacks.example.com/abc', 'Bearer token', 'nx_omni_agent_reply');
}

function spySend(client: GupshupClient) {
  return spyOn(client, 'send').mockResolvedValue({ status: 'ok' });
}

describe('capabilities', () => {
  it('declares buttons and flows', () => {
    expect(GUPSHUP_CAPABILITIES.canSendButtons).toBe(true);
    expect(GUPSHUP_CAPABILITIES.canSendFlow).toBe(true);
  });
});

describe('sendInteractive', () => {
  it('up to 3 options → BUTTONS with ids from data (or the title)', async () => {
    const client = makeClient();
    const send = spySend(client);

    await sendInteractive(client, TO, 'Have you been a customer before?', [
      { text: 'Yes', data: 'yes' },
      { text: 'No' },
    ]);

    expect(send).toHaveBeenCalledWith(TO, {
      type: 'BUTTONS',
      text: 'Have you been a customer before?',
      buttons: [
        { id: 'yes', title: 'Yes' },
        { id: 'No', title: 'No' },
      ],
    });
  });

  it('truncates button titles to 20 chars (Meta limit)', async () => {
    const client = makeClient();
    const send = spySend(client);

    await sendInteractive(client, TO, 'Pick', [{ text: 'A very long option label indeed' }]);

    const [, msg] = send.mock.calls[0] as [string, { buttons: Array<{ title: string }> }];
    expect(msg.buttons[0]?.title.length).toBeLessThanOrEqual(20);
  });

  it('4–10 options → LIST with rows, default button label', async () => {
    const client = makeClient();
    const send = spySend(client);

    await sendInteractive(
      client,
      TO,
      'How many people?',
      ['1', '2', '3', '4', '5+'].map((n) => ({ text: n })),
    );

    const [, msg] = send.mock.calls[0] as [string, { type: string; list: { button: string; rows: unknown[] } }];
    expect(msg.type).toBe('LIST');
    expect(msg.list.button).toBe(DEFAULT_LIST_BUTTON_LABEL);
    expect(msg.list.rows).toHaveLength(5);
  });

  it('a description or section title forces a list, with the caller label', async () => {
    const client = makeClient();
    const send = spySend(client);

    await sendInteractive(client, TO, 'Plan', [{ text: 'Basic', description: 'Urgent care only' }], {
      sectionTitle: 'Plans',
      buttonLabel: 'See plans',
    });

    expect(send).toHaveBeenCalledWith(TO, {
      type: 'LIST',
      text: 'Plan',
      list: {
        button: 'See plans',
        section_title: 'Plans',
        rows: [{ id: 'Basic', title: 'Basic', description: 'Urgent care only' }],
      },
    });
  });

  it('more than 10 options → 10 rows and the drop is reported', async () => {
    const client = makeClient();
    spySend(client);

    const result = await sendInteractive(
      client,
      TO,
      'City',
      Array.from({ length: 12 }, (_, i) => ({ text: `City ${i}` })),
    );

    expect(result.droppedRows).toBe(2);
  });

  it('URL-only buttons go out as TEXT with the links spelled out — never dropped', async () => {
    const client = makeClient();
    const send = spySend(client);

    await sendInteractive(client, TO, 'Docs', [{ text: 'Guide', url: 'https://example.com/guide' }]);

    expect(send).toHaveBeenCalledWith(TO, { type: 'TEXT', text: 'Docs\n\nGuide: https://example.com/guide' });
  });

  it('URL mixed with reply options is folded into the body', async () => {
    const client = makeClient();
    const send = spySend(client);

    await sendInteractive(client, TO, 'Choose', [{ text: 'A' }, { text: 'Site', url: 'https://example.com' }]);

    const [, msg] = send.mock.calls[0] as [string, { type: string; text: string }];
    expect(msg.type).toBe('BUTTONS');
    expect(msg.text).toContain('Site: https://example.com');
  });
});

describe('sendFlow', () => {
  it('navigate flow → FLOW event with screen and initial data', async () => {
    const client = makeClient();
    const send = spySend(client);

    await sendFlow(client, TO, {
      flowId: '1234567890',
      cta: 'Fill in',
      bodyText: 'Quick form 👇',
      screen: 'QUOTE',
      data: { cities: ['A', 'B'] },
      flowToken: 'omni.tok-1',
      footerText: 'Takes 30s',
    });

    expect(send).toHaveBeenCalledWith(TO, {
      type: 'FLOW',
      text: 'Quick form 👇',
      flow: {
        id: '1234567890',
        cta: 'Fill in',
        token: 'omni.tok-1',
        action: 'navigate',
        screen: 'QUOTE',
        data: { cities: ['A', 'B'] },
        footer: 'Takes 30s',
      },
    });
  });

  it('data_exchange flow drops screen/data (the endpoint drives the first screen)', async () => {
    const client = makeClient();
    const send = spySend(client);

    await sendFlow(client, TO, {
      flowId: '1',
      cta: 'Open',
      bodyText: 'Form',
      flowAction: 'data_exchange',
      screen: 'IGNORED',
      data: { x: 1 },
      flowToken: 't',
      draft: true,
    });

    const [, msg] = send.mock.calls[0] as unknown as [string, { flow: Record<string, unknown> }];
    expect(msg.flow).toEqual({ id: '1', cta: 'Open', token: 't', action: 'data_exchange', draft: true });
  });

  it('refuses a flow addressed by name — the Journey node needs the id', async () => {
    const client = makeClient();
    spySend(client);

    await expect(
      sendFlow(client, TO, { flowName: 'quote', cta: 'Open', bodyText: 'Form', flowToken: 't' }),
    ).rejects.toBeInstanceOf(GupshupError);
  });
});

describe('GupshupClient — interactive payloads reach the callback', () => {
  it('BUTTONS / LIST / FLOW fields are forwarded with msg_type', async () => {
    const ok = () => new Response('{"status":"ok"}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    const fetchSpy = spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(ok());
    try {
      const client = makeClient();
      await client.send(TO, { type: 'BUTTONS', text: 'Q', buttons: [{ id: 'a', title: 'A' }] });
      await client.send(TO, { type: 'LIST', text: 'Q', list: { button: 'Open', rows: [{ id: 'r', title: 'R' }] } });
      await client.send(TO, {
        type: 'FLOW',
        text: 'Form',
        flow: { id: '1', cta: 'Open', token: 't', action: 'navigate' },
      });

      const bodies = fetchSpy.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));
      expect(bodies[0]).toMatchObject({ msg_type: 'BUTTONS', message_text: 'Q', buttons: [{ id: 'a', title: 'A' }] });
      expect(bodies[1]).toMatchObject({ msg_type: 'LIST', list: { button: 'Open' } });
      expect(bodies[2]).toMatchObject({ msg_type: 'FLOW', flow: { id: '1', token: 't' } });
    } finally {
      // Clear the recorded calls too: another file's spyOn(fetch) would reuse this spy.
      fetchSpy.mockClear();
      fetchSpy.mockRestore();
    }
  });
});

describe('GupshupPlugin.sendMessage — interactive dispatch', () => {
  async function connectedPlugin() {
    const { GupshupPlugin } = await import('../plugin');
    const logger = { child: () => logger, info() {}, debug() {}, warn() {}, error() {} };
    const plugin = new GupshupPlugin();
    await plugin.initialize({
      eventBus: { publish: async () => {} } as never,
      logger: logger as never,
      storage: {} as never,
      config: {} as never,
      db: {} as never,
    });
    await plugin.connect('inst-1', {
      instanceId: 'inst-1',
      credentials: { gupshupCallbackUrl: 'https://callbacks.example.com/abc', gupshupAuthToken: 'Bearer t' },
    });
    return plugin;
  }

  async function sentBodies(send: (plugin: Awaited<ReturnType<typeof connectedPlugin>>) => Promise<unknown>) {
    const ok = async () =>
      new Response('{"status":"ok"}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(ok as unknown as typeof fetch);
    try {
      const plugin = await connectedPlugin();
      fetchSpy.mockClear();
      const result = await send(plugin);
      return { result, bodies: fetchSpy.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string)) };
    } finally {
      fetchSpy.mockClear();
      fetchSpy.mockRestore();
    }
  }

  it('text with content.buttons (the /messages/send contract) → BUTTONS event', async () => {
    const { result, bodies } = await sentBodies((p) =>
      p.sendMessage('inst-1', {
        to: TO,
        content: { type: 'text', text: 'Returning customer?', buttons: [{ text: 'Yes' }, { text: 'No' }] },
      }),
    );

    expect((result as { success: boolean }).success).toBe(true);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ msg_type: 'BUTTONS', buttons: [{ title: 'Yes' }, { title: 'No' }] });
  });

  it('content.type=flow with metadata.flow (the /whatsapp-flows/send contract) → FLOW event', async () => {
    const { bodies } = await sentBodies((p) =>
      p.sendMessage('inst-1', {
        to: TO,
        content: { type: 'flow', text: 'Form' },
        metadata: { flow: { flowId: '99', cta: 'Open', bodyText: 'Form', flowToken: 'omni.99.x' } },
      }),
    );

    expect(bodies[0]).toMatchObject({
      msg_type: 'FLOW',
      message_text: 'Form',
      flow: { id: '99', cta: 'Open', token: 'omni.99.x', action: 'navigate' },
    });
  });

  it('a flow without a valid descriptor fails (not retryable) and sends nothing', async () => {
    const { result, bodies } = await sentBodies((p) =>
      p.sendMessage('inst-1', { to: TO, content: { type: 'flow', text: 'Form' }, metadata: {} }),
    );

    expect(result).toMatchObject({ success: false, retryable: false });
    expect(bodies).toHaveLength(0);
  });
});
