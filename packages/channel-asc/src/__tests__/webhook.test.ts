/**
 * ASC webhook handler — GET challenge echo, optional verify token,
 * Meta-format inbound messages, statuses and dedupe.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import { AscPlugin } from '../plugin';
import {
  MockEventBus,
  ORIGINADOR,
  VERIFY_TOKEN,
  connectPlugin,
  createContext,
  instanceId,
  jsonResponse,
} from './helpers';

const SENDER = '5512345678910';
const WEBHOOK_URL = `http://localhost/api/v2/channels/asc/${instanceId}/webhook`;

/** Wrap a `value` object into the official Meta webhook envelope. */
function metaEnvelope(value: Record<string, unknown>): Record<string, unknown> {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_ID',
        changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', ...value } }],
      },
    ],
  };
}

function textPayload(wamid: string, body: string, context?: { from: string; id: string }): Record<string, unknown> {
  return metaEnvelope({
    metadata: { display_phone_number: ORIGINADOR, phone_number_id: 'PHONE_NUMBER_ID' },
    contacts: [{ profile: { name: 'Customer Name' }, wa_id: SENDER }],
    messages: [
      {
        from: SENDER,
        id: wamid,
        timestamp: '1660228514',
        text: { body },
        type: 'text',
        ...(context ? { context } : {}),
      },
    ],
  });
}

function post(payload: unknown, url = WEBHOOK_URL): Request {
  return new Request(url, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'content-type': 'application/json' },
  });
}

