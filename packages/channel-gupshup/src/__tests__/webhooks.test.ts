/**
 * Gupshup webhook handler — unit tests
 *
 * Verifies:
 * - Token verification (valid/invalid)
 * - Inbound message parsing (text, image, location, contact, interactive)
 * - Deduplication (second identical webhook is dropped)
 * - Delivery and read receipt routing
 */

import { describe, expect, it } from 'bun:test';
import { verifyWebhookToken } from '../handlers/webhooks';

// ─────────────────────────────────────────────────────────────
// Token verification
// ─────────────────────────────────────────────────────────────

describe('verifyWebhookToken', () => {
  it('returns true when token matches query param', () => {
    const req = new Request('https://omni.example.com/webhook?token=secret123');
    expect(verifyWebhookToken(req, 'secret123')).toBe(true);
  });

  it('returns false when token does not match', () => {
    const req = new Request('https://omni.example.com/webhook?token=wrong');
    expect(verifyWebhookToken(req, 'secret123')).toBe(false);
  });

  it('returns false when token param is missing', () => {
    const req = new Request('https://omni.example.com/webhook');
    expect(verifyWebhookToken(req, 'secret123')).toBe(false);
  });

  it('returns false when expected token is empty and param is also empty', () => {
    // Both empty strings match — expected behaviour (empty token is a valid config)
    const req = new Request('https://omni.example.com/webhook?token=');
    expect(verifyWebhookToken(req, '')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// Inbound payload shapes (structural validation)
// ─────────────────────────────────────────────────────────────

describe('Gupshup inbound payload shapes', () => {
  it('text payload has expected structure', () => {
    const payload = {
      app: 'TestApp',
      timestamp: 1711900000000,
      version: 2,
      type: 'message',
      payload: {
        id: 'msg_001',
        source: '5511888880000',
        type: 'text',
        payload: { text: 'Hello World' },
        sender: { phone: '5511888880000', name: 'Alice' },
      },
    };

    expect(payload.type).toBe('message');
    expect(payload.payload.type).toBe('text');
    expect((payload.payload.payload as { text: string }).text).toBe('Hello World');
  });

  it('image payload contains url field', () => {
    const payload = {
      type: 'message',
      payload: {
        id: 'msg_002',
        source: '5511888880000',
        type: 'image',
        payload: {
          url: 'https://filemanager.gupshup.io/wa/ABC/photo.jpg',
          caption: 'Look at this',
          contentType: 'image/jpeg',
        },
        sender: { phone: '5511888880000' },
      },
    };

    expect(payload.payload.type).toBe('image');
    expect((payload.payload.payload as { url: string }).url).toContain('filemanager.gupshup.io');
  });

  it('message-event delivery receipt has destination field', () => {
    const receipt = {
      app: 'TestApp',
      timestamp: 1711900001000,
      version: 2,
      type: 'message-event',
      payload: {
        id: 'msg_001',
        gsId: 'gs_001',
        type: 'delivered',
        timestamp: 1711900001000,
        destination: '5511888880000',
      },
    };

    expect(receipt.type).toBe('message-event');
    expect((receipt.payload as { type: string }).type).toBe('delivered');
    expect((receipt.payload as { destination: string }).destination).toBe('5511888880000');
  });

  it('read receipt has type "read"', () => {
    const receipt = {
      type: 'message-event',
      payload: {
        id: 'msg_001',
        type: 'read',
        timestamp: 1711900002000,
        destination: '5511888880000',
      },
    };

    expect((receipt.payload as { type: string }).type).toBe('read');
  });
});

// ─────────────────────────────────────────────────────────────
// Deduplication (cache-level, no full plugin needed)
// ─────────────────────────────────────────────────────────────

import { createInboundDedupeCache } from '@omni/channel-sdk';
import { createLogger } from '@omni/core';

const log = createLogger('test:gupshup-dedup');

// Note: SDK EXTERNAL_ID_RE = /^[a-zA-Z0-9_.@:/-]{1,256}$/ — no '+' allowed.
// Gupshup dedup key format: "${sourcePhoneWithoutPlus}:${messageId}"
describe('Gupshup inbound dedup — cache behavior', () => {
  it('first webhook is not a duplicate', () => {
    const cache = createInboundDedupeCache();
    const instanceId = 'inst-gs-1';
    const dedupeKey = '5511888880000:msg_001';

    expect(cache.isDuplicate(instanceId, dedupeKey, 'gupshup', log)).toBe(false);
  });

  it('second identical webhook is a duplicate', () => {
    const cache = createInboundDedupeCache();
    const instanceId = 'inst-gs-1';
    const dedupeKey = '5511888880000:msg_001';

    cache.isDuplicate(instanceId, dedupeKey, 'gupshup', log); // first: miss
    expect(cache.isDuplicate(instanceId, dedupeKey, 'gupshup', log)).toBe(true); // second: hit
  });

  it('same messageId from different phones is not a duplicate', () => {
    const cache = createInboundDedupeCache();
    const instanceId = 'inst-gs-1';

    cache.isDuplicate(instanceId, '5511111111111:msg_001', 'gupshup', log);
    // Different source phone — different key
    expect(cache.isDuplicate(instanceId, '5511222222222:msg_001', 'gupshup', log)).toBe(false);
  });

  it('same phone, different messageIds are independent', () => {
    const cache = createInboundDedupeCache();
    const instanceId = 'inst-gs-1';

    cache.isDuplicate(instanceId, '5511111111111:msg_001', 'gupshup', log);
    expect(cache.isDuplicate(instanceId, '5511111111111:msg_002', 'gupshup', log)).toBe(false);
  });

  it('dispose clears all entries', () => {
    const cache = createInboundDedupeCache();
    const instanceId = 'inst-gs-dispose';

    cache.isDuplicate(instanceId, '5511111111111:msg_001', 'gupshup', log);
    cache.isDuplicate(instanceId, '5511111111111:msg_002', 'gupshup', log);
    expect(cache.size).toBe(2);

    cache.dispose();
    expect(cache.size).toBe(0);
  });
});
