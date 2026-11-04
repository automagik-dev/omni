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
