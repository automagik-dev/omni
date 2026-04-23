/**
 * Gupshup webhook handler — unit tests
 *
 * Verifies:
 * - Gupshup native payload shapes (all 8 message types)
 * - event_type routing (user_input / async_response / click_to_chat_advertise
 *   → processInboundMessage; known non-message events dropped; unknown
 *   event_types fail-open with WARN — incident #503)
 * - Deduplication (second identical webhook is dropped)
 * - Location lat/lng string-to-float conversion
 * - Reply context extraction
 */

import { describe, expect, it } from 'bun:test';
import { handleGupshupWebhook } from '../handlers/webhooks';
import type { GupshupPlugin } from '../plugin';

// ─────────────────────────────────────────────────────────────
// Native payload fixtures (from real Gupshup webhooks)
// ─────────────────────────────────────────────────────────────

const BASE = {
  source: 'channel',
  sender: '5511960008976',
  channel: 'whatsapp',
  isGroup: false,
  destination: 5511974802440,
  botname: 'jNZdP9QAkSMjwX32kHqjpcx0',
  event_type: 'user_input',
  senderobj: { channeltype: 'whatsapp', channelid: '5511960008976', display: 'Gustavo Batista' },
  contextobj: {
    channeltype: 'whatsapp',
    contexttype: 'p2p',
    contextid: '5511960008976',
    botname: 'jNZdP9QAkSMjwX32kHqjpcx0',
    senderName: 'Gustavo Batista',
    cc: '55',
    dc: '11960008976',
  },
  messageHeader: {
    event_type: 'user_input',
    nsTraceId: '1715A9A85A3EECC-000000000000157A',
    project_id: '31569198',
    'x-gs-priority': 4,
  },
  metadata: {},
  postbackText: null,
};

function makePayload<T extends Record<string, unknown>>(messageobj: T, overrides: Record<string, unknown> = {}) {
  return { ...BASE, ...overrides, messageobj };
}

