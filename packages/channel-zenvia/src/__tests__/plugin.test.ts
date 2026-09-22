/**
 * ZenviaPlugin — outbound payload assembly (contents + auth header), native
 * handoff routing, template descriptor, config validation, inbound media
 * download and connection guard rails.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import { ZenviaPlugin } from '../plugin';
import { HANDOFF_NOT_CONFIGURED_ERROR } from '../utils/handoff';
import { API_TOKEN, MockEventBus, SENDER_ID, connectPlugin, createContext, instanceId, jsonResponse } from './helpers';

const MESSAGE_ID = '7390113b-e120-41b5-8a07-c4567726abc2';
const CONTACT = '5511900000001';

type FetchCall = [string | URL | Request, RequestInit | undefined];

function fetchCall(fetchSpy: ReturnType<typeof spyOn>, index: number): { url: string; init: RequestInit | undefined } {
  const [input, init] = fetchSpy.mock.calls[index] as FetchCall;
  return { url: String(input), init };
}

function sentBody(fetchSpy: ReturnType<typeof spyOn>, index: number): Record<string, unknown> {
  const { init } = fetchCall(fetchSpy, index);
  return JSON.parse((init?.body as string) ?? '{}') as Record<string, unknown>;
}

/** Body of the most recent fetch — robust to spies stacked by a second `setup()`. */
function lastSentBody(fetchSpy: ReturnType<typeof spyOn>): Record<string, unknown> {
  return sentBody(fetchSpy, fetchSpy.mock.calls.length - 1);
}

function sendResponse(): Response {
  return jsonResponse({ id: MESSAGE_ID, from: SENDER_ID, to: CONTACT, direction: 'OUT' });
}

