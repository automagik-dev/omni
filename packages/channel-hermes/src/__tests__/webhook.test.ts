/**
 * Hermes webhook handler — inbound messages, statuses, dedupe and the
 * media_id cross-check.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import type { HermesWebhookPayload } from '@omni/core/schemas';

import { handleHermesWebhook } from '../handlers/webhook';
import { HermesPlugin } from '../plugin';
import { MEDIA_ID, MockEventBus, connectPlugin, createContext, instanceId, jsonResponse } from './helpers';

const SENDER = '5512345678910';

function textPayload(wamid: string, body: string, context?: { from: string; id: string }): HermesWebhookPayload {
  return {
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
    media_id: MEDIA_ID,
    message_type: 'IN',
  };
}

describe('handleHermesWebhook', () => {
  let plugin: HermesPlugin;
  let eventBus: MockEventBus;

  beforeEach(async () => {
    plugin = new HermesPlugin();
    eventBus = new MockEventBus();
    await plugin.initialize(createContext(eventBus));
    spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ jwt: 'jwt-1' }));
    await connectPlugin(plugin);
    eventBus.published = []; // drop connection events
  });

  afterEach(() => {
    spyOn(globalThis, 'fetch').mockRestore();
  });

  it('emits message.received for an inbound text message', async () => {
    await handleHermesWebhook(plugin, instanceId, textPayload('wamid.text1', 'message text'));

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

  it('surfaces the direct file URL as content.mediaUrl for inbound media', async () => {
    const payload: HermesWebhookPayload = {
      contacts: [{ profile: { name: 'Customer Name' }, wa_id: SENDER }],
      messages: [
        {
          from: SENDER,
          id: 'wamid.img1',
          timestamp: '1660228735',
          type: 'image',
          image: {
            caption: 'an image',
            mime_type: 'image/jpeg',
            sha256: 'abc=',
            id: '769582177528267',
            file: 'https://waapproduploads.s3.amazonaws.com/line/2022.jpeg',
          },
        },
      ],
      media_id: MEDIA_ID,
      message_type: 'IN',
    };

    await handleHermesWebhook(plugin, instanceId, payload);

    const received = eventBus.published.find((e) => e.type === 'message.received');
    expect(received?.payload).toMatchObject({
      externalId: 'wamid.img1',
      content: {
        type: 'image',
        text: 'an image',
        mediaUrl: 'https://waapproduploads.s3.amazonaws.com/line/2022.jpeg',
        mimeType: 'image/jpeg',
      },
    });
  });

  it('propagates the reply context id as replyToId', async () => {
    await handleHermesWebhook(
      plugin,
      instanceId,
      textPayload('wamid.reply1', 'reply some text', { from: 'business-phone-number', id: 'message-sent-id' }),
    );

    const received = eventBus.published.find((e) => e.type === 'message.received');
    expect(received?.payload).toMatchObject({ externalId: 'wamid.reply1', replyToId: 'message-sent-id' });
  });

  it('dedupes repeated wamids — same POST twice emits once', async () => {
    const payload = textPayload('wamid.dup1', 'hello');
    await handleHermesWebhook(plugin, instanceId, payload);
    await handleHermesWebhook(plugin, instanceId, payload);

    const received = eventBus.published.filter((e) => e.type === 'message.received');
    expect(received).toHaveLength(1);
  });

  it('ignores payloads whose media_id does not match the instance line UUID', async () => {
    const payload = textPayload('wamid.wrongline', 'should be dropped');
    payload.media_id = 'another-line-uuid';

    await handleHermesWebhook(plugin, instanceId, payload);

    expect(eventBus.published).toHaveLength(0);
  });

  it('emits message.delivered for a delivered status keyed by the Hermes UUID', async () => {
    const payload: HermesWebhookPayload = {
      media_id: MEDIA_ID,
      statuses: [
        {
          id: 'b6ae720e-9877-4201-8c0c-301dc36fd077',
          recipient_id: SENDER,
          status: 'delivered',
          timestamp: '1659634612',
        },
      ],
    };

    await handleHermesWebhook(plugin, instanceId, payload);

    const delivered = eventBus.published.find((e) => e.type === 'message.delivered');
    expect(delivered?.payload).toMatchObject({
      externalId: 'b6ae720e-9877-4201-8c0c-301dc36fd077',
      chatId: SENDER,
      deliveredAt: 1659634612000,
    });
  });

  it('emits message.failed with the error detail for a failed status', async () => {
    const payload: HermesWebhookPayload = {
      media_id: MEDIA_ID,
      statuses: [
        {
          errors: [{ code: 500, title: 'some error' }],
          id: '7ba52322-5dea-429b-88fc-bfc4f45c966d',
          recipient_id: SENDER,
          status: 'failed',
          timestamp: '1660229888',
        },
      ],
    };

    await handleHermesWebhook(plugin, instanceId, payload);

    const failed = eventBus.published.find((e) => e.type === 'message.failed');
    expect(failed?.payload).toMatchObject({
      externalId: '7ba52322-5dea-429b-88fc-bfc4f45c966d',
      error: 'some error',
      errorCode: '500',
    });
  });

  it('treats a sent status as a no-op (message.sent already emitted on send)', async () => {
    const payload: HermesWebhookPayload = {
      media_id: MEDIA_ID,
      statuses: [
        { id: 'b6ae720e-9877-4201-8c0c-301dc36fd077', recipient_id: SENDER, status: 'sent', timestamp: '1659634604' },
      ],
    };

    await handleHermesWebhook(plugin, instanceId, payload);

    expect(eventBus.published).toHaveLength(0);
  });

  it('emits reaction.received / reaction.removed for inbound reactions', async () => {
    const reaction = (wamid: string, emoji: string): HermesWebhookPayload => ({
      media_id: MEDIA_ID,
      message_type: 'IN',
      messages: [
        {
          from: SENDER,
          id: wamid,
          timestamp: '1660229999',
          type: 'reaction',
          reaction: { message_id: 'wamid.target', emoji },
        },
      ],
    });

    await handleHermesWebhook(plugin, instanceId, reaction('wamid.react1', '👍'));
    await handleHermesWebhook(plugin, instanceId, reaction('wamid.react2', ''));

    expect(eventBus.published.find((e) => e.type === 'reaction.received')?.payload).toMatchObject({
      messageId: 'wamid.target',
      emoji: '👍',
    });
    expect(eventBus.published.find((e) => e.type === 'reaction.removed')?.payload).toMatchObject({
      messageId: 'wamid.target',
      emoji: '',
    });
  });

  it('handleWebhook: acks invalid JSON with 200 and emits nothing', async () => {
    const res = await plugin.handleWebhook(
      new Request(`http://localhost/api/v2/channels/hermes/${instanceId}/webhook`, {
        method: 'POST',
        body: 'not-json',
      }),
    );

    expect(res.status).toBe(200);
    expect(eventBus.published).toHaveLength(0);
  });

  it('handleWebhook: routes a valid POST to the per-instance handler', async () => {
    const res = await plugin.handleWebhook(
      new Request(`http://localhost/api/v2/channels/hermes/${instanceId}/webhook`, {
        method: 'POST',
        body: JSON.stringify(textPayload('wamid.viaroute', 'through the route')),
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(res.status).toBe(200);
    const received = eventBus.published.filter((e) => e.type === 'message.received');
    expect(received).toHaveLength(1);
    expect(received[0]?.payload).toMatchObject({ externalId: 'wamid.viaroute' });
  });
});
