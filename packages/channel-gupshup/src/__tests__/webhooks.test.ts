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
import * as fs from 'node:fs';
import * as path from 'node:path';
import { handleGupshupWebhook } from '../handlers/webhooks';
import { GUPSHUP_WEBHOOK_METRIC } from '../observability';
import type { GupshupPlugin } from '../plugin';

// ─────────────────────────────────────────────────────────────
// Real-payload fixture loader (#505)
// ─────────────────────────────────────────────────────────────
//
// Fixtures live in ./fixtures/*.json and mirror the shape of raw Gupshup
// webhook bodies observed in production, with PII (phones, wamids, names)
// scrubbed to deterministic placeholders.

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function loadFixtureText(name: string): string {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8');
}

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
        name: { formatted_name: 'Example Contact', first_name: 'Example', last_name: 'Contact' },
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
    expect(raw.payload.contacts[0]?.name.formatted_name).toBe('Example Contact');
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
    rawPayload?: Record<string, unknown>;
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
      rawPayload?: Record<string, unknown>;
    }) => {
      received.push({
        instanceId: params.instanceId,
        externalId: params.externalId,
        from: params.from,
        content: params.content,
        rawPayload: params.rawPayload,
      });
    },
  } as unknown as GupshupPlugin;

  return { plugin, logs, received };
}

function makeWebhookRequest(payload: Record<string, unknown> | string, headers: Record<string, string> = {}): Request {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return new Request('https://example.com/api/v2/channels/gupshup/inst-gs-handler/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body,
  });
}

function findMetricLogs(logs: HandlerLogCall[]) {
  return logs.filter((l) => l.data?.metric === GUPSHUP_WEBHOOK_METRIC);
}