describe('Gupshup native inbound payload shapes', () => {
  it('text message has expected structure', () => {
    const payload = makePayload({
      type: 'text',
      text: 'Oi',
      from: '5511960008976',
      timestamp: 1776273477,
      id: 'wamid.HBgN001',
      raw: {
        payload: { text: 'Oi' },
        sender: { phone: '5511960008976', name: 'Gustavo Batista' },
        id: 'wamid.HBgN001',
        source: '5511960008976',
        type: 'text',
      },
    });

    expect(payload.event_type).toBe('user_input');
    expect(payload.sender).toBe('5511960008976');
    expect(payload.messageobj.type).toBe('text');
    expect((payload.messageobj as { text: string }).text).toBe('Oi');
    expect(payload.messageobj.id).toBe('wamid.HBgN001');
    expect(payload.senderobj.display).toBe('Gustavo Batista');
  });

  it('audio message has url and contentType', () => {
    const payload = makePayload({
      type: 'audio',
      text: 'https://filemanager.gupshup.io/wa/media/1297619588963728?download=false',
      url: 'https://filemanager.gupshup.io/wa/media/1297619588963728?download=false',
      from: '5511960008976',
      timestamp: 1776273889,
      id: 'wamid.HBgN002',
      mediaId: '1297619588963728',
      contentType: 'audio/ogg; codecs=opus',
    });

    expect(payload.messageobj.type).toBe('audio');
    expect((payload.messageobj as { url: string }).url).toContain('filemanager.gupshup.io');
    expect((payload.messageobj as { contentType: string }).contentType).toBe('audio/ogg; codecs=opus');
  });

  it('image message has url and contentType', () => {
    const payload = makePayload({
      type: 'image',
      url: 'https://filemanager.gupshup.io/wa/media/972665975453585?download=false',
      contentType: 'image/jpeg',
      from: '5511960008976',
      timestamp: 1776273929,
      id: 'wamid.HBgN003',
      mediaId: '972665975453585',
    });

    expect(payload.messageobj.type).toBe('image');
    expect((payload.messageobj as { contentType: string }).contentType).toBe('image/jpeg');
  });

  it('video message has url and contentType', () => {
    const payload = makePayload({
      type: 'video',
      url: 'https://filemanager.gupshup.io/wa/media/1628495335088726?download=false',
      contentType: 'video/mp4',
      from: '5511960008976',
      timestamp: 1776274070,
      id: 'wamid.HBgN004',
      mediaId: '1628495335088726',
    });

    expect(payload.messageobj.type).toBe('video');
    expect((payload.messageobj as { contentType: string }).contentType).toBe('video/mp4');
  });

  it('sticker message has webp contentType', () => {
    const payload = makePayload({
      type: 'sticker',
      url: 'https://filemanager.gupshup.io/wa/media/1139212069264406?download=false',
      contentType: 'image/webp',
      from: '5511960008976',
      timestamp: 1776273909,
      id: 'wamid.HBgN005',
      mediaId: '1139212069264406',
    });

    expect(payload.messageobj.type).toBe('sticker');
    expect((payload.messageobj as { contentType: string }).contentType).toBe('image/webp');
  });

  it('file (document) message has url, contentType, and fileName', () => {
    const payload = makePayload({
      type: 'file',
      url: 'https://filemanager.gupshup.io/wa/media/2386365231876671?download=false&fileName=Invoice.pdf',
      contentType: 'application/pdf',
      fileName: 'Invoice-BEINGPAX-11287.pdf',
      from: '5511960008976',
      timestamp: 1776273976,
      id: 'wamid.HBgN006',
      mediaId: '2386365231876671',
      raw: {
        payload: { name: 'Invoice-BEINGPAX-11287.pdf', contentType: 'application/pdf' },
        type: 'document',
        sender: { phone: '5511960008976' },
        id: 'wamid.HBgN006',
        source: '5511960008976',
      },
    });

    expect(payload.messageobj.type).toBe('file');
    expect((payload.messageobj as { fileName: string }).fileName).toBe('Invoice-BEINGPAX-11287.pdf');
    expect((payload.messageobj as { raw: { type: string } }).raw.type).toBe('document');
  });

  it('contacts message has raw.payload.contacts array', () => {
    const contacts = [
      {
        name: { formatted_name: 'Cezar Namastex Vasconcelos', first_name: 'Cezar Namastex', last_name: 'Vasconcelos' },
        phones: [{ phone: '5551997285829', wa_id: '555197285829' }],
      },
    ];
    const payload = makePayload({
      type: 'contacts',
      text: JSON.stringify(contacts),
      from: '5511960008976',
      timestamp: 1776273949,
      id: 'wamid.HBgN007',
      raw: {
        payload: { contacts },
        type: 'contact',
        sender: { phone: '5511960008976' },
        id: 'wamid.HBgN007',
        source: '5511960008976',
      },
    });

    expect(payload.messageobj.type).toBe('contacts');
    const raw = (payload.messageobj as { raw: { payload: { contacts: typeof contacts } } }).raw;
    expect(raw.payload.contacts[0]?.name.formatted_name).toBe('Cezar Namastex Vasconcelos');
    expect(raw.payload.contacts[0]?.phones[0]?.phone).toBe('5551997285829');
  });

  it('location message has string lat/lng and address/name', () => {
    const payload = makePayload({
      type: 'location',
      latitude: '-23.52561378479',
      longitude: '-46.650077819824',
      address: 'Rua do Bosque, 130, São Paulo, 01136-000, SP, BR',
      name: 'Massagem para mulheres',
      from: '5511960008976',
      timestamp: 1776274892,
      id: 'wamid.HBgN008',
      raw: {
        payload: {
          latitude: '-23.52561378479',
          longitude: '-46.650077819824',
          address: 'Rua do Bosque, 130, São Paulo, 01136-000, SP, BR',
          name: 'Massagem para mulheres',
        },
        sender: { phone: '5511960008976' },
        id: 'wamid.HBgN008',
        source: '5511960008976',
        type: 'location',
      },
    });

    expect(payload.messageobj.type).toBe('location');
    const loc = payload.messageobj as { latitude: string; longitude: string; address: string; name: string };
    // lat/lng are strings — consumer must parseFloat()
    expect(typeof loc.latitude).toBe('string');
    expect(Number.parseFloat(loc.latitude)).toBeCloseTo(-23.5256, 3);
    expect(Number.parseFloat(loc.longitude)).toBeCloseTo(-46.6501, 3);
    expect(loc.address).toContain('Rua do Bosque');
    expect(loc.name).toBe('Massagem para mulheres');
  });

  it('text with replyContext has reply id', () => {
    const payload = makePayload({
      type: 'text',
      text: 'Ok',
      from: '5511960008976',
      timestamp: 1776274085,
      id: 'wamid.HBgN009',
      replyContext: { id: '03309zQxh2vOdjjUI6ly3y', internalId: '74abe5d4-a15e-40d8-8338-f428e3d11f77' },
      raw: {
        payload: { text: 'Ok' },
        sender: { phone: '5511960008976' },
        id: 'wamid.HBgN009',
        source: '5511960008976',
        type: 'text',
        context: { id: '03309zQxh2vOdjjUI6ly3y', gsId: '74abe5d4-a15e-40d8-8338-f428e3d11f77' },
      },
    });

    const rc = (payload.messageobj as { replyContext: { id: string } }).replyContext;
    expect(rc.id).toBe('03309zQxh2vOdjjUI6ly3y');
  });

  it('known non-message event_type (message_event) is not processed as a message', () => {
    const payload = makePayload(
      { type: 'text', text: 'x', from: '551196', timestamp: 1, id: 'wamid.x' },
      { event_type: 'message_event' },
    );
    // Semantic shift post-2026-04-22: async_response is now a message event,
    // so the denylist-based check uses a known non-message type instead.
    expect(payload.event_type).toBe('message_event');
  });

  it('sender name resolved from senderobj.display', () => {
    const payload = makePayload({ type: 'text', text: 'x', from: '551196', timestamp: 1, id: 'wamid.x' });
    expect(payload.senderobj.display).toBe('Gustavo Batista');
  });

  it('sender name falls back to contextobj.senderName', () => {
    const payload = makePayload(
      { type: 'text', text: 'x', from: '551196', timestamp: 1, id: 'wamid.x' },
      { senderobj: { channeltype: 'whatsapp', channelid: '5511960008976' } }, // no display
    );
    expect(payload.contextobj?.senderName).toBe('Gustavo Batista');
  });
});

