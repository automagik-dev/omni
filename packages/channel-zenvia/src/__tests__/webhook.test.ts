import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import { ZenviaPlugin } from '../plugin';
import {
  MockEventBus,
  SENDER_ID,
  VERIFY_TOKEN,
  connectPlugin,
  createContext,
  instanceId,
  jsonResponse,
} from './helpers';

const CONTACT = '5511900000002';
const WEBHOOK_URL = `http://localhost/api/v2/channels/zenvia/${instanceId}/webhook`;

function messageEvent(message: Record<string, unknown>, direction: 'IN' | 'OUT' = 'IN'): Record<string, unknown> {
  return {
    id: `evt-${String(message.id)}`,
    timestamp: '2026-09-22T12:00:00.000Z',
    type: 'MESSAGE',
    subscriptionId: 'sub-1',
    channel: 'whatsapp',
    direction,
    message: {
      from: direction === 'IN' ? CONTACT : SENDER_ID,
      to: direction === 'IN' ? SENDER_ID : CONTACT,
      direction,
      channel: 'whatsapp',
      timestamp: '2026-09-22T12:00:00.000Z',
      visitor: { name: 'Test Contact', firstName: 'Test' },
      ...message,
    },
  };
}

function post(payload: unknown, headers: Record<string, string> = { 'x-webhook-token': VERIFY_TOKEN }): Request {
  return new Request(WEBHOOK_URL, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'content-type': 'application/json', ...headers },
  });
}

type Published = { type: string; payload: unknown };

function received(eventBus: MockEventBus): Array<Record<string, unknown>> {
  return (eventBus.published as Published[])
    .filter((e) => e.type === 'message.received')
    .map((e) => e.payload as Record<string, unknown>);
}

