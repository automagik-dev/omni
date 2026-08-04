/**
 * HermesPlugin — sendMessage dispatch, SendResult externalId (Hermes UUID),
 * react/unreact, and connection guard rails.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import { HermesPlugin } from '../plugin';
import { MEDIA_ID, MockEventBus, connectPlugin, createContext, instanceId, jsonResponse } from './helpers';

const HERMES_UUID = 'cc8a0d2a-f7ea-4b07-b362-620ef690ccde';

type FetchCall = [string | URL | Request, RequestInit | undefined];

function sentEnvelope(fetchSpy: ReturnType<typeof spyOn>, index: number): Record<string, unknown> {
  const [, init] = fetchSpy.mock.calls[index] as FetchCall;
  return JSON.parse((init?.body as string) ?? '{}') as Record<string, unknown>;
}

describe('HermesPlugin', () => {
  let plugin: HermesPlugin;
  let eventBus: MockEventBus;

  beforeEach(async () => {
    plugin = new HermesPlugin();
    eventBus = new MockEventBus();
    await plugin.initialize(createContext(eventBus));
    spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ jwt: 'jwt-1' }));
    await connectPlugin(plugin);
    eventBus.published = [];
  });

  afterEach(() => {
    spyOn(globalThis, 'fetch').mockRestore();
  });

  it('sends text and returns the Hermes UUID as SendResult.messageId', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ message: { id: HERMES_UUID } }));

    const result = await plugin.sendMessage(instanceId, {
      to: '+5511999998888',
      content: { type: 'text', text: 'hello from omni' },
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe(HERMES_UUID);

    // The envelope carries the line media_id + On-Premises-style string text.
    const envelope = sentEnvelope(fetchSpy, 1) as { message: Record<string, unknown> };
    expect(envelope.message).toMatchObject({
      media_id: MEDIA_ID,
      to: '5511999998888',
      type: 'text',
      text: 'hello from omni',
    });

    const sent = eventBus.published.find((e) => e.type === 'message.sent');
    expect(sent?.payload).toMatchObject({
      externalId: HERMES_UUID,
      content: { type: 'text', text: 'hello from omni' },
    });
  });

  it('dispatches media by url with flat content_type + url + caption', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ message: { id: HERMES_UUID } }));

    const result = await plugin.sendMessage(instanceId, {
      to: '5511999998888',
      content: {
        type: 'image',
        mediaUrl: 'https://cdn.example.com/photo.jpg',
        mimeType: 'image/jpeg',
        caption: 'photo caption',
      },
    });

    expect(result.success).toBe(true);
    const envelope = sentEnvelope(fetchSpy, 1) as { message: Record<string, unknown> };
    expect(envelope.message).toMatchObject({
      type: 'image',
      content_type: 'image/jpeg',
      url: 'https://cdn.example.com/photo.jpg',
      caption: 'photo caption',
    });
  });

  it('dispatches templates using the instance hermesTemplateNamespace', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ message: { id: HERMES_UUID } }));

    const result = await plugin.sendMessage(instanceId, {
      to: '5511999998888',
      content: { type: 'template' },
      metadata: { template: { name: 'welcome_message', language: 'pt_BR', bodyParameters: ['John'] } },
    });

    expect(result.success).toBe(true);
    const envelope = sentEnvelope(fetchSpy, 1) as { message: { template: Record<string, unknown> } };
    expect(envelope.message.template).toMatchObject({
      namespace: 'a1b2c3d4_name_space',
      name: 'welcome_message',
      language: { policy: 'deterministic', code: 'pt_BR' },
    });
  });

  it('renders content.buttons (≤3, no descriptions) as an interactive button envelope', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ message: { id: HERMES_UUID } }));

    const result = await plugin.sendMessage(instanceId, {
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

    expect(result.success).toBe(true);
    const envelope = sentEnvelope(fetchSpy, 1) as { message: Record<string, unknown> };
    expect(envelope.message).toMatchObject({
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

  it('renders 4+ buttons as an interactive list with the buttonLabel', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ message: { id: HERMES_UUID } }));

    const result = await plugin.sendMessage(instanceId, {
      to: '5511999998888',
      content: {
        type: 'text',
        text: 'Escolha um horário:',
        buttons: [
          { text: '08:30', data: 's1', description: 'Unidade Centro' },
          { text: '09:15', data: 's2' },
          { text: '14:00', data: 's3' },
          { text: '16:40', data: 's4' },
        ],
        list: { buttonLabel: 'Ver horários', sectionTitle: 'Quinta 06/08' },
      },
    });

    expect(result.success).toBe(true);
    const envelope = sentEnvelope(fetchSpy, 1) as { message: { interactive: Record<string, unknown> } };
    expect(envelope.message.interactive).toMatchObject({
      type: 'list',
      action: {
        button: 'Ver horários',
        sections: [
          {
            title: 'Quinta 06/08',
            rows: [
              { id: 's1', title: '08:30', description: 'Unidade Centro' },
              { id: 's2', title: '09:15' },
              { id: 's3', title: '14:00' },
              { id: 's4', title: '16:40' },
            ],
          },
        ],
      },
    });
  });

  it('renders a single URL button as cta_url', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ message: { id: HERMES_UUID } }));

    await plugin.sendMessage(instanceId, {
      to: '5511999998888',
      content: {
        type: 'text',
        text: 'Sua carteirinha está no app.',
        buttons: [{ text: 'Abrir o app', url: 'https://app.example.com' }],
      },
    });

    const envelope = sentEnvelope(fetchSpy, 1) as { message: { interactive: Record<string, unknown> } };
    expect(envelope.message.interactive).toMatchObject({
      type: 'cta_url',
      action: { name: 'cta_url', parameters: { display_text: 'Abrir o app', url: 'https://app.example.com' } },
    });
  });

  it('converts markdown to WhatsApp syntax on text sends (messageFormatMode default)', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ message: { id: HERMES_UUID } }));

    await plugin.sendMessage(instanceId, {
      to: '5511999998888',
      content: { type: 'text', text: 'me informe seu **CPF** e **data de nascimento**' },
    });

    const envelope = sentEnvelope(fetchSpy, 1) as { message: Record<string, unknown> };
    expect(envelope.message.text).toBe('me informe seu *CPF* e *data de nascimento*');
  });

  it('honors messageFormatMode=passthrough (raw markdown untouched)', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ message: { id: HERMES_UUID } }));

    await plugin.sendMessage(instanceId, {
      to: '5511999998888',
      content: { type: 'text', text: '**raw**' },
      metadata: { messageFormatMode: 'passthrough' },
    });

    const envelope = sentEnvelope(fetchSpy, 1) as { message: Record<string, unknown> };
    expect(envelope.message.text).toBe('**raw**');
  });

  it('dispatches location_request as the location_request_message interactive', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ message: { id: HERMES_UUID } }));

    const result = await plugin.sendMessage(instanceId, {
      to: '5511999998888',
      content: { type: 'location_request', text: 'Compartilhe sua localização 📍' },
    });

    expect(result.success).toBe(true);
    const envelope = sentEnvelope(fetchSpy, 1) as { message: { interactive: Record<string, unknown> } };
    expect(envelope.message.interactive).toEqual({
      type: 'location_request_message',
      body: { text: 'Compartilhe sua localização 📍' },
      action: { name: 'send_location' },
    });
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

  it('reports missing Hermes message id as a non-retryable failure', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({}));

    const result = await plugin.sendMessage(instanceId, {
      to: '5511999998888',
      content: { type: 'text', text: 'x' },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('message id');
    expect(eventBus.published.find((e) => e.type === 'message.failed')).toBeDefined();
  });

  it('maps a 500 send failure to a retryable SendResult + message.failed', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500));

    const result = await plugin.sendMessage(instanceId, {
      to: '5511999998888',
      content: { type: 'text', text: 'x' },
    });

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(true);
    expect(result.errorCode).toBe('HERMES_UPSTREAM_ERROR');
    expect(eventBus.published.find((e) => e.type === 'message.failed')?.payload).toMatchObject({
      retryable: true,
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

  it('react sends the reaction payload; unreact sends an empty emoji', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ message: { id: HERMES_UUID } }))
      .mockResolvedValueOnce(jsonResponse({ message: { id: HERMES_UUID } }));

    await plugin.react(instanceId, '5511999998888', 'wamid.target', '😀');
    await plugin.unreact(instanceId, '5511999998888', 'wamid.target', '😀');

    const first = sentEnvelope(fetchSpy, 1) as { message: { reaction: Record<string, unknown> } };
    expect(first.message.reaction).toEqual({ message_id: 'wamid.target', emoji: '😀' });

    const second = sentEnvelope(fetchSpy, 2) as { message: { reaction: Record<string, unknown> } };
    expect(second.message.reaction).toEqual({ message_id: 'wamid.target', emoji: '' });
  });

  it('getHealth pings each connected instance and reports checkedAt', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ jwt: 'jwt-2' }));

    const health = await plugin.getHealth(instanceId);

    expect(health.status).toBe('healthy');
    expect(health.checks).toHaveLength(1);
    expect(health.checks[0]?.name).toBe(`hermes:${instanceId}`);
    expect(health.checkedAt).toBeInstanceOf(Date);
  });
});