describe('ASC webhook', () => {
  let plugin: AscPlugin;
  let eventBus: MockEventBus;

  beforeEach(async () => {
    plugin = new AscPlugin();
    eventBus = new MockEventBus();
    await plugin.initialize(createContext(eventBus));
    spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ id: '1234567890' }));
    await connectPlugin(plugin);
    eventBus.published = []; // drop connection events
  });

  afterEach(() => {
    spyOn(globalThis, 'fetch').mockRestore();
  });

  it('emits message.received for an inbound text message', async () => {
    const res = await plugin.handleWebhook(post(textPayload('wamid.text1', 'message text')));

    expect(res.status).toBe(200);
    const received = eventBus.published.filter((e) => e.type === 'message.received');
    expect(received).toHaveLength(1);
    expect(received[0]?.payload).toMatchObject({
      externalId: 'wamid.text1',
      chatId: SENDER,
      from: SENDER,
      senderName: 'Customer Name',
      content: { type: 'text', text: 'message text' },
    });
  });

  it('surfaces the media id (not a URL) for inbound media', async () => {
    const payload = metaEnvelope({
      messages: [
        {
          from: SENDER,
          id: 'wamid.img1',
          timestamp: '1660228735',
          type: 'image',
          image: { caption: 'an image', mime_type: 'image/jpeg', sha256: 'abc=', id: '769582177528267' },
        },
      ],
    });

    await plugin.handleWebhook(post(payload));

    const received = eventBus.published.find((e) => e.type === 'message.received');
    expect(received?.payload).toMatchObject({
      externalId: 'wamid.img1',
      content: { type: 'image', text: 'an image', mediaId: '769582177528267', mimeType: 'image/jpeg' },
    });
  });

  it('propagates the reply context id as replyToId', async () => {
    await plugin.handleWebhook(
      post(textPayload('wamid.reply1', 'reply some text', { from: ORIGINADOR, id: 'message-sent-id' })),
    );

    const received = eventBus.published.find((e) => e.type === 'message.received');
    expect(received?.payload).toMatchObject({ externalId: 'wamid.reply1', replyToId: 'message-sent-id' });
  });

  it('maps button replies to text content', async () => {
    const payload = metaEnvelope({
      messages: [
        {
          from: SENDER,
          id: 'wamid.btn1',
          timestamp: '1660228800',
          type: 'interactive',
          interactive: { type: 'button_reply', button_reply: { id: 'cad_1', title: 'João' } },
        },
      ],
    });

    await plugin.handleWebhook(post(payload));

    const received = eventBus.published.find((e) => e.type === 'message.received');
    expect(received?.payload).toMatchObject({ externalId: 'wamid.btn1', content: { type: 'text', text: 'João' } });
  });

  it('dedupes repeated wamids — same POST twice emits once', async () => {
    const payload = textPayload('wamid.dup1', 'hello');
    await plugin.handleWebhook(post(payload));
    await plugin.handleWebhook(post(payload));

    const received = eventBus.published.filter((e) => e.type === 'message.received');
    expect(received).toHaveLength(1);
  });

  it('emits message.delivered / message.read for statuses; sent is a no-op', async () => {
    const statuses = (status: string, id: string) =>
      metaEnvelope({
        statuses: [
          {
            id,
            recipient_id: SENDER,
            status,
            timestamp: '1659634612',
            conversation: { id: 'CONV', origin: { type: 'service' } },
            pricing: { pricing_model: 'CBP', billable: true, category: 'service' },
          },
        ],
      });

    await plugin.handleWebhook(post(statuses('sent', 'wamid.out1')));
    await plugin.handleWebhook(post(statuses('delivered', 'wamid.out1')));
    await plugin.handleWebhook(post(statuses('read', 'wamid.out1')));

    expect(eventBus.published.filter((e) => e.type === 'message.sent')).toHaveLength(0);
    expect(eventBus.published.find((e) => e.type === 'message.delivered')?.payload).toMatchObject({
      externalId: 'wamid.out1',
      chatId: SENDER,
      deliveredAt: 1659634612000,
    });
    expect(eventBus.published.find((e) => e.type === 'message.read')?.payload).toMatchObject({
      externalId: 'wamid.out1',
      readAt: 1659634612000,
    });
  });

  it('emits message.failed with the error detail for a failed status', async () => {
    const payload = metaEnvelope({
      statuses: [
        {
          errors: [{ code: 131047, title: 'Re-engagement message' }],
          id: 'wamid.fail1',
          recipient_id: SENDER,
          status: 'failed',
          timestamp: '1660229888',
        },
      ],
    });

    await plugin.handleWebhook(post(payload));

    expect(eventBus.published.find((e) => e.type === 'message.failed')?.payload).toMatchObject({
      externalId: 'wamid.fail1',
      error: 'Re-engagement message',
      errorCode: '131047',
    });
  });

  it('acks invalid JSON with 200 and emits nothing', async () => {
    const res = await plugin.handleWebhook(new Request(WEBHOOK_URL, { method: 'POST', body: 'not-json' }));

    expect(res.status).toBe(200);
    expect(eventBus.published).toHaveLength(0);
  });

  it('returns 404 for an unknown instance path', async () => {
    const res = await plugin.handleWebhook(
      post(textPayload('wamid.x', 'y'), 'http://localhost/api/v2/channels/asc/unknown-instance/webhook'),
    );
    expect(res.status).toBe(404);
  });

  describe('GET challenge', () => {
    it('echoes hub.challenge when no verify token is configured', async () => {
      const res = await plugin.handleWebhook(new Request(`${WEBHOOK_URL}?hub.mode=subscribe&hub.challenge=12345`));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('12345');
    });

    it('validates hub.verify_token when configured', async () => {
      await plugin.disconnect(instanceId);
      spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ id: '1234567890' }));
      await connectPlugin(plugin, { webhookVerifyToken: VERIFY_TOKEN });

      const ok = await plugin.handleWebhook(
        new Request(`${WEBHOOK_URL}?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=54321`),
      );
      expect(ok.status).toBe(200);
      expect(await ok.text()).toBe('54321');

      const bad = await plugin.handleWebhook(
        new Request(`${WEBHOOK_URL}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=54321`),
      );
      expect(bad.status).toBe(403);
    });
  });

  describe('POST verify token', () => {
    beforeEach(async () => {
      await plugin.disconnect(instanceId);
      spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ id: '1234567890' }));
      await connectPlugin(plugin, { webhookVerifyToken: VERIFY_TOKEN });
      eventBus.published = [];
    });

    it('accepts a POST without a token (ASC does not document echoing the chave)', async () => {
      const res = await plugin.handleWebhook(post(textPayload('wamid.nokey', 'hi')));
      expect(res.status).toBe(200);
      expect(eventBus.published.filter((e) => e.type === 'message.received')).toHaveLength(1);
    });

    it('accepts a POST with the matching ?token=', async () => {
      const res = await plugin.handleWebhook(
        post(textPayload('wamid.goodkey', 'hi'), `${WEBHOOK_URL}?token=${VERIFY_TOKEN}`),
      );
      expect(res.status).toBe(200);
      expect(eventBus.published.filter((e) => e.type === 'message.received')).toHaveLength(1);
    });

    it('rejects a POST with a mismatching token', async () => {
      const res = await plugin.handleWebhook(post(textPayload('wamid.badkey', 'hi'), `${WEBHOOK_URL}?token=wrong`));
      expect(res.status).toBe(401);
      expect(eventBus.published).toHaveLength(0);
    });
  });
});
