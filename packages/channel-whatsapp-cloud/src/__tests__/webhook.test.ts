/**
 * WhatsApp Cloud webhook handler — unit tests.
 *
 * Covers the Group 4 contract:
 *   - GET verify-challenge handshake (200 + body | 403).
 *   - POST X-Hub-Signature-256 verification (401 on mismatch).
 *   - End-to-end emission of `message.received` for text inbound.
 *   - Status update routing to `message.delivered` (+ similar for read/failed).
 *   - Unknown `phone_number_id` is silently ack'd 200 (never 4xx — Meta
 *     disables the app after repeated 4xx).
 *   - Idempotency via `wamid` dedupe cache — re-posting the same wamid emits
 *     only once.
 *
 * The plugin is stubbed via a friend-style cast so we can intercept every
 * emit* call without standing up NATS or the full plugin lifecycle.
 */

import { describe, expect, test } from 'bun:test';
import { createInboundDedupeCache } from '@omni/channel-sdk';

import { handleMetaWebhook, handleVerifyChallenge } from '../handlers/webhook';
import type { WhatsAppCloudPlugin } from '../plugin';

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

const APP_SECRET = 'test-app-secret-1234567890abcdef';
const VERIFY_TOKEN = 'test-verify-token-xyz';

interface EmitCall {
  method: string;
  params: Record<string, unknown>;
}

interface LogCall {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  data?: Record<string, unknown>;
}

interface Harness {
  plugin: WhatsAppCloudPlugin;
  emits: EmitCall[];
  logs: LogCall[];
}

/**
 * Build a stub plugin that mimics the WhatsAppCloudPlugin surface required
 * by the webhook handler. All emit* methods just record their calls.
 */
function makeHarness(opts?: {
  phoneNumberId?: string;
  instanceId?: string;
  withInstance?: boolean;
}): Harness {
  const phoneNumberId = opts?.phoneNumberId ?? '107654321987654';
  const instanceId = opts?.instanceId ?? 'inst-wac-1';
  const withInstance = opts?.withInstance ?? true;

  const emits: EmitCall[] = [];
  const logs: LogCall[] = [];

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

  const dedupeCache = createInboundDedupeCache();

  const state = {
    config: { phoneNumberId },
    dedupeCache,
  };

  const stub = {
    id: 'whatsapp-cloud',
    getLogger: () => logger,
    findInstanceByPhoneNumberId: (pid: string) => {
      if (!withInstance) return undefined;
      if (pid !== phoneNumberId) return undefined;
      return [instanceId, state] as const;
    },
    getConnectedInstanceIds: () => (withInstance ? [instanceId] : []),
    // emit* shims — match the protected surface that the sidecar helpers
    // expect. Each one records the call so tests can assert against `emits`.
    emitMessageReceived: async (params: Record<string, unknown>) => {
      emits.push({ method: 'message.received', params });
      return 'evt_corr_id';
    },
    emitMessageSent: async (params: Record<string, unknown>) => {
      emits.push({ method: 'message.sent', params });
    },
    emitMessageDelivered: async (params: Record<string, unknown>) => {
      emits.push({ method: 'message.delivered', params });
    },
    emitMessageRead: async (params: Record<string, unknown>) => {
      emits.push({ method: 'message.read', params });
    },
    emitMessageFailed: async (params: Record<string, unknown>) => {
      emits.push({ method: 'message.failed', params });
    },
    emitReactionReceived: async (params: Record<string, unknown>) => {
      emits.push({ method: 'reaction.received', params });
    },
    emitReactionRemoved: async (params: Record<string, unknown>) => {
      emits.push({ method: 'reaction.removed', params });
    },
    // eventBus stub for template.status_changed (publishEvent path)
    eventBus: {
      publish: async (type: string, payload: Record<string, unknown>) => {
        emits.push({ method: type, params: payload });
        return { id: 'evt-id' };
      },
    },
  };

  return {
    plugin: stub as unknown as WhatsAppCloudPlugin,
    emits,
    logs,
  };
}

/** Compute the X-Hub-Signature-256 header value for a given body + secret. */
async function signBody(body: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  const bytes = new Uint8Array(sig);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i] ?? 0;
    hex += byte.toString(16).padStart(2, '0');
  }
  return `sha256=${hex}`;
}

/** Build a POST Request with body + valid signature header. */
async function makeSignedPost(body: string, secret: string = APP_SECRET): Promise<Request> {
  const sig = await signBody(body, secret);
  return new Request('https://example.com/api/v2/channels/whatsapp-cloud/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': sig,
    },
    body,
  });
}