describe('handleGupshupWebhook — event_type routing against real fixtures (#503, #505)', () => {
  it('processes async_response text message end-to-end (post-2026-04-22 cutover)', async () => {
    const { plugin, logs, received } = makeHandlerHarness();
    const dedupeCache = createInboundDedupeCache();

    const response = await handleGupshupWebhook(
      makeWebhookRequest(loadFixtureText('async_response-text.json')),
      plugin,
      'inst-gs-handler',
      undefined,
      dedupeCache,
    );

    expect(response.status).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0]?.externalId).toBe('wamid.TEST_ASYNC_RESPONSE_TEXT_001');
    expect(received[0]?.content.text).toBe('Boa noite, gostaria de contratar um plano');
    expect(logs.filter((l) => l.level === 'warn' && l.message.includes('unknown event_type'))).toHaveLength(0);
  });

  it('maps inbound KHAL session headers and Gupshup context into rawPayload', async () => {
    const { plugin, received } = makeHandlerHarness();
    const dedupeCache = createInboundDedupeCache();

    const response = await handleGupshupWebhook(
      makeWebhookRequest(loadFixtureText('async_response-text.json'), { 'x-khal-session-id': 'khal-session-abc' }),
      plugin,
      'inst-gs-handler',
      undefined,
      dedupeCache,
    );

    expect(response.status).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0]?.rawPayload?.khalSessionId).toBe('khal-session-abc');
    expect((received[0]?.rawPayload?.headers as Record<string, string> | undefined)?.['x-khal-session-id']).toBe(
      'khal-session-abc',
    );
    expect(received[0]?.rawPayload?.threadId).toBe('5521900000002');
  });

  it('processes user_input text message (legacy format regression guard)', async () => {
    const { plugin, logs, received } = makeHandlerHarness();
    const dedupeCache = createInboundDedupeCache();

    const response = await handleGupshupWebhook(
      makeWebhookRequest(loadFixtureText('user_input-text.json')),
      plugin,
      'inst-gs-handler',
      undefined,
      dedupeCache,
    );

    expect(response.status).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0]?.externalId).toBe('wamid.TEST_USER_INPUT_TEXT_001');
    expect(received[0]?.content.text).toBe('Oi');
    expect(logs.filter((l) => l.level === 'warn' && l.message.includes('unknown event_type'))).toHaveLength(0);
  });

  it('processes click_to_chat_advertise text message from paid ads', async () => {
    const { plugin, logs, received } = makeHandlerHarness();
    const dedupeCache = createInboundDedupeCache();

    const response = await handleGupshupWebhook(
      makeWebhookRequest(loadFixtureText('click_to_chat_advertise.json')),
      plugin,
      'inst-gs-handler',
      undefined,
      dedupeCache,
    );

    expect(response.status).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0]?.externalId).toBe('wamid.TEST_CTCA_001');
    expect(logs.filter((l) => l.level === 'warn' && l.message.includes('unknown event_type'))).toHaveLength(0);
  });

  it('processes async_response audio message (current format media)', async () => {
    const { plugin, logs, received } = makeHandlerHarness();
    const dedupeCache = createInboundDedupeCache();

    const response = await handleGupshupWebhook(
      makeWebhookRequest(loadFixtureText('async_response-audio.json')),
      plugin,
      'inst-gs-handler',
      undefined,
      dedupeCache,
    );

    expect(response.status).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0]?.externalId).toBe('wamid.TEST_ASYNC_RESPONSE_AUDIO_001');
    expect(received[0]?.content.type).toBe('audio');
    expect(logs.filter((l) => l.level === 'warn' && l.message.includes('unknown event_type'))).toHaveLength(0);
  });

  it('ignores message_event delivery receipt (no processInboundMessage call)', async () => {
    const { plugin, logs, received } = makeHandlerHarness();
    const dedupeCache = createInboundDedupeCache();

    const response = await handleGupshupWebhook(
      makeWebhookRequest(loadFixtureText('message_event-delivery.json')),
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

  it('ignores billing_event (no processInboundMessage call)', async () => {
    const { plugin, received } = makeHandlerHarness();
    const dedupeCache = createInboundDedupeCache();

    const response = await handleGupshupWebhook(
      makeWebhookRequest(loadFixtureText('billing_event.json')),
      plugin,
      'inst-gs-handler',
      undefined,
      dedupeCache,
    );

    expect(response.status).toBe(200);
    expect(received).toHaveLength(0);
  });

  it('processes + WARNs on unknown event_type (fail-open for format drift)', async () => {
    const { plugin, logs, received } = makeHandlerHarness();
    const dedupeCache = createInboundDedupeCache();
    // Mutate async_response fixture to an unseen event_type to simulate a future Gupshup format.
    const mutated = loadFixtureText('async_response-text.json').replace(/"async_response"/g, '"v3_future_format"');

    const response = await handleGupshupWebhook(
      makeWebhookRequest(mutated),
      plugin,
      'inst-gs-handler',
      undefined,
      dedupeCache,
    );

    expect(response.status).toBe(200);
    expect(received).toHaveLength(1);
    const warn = logs.find((l) => l.level === 'warn' && l.message.includes('unknown event_type'));
    expect(warn).toBeDefined();
    expect(warn?.data?.event_type).toBe('v3_future_format');
    expect(warn?.data?.messageType).toBe('text');
  });

  it('handles Gupshup Request Builder double-encoding envelope (unescaped inner quotes)', async () => {
    const { plugin, received } = makeHandlerHarness();
    const dedupeCache = createInboundDedupeCache();
    // Gupshup Request Builder produces an outer body whose "gupshupPayload" value
    // is raw (not JSON-escaped), so the full string is not valid JSON. The handler
    // strips the wrapper by string match instead of JSON.parse.
    const inner = loadFixtureText('async_response-text.json').trim();
    const wrapped = `{"gupshupPayload":"${inner}"}`;

    const response = await handleGupshupWebhook(
      makeWebhookRequest(wrapped),
      plugin,
      'inst-gs-handler',
      undefined,
      dedupeCache,
    );

    expect(response.status).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0]?.externalId).toBe('wamid.TEST_ASYNC_RESPONSE_TEXT_001');
  });
});

// ─────────────────────────────────────────────────────────────
// Observability — metric emission + first-seen WARN (#504)
// ─────────────────────────────────────────────────────────────

