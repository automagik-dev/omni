import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import type { PluginContext } from '@omni/channel-sdk';
import { ZapiClient, recipient } from '../client';
import { ZapiWebPlugin } from '../plugin';
import { readBody, verifyOmniSignature } from '../signature';
import { normalizeOmni, normalizeWeb } from '../webhook';

const web = {
  driver: 'web' as const,
  instanceId: 'vendor-instance',
  instanceToken: 'instance-secret-123',
  clientToken: 'client-secret-12345',
  webhookToken: 'webhook-secret-12345678901234567890',
};
const omni = {
  driver: 'omni' as const,
  channelId: 'vendor-channel',
  secretKey: 'secret-key-1234567890',
  signingSecret: 'signing-secret-1234567890',
};
const ok = (body: unknown) => Response.json(body);
let fetchMock: ReturnType<typeof spyOn>;
beforeEach(() => {
  fetchMock = spyOn(globalThis, 'fetch').mockImplementation((async () =>
    ok({ messageId: 'msg-1' })) as unknown as typeof fetch);
});
afterEach(() => fetchMock.mockRestore());
function signed(body: string, timestamp = Math.floor(Date.now() / 1000)) {
  const key = 'message.event:0:123';
  const signature = createHmac('sha256', omni.signingSecret)
    .update(`${timestamp}\nmessage.event\n0\n123\n${body}`)
    .digest('hex');
  return new Headers({ 'x-idempotency-key': key, 'x-webhook-signature': `t=${timestamp},v1=${signature}` });
}
const inbound = {
  instanceId: web.instanceId,
  type: 'ReceivedCallback',
  messageId: 'in-1',
  phone: '5511999999999',
  fromMe: false,
  momment: 1780000000000,
  text: { message: 'Olá' },
};
const omniInbound = {
  messageEventType: 'NEW_MESSAGE',
  message: {
    _id: 'omni-1',
    channel_id: omni.channelId,
    created: 1780000000000,
    metadata: { from_me: false },
    sender: { identifier: '5511999999999' },
    recipient: { identifier: '5511888888888' },
    contents: [{ type: 'TEXT', message: 'Olá' }],
    attachments: [],
  },
};

