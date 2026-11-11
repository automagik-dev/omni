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

  describe('inbound publication failure', () => {
    function inboundEvent(id: string): Record<string, unknown> {
      return messageEvent({ id, contents: [{ type: 'text', text: 'Hi' }] });
    }

    function gatePublish(): { open: () => void; started: Promise<void> } {
      const original = eventBus.publish.bind(eventBus);
      let open: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      let markStarted: () => void = () => {};
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      spyOn(eventBus, 'publish').mockImplementationOnce(async (type, payload, metadata) => {
        markStarted();
        await gate;
        return original(type, payload, metadata);
      });
      return { open, started };
    }

    it('answers 503 and emits nothing when the message cannot be published', async () => {
      spyOn(eventBus, 'publish').mockRejectedValueOnce(new Error('bus down'));

      const res = await plugin.handleWebhook(post(inboundEvent('m-fail')));

      expect(res.status).toBe(503);
      expect(received(eventBus)).toHaveLength(0);
    });

    it('processes the redelivery of a message whose publication failed', async () => {
      const payload = inboundEvent('m-retry');
      spyOn(eventBus, 'publish').mockRejectedValueOnce(new Error('bus down'));

      const first = await plugin.handleWebhook(post(payload));
      const second = await plugin.handleWebhook(post(payload));

      expect(first.status).toBe(503);
      expect(second.status).toBe(200);
      expect(received(eventBus).map((e) => e.externalId)).toEqual(['m-retry']);
    });

    it('drops a duplicate that arrives while the first delivery is still being published', async () => {
      const payload = inboundEvent('m-concurrent');
      const publish = gatePublish();

      const first = plugin.handleWebhook(post(payload));
      await publish.started;
      const duplicate = await plugin.handleWebhook(post(payload));
      publish.open();
      const firstResult = await first;

      expect(duplicate.status).toBe(200);
      expect(firstResult.status).toBe(200);
      expect(received(eventBus).map((e) => e.externalId)).toEqual(['m-concurrent']);
    });

    it('still drops a duplicate that arrives after the message was published', async () => {
      const payload = inboundEvent('m-done');

      const first = await plugin.handleWebhook(post(payload));
      const duplicate = await plugin.handleWebhook(post(payload));

      expect(first.status).toBe(200);
      expect(duplicate.status).toBe(200);
      expect(received(eventBus)).toHaveLength(1);
    });

    it('lets the redelivery through when a concurrent duplicate was dropped before the first publish failed', async () => {
      const payload = inboundEvent('m-race');
      const original = eventBus.publish.bind(eventBus);
      let fail: () => void = () => {};
      const failing = new Promise<void>((_resolve, reject) => {
        fail = () => reject(new Error('bus down'));
      });
      let markStarted: () => void = () => {};
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      spyOn(eventBus, 'publish').mockImplementationOnce(async (type, body, metadata) => {
        markStarted();
        await failing;
        return original(type, body, metadata);
      });

      const first = plugin.handleWebhook(post(payload));
      await started;
      const duplicate = await plugin.handleWebhook(post(payload));
      fail();
      const firstResult = await first;
      const redelivery = await plugin.handleWebhook(post(payload));

      expect(duplicate.status).toBe(200);
      expect(firstResult.status).toBe(503);
      expect(redelivery.status).toBe(200);
      expect(received(eventBus).map((e) => e.externalId)).toEqual(['m-race']);
    });

    it('keeps answering 200 for messages it deliberately drops', async () => {
      const otherSender = await plugin.handleWebhook(
        post(messageEvent({ id: 'm-elsewhere', to: '5511988887777', contents: [{ type: 'text', text: 'Hi' }] })),
      );
      const rejectedFile = await plugin.handleWebhook(
        post(messageEvent({ id: 'm-rejected-file', contents: [{ type: 'file', status: 'REJECTED' }] })),
      );

      expect(otherSender.status).toBe(200);
      expect(rejectedFile.status).toBe(200);
      expect(received(eventBus)).toHaveLength(0);
    });
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

  describe('body size limit', () => {
    const OVER_LIMIT = String(1024 * 1024 + 1);
    const AT_LIMIT = String(1024 * 1024);

    function sized(contentLength: string, id: string): Request {
      return post(messageEvent({ id, contents: [{ type: 'text', text: 'x' }] }), {
        'x-webhook-token': VERIFY_TOKEN,
        'content-length': contentLength,
      });
    }

    it('answers 200 without reading a body that declares more than 1 MiB', async () => {
      const request = sized(OVER_LIMIT, 'm-declared-big');
      const readBody = spyOn(request, 'text');
      const res = await plugin.handleWebhook(request);
      expect(res.status).toBe(200);
      expect(readBody).not.toHaveBeenCalled();
      expect(received(eventBus)).toHaveLength(0);
    });

    it('still processes a body that declares exactly 1 MiB', async () => {
      const res = await plugin.handleWebhook(sized(AT_LIMIT, 'm-at-limit'));
      expect(res.status).toBe(200);
      expect(received(eventBus).map((e) => e.externalId)).toEqual(['m-at-limit']);
    });

    it('ignores a content-length that is not a number', async () => {
      const res = await plugin.handleWebhook(sized('abc', 'm-bad-length'));
      expect(res.status).toBe(200);
      expect(received(eventBus).map((e) => e.externalId)).toEqual(['m-bad-length']);
    });

    it('rejects an unauthenticated request before looking at its declared size', async () => {
      const request = post(messageEvent({ id: 'm-big-noauth', contents: [{ type: 'text', text: 'x' }] }), {
        'content-length': OVER_LIMIT,
      });
      const res = await plugin.handleWebhook(request);
      expect(res.status).toBe(401);
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

    describe('status publication failure', () => {
      const statusTypes = ['message.delivered', 'message.read', 'message.failed'];

      function statusPublished(): Published[] {
        return (eventBus.published as Published[]).filter((e) => statusTypes.includes(e.type));
      }

      it('answers 503 and emits nothing when a delivered status cannot be published', async () => {
        spyOn(eventBus, 'publish').mockRejectedValueOnce(new Error('bus down'));

        const res = await plugin.handleWebhook(post(statusEvent('DELIVERED')));

        expect(res.status).toBe(503);
        expect(statusPublished()).toHaveLength(0);
      });

      it('answers 503 for read and failed statuses that cannot be published', async () => {
        spyOn(eventBus, 'publish').mockRejectedValueOnce(new Error('bus down'));
        const read = await plugin.handleWebhook(post(statusEvent('READ')));

        spyOn(eventBus, 'publish').mockRejectedValueOnce(new Error('bus down'));
        const failed = await plugin.handleWebhook(post(statusEvent('NOT_DELIVERED')));

        expect(read.status).toBe(503);
        expect(failed.status).toBe(503);
        expect(statusPublished()).toHaveLength(0);
      });

      it('publishes the redelivery of a status whose publication failed and answers 200', async () => {
        const payload = statusEvent('DELIVERED');
        spyOn(eventBus, 'publish').mockRejectedValueOnce(new Error('bus down'));

        const first = await plugin.handleWebhook(post(payload));
        const second = await plugin.handleWebhook(post(payload));

        expect(first.status).toBe(503);
        expect(second.status).toBe(200);
        expect(statusPublished().map((e) => e.type)).toEqual(['message.delivered']);
        expect(statusPublished()[0]?.payload).toMatchObject({ externalId: 'out-1', chatId: CONTACT });
      });

      it('logs the failed status publication before answering 503', async () => {
        const warn = spyOn(plugin.getLogger(), 'warn');
        spyOn(eventBus, 'publish').mockRejectedValueOnce(new Error('bus down'));

        await plugin.handleWebhook(post(statusEvent('DELIVERED')));

        const lines = warn.mock.calls.map((args) => JSON.stringify(args));
        expect(lines.some((line) => line.includes('failed to emit status event') && line.includes(instanceId))).toBe(
          true,
        );
      });

      it('keeps answering 200 for a status payload that fails validation', async () => {
        const invalid = await plugin.handleWebhook(
          post({ type: 'MESSAGE_STATUS', messageId: 'out-1', messageStatus: { timestamp: 'x' } }),
        );
        const missingStatus = await plugin.handleWebhook(post({ type: 'MESSAGE_STATUS', messageId: 'out-1' }));

        expect(invalid.status).toBe(200);
        expect(missingStatus.status).toBe(200);
        expect(statusPublished()).toHaveLength(0);
      });

      it('keeps answering 200 for statuses it deliberately does not publish', async () => {
        const sent = await plugin.handleWebhook(post(statusEvent('SENT')));
        const noId = await plugin.handleWebhook(
          post({ type: 'MESSAGE_STATUS', messageStatus: { code: 'DELIVERED', timestamp: 'x' } }),
        );

        expect(sent.status).toBe(200);
        expect(noId.status).toBe(200);
        expect(statusPublished()).toHaveLength(0);
      });
    });

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
