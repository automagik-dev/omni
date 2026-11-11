import { afterEach, describe, expect, it, spyOn } from 'bun:test';

import { ZenviaPlugin } from '../plugin';
import { HANDOFF_NOT_CONFIGURED_ERROR } from '../utils/handoff';
import { MockEventBus, SENDER_ID, connectPlugin, createContext, instanceId, jsonResponse } from './helpers';

const CONTACT = '5511900000001';
const SALES_KEY = 'sales-secret-key';
const GROUP_ID = 'group-chatbot';
const USER_ID = 'agent-7';
const PROSPECT_ID = '507f191e810c19729de860ea';
const MESSAGE_ID = '7390113b-e120-41b5-8a07-c4567726abc2';

type FetchCall = [string | URL | Request, RequestInit | undefined];

function call(fetchSpy: ReturnType<typeof spyOn>, index: number): { url: URL; init: RequestInit | undefined } {
  const [input, init] = fetchSpy.mock.calls[index] as FetchCall;
  return { url: new URL(String(input)), init };
}

function bodyOf(fetchSpy: ReturnType<typeof spyOn>, index: number): Record<string, unknown> {
  return JSON.parse((call(fetchSpy, index).init?.body as string) ?? '{}') as Record<string, unknown>;
}

function sendResponse(): Response {
  return jsonResponse({ id: MESSAGE_ID, from: SENDER_ID, to: CONTACT, direction: 'OUT' });
}

const handoffMessage = {
  to: CONTACT,
  content: { type: 'text' as const, text: 'Someone from the team will take it from here.' },
  metadata: {
    isHandoff: true,
    motivoHandoff: 'asked for a person',
    dadosLead: { city: 'Fortaleza', lives: 2 },
    handoffFields: { queue: 'sales' },
  },
};