describe('Zenvia webhook', () => {
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

  it('emits message.received for an inbound text with the contact profile name', async () => {
    const res = await plugin.handleWebhook(post(messageEvent({ id: 'm-1', contents: [{ type: 'text', text: 'Hi' }] })));

    expect(res.status).toBe(200);
    const [event] = received(eventBus);
    expect(event).toMatchObject({
      externalId: 'm-1',
      chatId: CONTACT,
      from: CONTACT,
      content: { type: 'text', text: 'Hi' },
    });
    expect(event?.rawPayload).toMatchObject({ pushName: 'Test Contact' });
  });

  it('drops redelivered events by message id', async () => {
    const payload = messageEvent({ id: 'm-dup', contents: [{ type: 'text', text: 'Hi' }] });
    await plugin.handleWebhook(post(payload));
    await plugin.handleWebhook(post(payload));
    expect(received(eventBus)).toHaveLength(1);
  });

  it('ignores OUT echoes of messages sent from the number', async () => {
    await plugin.handleWebhook(post(messageEvent({ id: 'm-out', contents: [{ type: 'text', text: 'x' }] }, 'OUT')));
    expect(received(eventBus)).toHaveLength(0);
  });

  it('maps a file content to the Omni media type by mime, deferring the download', async () => {
    await plugin.handleWebhook(
      post(
        messageEvent({
          id: 'm-audio',
          contents: [
            { type: 'file', fileUrl: 'https://files.zenvia.com/a.ogg', fileMimeType: 'audio/ogg', status: 'ACCEPTED' },
          ],
        }),
      ),
    );
    await plugin.handleWebhook(
      post(
        messageEvent({
          id: 'm-doc',
          contents: [
            {
              type: 'file',
              fileUrl: 'https://files.zenvia.com/b.pdf',
              fileMimeType: 'application/pdf',
              fileName: 'b.pdf',
            },
          ],
        }),
      ),
    );

    const [audio, doc] = received(eventBus);
    expect(audio?.content).toMatchObject({
      type: 'audio',
      mediaId: 'https://files.zenvia.com/a.ogg',
      mimeType: 'audio/ogg',
    });
    expect(doc?.content).toMatchObject({ type: 'document', mediaId: 'https://files.zenvia.com/b.pdf' });
    expect(doc?.rawPayload).toMatchObject({ filename: 'b.pdf' });
  });

  it('drops files Zenvia itself rejected', async () => {
    await plugin.handleWebhook(
      post(
        messageEvent({
          id: 'm-rejected',
          contents: [
            { type: 'file', fileMimeType: 'video/x-unknown', status: 'REJECTED', reason: 'MIME_TYPE_NOT_SUPPORTED' },
          ],
        }),
      ),
    );
    expect(received(eventBus)).toHaveLength(0);
  });

  it('normalizes click-to-WhatsApp referral to the Meta Cloud shape', async () => {
    await plugin.handleWebhook(
      post(
        messageEvent({
          id: 'm-ad',
          contents: [{ type: 'text', text: 'I saw the ad' }],
          referral: {
            headline: 'Headline',
            body: 'Body',
            source: { id: '1234567890', type: 'ad', url: 'https://fb.me/TEST' },
            ctwaId: 'CLICK-1',
          },
        }),
      ),
    );

    const [event] = received(eventBus);
    expect(event?.rawPayload).toMatchObject({
      referral: {
        source_type: 'ad',
        source_id: '1234567890',
        source_url: 'https://fb.me/TEST',
        headline: 'Headline',
        body: 'Body',
        ctwa_clid: 'CLICK-1',
      },
    });
    expect((event?.rawPayload as Record<string, unknown>).zenvia).toBeDefined();
  });

  it('turns a location into a labelled location message', async () => {
    await plugin.handleWebhook(
      post(
        messageEvent({
          id: 'm-loc',
          contents: [{ type: 'location', latitude: -23.5, longitude: -46.6, name: 'Office' }],
        }),
      ),
    );
    expect(received(eventBus)[0]?.content).toMatchObject({ type: 'location', text: 'Office' });
  });

  it('carries the quoted message id as replyToId', async () => {
    await plugin.handleWebhook(
      post(messageEvent({ id: 'm-reply', idRef: 'out-9', contents: [{ type: 'text', text: 'yes' }] })),
    );
    expect(received(eventBus)[0]?.replyToId).toBe('out-9');
  });

  it('acks malformed payloads with 200 without emitting', async () => {
    const res = await plugin.handleWebhook(post({ type: 'MESSAGE', message: { id: 'x' } }));
    expect(res.status).toBe(200);
    expect(received(eventBus)).toHaveLength(0);
  });

  it('acks conversation status events without emitting', async () => {
    const res = await plugin.handleWebhook(post({ type: 'CONVERSATION_STATUS', conversationStatus: {} }));
    expect(res.status).toBe(200);
    expect(eventBus.published).toHaveLength(0);
  });

  it('answers 503 while the instance is not connected, so Zenvia can redeliver', async () => {
    const res = await plugin.handleWebhook(
      new Request('http://localhost/api/v2/channels/zenvia/not-connected/webhook', { method: 'POST', body: '{}' }),
    );
    expect(res.status).toBe(503);
  });

  it('drops an inbound message addressed to another sender of the account', async () => {
    const res = await plugin.handleWebhook(
      post(messageEvent({ id: 'm-other', to: '5511988887777', contents: [{ type: 'text', text: 'x' }] })),
    );
    expect(res.status).toBe(200);
    expect(received(eventBus)).toHaveLength(0);
  });

  describe('webhook verify token', () => {
    it('is required to connect', async () => {
      const fresh = new ZenviaPlugin();
      await fresh.initialize(createContext(new MockEventBus()));
      await expect(connectPlugin(fresh, { webhookVerifyToken: undefined })).rejects.toThrow(/webhookVerifyToken/);
    });

    it('rejects a request without the token header', async () => {
      const res = await plugin.handleWebhook(
        post(messageEvent({ id: 'm-noauth', contents: [{ type: 'text', text: 'x' }] }), {}),
      );
      expect(res.status).toBe(401);
      expect(received(eventBus)).toHaveLength(0);
    });

    it('rejects a wrong token and accepts the right one', async () => {
      const wrong = await plugin.handleWebhook(
        post(messageEvent({ id: 'm-wrong', contents: [{ type: 'text', text: 'x' }] }), { 'x-webhook-token': 'nope' }),
      );
      const right = await plugin.handleWebhook(
        post(messageEvent({ id: 'm-right', contents: [{ type: 'text', text: 'x' }] }), {
          'x-webhook-token': VERIFY_TOKEN,
        }),
      );
      expect(wrong.status).toBe(401);
      expect(right.status).toBe(200);
      expect(received(eventBus).map((e) => e.externalId)).toEqual(['m-right']);
    });
  });

  describe('MESSAGE_STATUS', () => {
    function statusEvent(code: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
      return {
        type: 'MESSAGE_STATUS',
        channel: 'whatsapp',
        messageId: 'out-1',
        message: { id: 'out-1', from: SENDER_ID, to: CONTACT, direction: 'OUT' },
        messageStatus: { code, timestamp: '2026-09-22T12:00:05.000Z', ...extra },
      };
    }

    it('maps DELIVERED, READ and NOT_DELIVERED to message events', async () => {
      await plugin.handleWebhook(post(statusEvent('SENT')));
      await plugin.handleWebhook(post(statusEvent('DELIVERED')));
      await plugin.handleWebhook(post(statusEvent('READ')));
      await plugin.handleWebhook(
        post(statusEvent('NOT_DELIVERED', { causes: [{ channelErrorCode: '131047', reason: 'window closed' }] })),
      );

      const types = (eventBus.published as Published[]).map((e) => e.type);
      expect(types).toEqual(['message.delivered', 'message.read', 'message.failed']);

      const failed = (eventBus.published as Published[])[2]?.payload as Record<string, unknown>;
      expect(failed).toMatchObject({ externalId: 'out-1', chatId: CONTACT, errorCode: '131047' });
    });

    describe('events without a recipient', () => {
      function withoutRecipient(code: string, messageId: string, extra: Record<string, unknown> = {}) {
        return {
          type: 'MESSAGE_STATUS',
          channel: 'whatsapp',
          messageId,
          message: { id: messageId, from: SENDER_ID, direction: 'OUT' },
          messageStatus: { code, timestamp: '2026-09-22T12:00:05.000Z', ...extra },
        };
      }

      function mockSends(): { count: () => number } {
        let sent = 0;
        spyOn(globalThis, 'fetch').mockImplementation((async () => {
          sent += 1;
          return jsonResponse({ id: `out-${sent}` });
        }) as never);
        return { count: () => sent };
      }

      function send(to = CONTACT) {
        return plugin.sendMessage(instanceId, { to, content: { type: 'text', text: 'hello' } });
      }

      function lastPayload(): Record<string, unknown> {
        return (eventBus.published as Published[]).at(-1)?.payload as Record<string, unknown>;
      }

      it('uses the recipient recorded when the message was sent', async () => {
        mockSends();
        await send('+55 (11) 90000-0002');
        eventBus.published = [];

        await plugin.handleWebhook(post(withoutRecipient('DELIVERED', 'out-1')));
        await plugin.handleWebhook(post(withoutRecipient('READ', 'out-1')));
        await plugin.handleWebhook(
          post(withoutRecipient('NOT_DELIVERED', 'out-1', { causes: [{ channelErrorCode: '131047' }] })),
        );

        const events = eventBus.published as Published[];
        expect(events.map((e) => e.type)).toEqual(['message.delivered', 'message.read', 'message.failed']);
        for (const event of events) {
          expect(event.payload).toMatchObject({ externalId: 'out-1', chatId: CONTACT });
        }
      });

      it('prefers the recipient the event carries over the recorded one', async () => {
        mockSends();
        await send(CONTACT);
        eventBus.published = [];

        await plugin.handleWebhook(
          post({
            ...withoutRecipient('DELIVERED', 'out-1'),
            message: { id: 'out-1', from: SENDER_ID, to: '5511911112222', direction: 'OUT' },
          }),
        );

        expect(lastPayload()).toMatchObject({ externalId: 'out-1', chatId: '5511911112222' });
      });

      it('warns with the external id, and emits with an empty chat, when no recipient is known', async () => {
        const warn = spyOn(plugin.getLogger(), 'warn');

        await plugin.handleWebhook(post(withoutRecipient('NOT_DELIVERED', 'out-unknown')));

        expect(lastPayload()).toMatchObject({ externalId: 'out-unknown', chatId: '' });
        const lines = warn.mock.calls.map((args) => JSON.stringify(args));
        expect(lines.some((line) => line.includes('out-unknown') && line.includes(instanceId))).toBe(true);
      });

      it('does not warn when the event carries its recipient', async () => {
        const warn = spyOn(plugin.getLogger(), 'warn');

        await plugin.handleWebhook(post(statusEvent('DELIVERED')));

        expect(warn).not.toHaveBeenCalled();
      });

      it('does not record anything for a send that failed', async () => {
        spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ message: 'down' }, 503));
        await send();
        const warn = spyOn(plugin.getLogger(), 'warn');
        eventBus.published = [];

        await plugin.handleWebhook(post(withoutRecipient('DELIVERED', 'out-1')));

        expect(lastPayload()).toMatchObject({ chatId: '' });
        expect(warn.mock.calls.some((args) => JSON.stringify(args).includes('out-1'))).toBe(true);
      });

      it('keeps at most 5000 recipients, dropping the oldest first', async () => {
        const sends = mockSends();
        for (let index = 0; index < 5001; index += 1) await send(`55119${String(index).padStart(8, '0')}`);
        expect(sends.count()).toBe(5001);
        const warn = spyOn(plugin.getLogger(), 'warn');
        eventBus.published = [];

        await plugin.handleWebhook(post(withoutRecipient('DELIVERED', 'out-1')));
        expect(lastPayload()).toMatchObject({ externalId: 'out-1', chatId: '' });
        expect(warn.mock.calls.some((args) => JSON.stringify(args).includes('out-1'))).toBe(true);

        await plugin.handleWebhook(post(withoutRecipient('DELIVERED', 'out-2')));
        expect(lastPayload()).toMatchObject({ externalId: 'out-2', chatId: '5511900000001' });

        await plugin.handleWebhook(post(withoutRecipient('DELIVERED', 'out-5001')));
        expect(lastPayload()).toMatchObject({ externalId: 'out-5001', chatId: '5511900005000' });
      });

      it('forgets a recipient 24 hours after the send', async () => {
        mockSends();
        const sentAt = Date.now();
        await send();
        const now = spyOn(Date, 'now');
        try {
          now.mockReturnValue(sentAt + 24 * 60 * 60 * 1000 - 1000);
          await plugin.handleWebhook(post(withoutRecipient('DELIVERED', 'out-1')));
          expect(lastPayload()).toMatchObject({ chatId: CONTACT });

          now.mockReturnValue(sentAt + 24 * 60 * 60 * 1000 + 1000);
          await plugin.handleWebhook(post(withoutRecipient('DELIVERED', 'out-1')));
          expect(lastPayload()).toMatchObject({ chatId: '' });
        } finally {
          now.mockRestore();
        }
      });
    });
  });
});