describe('Z-API transport contract', () => {
  test('Web auth and exact text endpoint', async () => {
    await new ZapiClient(web).send({ to: '+5511999999999', content: { type: 'text', text: 'Olá' } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.z-api.io/instances/${web.instanceId}/token/${web.instanceToken}/send-text`);
    expect((init.headers as Record<string, string>)['Client-Token']).toBe(web.clientToken);
    expect(JSON.parse(init.body as string)).toEqual({ phone: '5511999999999', message: 'Olá' });
    expect(init.redirect).toBe('error');
  });
  test('Web quoted text uses reply endpoint', async () => {
    await new ZapiClient(web).send({ to: '5511999999999', replyTo: 'prior', content: { type: 'text', text: 'Reply' } });
    expect(fetchMock.mock.calls[0][0]).toEndWith('/reply-message');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ messageId: 'prior' });
  });
  test('Web document retains filename and quote', async () => {
    await new ZapiClient(web).send({
      to: '5511999999999',
      replyTo: 'prior',
      content: { type: 'document', mediaUrl: 'https://example.com/a.pdf', filename: 'a.pdf' },
    });
    expect(fetchMock.mock.calls[0][0]).toEndWith('/send-document/pdf');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      document: 'https://example.com/a.pdf',
      fileName: 'a.pdf',
      messageId: 'prior',
    });
  });
  test('Web base64 image becomes a vendor data URI', async () => {
    await new ZapiClient(web).send({
      to: '5511999999999',
      content: { type: 'image', mimeType: 'image/png', caption: 'image' },
      metadata: { base64: 'aGVsbG8=' },
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).image).toBe('data:image/png;base64,aGVsbG8=');
  });
  test('invalid base64 and MIME mismatch never reach the vendor', async () => {
    for (const [base64, mimeType] of [
      ['invalid!', 'image/png'],
      ['aGVsbG8=', 'audio/mp3'],
    ]) {
      await expect(
        new ZapiClient(web).send({ to: '5511999999999', content: { type: 'image', mimeType }, metadata: { base64 } }),
      ).rejects.toThrow();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  test('Web lists follow vendor payload', async () => {
    await new ZapiClient(web).send({
      to: '5511999999999',
      content: {
        type: 'text',
        text: 'Choose',
        buttons: [{ text: 'One', data: 'one' }],
        list: { buttonLabel: 'Choose' },
      },
    });
    expect(fetchMock.mock.calls[0][0]).toEndWith('/send-option-list');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).optionList.options[0].id).toBe('one');
  });
  test('official auth and text wire format', async () => {
    await new ZapiClient(omni).send({ to: '5511999999999@s.whatsapp.net', content: { type: 'text', text: 'Hello' } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.omni.z-api.io/v1/channels/vendor-channel/messages');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${omni.secretKey}`);
    expect(JSON.parse(init.body as string).content).toEqual({ type: 'TEXT', body: { message: 'Hello' } });
  });
  test('official template translated to attachments', async () => {
    const template = { name: 'notice', language: 'pt_BR' };
    await new ZapiClient(omni).send({ to: '5511999999999', content: { type: 'template' }, metadata: { template } });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).content).toEqual({
      type: 'TEMPLATE',
      attachments: [
        { template: { name: 'notice', language: { code: 'pt_BR', policy: 'deterministic' }, components: [] } },
      ],
    });
  });
  test('official buttons are attachments, not body fields', async () => {
    await new ZapiClient(omni).send({
      to: '5511999999999',
      content: { type: 'text', text: 'Choose', buttons: [{ text: 'One', data: 'one' }] },
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).content.attachments).toEqual([{ id: 'one', title: 'One' }]);
  });
  test('unsupported official document does not send', async () => {
    await expect(
      new ZapiClient(omni).send({
        to: '5511999999999',
        content: { type: 'document', mediaUrl: 'https://example.com/a.pdf' },
      }),
    ).rejects.toThrow('not enabled');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  test('unknown network result is non-retryable and redacts credential URL', async () => {
    fetchMock.mockImplementation(async () => {
      throw new Error(`socket ${web.instanceToken}`);
    });
    try {
      await new ZapiClient(web).send({ to: '5511999999999', content: { type: 'text', text: 'Hello' } });
      throw new Error('expected error');
    } catch (e) {
      expect((e as { channelCode: string }).channelCode).toBe('ZAPI_DELIVERY_UNKNOWN');
      expect((e as { retryable: boolean }).retryable).toBe(false);
      expect(String(e)).not.toContain(web.instanceToken);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  test('429 may retry, 5xx cannot blindly retry', async () => {
    for (const status of [429, 503]) {
      fetchMock.mockImplementation(async () => new Response('error', { status }));
      try {
        await new ZapiClient(web).send({ to: '5511999999999', content: { type: 'text', text: 'Hello' } });
        throw new Error('expected');
      } catch (e) {
        expect((e as { retryable: boolean }).retryable).toBe(status === 429);
      }
    }
  });
  test('malformed success cannot fabricate a message ID', async () => {
    fetchMock.mockImplementation(async () => ok({}));
    await expect(
      new ZapiClient(web).send({ to: '5511999999999', content: { type: 'text', text: 'Hello' } }),
    ).rejects.toThrow();
  });
  test('LID and group identity remain distinct; official phone-only', () => {
    expect(recipient('123456789@lid')).toBe('123456789@lid');
    expect(recipient('123456789-1@g.us')).toBe('123456789-1-group');
    expect(recipient('120363019502650977-group')).toBe('120363019502650977-group');
    expect(() => recipient('123456789@lid', true)).toThrow();
    expect(() => recipient('abc')).toThrow();
  });
});
describe('signed webhooks and normalization', () => {
  test('canonical HMAC accepts original bytes, rejects edits, old signatures and missing key', () => {
    const raw = JSON.stringify(omniInbound);
    const headers = signed(raw);
    expect(verifyOmniSignature(Buffer.from(raw), headers, omni.signingSecret)).toBe(true);
    expect(verifyOmniSignature(Buffer.from(`${raw} `), headers, omni.signingSecret)).toBe(false);
    expect(verifyOmniSignature(Buffer.from(raw), signed(raw, 1), omni.signingSecret)).toBe(false);
    headers.delete('x-idempotency-key');
    expect(verifyOmniSignature(Buffer.from(raw), headers, omni.signingSecret)).toBe(false);
  });
  test('gzip signs decompressed bytes and decompression is bounded', async () => {
    const raw = JSON.stringify(omniInbound);
    const headers = signed(raw);
    headers.set('content-encoding', 'gzip');
    const body = await readBody(new Request('https://example.com', { method: 'POST', headers, body: gzipSync(raw) }));
    expect(verifyOmniSignature(body, headers, omni.signingSecret)).toBe(true);
    await expect(
      readBody(
        new Request('https://example.com', { method: 'POST', headers, body: gzipSync('a'.repeat(3 * 1024 * 1024)) }),
      ),
    ).rejects.toThrow();
  });
  test('cross-instance/channel payloads fail', () => {
    expect(() => normalizeWeb(inbound, 'other')).toThrow();
    expect(() => normalizeOmni(omniInbound, 'other')).toThrow();
  });
  test('unknown Web content retains raw data', () => {
    const events = normalizeWeb({ ...inbound, text: undefined, poll: { question: 'Q' } }, web.instanceId);
    expect(events[0]).toMatchObject({
      type: 'received',
      content: { type: 'unknown' },
      raw: { poll: { question: 'Q' } },
    });
  });
  test('outbound echo never becomes inbound', () => {
    expect(normalizeWeb({ ...inbound, fromMe: true }, web.instanceId)[0]?.type).toBe('sent');
  });
  test('DeliveryCallback is not recipient delivery', () => {
    expect(normalizeWeb({ ...inbound, type: 'DeliveryCallback' }, web.instanceId)).toEqual([]);
    expect(
      normalizeWeb({ ...inbound, type: 'MessageStatusCallback', status: 'RECEIVED', ids: ['a', 'b'] }, web.instanceId),
    ).toHaveLength(2);
  });
  test('official batch normalizes all messages and status states', () => {
    const outgoing = structuredClone(omniInbound);
    outgoing.message.metadata.from_me = true;
    (outgoing.message.contents[0] as Record<string, unknown>).state_items = [
      { moment: 1780000000010, state: { name: 'READ' } },
    ];
    const events = normalizeOmni([omniInbound, outgoing], omni.channelId);
    expect(events.map((e) => e.type)).toEqual(['received', 'sent', 'read']);
  });
});

function harness() {
  const published: Array<{ type: string; payload: unknown }> = [];
  const keys = new Map<string, string>();
  const stored = new Map<string, unknown>();
  const context = {
    eventBus: {
      publish: async (type: string, payload: unknown) => {
        published.push({ type, payload });
        return { id: 'evt', sequence: 1, stream: 'test' };
      },
    },
    logger: {
      info() {},
      debug() {},
      warn() {},
      error() {},
      child() {
        return this;
      },
    },
    storage: {
      get: async (k: string) => stored.get(k) ?? null,
      set: async (k: string, v: unknown) => {
        stored.set(k, v);
      },
    },
    config: {
      env: 'development',
      apiBaseUrl: 'https://example.com',
      webhookBaseUrl: 'https://example.com',
      mediaStorage: { type: 'local', basePath: '/test' },
    },
    db: { execute: async () => [], getDrizzle: () => null },
    ingressClaim: {
      claim: async (p: { idempotencyKey: string }) => {
        if (keys.has(p.idempotencyKey)) return null;
        const id = crypto.randomUUID();
        keys.set(p.idempotencyKey, id);
        return id;
      },
      release: async (id: string) => {
        for (const [k, v] of keys) if (v === id) keys.delete(k);
      },
    },
  } as unknown as PluginContext;
  return { context, published };
}
describe('plugin lifecycle and ACK durability', () => {
  test('auth failure, tenant mismatch, dedupe and reconnect', async () => {
    fetchMock.mockImplementation(async () => ok({ connected: true }));
    const h = harness();
    const plugin = new ZapiWebPlugin();
    await plugin.initialize(h.context);
    await plugin.connect('local', { instanceId: 'local', credentials: {}, options: { zapiConfig: web } });
    const url = `https://example.com/api/v2/channels/zapi-web/local/webhook?token=${web.webhookToken}`;
    const send = (payload: unknown, requestUrl = url) =>
      plugin.handleWebhook(new Request(requestUrl, { method: 'POST', body: JSON.stringify(payload) }));
    expect((await send(inbound, url.replace(web.webhookToken, 'bad'))).status).toBe(401);
    expect((await send({ ...inbound, instanceId: 'other' })).status).toBe(400);
    expect((await send(inbound)).status).toBe(200);
    expect((await send(inbound)).status).toBe(200);
    expect(h.published.filter((e) => e.type === 'message.received')).toHaveLength(1);
    await plugin.disconnect('local');
    expect((await send(inbound)).status).toBe(404);
    await plugin.connect('local', { instanceId: 'local', credentials: {}, options: { zapiConfig: web } });
    expect((await send(inbound)).status).toBe(200);
    expect(h.published.filter((e) => e.type === 'message.received')).toHaveLength(1);
    await plugin.destroy();
  });
  test('failed publish returns 503 and releases claim for retry', async () => {
    fetchMock.mockImplementation(async () => ok({ connected: true }));
    const h = harness();
    const plugin = new ZapiWebPlugin();
    await plugin.initialize(h.context);
    await plugin.connect('local', { instanceId: 'local', credentials: {}, options: { zapiConfig: web } });
    const pub = spyOn(h.context.eventBus, 'publish').mockRejectedValueOnce(new Error('offline'));
    const req = () =>
      new Request(`https://example.com/api/v2/channels/zapi-web/local/webhook?token=${web.webhookToken}`, {
        method: 'POST',
        body: JSON.stringify(inbound),
      });
    expect((await plugin.handleWebhook(req())).status).toBe(503);
    expect((await plugin.handleWebhook(req())).status).toBe(200);
    pub.mockRestore();
    await plugin.destroy();
  });
  test('driver mismatch cannot reuse credentials', async () => {
    const h = harness();
    const plugin = new ZapiWebPlugin();
    await plugin.initialize(h.context);
    await expect(
      plugin.connect('local', { instanceId: 'local', credentials: {}, options: { zapiConfig: omni } }),
    ).rejects.toThrow('driver mismatch');
    await plugin.destroy();
  });
});

describe('Z-API complete messaging journey', () => {
  test('Web QR becomes a QR state and read receipts use explicit IDs', async () => {
    fetchMock.mockImplementation((async (url: string) =>
      ok(
        url.endsWith('/status') ? { connected: false } : { value: 'data:image/png;base64,aGVsbG8=' },
      )) as unknown as typeof fetch);
    const h = harness();
    const plugin = new ZapiWebPlugin();
    await plugin.initialize(h.context);
    await plugin.connect('local', { instanceId: 'local', credentials: {}, options: { zapiConfig: web } });
    expect((await plugin.getStatus('local')).state).toBe('qr');
    expect(h.published.some((e) => e.type === 'instance.qr_code')).toBe(true);
    fetchMock.mockImplementation(async () => new Response(null, { status: 204 }));
    const beforeRead = fetchMock.mock.calls.length;
    await plugin.markAsRead('local', '5511999999999', ['one'], undefined, 'off');
    await plugin.markAsRead('local', '5511999999999', ['one'], undefined, 'exclude-self');
    expect(fetchMock.mock.calls.length).toBe(beforeRead);
    await plugin.markAsRead('local', '5511999999999', ['one', 'two']);
    expect(
      fetchMock.mock.calls
        .slice(-2)
        .map((call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string).messageId),
    ).toEqual(['one', 'two']);
    await expect(plugin.markAsRead('local', '5511999999999', ['all'])).rejects.toThrow('Explicit');
    await plugin.unreact('local', '5511999999999', 'one', '❤️');
    expect(fetchMock.mock.calls.at(-1)?.[0]).toEndWith('/send-remove-reaction');
    await plugin.destroy();
  });
  test('reaction callbacks publish reaction facts rather than trigger an agent message', async () => {
    fetchMock.mockImplementation(async () => ok({ connected: true }));
    const h = harness();
    const plugin = new ZapiWebPlugin();
    await plugin.initialize(h.context);
    await plugin.connect('local', { instanceId: 'local', credentials: {}, options: { zapiConfig: web } });
    const body = {
      ...inbound,
      reaction: { value: '❤️', reactionBy: inbound.phone, referencedMessage: { messageId: 'target' } },
    };
    const req = () =>
      new Request(`https://example.com/api/v2/channels/zapi-web/local/webhook?token=${web.webhookToken}`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    expect((await plugin.handleWebhook(req())).status).toBe(200);
    expect((await plugin.handleWebhook(req())).status).toBe(200);
    expect(h.published.filter((e) => e.type === 'reaction.received')).toHaveLength(1);
    expect(h.published.filter((e) => e.type === 'message.received')).toHaveLength(0);
    await plugin.destroy();
  });
  test('a vendor-accepted send followed by journal failure cannot invite a duplicate send', async () => {
    fetchMock.mockImplementation(async () => ok({ connected: true }));
    const h = harness();
    const plugin = new ZapiWebPlugin();
    await plugin.initialize(h.context);
    await plugin.connect('local', { instanceId: 'local', credentials: {}, options: { zapiConfig: web } });
    fetchMock.mockImplementation(async () => ok({ messageId: 'accepted' }));
    const pub = spyOn(h.context.eventBus, 'publish').mockRejectedValueOnce(new Error('offline'));
    const result = await plugin.sendMessage('local', { to: inbound.phone, content: { type: 'text', text: 'Hello' } });
    expect(result).toMatchObject({ success: false, retryable: false, error: 'ZAPI_DELIVERY_UNKNOWN' });
    expect(fetchMock.mock.calls.filter((call: unknown[]) => String(call[0]).endsWith('/send-text'))).toHaveLength(1);
    pub.mockRestore();
    await plugin.destroy();
  });
  test('templates preserve body variables and primary inbound attachment', async () => {
    await new ZapiClient(omni).send({
      to: inbound.phone,
      content: { type: 'template' },
      metadata: { template: { name: 'notice', language: 'pt_BR', bodyParameters: ['Kelvin'] } },
    });
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.content.attachments[0].template.components[0]).toEqual({
      type: 'body',
      parameters: [{ type: 'text', text: 'Kelvin' }],
    });
    const raw = {
      ...omniInbound,
      message: { ...omniInbound.message, attachments: [{ type: 'IMAGE', url: 'https://example.com/photo.jpg' }] },
    };
    expect(normalizeOmni(raw, omni.channelId)[0]).toMatchObject({
      content: { type: 'image', mediaUrl: 'https://example.com/photo.jpg', text: 'Olá' },
    });
  });
});

test('vendor group IDs round-trip through a canonical group chat and retain participant identity', async () => {
  const payload = { ...inbound, phone: '120363019502650977-group', isGroup: true, participantPhone: '5511888888888' };
  expect(normalizeWeb(payload, web.instanceId)[0]).toMatchObject({
    chatId: '120363019502650977@g.us',
    from: '5511888888888',
  });
  await new ZapiClient(web).send({ to: '120363019502650977@g.us', content: { type: 'text', text: 'Group reply' } });
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).phone).toBe('120363019502650977-group');
});