describe('ZenviaPlugin handoff through the Sales API', () => {
  let plugin: ZenviaPlugin;

  async function connect(extra: Record<string, unknown> = {}, groups: unknown = [{ id: GROUP_ID, name: 'Chatbot' }]) {
    plugin = new ZenviaPlugin();
    await plugin.initialize(createContext(new MockEventBus()));
    spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse([])).mockResolvedValueOnce(jsonResponse(groups));
    await connectPlugin(plugin, { zenviaSalesApiKey: SALES_KEY, zenviaHandoffGroupId: GROUP_ID, ...extra });
  }

  afterEach(() => {
    spyOn(globalThis, 'fetch').mockRestore();
  });

  it('verifies the Sales key and the group on connect', async () => {
    await connect();
    const fetchSpy = spyOn(globalThis, 'fetch');
    const { url } = call(fetchSpy, 1);
    expect(url.origin + url.pathname).toBe('https://sales.zenvia.com/api/v1/groups');
    expect(url.searchParams.get('api-key')).toBe(SALES_KEY);
  });

  it('still connects when the group is not listed, and still attempts the transfer', async () => {
    await connect({}, [{ id: 'another-group' }]);
    const fetchSpy = spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ id: PROSPECT_ID }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse([{ id: 'n1' }]))
      .mockResolvedValueOnce(sendResponse());
    const before = fetchSpy.mock.calls.length;

    const result = await plugin.sendMessage(instanceId, handoffMessage);

    expect(result.success).toBe(true);
    expect(call(fetchSpy, before + 1).url.pathname).toBe(`/api/v1/prospect/${PROSPECT_ID}/transfer`);
  });

  it('still connects when the Sales key is rejected; the handoff then fails without echoing the key', async () => {
    plugin = new ZenviaPlugin();
    await plugin.initialize(createContext(new MockEventBus()));
    spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ message: 'invalid api key' }, 401));
    await connectPlugin(plugin, { zenviaSalesApiKey: SALES_KEY, zenviaHandoffGroupId: GROUP_ID });
    spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ message: 'invalid api key' }, 401));

    const result = await plugin.sendMessage(instanceId, handoffMessage);

    expect(result.success).toBe(false);
    expect(result.error).not.toContain(SALES_KEY);
  });

  it('still connects when the Sales API is down, so messaging is not held hostage', async () => {
    plugin = new ZenviaPlugin();
    await plugin.initialize(createContext(new MockEventBus()));
    spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(new Response('', { status: 503 }));
    await connectPlugin(plugin, { zenviaSalesApiKey: SALES_KEY, zenviaHandoffGroupId: GROUP_ID });
    spyOn(globalThis, 'fetch').mockResolvedValueOnce(sendResponse());
    const result = await plugin.sendMessage(instanceId, { to: CONTACT, content: { type: 'text', text: 'hi' } });
    expect(result.success).toBe(true);
  });

  it('keeps the transfer off, without blocking the connection, when only half of the pair is set', async () => {
    plugin = new ZenviaPlugin();
    await plugin.initialize(createContext(new MockEventBus()));
    spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse([]));
    await connectPlugin(plugin, { zenviaSalesApiKey: SALES_KEY });
    const fetchSpy = spyOn(globalThis, 'fetch');
    const before = fetchSpy.mock.calls.length;

    const result = await plugin.sendMessage(instanceId, handoffMessage);

    expect(result.success).toBe(false);
    expect(result.error).toBe(HANDOFF_NOT_CONFIGURED_ERROR);
    expect(fetchSpy.mock.calls.length).toBe(before);
  });

  it('looks the prospect up, transfers to the group, writes the note and then sends the farewell', async () => {
    await connect();
    const fetchSpy = spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ id: PROSPECT_ID, firstName: 'Ana' }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse([{ id: 'n1' }]))
      .mockResolvedValueOnce(sendResponse());
    const before = fetchSpy.mock.calls.length;

    const result = await plugin.sendMessage(instanceId, handoffMessage);

    expect(result.success).toBe(true);
    expect(result.messageId).toBe(MESSAGE_ID);
    expect(result.pauseAgent).toBeUndefined();

    const lookup = call(fetchSpy, before);
    expect(lookup.url.pathname).toBe('/api/v1/prospect-by');
    expect(lookup.url.searchParams.get('phoneNumber')).toBe(`+${CONTACT}`);
    expect(lookup.url.searchParams.get('api-key')).toBe(SALES_KEY);

    const transfer = call(fetchSpy, before + 1);
    expect(transfer.url.pathname).toBe(`/api/v1/prospect/${PROSPECT_ID}/transfer`);
    expect(bodyOf(fetchSpy, before + 1)).toEqual({ group: GROUP_ID });

    const note = call(fetchSpy, before + 2);
    expect(note.url.pathname).toBe(`/api/v1/prospect/${PROSPECT_ID}/interactions`);
    expect(bodyOf(fetchSpy, before + 2)).toEqual({
      type: 'note',
      content: 'Motivo do handoff: asked for a person\nDados do lead:\ncity: Fortaleza\nlives: 2\nqueue: sales',
    });

    const farewell = call(fetchSpy, before + 3);
    expect(farewell.url.href).toBe('https://api.zenvia.com/v2/channels/whatsapp/messages');
    expect(bodyOf(fetchSpy, before + 3).conversation).toBeUndefined();
  });

  it('transfers to a specific agent when one is configured', async () => {
    await connect({ zenviaHandoffUserId: USER_ID });
    const fetchSpy = spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ id: PROSPECT_ID }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse([{ id: 'n1' }]))
      .mockResolvedValueOnce(sendResponse());
    const before = fetchSpy.mock.calls.length;

    await plugin.sendMessage(instanceId, handoffMessage);

    expect(bodyOf(fetchSpy, before + 1)).toEqual({ user: USER_ID, group: GROUP_ID });
  });

  it('takes an empty 2xx transfer answer as done', async () => {
    await connect();
    spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ id: PROSPECT_ID }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse([{ id: 'n1' }]))
      .mockResolvedValueOnce(sendResponse());

    const result = await plugin.sendMessage(instanceId, handoffMessage);

    expect(result.success).toBe(true);
  });

  it('retries the prospect lookup without the plus sign on a 404', async () => {
    await connect();
    const fetchSpy = spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ id: PROSPECT_ID }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse([{ id: 'n1' }]))
      .mockResolvedValueOnce(sendResponse());
    const before = fetchSpy.mock.calls.length;

    const result = await plugin.sendMessage(instanceId, handoffMessage);

    expect(result.success).toBe(true);
    expect(call(fetchSpy, before).url.searchParams.get('phoneNumber')).toBe(`+${CONTACT}`);
    expect(call(fetchSpy, before + 1).url.searchParams.get('phoneNumber')).toBe(CONTACT);
  });

  it('also retries without the plus sign when the first format is rejected', async () => {
    await connect();
    spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ message: 'invalid phone format' }, 400))
      .mockResolvedValueOnce(jsonResponse({ id: PROSPECT_ID }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse([{ id: 'n1' }]))
      .mockResolvedValueOnce(sendResponse());

    const result = await plugin.sendMessage(instanceId, handoffMessage);

    expect(result.success).toBe(true);
  });

  it('fails the handoff, and sends nothing to the contact, when there is no prospect', async () => {
    await connect();
    const fetchSpy = spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 404 }));
    const before = fetchSpy.mock.calls.length;

    const result = await plugin.sendMessage(instanceId, handoffMessage);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no Sales prospect/);
    expect(fetchSpy.mock.calls.length - before).toBe(2);
  });

  it('fails the handoff, and writes nothing nor sends anything, when the transfer is refused', async () => {
    await connect();
    const fetchSpy = spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ id: PROSPECT_ID }))
      .mockResolvedValueOnce(jsonResponse({ message: 'group not allowed' }, 403));
    const before = fetchSpy.mock.calls.length;

    const result = await plugin.sendMessage(instanceId, handoffMessage);

    expect(result.success).toBe(false);
    expect(result.error).not.toContain(SALES_KEY);
    expect(fetchSpy.mock.calls.length - before).toBe(2);
  });

  it('fails the handoff when Zenvia answers success=false', async () => {
    await connect();
    spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ id: PROSPECT_ID }))
      .mockResolvedValueOnce(jsonResponse({ success: false }));

    const result = await plugin.sendMessage(instanceId, handoffMessage);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/did not confirm the transfer/);
  });

  describe('definitive refusal versus transient failure', () => {
    it('marks the handoff rejected when no Sales prospect exists for the number', async () => {
      await connect();
      spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response('', { status: 404 }))
        .mockResolvedValueOnce(new Response('', { status: 404 }));

      const result = await plugin.sendMessage(instanceId, handoffMessage);

      expect(result.success).toBe(false);
      expect(result.rejected).toBe(true);
      expect(result.retryable).toBe(false);
    });

    it('marks the handoff rejected when the Sales API refuses the transfer with a definitive 4xx', async () => {
      for (const status of [400, 404, 409, 422]) {
        await connect();
        spyOn(globalThis, 'fetch')
          .mockResolvedValueOnce(jsonResponse({ id: PROSPECT_ID }))
          .mockResolvedValueOnce(jsonResponse({ message: 'refused' }, status));

        const result = await plugin.sendMessage(instanceId, handoffMessage);

        expect(result.success).toBe(false);
        expect(result.rejected).toBe(true);
        expect(result.retryable).toBe(false);
        spyOn(globalThis, 'fetch').mockRestore();
      }
    });

    it('marks the handoff rejected when Zenvia answers success=false', async () => {
      await connect();
      spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(jsonResponse({ id: PROSPECT_ID }))
        .mockResolvedValueOnce(jsonResponse({ success: false }));

      const result = await plugin.sendMessage(instanceId, handoffMessage);

      expect(result.success).toBe(false);
      expect(result.rejected).toBe(true);
    });

    it('does not mark credential failures (401, 403) or rate limits (429) as rejected', async () => {
      for (const [status, retryable] of [
        [401, false],
        [403, false],
        [429, true],
      ] as const) {
        await connect();
        spyOn(globalThis, 'fetch')
          .mockResolvedValueOnce(jsonResponse({ id: PROSPECT_ID }))
          .mockResolvedValueOnce(jsonResponse({ message: 'nope' }, status));

        const result = await plugin.sendMessage(instanceId, handoffMessage);

        expect(result.success).toBe(false);
        expect(result.rejected).toBeUndefined();
        expect(result.retryable).toBe(retryable);
        spyOn(globalThis, 'fetch').mockRestore();
      }
    });

    it('does not mark a Sales 5xx on the transfer as rejected and keeps it retryable', async () => {
      await connect();
      spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(jsonResponse({ id: PROSPECT_ID }))
        .mockResolvedValueOnce(jsonResponse({ message: 'boom' }, 503));

      const result = await plugin.sendMessage(instanceId, handoffMessage);

      expect(result.success).toBe(false);
      expect(result.rejected).toBeUndefined();
      expect(result.retryable).toBe(true);
    });

    it('does not mark a Sales 5xx on the prospect lookup as rejected', async () => {
      await connect();
      spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ message: 'boom' }, 500));

      const result = await plugin.sendMessage(instanceId, handoffMessage);

      expect(result.success).toBe(false);
      expect(result.rejected).toBeUndefined();
      expect(result.retryable).toBe(true);
    });

    it('does not mark a network failure on the transfer as rejected and keeps it retryable', async () => {
      await connect();
      spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(jsonResponse({ id: PROSPECT_ID }))
        .mockRejectedValueOnce(new TypeError('socket closed'));

      const result = await plugin.sendMessage(instanceId, handoffMessage);

      expect(result.success).toBe(false);
      expect(result.rejected).toBeUndefined();
      expect(result.retryable).toBe(true);
    });

    it('does not mark a timeout on the transfer as rejected and keeps it retryable', async () => {
      await connect();
      const timeout = new Error('timed out');
      timeout.name = 'TimeoutError';
      spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(jsonResponse({ id: PROSPECT_ID }))
        .mockRejectedValueOnce(timeout);

      const result = await plugin.sendMessage(instanceId, handoffMessage);

      expect(result.success).toBe(false);
      expect(result.rejected).toBeUndefined();
      expect(result.retryable).toBe(true);
    });

    it('marks a handoff with only half of the transfer pair configured as rejected', async () => {
      plugin = new ZenviaPlugin();
      await plugin.initialize(createContext(new MockEventBus()));
      spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse([]));
      await connectPlugin(plugin, { zenviaSalesApiKey: SALES_KEY });

      const result = await plugin.sendMessage(instanceId, handoffMessage);

      expect(result.success).toBe(false);
      expect(result.error).toBe(HANDOFF_NOT_CONFIGURED_ERROR);
      expect(result.rejected).toBe(true);
    });

    it('marks a handoff with neither a transfer target nor a routing solution as rejected', async () => {
      plugin = new ZenviaPlugin();
      await plugin.initialize(createContext(new MockEventBus()));
      spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse([]));
      await connectPlugin(plugin);

      const result = await plugin.sendMessage(instanceId, handoffMessage);

      expect(result.success).toBe(false);
      expect(result.rejected).toBe(true);
    });

    it('never sets rejected on a successful handoff or on an ordinary send failure', async () => {
      await connect();
      spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(jsonResponse({ id: PROSPECT_ID }))
        .mockResolvedValueOnce(jsonResponse({ success: true }))
        .mockResolvedValueOnce(jsonResponse([{ id: 'n1' }]))
        .mockResolvedValueOnce(sendResponse());
      const ok = await plugin.sendMessage(instanceId, handoffMessage);

      spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ message: 'bad number' }, 400));
      const plain = await plugin.sendMessage(instanceId, { to: CONTACT, content: { type: 'text', text: 'hi' } });

      expect(ok.rejected).toBeUndefined();
      expect(plain.success).toBe(false);
      expect(plain.rejected).toBeUndefined();
    });
  });

  describe('group routing by queue', () => {
    const ROUTING = { field: 'queue_field', groups: { 'queue-a': 'group-1', 'Queue B': 'group-2' } };
    const NO_DEFAULT = { zenviaHandoffGroupId: undefined };

    function routedMessage(queue: unknown, extra: Record<string, unknown> = {}) {
      return {
        ...handoffMessage,
        metadata: { ...handoffMessage.metadata, handoffFields: { queue_field: queue, ...extra } },
      };
    }

    function queueTransfer(fetchSpy: ReturnType<typeof spyOn>) {
      fetchSpy
        .mockResolvedValueOnce(jsonResponse({ id: PROSPECT_ID }))
        .mockResolvedValueOnce(jsonResponse({ success: true }))
        .mockResolvedValueOnce(jsonResponse([{ id: 'n1' }]))
        .mockResolvedValueOnce(sendResponse());
    }

    it('transfers to the group mapped to the queue the emitter chose', async () => {
      await connect({ zenviaHandoffRouting: ROUTING });
      const fetchSpy = spyOn(globalThis, 'fetch');
      queueTransfer(fetchSpy);
      const before = fetchSpy.mock.calls.length;

      const result = await plugin.sendMessage(instanceId, routedMessage('queue-a'));

      expect(result.success).toBe(true);
      expect(bodyOf(fetchSpy, before + 1)).toEqual({ group: 'group-1' });
    });

    it('sends different queues to different groups', async () => {
      await connect({ zenviaHandoffRouting: ROUTING });
      const fetchSpy = spyOn(globalThis, 'fetch');
      queueTransfer(fetchSpy);
      queueTransfer(fetchSpy);
      const before = fetchSpy.mock.calls.length;

      await plugin.sendMessage(instanceId, routedMessage('queue-a'));
      await plugin.sendMessage(instanceId, routedMessage('queue b'));

      expect(bodyOf(fetchSpy, before + 1)).toEqual({ group: 'group-1' });
      expect(bodyOf(fetchSpy, before + 5)).toEqual({ group: 'group-2' });
    });

    it('matches the queue after trimming, collapsing spaces and ignoring case', async () => {
      await connect({ zenviaHandoffRouting: ROUTING });
      const fetchSpy = spyOn(globalThis, 'fetch');
      queueTransfer(fetchSpy);
      const before = fetchSpy.mock.calls.length;

      await plugin.sendMessage(instanceId, routedMessage('  QUEUE \t  b '));

      expect(bodyOf(fetchSpy, before + 1)).toEqual({ group: 'group-2' });
    });

    it('keeps the queue in the note for the human attendant', async () => {
      await connect({ zenviaHandoffRouting: ROUTING });
      const fetchSpy = spyOn(globalThis, 'fetch');
      queueTransfer(fetchSpy);
      const before = fetchSpy.mock.calls.length;

      await plugin.sendMessage(instanceId, routedMessage('queue-a'));

      const content = String(bodyOf(fetchSpy, before + 2).content);
      expect(content).toContain('queue_field: queue-a');
      expect(content).toContain('Motivo do handoff: asked for a person');
    });

    it('keeps zenviaHandoffUserId inside the chosen group', async () => {
      await connect({ zenviaHandoffRouting: ROUTING, zenviaHandoffUserId: USER_ID });
      const fetchSpy = spyOn(globalThis, 'fetch');
      queueTransfer(fetchSpy);
      const before = fetchSpy.mock.calls.length;

      await plugin.sendMessage(instanceId, routedMessage('queue b'));

      expect(bodyOf(fetchSpy, before + 1)).toEqual({ user: USER_ID, group: 'group-2' });
    });

    it('falls back to the default group, warning with the value but without lead data', async () => {
      await connect({ zenviaHandoffRouting: ROUTING });
      const warn = spyOn(plugin.getLogger(), 'warn');
      const fetchSpy = spyOn(globalThis, 'fetch');
      queueTransfer(fetchSpy);
      const before = fetchSpy.mock.calls.length;

      const result = await plugin.sendMessage(instanceId, routedMessage('queue-z'));

      expect(result.success).toBe(true);
      expect(bodyOf(fetchSpy, before + 1)).toEqual({ group: GROUP_ID });
      const logged = warn.mock.calls.map((args) => JSON.stringify(args));
      const routingWarning = logged.find((line) => line.includes('queue-z'));
      expect(routingWarning).toBeDefined();
      expect(routingWarning).toContain('queue_field');
      expect(routingWarning).not.toContain('Fortaleza');
      expect(routingWarning).not.toContain('asked for a person');
    });

    it('falls back to the default group when the emitter sent no queue at all', async () => {
      await connect({ zenviaHandoffRouting: ROUTING });
      const fetchSpy = spyOn(globalThis, 'fetch');
      queueTransfer(fetchSpy);
      const before = fetchSpy.mock.calls.length;

      const result = await plugin.sendMessage(instanceId, handoffMessage);

      expect(result.success).toBe(true);
      expect(bodyOf(fetchSpy, before + 1)).toEqual({ group: GROUP_ID });
    });

    it('falls back on a queue value that is not a string, naming the type only', async () => {
      await connect({ zenviaHandoffRouting: ROUTING });
      const warn = spyOn(plugin.getLogger(), 'warn');
      const fetchSpy = spyOn(globalThis, 'fetch');
      queueTransfer(fetchSpy);
      const before = fetchSpy.mock.calls.length;

      const result = await plugin.sendMessage(instanceId, routedMessage(12));

      expect(result.success).toBe(true);
      expect(bodyOf(fetchSpy, before + 1)).toEqual({ group: GROUP_ID });
      expect(warn.mock.calls.map((args) => JSON.stringify(args)).some((line) => line.includes('number'))).toBe(true);
    });

    it('refuses for good, calling nothing, when the queue has no group and there is no default', async () => {
      await connect({ zenviaHandoffRouting: ROUTING, ...NO_DEFAULT });
      const fetchSpy = spyOn(globalThis, 'fetch');
      const before = fetchSpy.mock.calls.length;

      const result = await plugin.sendMessage(instanceId, routedMessage('queue-z'));

      expect(result.success).toBe(false);
      expect(result.rejected).toBe(true);
      expect(result.retryable).toBe(false);
      expect(result.error).toContain('queue_field');
      expect(fetchSpy.mock.calls.length).toBe(before);
    });

    it('refuses for good when the emitter sent no queue and there is no default', async () => {
      await connect({ zenviaHandoffRouting: ROUTING, ...NO_DEFAULT });
      const fetchSpy = spyOn(globalThis, 'fetch');
      const before = fetchSpy.mock.calls.length;

      const result = await plugin.sendMessage(instanceId, handoffMessage);

      expect(result.success).toBe(false);
      expect(result.rejected).toBe(true);
      expect(fetchSpy.mock.calls.length).toBe(before);
    });

    it('still routes the matching queue when there is no default group', async () => {
      await connect({ zenviaHandoffRouting: ROUTING, ...NO_DEFAULT });
      const fetchSpy = spyOn(globalThis, 'fetch');
      queueTransfer(fetchSpy);
      const before = fetchSpy.mock.calls.length;

      const result = await plugin.sendMessage(instanceId, routedMessage('queue b'));

      expect(result.success).toBe(true);
      expect(bodyOf(fetchSpy, before + 1)).toEqual({ group: 'group-2' });
    });

    it('leaves the behavior untouched without a routing map: the queue only reaches the note', async () => {
      await connect();
      const fetchSpy = spyOn(globalThis, 'fetch');
      queueTransfer(fetchSpy);
      const before = fetchSpy.mock.calls.length;

      await plugin.sendMessage(instanceId, routedMessage('queue-a'));

      expect(bodyOf(fetchSpy, before + 1)).toEqual({ group: GROUP_ID });
      expect(String(bodyOf(fetchSpy, before + 2).content)).toContain('queue_field: queue-a');
    });

    it('accepts the routing map as a JSON string', async () => {
      await connect({ zenviaHandoffRouting: JSON.stringify(ROUTING) });
      const fetchSpy = spyOn(globalThis, 'fetch');
      queueTransfer(fetchSpy);
      const before = fetchSpy.mock.calls.length;

      await plugin.sendMessage(instanceId, routedMessage('queue-a'));

      expect(bodyOf(fetchSpy, before + 1)).toEqual({ group: 'group-1' });
    });

    it('refuses to connect with an invalid routing map, before calling Zenvia', async () => {
      plugin = new ZenviaPlugin();
      await plugin.initialize(createContext(new MockEventBus()));
      const fetchSpy = spyOn(globalThis, 'fetch');
      const before = fetchSpy.mock.calls.length;

      for (const zenviaHandoffRouting of [
        { field: '', groups: { a: 'g' } },
        { field: 'queue_field', groups: {} },
        { field: 'queue_field', groups: { a: 12 } },
        { field: 'queue_field', groups: { 'Queue A': 'g1', 'queue  a': 'g2' } },
        '{broken',
      ]) {
        await expect(connectPlugin(plugin, { zenviaHandoffRouting })).rejects.toThrow(/zenviaHandoffRouting/);
      }
      expect(fetchSpy.mock.calls.length).toBe(before);
    });

    it('checks the mapped groups on connect, warning about the ones the Sales key does not list', async () => {
      plugin = new ZenviaPlugin();
      await plugin.initialize(createContext(new MockEventBus()));
      const warn = spyOn(plugin.getLogger(), 'warn');
      spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(jsonResponse([]))
        .mockResolvedValueOnce(jsonResponse([{ id: GROUP_ID }, { id: 'group-1' }]));

      await connectPlugin(plugin, {
        zenviaSalesApiKey: SALES_KEY,
        zenviaHandoffGroupId: GROUP_ID,
        zenviaHandoffRouting: ROUTING,
      });

      const lines = warn.mock.calls.map((args) => JSON.stringify(args));
      expect(lines.filter((line) => line.includes('group-2'))).toHaveLength(1);
      expect(lines.some((line) => line.includes('group-1'))).toBe(false);
      expect(plugin.getInstanceState(instanceId)).toBeDefined();
    });

    it('verifies the Sales key on connect when only the routing map is set', async () => {
      plugin = new ZenviaPlugin();
      await plugin.initialize(createContext(new MockEventBus()));
      const fetchSpy = spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(jsonResponse([]))
        .mockResolvedValueOnce(jsonResponse([{ id: 'group-1' }, { id: 'group-2' }]));

      await connectPlugin(plugin, { zenviaSalesApiKey: SALES_KEY, zenviaHandoffRouting: ROUTING });

      const { url } = call(fetchSpy, fetchSpy.mock.calls.length - 1);
      expect(url.pathname).toBe('/api/v1/groups');
      expect(plugin.getInstanceState(instanceId)?.salesClient).toBeDefined();
    });

    it('keeps the transfer off, without blocking the connection, when the map has no Sales key', async () => {
      plugin = new ZenviaPlugin();
      await plugin.initialize(createContext(new MockEventBus()));
      const warn = spyOn(plugin.getLogger(), 'warn');
      spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse([]));

      await connectPlugin(plugin, { zenviaHandoffRouting: ROUTING });

      expect(plugin.getInstanceState(instanceId)?.salesClient).toBeUndefined();
      expect(warn).toHaveBeenCalled();
    });
  });

  it('keeps the handoff done when the note cannot be written', async () => {
    await connect();
    const fetchSpy = spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ id: PROSPECT_ID }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ message: 'boom' }, 500))
      .mockResolvedValueOnce(sendResponse());
    const before = fetchSpy.mock.calls.length;

    const result = await plugin.sendMessage(instanceId, handoffMessage);

    expect(result.success).toBe(true);
    expect(call(fetchSpy, before + 3).url.href).toBe('https://api.zenvia.com/v2/channels/whatsapp/messages');
  });

  it('skips the note when the handoff carries no context', async () => {
    await connect();
    const fetchSpy = spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ id: PROSPECT_ID }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(sendResponse());
    const before = fetchSpy.mock.calls.length;

    await plugin.sendMessage(instanceId, { ...handoffMessage, metadata: { isHandoff: true } });

    expect(call(fetchSpy, before + 2).url.href).toBe('https://api.zenvia.com/v2/channels/whatsapp/messages');
  });

  it('still reports the handoff as done when only the farewell fails after the transfer', async () => {
    await connect();
    spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ id: PROSPECT_ID }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse([{ id: 'n1' }]))
      .mockResolvedValueOnce(jsonResponse({ message: 'down' }, 503));

    const result = await plugin.sendMessage(instanceId, handoffMessage);

    expect(result.success).toBe(true);
    expect(result.messageId).toBeUndefined();
  });

  describe('farewell failing after a completed transfer', () => {
    async function connectWith(bus: MockEventBus) {
      plugin = new ZenviaPlugin();
      await plugin.initialize(createContext(bus));
      spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(jsonResponse([]))
        .mockResolvedValueOnce(jsonResponse([{ id: GROUP_ID }]));
      await connectPlugin(plugin, { zenviaSalesApiKey: SALES_KEY, zenviaHandoffGroupId: GROUP_ID });
    }

    function queueTransferThenFarewell(farewell: Response | Error) {
      const fetchSpy = spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(jsonResponse({ id: PROSPECT_ID }))
        .mockResolvedValueOnce(jsonResponse({ success: true }))
        .mockResolvedValueOnce(jsonResponse([{ id: 'n1' }]));
      if (farewell instanceof Error) fetchSpy.mockRejectedValueOnce(farewell);
      else fetchSpy.mockResolvedValueOnce(farewell);
    }

    function errorLogs(logger: ReturnType<typeof spyOn>) {
      return logger.mock.calls.map((args: unknown[]) => args[1] as Record<string, unknown>);
    }

    it('keeps success, leaves messageId out, logs an error with the instance and the code, and emits message.failed', async () => {
      const bus = new MockEventBus();
      await connectWith(bus);
      const logError = spyOn(plugin.getLogger(), 'error');
      queueTransferThenFarewell(jsonResponse({ message: 'down' }, 503));

      const result = await plugin.sendMessage(instanceId, handoffMessage);

      expect(result.success).toBe(true);
      expect(result.messageId ?? null).toBeNull();
      expect(result.error).toBeUndefined();
      expect(errorLogs(logError)).toEqual([
        expect.objectContaining({ instanceId, errorCode: 'ZENVIA_UPSTREAM_ERROR' }),
      ]);
      const failed = bus.published.filter((event) => event.type === 'message.failed');
      expect(failed).toHaveLength(1);
      expect(failed[0]?.payload).toMatchObject({ chatId: CONTACT, retryable: true });
      expect(bus.published.some((event) => event.type === 'message.sent')).toBe(false);
    });

    it('logs the Zenvia code of a refused farewell', async () => {
      await connect();
      const logError = spyOn(plugin.getLogger(), 'error');
      queueTransferThenFarewell(jsonResponse({ message: 'bad number' }, 400));

      const result = await plugin.sendMessage(instanceId, handoffMessage);

      expect(result.success).toBe(true);
      expect(errorLogs(logError)).toEqual([
        expect.objectContaining({ instanceId, errorCode: 'ZENVIA_INVALID_REQUEST' }),
      ]);
    });

    it('treats a network failure of the farewell the same way', async () => {
      const bus = new MockEventBus();
      await connectWith(bus);
      const logError = spyOn(plugin.getLogger(), 'error');
      queueTransferThenFarewell(new TypeError('socket closed'));

      const result = await plugin.sendMessage(instanceId, handoffMessage);

      expect(result.success).toBe(true);
      expect(result.messageId ?? null).toBeNull();
      expect(errorLogs(logError)).toEqual([
        expect.objectContaining({ instanceId, errorCode: 'ZENVIA_UPSTREAM_ERROR' }),
      ]);
      expect(bus.published.some((event) => event.type === 'message.failed')).toBe(true);
    });

    it('treats a 2xx farewell without a message id the same way', async () => {
      const bus = new MockEventBus();
      await connectWith(bus);
      const logError = spyOn(plugin.getLogger(), 'error');
      queueTransferThenFarewell(jsonResponse({ from: SENDER_ID }));

      const result = await plugin.sendMessage(instanceId, handoffMessage);

      expect(result.success).toBe(true);
      expect(result.messageId ?? null).toBeNull();
      expect(errorLogs(logError)).toEqual([expect.objectContaining({ instanceId })]);
      expect(bus.published.some((event) => event.type === 'message.failed')).toBe(true);
    });

    it('does not log that error, and reports the failure, when no transfer happened', async () => {
      plugin = new ZenviaPlugin();
      await plugin.initialize(createContext(new MockEventBus()));
      spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse([]));
      await connectPlugin(plugin, { zenviaHandoffSolution: 'conversion' });
      const logError = spyOn(plugin.getLogger(), 'error');
      spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ message: 'down' }, 503));

      const result = await plugin.sendMessage(instanceId, handoffMessage);

      expect(result.success).toBe(false);
      expect(logError).not.toHaveBeenCalled();
    });
  });

  it('prefers the transfer over conversation routing when both are configured', async () => {
    await connect({ zenviaHandoffSolution: 'conversion' });
    const fetchSpy = spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ id: PROSPECT_ID }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse([{ id: 'n1' }]))
      .mockResolvedValueOnce(sendResponse());
    const before = fetchSpy.mock.calls.length;

    await plugin.sendMessage(instanceId, handoffMessage);

    expect(bodyOf(fetchSpy, before + 3).conversation).toBeUndefined();
  });

  it('refuses a handoff with neither a transfer target nor a routing solution', async () => {
    plugin = new ZenviaPlugin();
    await plugin.initialize(createContext(new MockEventBus()));
    spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse([]));
    await connectPlugin(plugin);
    const fetchSpy = spyOn(globalThis, 'fetch');
    const before = fetchSpy.mock.calls.length;

    const result = await plugin.sendMessage(instanceId, handoffMessage);

    expect(result.success).toBe(false);
    expect(result.error).toBe(HANDOFF_NOT_CONFIGURED_ERROR);
    expect(fetchSpy.mock.calls.length).toBe(before);
  });
});
