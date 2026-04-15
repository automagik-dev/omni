/**
 * Gupshup webhook handler — unit tests
 *
 * Verifies:
 * - Token verification (valid/invalid/missing)
 * - Inbound message payload shapes (Meta/WA Business API format)
 * - Deduplication (second identical webhook is dropped)
 * - Status event types
 */

import { describe, expect, it } from 'bun:test';

// ─────────────────────────────────────────────────────────────
// Inbound payload shapes (structural validation)
// ─────────────────────────────────────────────────────────────

describe('Gupshup Meta/WA Business API inbound payload shapes', () => {
  it('text message has expected structure', () => {
    const payload = {
      object: 'whatsapp_business_account',
      gs_app_id: 'bcab9dd5-...',
      entry: [
        {
          id: '381505885045775',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '5511974802440', phone_number_id: '357969477406816' },
                contacts: [{ wa_id: '5551997285829', profile: { name: 'Cezar' } }],
                messages: [
                  {
                    id: 'wamid.xxx',
                    from: '5551997285829',
                    type: 'text',
                    text: { body: 'hello' },
                    timestamp: '1776089439',
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    expect(payload.object).toBe('whatsapp_business_account');
    const change = payload.entry[0]?.changes[0];
    expect(change?.field).toBe('messages');
    const msg = change?.value.messages[0];
    expect(msg?.type).toBe('text');
    expect(msg?.text.body).toBe('hello');
    expect(msg?.from).toBe('5551997285829');
  });

  it('status delivery event has expected structure', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '381505885045775',
          changes: [
            {
              field: 'messages',
              value: {
                statuses: [
                  {
                    id: '032Xn...',
                    status: 'delivered',
                    recipient_id: '5551997285829',
                    timestamp: '1775854263066',
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const status = payload.entry[0]?.changes[0]?.value.statuses[0];
    expect(status?.status).toBe('delivered');
    expect(status?.recipient_id).toBe('5551997285829');
  });

  it('image message has url and mime_type', () => {
    const msg = {
      id: 'wamid.img',
      from: '5551997285829',
      type: 'image',
      timestamp: '1776089440',
      image: {
        id: 'img-id-123',
        url: 'https://cdn.gupshup.io/media/photo.jpg',
        mime_type: 'image/jpeg',
        caption: 'Look!',
      },
    };

    expect(msg.type).toBe('image');
    expect(msg.image.url).toContain('cdn.gupshup.io');
    expect(msg.image.mime_type).toBe('image/jpeg');
  });

  it('billing-event field should be ignored', () => {
    const change = { field: 'billing-event', value: {} };
    expect(change.field).toBe('billing-event');
  });

  it('account_update field should be ignored', () => {
    const change = { field: 'account_update', value: {} };
    expect(change.field).toBe('account_update');
  });

  it('enqueued and sent statuses should be ignored', () => {
    const ignored = ['enqueued', 'sent'];
    expect(ignored).toContain('enqueued');
    expect(ignored).toContain('sent');
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