describe('ZenviaPlugin', () => {
  let plugin: ZenviaPlugin;
  let eventBus: MockEventBus;

  async function setup(extraCredentials: Record<string, unknown> = {}): Promise<void> {
    plugin = new ZenviaPlugin();
    eventBus = new MockEventBus();
    await plugin.initialize(createContext(eventBus));
    spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse([]));
    await connectPlugin(plugin, extraCredentials);
    eventBus.published = [];
  }

  beforeEach(async () => {
    await setup();
  });

  afterEach(() => {
    spyOn(globalThis, 'fetch').mockRestore();
  });

  it('validates the token on connect with an authenticated GET /subscriptions', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse([]));
    const fresh = new ZenviaPlugin();
    await fresh.initialize(createContext(new MockEventBus()));
    await connectPlugin(fresh);

    const { url, init } = fetchCall(fetchSpy, 0);
    expect(url).toBe('https://api.zenvia.com/v2/subscriptions');
    expect(init?.headers).toMatchObject({ 'X-API-TOKEN': API_TOKEN });
  });

  it('refuses to connect when the token is rejected', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ code: 'UNAUTHORIZED', message: 'nope' }, 401));
    const fresh = new ZenviaPlugin();
    await fresh.initialize(createContext(new MockEventBus()));
    await expect(connectPlugin(fresh)).rejects.toThrow(/rejected the token/);
  });

  it('refuses to connect without a sender id or with an unknown handoff solution', async () => {
    const fresh = new ZenviaPlugin();
    await fresh.initialize(createContext(new MockEventBus()));
    await expect(fresh.connect(instanceId, { instanceId, credentials: { zenviaApiToken: API_TOKEN } })).rejects.toThrow(
      /zenviaSenderId/,
    );
    await expect(connectPlugin(fresh, { zenviaHandoffSolution: 'queue' })).rejects.toThrow(/zenviaHandoffSolution/);
  });

  it('sends text through /channels/whatsapp/messages and returns the Zenvia message id', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(sendResponse());

    const result = await plugin.sendMessage(instanceId, {
      to: '+55 11 90000-0001',
      content: { type: 'text', text: 'hello from **omni**' },
    });

    expect(result).toMatchObject({ success: true, messageId: MESSAGE_ID });

    const { url, init } = fetchCall(fetchSpy, 1);
    expect(url).toBe('https://api.zenvia.com/v2/channels/whatsapp/messages');
    expect(init?.headers).toMatchObject({ 'X-API-TOKEN': API_TOKEN, 'Content-Type': 'application/json' });
    expect(sentBody(fetchSpy, 1)).toEqual({
      from: SENDER_ID,
      to: CONTACT,
      contents: [{ type: 'text', text: 'hello from *omni*' }],
    });

    const sent = eventBus.published.find((e) => e.type === 'message.sent');
    expect(sent).toBeDefined();
  });

  it('quotes the replied message through idRef', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(sendResponse());
    await plugin.sendMessage(instanceId, { to: CONTACT, content: { type: 'text', text: 'hi' }, replyTo: 'in-1' });
    expect(sentBody(fetchSpy, 1).idRef).toBe('in-1');
  });

  it('sends media as a file content with caption only where WhatsApp renders it', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(sendResponse())
      .mockResolvedValueOnce(sendResponse());

    await plugin.sendMessage(instanceId, {
      to: CONTACT,
      content: { type: 'image', mediaUrl: 'https://cdn.example.com/a.png', mimeType: 'image/png', caption: 'look' },
    });
    await plugin.sendMessage(instanceId, {
      to: CONTACT,
      content: { type: 'document', mediaUrl: 'https://cdn.example.com/a.pdf', filename: 'a.pdf', caption: 'ignored' },
    });

    expect(sentBody(fetchSpy, 1).contents).toEqual([
      { type: 'file', fileUrl: 'https://cdn.example.com/a.png', fileMimeType: 'image/png', fileCaption: 'look' },
    ]);
    expect(sentBody(fetchSpy, 2).contents).toEqual([
      { type: 'file', fileUrl: 'https://cdn.example.com/a.pdf', fileName: 'a.pdf' },
    ]);
  });

  it('sends a template by id with named fields and refuses positional parameters', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(sendResponse());

    const ok = await plugin.sendMessage(instanceId, {
      to: CONTACT,
      content: { type: 'template' },
      metadata: { template: { id: 'tpl-1', fields: { name: 'Ana' } } },
    });
    expect(ok.success).toBe(true);
    expect(sentBody(fetchSpy, 1).contents).toEqual([
      { type: 'template', templateId: 'tpl-1', fields: { name: 'Ana' } },
    ]);

    const refused = await plugin.sendMessage(instanceId, {
      to: CONTACT,
      content: { type: 'template' },
      metadata: { template: { id: 'tpl-1', bodyParameters: ['Ana'] } },
    });
    expect(refused.success).toBe(false);
    expect(refused.error).toMatch(/named fields/);
  });

  it('refuses unsupported content types without calling the API', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch');
    const callsBefore = fetchSpy.mock.calls.length;
    const result = await plugin.sendMessage(instanceId, { to: CONTACT, content: { type: 'sticker' } });
    expect(result.success).toBe(false);
    expect(fetchSpy.mock.calls.length).toBe(callsBefore);
  });

  it('maps API failures to a failed SendResult and message.failed', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ code: 'VALIDATION_ERROR', message: 'to is invalid' }, 400),
    );

    const result = await plugin.sendMessage(instanceId, { to: CONTACT, content: { type: 'text', text: 'hi' } });

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
    expect(result.errorCode).toBe('ZENVIA_INVALID_REQUEST');
    expect(result.error).toContain('VALIDATION_ERROR');
    expect(eventBus.published.some((e) => e.type === 'message.failed')).toBe(true);
  });

  it('marks rate limits as retryable', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ code: 'TOO_MANY', message: 'slow down' }, 429));
    const result = await plugin.sendMessage(instanceId, { to: CONTACT, content: { type: 'text', text: 'hi' } });
    expect(result.retryable).toBe(true);
  });

  describe('handoff', () => {
    it('refuses a handoff when no solution is configured, without sending anything', async () => {
      const fetchSpy = spyOn(globalThis, 'fetch');
      const callsBefore = fetchSpy.mock.calls.length;

      const result = await plugin.sendMessage(instanceId, {
        to: CONTACT,
        content: { type: 'text', text: 'Someone from the team will take it from here.' },
        metadata: { isHandoff: true, motivoHandoff: 'asked for a person' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe(HANDOFF_NOT_CONFIGURED_ERROR);
      expect(fetchSpy.mock.calls.length).toBe(callsBefore);
    });

    it('carries the farewell with conversation routing and the handoff context', async () => {
      await setup({ zenviaHandoffSolution: 'conversion' });
      const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(sendResponse());

      const result = await plugin.sendMessage(instanceId, {
        to: CONTACT,
        content: { type: 'text', text: 'Someone from the team will take it from here.' },
        metadata: {
          isHandoff: true,
          motivoHandoff: 'asked for a person',
          dadosLead: 'family account',
          handoffFields: { queue: 'sales', lives: 3 },
        },
      });

      expect(result.success).toBe(true);
      // The route's agentPaused side effect must run: the contact's reply now belongs to people.
      expect(result.pauseAgent).toBeUndefined();
      expect(lastSentBody(fetchSpy)).toMatchObject({
        contents: [{ type: 'text', text: 'Someone from the team will take it from here.' }],
        conversation: {
          solution: 'conversion',
          properties: { handoffReason: 'asked for a person', leadData: 'family account', queue: 'sales', lives: 3 },
        },
      });
    });

    it('never adds routing to ordinary messages', async () => {
      await setup({ zenviaHandoffSolution: 'zenvia_chat' });
      const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(sendResponse());
      await plugin.sendMessage(instanceId, { to: CONTACT, content: { type: 'text', text: 'hi' } });
      const body = lastSentBody(fetchSpy);
      expect(body.contents).toEqual([{ type: 'text', text: 'hi' }]);
      expect(body.conversation).toBeUndefined();
    });
  });

  describe('downloadInboundMedia', () => {
    it('sends the token to Zenvia hosts only', async () => {
      const fetchSpy = spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response('abc', { headers: { 'content-type': 'audio/ogg; codecs=opus' } }))
        .mockResolvedValueOnce(new Response('abc', { headers: { 'content-type': 'image/jpeg' } }));

      const zenviaFile = await plugin.downloadInboundMedia(instanceId, 'https://files.zenvia.com/abc.ogg');
      await plugin.downloadInboundMedia(instanceId, 'https://cdn.example.com/abc.jpg');

      expect(zenviaFile.mimeType).toBe('audio/ogg');
      expect(zenviaFile.buffer.toString()).toBe('abc');
      expect(fetchCall(fetchSpy, 1).init?.headers).toMatchObject({ 'X-API-TOKEN': API_TOKEN });
      expect(fetchCall(fetchSpy, 2).init?.headers).toEqual({});
    });

    it('refuses non-https URLs and oversized declared downloads', async () => {
      await expect(plugin.downloadInboundMedia(instanceId, 'http://files.zenvia.com/a.ogg')).rejects.toThrow(/https/);

      spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('x', { headers: { 'content-length': String(1024 * 1024 * 1024) } }),
      );
      await expect(plugin.downloadInboundMedia(instanceId, 'https://files.zenvia.com/big.mp4')).rejects.toThrow();
    });
  });

  it('reports not-connected sends without calling the API', async () => {
    const result = await plugin.sendMessage('unknown-instance', { to: CONTACT, content: { type: 'text', text: 'x' } });
    expect(result).toMatchObject({ success: false, error: 'Zenvia instance not connected' });
  });
});