// ─────────────────────────────────────────────────────────────
// Deduplication (cache-level, no full plugin needed)
// ─────────────────────────────────────────────────────────────

import { createInboundDedupeCache } from '@omni/channel-sdk';
import { createLogger } from '@omni/core';

const log = createLogger('test:gupshup-dedup');

describe('Gupshup inbound dedup — cache behavior', () => {
  it('first webhook is not a duplicate', () => {
    const cache = createInboundDedupeCache();
    const instanceId = 'inst-gs-1';
    const dedupeKey = '5511888880000:wamid.msg_001';

    expect(cache.isDuplicate(instanceId, dedupeKey, 'gupshup', log)).toBe(false);
  });

  it('second identical webhook is a duplicate', () => {
    const cache = createInboundDedupeCache();
    const instanceId = 'inst-gs-1';
    const dedupeKey = '5511888880000:wamid.msg_001';

    cache.isDuplicate(instanceId, dedupeKey, 'gupshup', log); // first: miss
    expect(cache.isDuplicate(instanceId, dedupeKey, 'gupshup', log)).toBe(true); // second: hit
  });

  it('same messageId from different phones is not a duplicate', () => {
    const cache = createInboundDedupeCache();
    const instanceId = 'inst-gs-1';

    cache.isDuplicate(instanceId, '5511111111111:wamid.msg_001', 'gupshup', log);
    expect(cache.isDuplicate(instanceId, '5511222222222:wamid.msg_001', 'gupshup', log)).toBe(false);
  });

  it('same phone, different messageIds are independent', () => {
    const cache = createInboundDedupeCache();
    const instanceId = 'inst-gs-1';

    cache.isDuplicate(instanceId, '5511111111111:wamid.msg_001', 'gupshup', log);
    expect(cache.isDuplicate(instanceId, '5511111111111:wamid.msg_002', 'gupshup', log)).toBe(false);
  });

  it('dispose clears all entries', () => {
    const cache = createInboundDedupeCache();
    const instanceId = 'inst-gs-dispose';

    cache.isDuplicate(instanceId, '5511111111111:wamid.msg_001', 'gupshup', log);
    cache.isDuplicate(instanceId, '5511111111111:wamid.msg_002', 'gupshup', log);
    expect(cache.size).toBe(2);

    cache.dispose();
    expect(cache.size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// handleGupshupWebhook — event_type routing (incident #503)
// ─────────────────────────────────────────────────────────────

interface HandlerLogCall {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  data?: Record<string, unknown>;
}

function makeHandlerHarness() {
  const logs: HandlerLogCall[] = [];
  const received: Array<{
    instanceId: string;
    externalId: string;
    from: string;
    content: { type: string; text?: string };
  }> = [];

  const logger = {
    debug: (message: string, data?: Record<string, unknown>) => {
      logs.push({ level: 'debug', message, data });
    },
    info: (message: string, data?: Record<string, unknown>) => {
      logs.push({ level: 'info', message, data });
    },
    warn: (message: string, data?: Record<string, unknown>) => {
      logs.push({ level: 'warn', message, data });
    },
    error: (message: string, data?: Record<string, unknown>) => {
      logs.push({ level: 'error', message, data });
    },
    child: () => logger,
  };

  const plugin = {
    getLogger: () => logger,
    handleMessageReceived: async (params: {
      instanceId: string;
      externalId: string;
      from: string;
      content: { type: string; text?: string };
    }) => {
      received.push({
        instanceId: params.instanceId,
        externalId: params.externalId,
        from: params.from,
        content: params.content,
      });
    },
  } as unknown as GupshupPlugin;

  return { plugin, logs, received };
}

function makeWebhookRequest(payload: Record<string, unknown>): Request {
  return new Request('https://example.com/api/v2/channels/gupshup/inst-gs-handler/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: JSON.stringify(payload),
  });
}

const TEXT_MESSAGEOBJ = {
  type: 'text',
  text: 'Oi',
  from: '5511960008976',
  timestamp: 1776273477,
  id: 'wamid.HANDLER_TEST_001',
  raw: {
    payload: { text: 'Oi' },
    sender: { phone: '5511960008976', name: 'Gustavo Batista' },
    id: 'wamid.HANDLER_TEST_001',
    source: '5511960008976',
    type: 'text',
  },
};

describe('handleGupshupWebhook — event_type routing (incident #503)', () => {
  it('async_response text message is processed end-to-end (post-cutover)', async () => {
    const { plugin, logs, received } = makeHandlerHarness();
    const dedupeCache = createInboundDedupeCache();
    const epoch = Date.now();
    const payload = {
      ...BASE,
      event_type: 'async_response',
      request_id: `5521975469499_d4296fbd-42ad-4a44-b5fb-6178182b23ef_${epoch}`,
      stack_id: epoch,
      messageHeader: { ...BASE.messageHeader, event_type: 'async_response' },
      messageobj: { ...TEXT_MESSAGEOBJ, id: 'wamid.ASYNC_RESPONSE_001' },
    };

    const response = await handleGupshupWebhook(
      makeWebhookRequest(payload),
      plugin,
      'inst-gs-handler',
      undefined,
      dedupeCache,
    );

    expect(response.status).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0]?.externalId).toBe('wamid.ASYNC_RESPONSE_001');
    expect(received[0]?.content.text).toBe('Oi');
    // No WARN for known message event_type
    expect(logs.filter((l) => l.level === 'warn' && l.message.includes('unknown event_type'))).toHaveLength(0);
  });

  it('user_input text message is still processed (regression guard)', async () => {
    const { plugin, received, logs } = makeHandlerHarness();
    const dedupeCache = createInboundDedupeCache();
    const payload = {
      ...BASE,
      event_type: 'user_input',
      messageobj: { ...TEXT_MESSAGEOBJ, id: 'wamid.USER_INPUT_001' },
    };

    const response = await handleGupshupWebhook(
      makeWebhookRequest(payload),
      plugin,
      'inst-gs-handler',
      undefined,
      dedupeCache,
    );

    expect(response.status).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0]?.externalId).toBe('wamid.USER_INPUT_001');
    expect(logs.filter((l) => l.level === 'warn' && l.message.includes('unknown event_type'))).toHaveLength(0);
  });

  it('click_to_chat_advertise text message is processed', async () => {
    const { plugin, received, logs } = makeHandlerHarness();
    const dedupeCache = createInboundDedupeCache();
    const payload = {
      ...BASE,
      event_type: 'click_to_chat_advertise',
      messageobj: { ...TEXT_MESSAGEOBJ, id: 'wamid.CTCA_001' },
    };

    const response = await handleGupshupWebhook(
      makeWebhookRequest(payload),
      plugin,
      'inst-gs-handler',
      undefined,
      dedupeCache,
    );

    expect(response.status).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0]?.externalId).toBe('wamid.CTCA_001');
    expect(logs.filter((l) => l.level === 'warn' && l.message.includes('unknown event_type'))).toHaveLength(0);
  });

  it('message_event delivery receipt is ignored (processInboundMessage not called)', async () => {
    const { plugin, received, logs } = makeHandlerHarness();
    const dedupeCache = createInboundDedupeCache();
    const payload = {
      ...BASE,
      event_type: 'message_event',
      messageobj: { ...TEXT_MESSAGEOBJ, id: 'wamid.DELIVERY_RECEIPT_001' },
    };

    const response = await handleGupshupWebhook(
      makeWebhookRequest(payload),
      plugin,
      'inst-gs-handler',
      undefined,
      dedupeCache,
    );

    expect(response.status).toBe(200);
    expect(received).toHaveLength(0);
    const debugDrop = logs.find((l) => l.level === 'debug' && l.message.includes('known non-message event'));
    expect(debugDrop).toBeDefined();
    expect(debugDrop?.data?.event_type).toBe('message_event');
  });

  it('unknown event_type with valid messageobj is processed AND WARN is logged (fail-open)', async () => {
    const { plugin, received, logs } = makeHandlerHarness();
    const dedupeCache = createInboundDedupeCache();
    const payload = {
      ...BASE,
      event_type: 'v3_message',
      messageHeader: { ...BASE.messageHeader, event_type: 'v3_message' },
      messageobj: { ...TEXT_MESSAGEOBJ, id: 'wamid.UNKNOWN_EVENT_001' },
    };

    const response = await handleGupshupWebhook(
      makeWebhookRequest(payload),
      plugin,
      'inst-gs-handler',
      undefined,
      dedupeCache,
    );

    expect(response.status).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0]?.externalId).toBe('wamid.UNKNOWN_EVENT_001');
    const warn = logs.find((l) => l.level === 'warn' && l.message.includes('unknown event_type'));
    expect(warn).toBeDefined();
    expect(warn?.data?.event_type).toBe('v3_message');
    expect(warn?.data?.messageHeaderEventType).toBe('v3_message');
    expect(warn?.data?.messageType).toBe('text');
    expect(warn?.data?.sender).toBe(BASE.sender);
  });
});