/** Build a payload envelope around a single change `value`. */
function envelope(
  field: string,
  value: Record<string, unknown>,
  entryId = '107654321987654',
): Record<string, unknown> {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: entryId,
        time: Math.floor(Date.now() / 1000),
        changes: [{ field, value }],
      },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────
// GET verify challenge
// ─────────────────────────────────────────────────────────────────────────

describe('handleVerifyChallenge (GET)', () => {
  test('returns 200 + challenge body for matching verify_token', () => {
    const req = new Request(
      `https://example.com/api/v2/channels/whatsapp-cloud/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=abc123`,
      { method: 'GET' },
    );

    const res = handleVerifyChallenge(req, VERIFY_TOKEN);
    expect(res.status).toBe(200);
    return res.text().then((text) => {
      expect(text).toBe('abc123');
    });
  });

  test('returns 403 when verify_token mismatches', () => {
    const req = new Request(
      `https://example.com/api/v2/channels/whatsapp-cloud/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123`,
      { method: 'GET' },
    );
    const res = handleVerifyChallenge(req, VERIFY_TOKEN);
    expect(res.status).toBe(403);
  });

  test('returns 403 when hub.mode is missing', () => {
    const req = new Request(
      `https://example.com/api/v2/channels/whatsapp-cloud/webhook?hub.verify_token=${VERIFY_TOKEN}&hub.challenge=abc123`,
      { method: 'GET' },
    );
    const res = handleVerifyChallenge(req, VERIFY_TOKEN);
    expect(res.status).toBe(403);
  });

  test('handleMetaWebhook delegates GET to challenge handler', async () => {
    const { plugin } = makeHarness();
    const req = new Request(
      `https://example.com/api/v2/channels/whatsapp-cloud/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=challenge42`,
      { method: 'GET' },
    );
    const res = await handleMetaWebhook(req, plugin, APP_SECRET, VERIFY_TOKEN);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('challenge42');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// POST signature verification
// ─────────────────────────────────────────────────────────────────────────

describe('handleMetaWebhook (POST) — signature verification', () => {
  test('rejects POST without X-Hub-Signature-256 header with 401', async () => {
    const { plugin } = makeHarness();
    const body = JSON.stringify(envelope('messages', { metadata: { phone_number_id: '1' } }));
    const req = new Request('https://example.com/api/v2/channels/whatsapp-cloud/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });

    const res = await handleMetaWebhook(req, plugin, APP_SECRET, VERIFY_TOKEN);
    expect(res.status).toBe(401);
  });

  test('rejects POST with malformed signature with 401', async () => {
    const { plugin } = makeHarness();
    const body = JSON.stringify(envelope('messages', { metadata: { phone_number_id: '1' } }));
    const req = new Request('https://example.com/api/v2/channels/whatsapp-cloud/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': 'not-a-valid-signature',
      },
      body,
    });

    const res = await handleMetaWebhook(req, plugin, APP_SECRET, VERIFY_TOKEN);
    expect(res.status).toBe(401);
  });

  test('rejects POST signed with the wrong secret with 401', async () => {
    const { plugin } = makeHarness();
    const body = JSON.stringify(envelope('messages', { metadata: { phone_number_id: '1' } }));
    const req = await makeSignedPost(body, 'wrong-secret');
    const res = await handleMetaWebhook(req, plugin, APP_SECRET, VERIFY_TOKEN);
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// POST text message → message.received
// ─────────────────────────────────────────────────────────────────────────

describe('handleMetaWebhook (POST) — inbound messages', () => {
  test('valid signature + text message emits message.received', async () => {
    const phoneNumberId = '107654321987654';
    const { plugin, emits } = makeHarness({ phoneNumberId });

    const payload = envelope('messages', {
      messaging_product: 'whatsapp',
      metadata: {
        display_phone_number: '+15550000001',
        phone_number_id: phoneNumberId,
      },
      contacts: [{ profile: { name: 'Alice' }, wa_id: '5511999998888' }],
      messages: [
        {
          from: '5511999998888',
          id: 'wamid.HBgABCDE001',
          timestamp: '1700000000',
          type: 'text',
          text: { body: 'Hello from Meta!' },
        },
      ],
    });
    const body = JSON.stringify(payload);
    const req = await makeSignedPost(body);

    const res = await handleMetaWebhook(req, plugin, APP_SECRET, VERIFY_TOKEN);
    expect(res.status).toBe(200);

    const received = emits.filter((e) => e.method === 'message.received');
    expect(received).toHaveLength(1);
    expect(received[0]?.params.externalId).toBe('wamid.HBgABCDE001');
    expect(received[0]?.params.from).toBe('5511999998888');
    expect(received[0]?.params.senderName).toBe('Alice');
    expect((received[0]?.params.content as { type: string }).type).toBe('text');
    expect((received[0]?.params.content as { text: string }).text).toBe('Hello from Meta!');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// POST status → message.delivered (+ similar)
// ─────────────────────────────────────────────────────────────────────────

describe('handleMetaWebhook (POST) — statuses', () => {
  test('valid signature + delivered status emits message.delivered', async () => {
    const phoneNumberId = '107654321987654';
    const { plugin, emits } = makeHarness({ phoneNumberId });

    const payload = envelope('messages', {
      messaging_product: 'whatsapp',
      metadata: {
        display_phone_number: '+15550000001',
        phone_number_id: phoneNumberId,
      },
      statuses: [
        {
          id: 'wamid.OUTBOUND_001',
          status: 'delivered',
          timestamp: '1700000100',
          recipient_id: '5511999998888',
          conversation: { id: 'conv-1' },
        },
      ],
    });
    const req = await makeSignedPost(JSON.stringify(payload));

    const res = await handleMetaWebhook(req, plugin, APP_SECRET, VERIFY_TOKEN);
    expect(res.status).toBe(200);

    const delivered = emits.filter((e) => e.method === 'message.delivered');
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.params.externalId).toBe('wamid.OUTBOUND_001');
    expect(delivered[0]?.params.deliveredAt).toBe(1700000100 * 1000);
  });

  test('failed status emits message.failed with error code', async () => {
    const phoneNumberId = '107654321987654';
    const { plugin, emits } = makeHarness({ phoneNumberId });

    const payload = envelope('messages', {
      messaging_product: 'whatsapp',
      metadata: {
        display_phone_number: '+15550000001',
        phone_number_id: phoneNumberId,
      },
      statuses: [
        {
          id: 'wamid.OUTBOUND_002',
          status: 'failed',
          timestamp: '1700000200',
          recipient_id: '5511999998888',
          errors: [{ code: 131047, title: 'Re-engagement message', message: 'Outside 24h' }],
        },
      ],
    });
    const req = await makeSignedPost(JSON.stringify(payload));

    const res = await handleMetaWebhook(req, plugin, APP_SECRET, VERIFY_TOKEN);
    expect(res.status).toBe(200);

    const failed = emits.filter((e) => e.method === 'message.failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]?.params.errorCode).toBe('131047');
    expect(failed[0]?.params.error).toBe('Outside 24h');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Unknown phone_number_id → 200, no emit
// ─────────────────────────────────────────────────────────────────────────

describe('handleMetaWebhook (POST) — unknown phone_number_id', () => {
  test('unknown phone_number_id returns 200 and emits nothing', async () => {
    const { plugin, emits, logs } = makeHarness({ phoneNumberId: '999999999999999' });

    // Payload references a DIFFERENT phone_number_id that the plugin won't
    // resolve — Meta cannot be 4xx'd for this case, or the app gets disabled.
    const payload = envelope('messages', {
      messaging_product: 'whatsapp',
      metadata: {
        display_phone_number: '+15550000099',
        phone_number_id: '111111111111111', // unknown to plugin
      },
      messages: [
        {
          from: '5511999998888',
          id: 'wamid.UNKNOWN_001',
          timestamp: '1700000300',
          type: 'text',
          text: { body: 'Should be dropped' },
        },
      ],
    });
    const req = await makeSignedPost(JSON.stringify(payload));

    const res = await handleMetaWebhook(req, plugin, APP_SECRET, VERIFY_TOKEN);
    expect(res.status).toBe(200);
    expect(emits).toHaveLength(0);
    expect(
      logs.some(
        (l) => l.level === 'warn' && l.message.includes('no instance for phone_number_id'),
      ),
    ).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Idempotency — same wamid twice emits once
// ─────────────────────────────────────────────────────────────────────────

describe('handleMetaWebhook (POST) — idempotency', () => {
  test('same wamid posted twice triggers message.received only once', async () => {
    const phoneNumberId = '107654321987654';
    const { plugin, emits } = makeHarness({ phoneNumberId });

    const payload = envelope('messages', {
      messaging_product: 'whatsapp',
      metadata: {
        display_phone_number: '+15550000001',
        phone_number_id: phoneNumberId,
      },
      messages: [
        {
          from: '5511999998888',
          id: 'wamid.DUPLICATE_001',
          timestamp: '1700000500',
          type: 'text',
          text: { body: 'duplicate me' },
        },
      ],
    });
    const body = JSON.stringify(payload);

    const res1 = await handleMetaWebhook(await makeSignedPost(body), plugin, APP_SECRET, VERIFY_TOKEN);
    const res2 = await handleMetaWebhook(await makeSignedPost(body), plugin, APP_SECRET, VERIFY_TOKEN);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const received = emits.filter((e) => e.method === 'message.received');
    expect(received).toHaveLength(1);
  });
});
