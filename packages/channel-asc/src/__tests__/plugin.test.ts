/**
 * AscPlugin — outbound payload assembly (Graph mirror + auth headers),
 * typing indicator with/without a remembered wamid, markAsRead, reactions
 * and connection guard rails.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import { AscPlugin } from '../plugin';
import { MockEventBus, ORIGINADOR, connectPlugin, createContext, instanceId, jsonResponse } from './helpers';

const WAMID = 'wamid.HBgLMjM5Njc4OTQ3NzU4OTQ4NFUABgIFINfR_T4yFQ';

type FetchCall = [string | URL | Request, RequestInit | undefined];

function fetchCall(fetchSpy: ReturnType<typeof spyOn>, index: number): { url: string; init: RequestInit | undefined } {
  const [input, init] = fetchSpy.mock.calls[index] as FetchCall;
  return { url: String(input), init };
}

function sentBody(fetchSpy: ReturnType<typeof spyOn>, index: number): Record<string, unknown> {
  const { init } = fetchCall(fetchSpy, index);
  return JSON.parse((init?.body as string) ?? '{}') as Record<string, unknown>;
}

function sendResponse(): Response {
  return jsonResponse({ messaging_product: 'whatsapp', messages: [{ id: WAMID }] });
}

/** Inject an inbound text message so the plugin remembers the sender's wamid. */
async function receiveInbound(plugin: AscPlugin, from: string, wamid: string): Promise<void> {
  const state = plugin.getInstanceState(instanceId);
  if (!state) throw new Error('instance not connected');
  await plugin.handleInboundMessage(
    instanceId,
    { type: 'text', from, id: wamid, timestamp: '1660228514', text: { body: 'inbound' } },
    undefined,
    state.dedupeCache,
  );
}

