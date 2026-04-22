import { describe, expect, test } from 'bun:test';
import { createInboundDedupeCache } from '@omni/channel-sdk';
import { handleTwilioWhatsAppWebhook } from '../handlers/webhooks';
import type { TwilioWhatsAppPlugin } from '../plugin';
import type { TwilioWhatsAppConfig } from '../types';
import { computeTwilioSignature } from '../utils/signature';

const instanceId = '00000000-0000-4000-8000-000000000001';
const webhookUrl = `https://example.com/api/v2/channels/twilio-whatsapp/${instanceId}/webhook`;

const baseConfig: TwilioWhatsAppConfig = {
  twilioAccountSid: 'ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  twilioAuthToken: 'auth-token',
  twilioFrom: 'whatsapp:+15550001111',
  twilioWebhookUrl: webhookUrl,
  twilioValidateSignature: false,
};

type TestLogger = {
  info: () => void;
  warn: () => void;
  error: () => void;
  debug: () => void;
  child: () => TestLogger;
};

function makeBody(params: Record<string, string>): string {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) body.set(key, value);
  return body.toString();
}

function makeRequest(params: Record<string, string>, signature?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
  if (signature) headers['x-twilio-signature'] = signature;
  return new Request(webhookUrl, {
    method: 'POST',
    headers,
    body: makeBody(params),
  });
}

function makePlugin() {
  const received: unknown[] = [];
  const delivered: unknown[] = [];
  const read: unknown[] = [];
  const failed: unknown[] = [];
  const logger: TestLogger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: () => logger,
  };

  const plugin = {
    getLogger: () => logger,
    handleMessageReceived: async (params: unknown) => {
      received.push(params);
    },
    handleMessageDelivered: async (params: unknown) => {
      delivered.push(params);
    },
    handleMessageRead: async (params: unknown) => {
      read.push(params);
    },
    handleMessageFailed: async (params: unknown) => {
      failed.push(params);
    },
  } as unknown as TwilioWhatsAppPlugin;

  return { plugin, received, delivered, read, failed };
}