describe('handleGupshupWebhook — observability signals (#504)', () => {
  it('emits gupshup.webhook.received{handled=processed} on happy path', async () => {
    const { plugin, logs } = makeHandlerHarness();
    const dedupeCache = createInboundDedupeCache();

    await handleGupshupWebhook(
      makeWebhookRequest(loadFixtureText('async_response-text.json')),
      plugin,
      'inst-gs-handler',
      undefined,
      dedupeCache,
    );

    const metrics = findMetricLogs(logs);
    expect(metrics).toHaveLength(1);
    const dims = metrics[0]?.data?.dimensions as Record<string, unknown>;
    expect(dims.handled).toBe('processed');
    expect(dims.event_type).toBe('async_response');
    expect(dims.instanceId).toBe('inst-gs-handler');
  });

  it('emits gupshup.webhook.received{handled=dropped_known_non_message} for denylisted events', async () => {
    const { plugin, logs } = makeHandlerHarness();
    const dedupeCache = createInboundDedupeCache();

    await handleGupshupWebhook(
      makeWebhookRequest(loadFixtureText('message_event-delivery.json')),
      plugin,
      'inst-gs-handler',
      undefined,
      dedupeCache,
    );

    const metrics = findMetricLogs(logs);
    expect(metrics).toHaveLength(1);
    const dims = metrics[0]?.data?.dimensions as Record<string, unknown>;
    expect(dims.handled).toBe('dropped_known_non_message');
    expect(dims.event_type).toBe('message_event');
  });

  it('emits gupshup.webhook.received{handled=dropped_unknown_fail_open} for unknown event_types', async () => {
    const { plugin, logs } = makeHandlerHarness();
    const dedupeCache = createInboundDedupeCache();
    const mutated = loadFixtureText('async_response-text.json').replace(/"async_response"/g, '"v3_future_format"');

    await handleGupshupWebhook(makeWebhookRequest(mutated), plugin, 'inst-gs-handler', undefined, dedupeCache);

    const metrics = findMetricLogs(logs);
    expect(metrics).toHaveLength(1);
    const dims = metrics[0]?.data?.dimensions as Record<string, unknown>;
    expect(dims.handled).toBe('dropped_unknown_fail_open');
    expect(dims.event_type).toBe('v3_future_format');
  });

  it('emits gupshup.webhook.received{handled=dropped_unrecognized_shape} for schema failures', async () => {
    const { plugin, logs } = makeHandlerHarness();
    const dedupeCache = createInboundDedupeCache();
    const broken = JSON.stringify({ event_type: 'user_input', missing_everything: true });

    await handleGupshupWebhook(makeWebhookRequest(broken), plugin, 'inst-gs-handler', undefined, dedupeCache);

    const metrics = findMetricLogs(logs);
    expect(metrics).toHaveLength(1);
    const dims = metrics[0]?.data?.dimensions as Record<string, unknown>;
    expect(dims.handled).toBe('dropped_unrecognized_shape');
  });

  it('first-seen event_type WARN fires once per process per value', async () => {
    const { plugin, logs } = makeHandlerHarness();
    const dedupeCache = createInboundDedupeCache();
    // Use a sentinel value unlikely to collide with other tests in the same process.
    const sentinel = `first_seen_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const mutated = loadFixtureText('async_response-text.json').replace(/"async_response"/g, `"${sentinel}"`);

    await handleGupshupWebhook(makeWebhookRequest(mutated), plugin, 'inst-gs-handler', undefined, dedupeCache);
    // Re-run with a different wamid so dedupe doesn't fire, but same event_type.
    const second = mutated.replace(/TEST_ASYNC_RESPONSE_TEXT_001/g, 'TEST_ASYNC_RESPONSE_TEXT_002');
    await handleGupshupWebhook(makeWebhookRequest(second), plugin, 'inst-gs-handler', undefined, dedupeCache);

    const firstSeenWarns = logs.filter(
      (l) =>
        l.level === 'warn' &&
        l.message.includes('first time seeing this event_type') &&
        l.data?.event_type === sentinel,
    );
    expect(firstSeenWarns).toHaveLength(1);
    expect(firstSeenWarns[0]?.data?.knownMessage).toBe(false);
    expect(firstSeenWarns[0]?.data?.knownNonMessage).toBe(false);
  });
});