describe('AscPlugin', () => {
  let plugin: AscPlugin;
  let eventBus: MockEventBus;

  beforeEach(async () => {
    plugin = new AscPlugin();
    eventBus = new MockEventBus();
    await plugin.initialize(createContext(eventBus));
    spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ id: '1234567890' }));
    await connectPlugin(plugin);
    eventBus.published = [];
  });

  afterEach(() => {
    spyOn(globalThis, 'fetch').mockRestore();
  });

  it('sends text through /api/v1/messages with the auth headers and returns the wamid', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(sendResponse());

    const result = await plugin.sendMessage(instanceId, {
      to: '+5511999998888',
      content: { type: 'text', text: 'hello from omni' },
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe(WAMID);

    const { url, init } = fetchCall(fetchSpy, 1);
    expect(url).toBe('https://apigw.ascbrazil.com.br/api/v1/messages');
    expect(init?.headers).toMatchObject({ originador: ORIGINADOR, 'asc-token': 'test-asc-token' });

    expect(sentBody(fetchSpy, 1)).toMatchObject({
      messaging_product: 'whatsapp',
      to: '5511999998888',
      type: 'text',
      text: { body: 'hello from omni', preview_url: false },
    });

    expect(eventBus.published.find((e) => e.type === 'message.sent')?.payload).toMatchObject({
      externalId: WAMID,
      content: { type: 'text', text: 'hello from omni' },
    });
  });

  it('sends media by link with caption and reply context', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(sendResponse());

    const result = await plugin.sendMessage(instanceId, {
      to: '5511999998888',
      replyTo: 'wamid.orig',
      content: {
        type: 'image',
        mediaUrl: 'https://cdn.example.com/photo.jpg',
        mimeType: 'image/jpeg',
        caption: 'photo caption',
      },
    });

    expect(result.success).toBe(true);
    expect(sentBody(fetchSpy, 1)).toMatchObject({
      type: 'image',
      image: { link: 'https://cdn.example.com/photo.jpg', caption: 'photo caption' },
      context: { message_id: 'wamid.orig' },
    });
  });

  it('drops captions on audio sends (Cloud API rejects them)', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(sendResponse());

    await plugin.sendMessage(instanceId, {
      to: '5511999998888',
      content: { type: 'audio', mediaUrl: 'https://cdn.example.com/note.ogg', caption: 'nope' },
    });

    const body = sentBody(fetchSpy, 1);
    expect(body.audio).toEqual({ link: 'https://cdn.example.com/note.ogg' });
  });

  it('renders content.buttons (≤3) as a Cloud API interactive button payload', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(sendResponse());

    await plugin.sendMessage(instanceId, {
      to: '5511999998888',
      content: {
        type: 'text',
        text: 'Qual cadastro deseja usar?',
        buttons: [
          { text: 'João', data: 'cad_1' },
          { text: 'Maria', data: 'cad_2' },
        ],
      },
    });

    expect(sentBody(fetchSpy, 1)).toMatchObject({
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: 'Qual cadastro deseja usar?' },
        action: {
          buttons: [
            { type: 'reply', reply: { id: 'cad_1', title: 'João' } },
            { type: 'reply', reply: { id: 'cad_2', title: 'Maria' } },
          ],
        },
      },
    });
  });

  it('renders 4+ buttons as an interactive list', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(sendResponse());

    await plugin.sendMessage(instanceId, {
      to: '5511999998888',
      content: {
        type: 'text',
        text: 'Escolha um horário:',
        buttons: [
          { text: '08:30', data: 's1' },
          { text: '09:15', data: 's2' },
          { text: '14:00', data: 's3' },
          { text: '16:40', data: 's4' },
        ],
        list: { buttonLabel: 'Ver horários' },
      },
    });

    const body = sentBody(fetchSpy, 1) as { interactive: { type: string; action: { button: string } } };
    expect(body.interactive.type).toBe('list');
    expect(body.interactive.action.button).toBe('Ver horários');
  });

  it('dispatches templates with bodyParameters expanded into components', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(sendResponse());

    const result = await plugin.sendMessage(instanceId, {
      to: '5511999998888',
      content: { type: 'template' },
      metadata: { template: { name: 'welcome_message', language: 'pt_BR', bodyParameters: ['John'] } },
    });

    expect(result.success).toBe(true);
    expect(sentBody(fetchSpy, 1)).toMatchObject({
      type: 'template',
      template: {
        name: 'welcome_message',
        language: { code: 'pt_BR' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: 'John' }] }],
      },
    });
  });

  it('converts markdown to WhatsApp syntax on text sends (messageFormatMode default)', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(sendResponse());

    await plugin.sendMessage(instanceId, {
      to: '5511999998888',
      content: { type: 'text', text: 'me informe seu **CPF**' },
    });

    const body = sentBody(fetchSpy, 1) as { text: { body: string } };
    expect(body.text.body).toBe('me informe seu *CPF*');
  });

  it('fails fast (no message.failed) for unsupported content types', async () => {
    const result = await plugin.sendMessage(instanceId, {
      to: '5511999998888',
      content: { type: 'poll', poll: { question: 'q', options: ['a'] } },
    });

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
    expect(eventBus.published.find((e) => e.type === 'message.failed')).toBeUndefined();
  });

  it('reports a missing wamid on send as a non-retryable failure', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({}));

    const result = await plugin.sendMessage(instanceId, {
      to: '5511999998888',
      content: { type: 'text', text: 'x' },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('message id');
  });

  it('maps a 500 send failure to a retryable SendResult + message.failed', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500));

    const result = await plugin.sendMessage(instanceId, {
      to: '5511999998888',
      content: { type: 'text', text: 'x' },
    });

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(true);
    expect(result.errorCode).toBe('ASC_UPSTREAM_ERROR');
  });

  it('maps a 401 send failure to a non-retryable auth error', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ error: 'bad token' }, 401));

    const result = await plugin.sendMessage(instanceId, {
      to: '5511999998888',
      content: { type: 'text', text: 'x' },
    });

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
    expect(result.errorCode).toBe('ASC_AUTH_FAILED');
  });

  describe('sendTyping', () => {
    it('references the last inbound wamid for the chat', async () => {
      await receiveInbound(plugin, '5511999998888', 'wamid.inbound1');
      const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 200 }));

      await plugin.sendTyping(instanceId, '+5511999998888', 2500);

      const { url } = fetchCall(fetchSpy, 1);
      expect(url).toBe('https://apigw.ascbrazil.com.br/api/v1/sendTypingIndicator');
      expect(sentBody(fetchSpy, 1)).toEqual({ message_id: 'wamid.inbound1' });
    });

    it('no-ops without HTTP calls when no inbound wamid is remembered', async () => {
      const fetchSpy = spyOn(globalThis, 'fetch');
      const before = fetchSpy.mock.calls.length;

      await plugin.sendTyping(instanceId, '5511000000000', 2500);

      expect(fetchSpy.mock.calls.length).toBe(before);
    });

    it('remembers the NEWEST wamid per chat', async () => {
      await receiveInbound(plugin, '5511999998888', 'wamid.old');
      await receiveInbound(plugin, '5511999998888', 'wamid.new');
      const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 200 }));

      await plugin.sendTyping(instanceId, '5511999998888');

      expect(sentBody(fetchSpy, 1)).toEqual({ message_id: 'wamid.new' });
    });
  });

  it('markAsRead posts /api/v1/markRead for wamid externalIds', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 200 }));

    await plugin.markAsRead(instanceId, '5511999998888', ['db-id-1'], [{ externalId: 'wamid.read1' }]);

    const { url } = fetchCall(fetchSpy, 1);
    expect(url).toBe('https://apigw.ascbrazil.com.br/api/v1/markRead');
    expect(sentBody(fetchSpy, 1)).toEqual({ message_id: 'wamid.read1' });
  });

  it('markAsRead falls back to the last inbound wamid for ["all"]', async () => {
    await receiveInbound(plugin, '5511999998888', 'wamid.lastin');
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 200 }));

    await plugin.markAsRead(instanceId, '5511999998888', ['all']);

    expect(sentBody(fetchSpy, 1)).toEqual({ message_id: 'wamid.lastin' });
  });

  it('react/unreact go through /api/v1/reactMessage', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }));

    await plugin.react(instanceId, '5511999998888', 'wamid.target', '😀');
    await plugin.unreact(instanceId, '5511999998888', 'wamid.target', '😀');

    expect(fetchCall(fetchSpy, 1).url).toBe('https://apigw.ascbrazil.com.br/api/v1/reactMessage');
    expect(sentBody(fetchSpy, 1)).toEqual({
      to: '5511999998888',
      reaction: { message_id: 'wamid.target', emoji: '😀' },
    });
    expect(sentBody(fetchSpy, 2)).toEqual({
      to: '5511999998888',
      reaction: { message_id: 'wamid.target', emoji: '' },
    });
  });

  it('returns a failure without HTTP calls when the instance is not connected', async () => {
    const result = await plugin.sendMessage('missing-instance', {
      to: '5511999998888',
      content: { type: 'text', text: 'x' },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('not connected');
  });

  it('connect fails when the gateway rejects the credentials', async () => {
    const fresh = new AscPlugin();
    await fresh.initialize(createContext(new MockEventBus()));
    spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ error: 'nope' }, 403));

    await expect(connectPlugin(fresh)).rejects.toThrow(/rejected the credentials/);
  });

  it('getHealth pings each connected instance and reports checkedAt', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ id: '1234567890' }));

    const health = await plugin.getHealth(instanceId);

    expect(health.status).toBe('healthy');
    expect(health.checks).toHaveLength(1);
    expect(health.checks[0]?.name).toBe(`asc:${instanceId}`);
    expect(health.checkedAt).toBeInstanceOf(Date);
  });
});