describe('handleTwilioWhatsAppWebhook', () => {
  test('emits message.received for inbound text', async () => {
    const { plugin, received } = makePlugin();
    const dedupe = createInboundDedupeCache();
    const response = await handleTwilioWhatsAppWebhook(
      makeRequest({
        AccountSid: baseConfig.twilioAccountSid,
        MessageSid: 'SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        From: 'whatsapp:+15559998888',
        To: 'whatsapp:+15550001111',
        Body: 'hello',
        NumMedia: '0',
        ProfileName: 'Alice',
        WaId: '15559998888',
      }),
      plugin,
      instanceId,
      baseConfig,
      dedupe,
    );

    expect(response.status).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      instanceId,
      externalId: 'SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      chatId: 'whatsapp:+15559998888',
      from: 'whatsapp:+15559998888',
      content: { type: 'text', text: 'hello' },
      rawPayload: { pushName: 'Alice', twilioWaId: '15559998888' },
    });
    dedupe.dispose();
  });

  test('maps inbound media to Omni media content', async () => {
    const { plugin, received } = makePlugin();
    const dedupe = createInboundDedupeCache();
    await handleTwilioWhatsAppWebhook(
      makeRequest({
        AccountSid: baseConfig.twilioAccountSid,
        MessageSid: 'SMbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        From: 'whatsapp:+15559998888',
        To: 'whatsapp:+15550001111',
        Body: 'photo',
        NumMedia: '1',
        MediaUrl0: 'https://api.twilio.com/media/ME123',
        MediaContentType0: 'image/jpeg',
      }),
      plugin,
      instanceId,
      baseConfig,
      dedupe,
    );

    expect(received[0]).toMatchObject({
      content: {
        type: 'image',
        text: 'photo',
        caption: 'photo',
        mediaUrl: 'https://api.twilio.com/media/ME123',
        mimeType: 'image/jpeg',
      },
    });
    dedupe.dispose();
  });

  test('does not treat body-less inbound location as a status callback', async () => {
    const { plugin, received, delivered, read, failed } = makePlugin();
    const dedupe = createInboundDedupeCache();

    await handleTwilioWhatsAppWebhook(
      makeRequest({
        AccountSid: baseConfig.twilioAccountSid,
        MessageSid: 'SM99999999999999999999999999999999',
        From: 'whatsapp:+15559998888',
        To: 'whatsapp:+15550001111',
        SmsStatus: 'received',
        NumMedia: '0',
        Latitude: '37.785834',
        Longitude: '-122.406417',
        Label: 'HQ',
      }),
      plugin,
      instanceId,
      baseConfig,
      dedupe,
    );

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      content: {
        type: 'location',
        text: 'HQ',
        location: { latitude: 37.785834, longitude: -122.406417, name: 'HQ' },
      },
    });
    expect(delivered).toHaveLength(0);
    expect(read).toHaveLength(0);
    expect(failed).toHaveLength(0);
    dedupe.dispose();
  });

  test('emits delivered/read/failed for status callbacks', async () => {
    const { plugin, delivered, read, failed } = makePlugin();
    const dedupe = createInboundDedupeCache();

    await handleTwilioWhatsAppWebhook(
      makeRequest({
        AccountSid: baseConfig.twilioAccountSid,
        MessageSid: 'SMcccccccccccccccccccccccccccccccc',
        To: 'whatsapp:+15559998888',
        From: 'whatsapp:+15550001111',
        MessageStatus: 'delivered',
      }),
      plugin,
      instanceId,
      baseConfig,
      dedupe,
    );
    await handleTwilioWhatsAppWebhook(
      makeRequest({
        AccountSid: baseConfig.twilioAccountSid,
        MessageSid: 'SMcccccccccccccccccccccccccccccccc',
        To: 'whatsapp:+15559998888',
        From: 'whatsapp:+15550001111',
        MessageStatus: 'read',
      }),
      plugin,
      instanceId,
      baseConfig,
      dedupe,
    );
    await handleTwilioWhatsAppWebhook(
      makeRequest({
        AccountSid: baseConfig.twilioAccountSid,
        MessageSid: 'SMcccccccccccccccccccccccccccccccc',
        To: 'whatsapp:+15559998888',
        From: 'whatsapp:+15550001111',
        MessageStatus: 'failed',
        ErrorMessage: 'Delivery failed',
      }),
      plugin,
      instanceId,
      baseConfig,
      dedupe,
    );

    expect(delivered).toHaveLength(1);
    expect(read).toHaveLength(1);
    expect(failed).toHaveLength(1);
    dedupe.dispose();
  });

  test('handles EventType read status callbacks', async () => {
    const { plugin, read } = makePlugin();
    const dedupe = createInboundDedupeCache();

    await handleTwilioWhatsAppWebhook(
      makeRequest({
        AccountSid: baseConfig.twilioAccountSid,
        MessageSid: 'SMffffffffffffffffffffffffffffffff',
        To: 'whatsapp:+15559998888',
        From: 'whatsapp:+15550001111',
        EventType: 'READ',
      }),
      plugin,
      instanceId,
      baseConfig,
      dedupe,
    );

    expect(read).toHaveLength(1);
    expect(read[0]).toMatchObject({
      instanceId,
      externalId: 'SMffffffffffffffffffffffffffffffff',
      to: 'whatsapp:+15559998888',
    });
    dedupe.dispose();
  });

  test('rejects invalid signatures when validation is enabled', async () => {
    const { plugin } = makePlugin();
    const dedupe = createInboundDedupeCache();
    const response = await handleTwilioWhatsAppWebhook(
      makeRequest({
        AccountSid: baseConfig.twilioAccountSid,
        MessageSid: 'SMdddddddddddddddddddddddddddddddd',
        From: 'whatsapp:+15559998888',
        To: 'whatsapp:+15550001111',
        Body: 'hello',
      }),
      plugin,
      instanceId,
      { ...baseConfig, twilioValidateSignature: true },
      dedupe,
    );

    expect(response.status).toBe(401);
    dedupe.dispose();
  });

  test('accepts valid signatures when validation is enabled', async () => {
    const { plugin, received } = makePlugin();
    const dedupe = createInboundDedupeCache();
    const params = {
      AccountSid: baseConfig.twilioAccountSid,
      MessageSid: 'SMeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      From: 'whatsapp:+15559998888',
      To: 'whatsapp:+15550001111',
      Body: 'signed',
    };
    const signature = computeTwilioSignature(baseConfig.twilioAuthToken, webhookUrl, params);
    const response = await handleTwilioWhatsAppWebhook(
      makeRequest(params, signature),
      plugin,
      instanceId,
      { ...baseConfig, twilioValidateSignature: true },
      dedupe,
    );

    expect(response.status).toBe(200);
    expect(received).toHaveLength(1);
    dedupe.dispose();
  });
});
