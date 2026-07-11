import { describe, expect, test } from 'bun:test';
import type { ChatRow, EventRow, MessageRow } from '../../api/ext';
import {
  FELIPE_WHATSAPP_ID,
  PESSOAL_WHATSAPP_ID,
  agentStatusDot,
  canClearSession,
  canMutateChatFlags,
  chatDisplayName,
  correlateChatEvents,
  deliveryTick,
  eventsForChat,
  eventsForMessage,
  formatDaySeparator,
  isCanaryChat,
  isPossiblyStalled,
  isProductionChat,
  mediaKind,
  mediaUrl,
  mergeMessagesById,
  reactionSummary,
  requiresSendConfirm,
  senderLabel,
  toTraceSteps,
} from './chat-helpers';

const chat = (over: Partial<ChatRow>): ChatRow => ({
  id: 'c1',
  instanceId: 'disposable',
  externalId: '5599999999@s.whatsapp.net',
  chatType: 'dm',
  channel: 'whatsapp-baileys',
  ...over,
});

const msg = (over: Partial<MessageRow>): MessageRow => ({ id: 'm1', chatId: 'c1', messageType: 'text', ...over });

describe('safety guards', () => {
  test('isProductionChat flags the two production instances', () => {
    expect(isProductionChat(chat({ instanceId: FELIPE_WHATSAPP_ID }))).toBe(true);
    expect(isProductionChat(chat({ instanceId: PESSOAL_WHATSAPP_ID }))).toBe(true);
    expect(isProductionChat(chat({ instanceId: 'disposable' }))).toBe(false);
  });

  test('isCanaryChat recognises the felipe↔pessoal DM in both directions', () => {
    // On felipe-whatsapp, the DM to the pessoal number.
    expect(isCanaryChat(chat({ instanceId: FELIPE_WHATSAPP_ID, externalId: '5512982298888@s.whatsapp.net' }))).toBe(
      true,
    );
    // On pessoal-whatsapp, the DM to the felipe number.
    expect(isCanaryChat(chat({ instanceId: PESSOAL_WHATSAPP_ID, externalId: '5511986780008@s.whatsapp.net' }))).toBe(
      true,
    );
  });

  test('isCanaryChat rejects other production chats and groups', () => {
    expect(isCanaryChat(chat({ instanceId: FELIPE_WHATSAPP_ID, externalId: '5511111111111@s.whatsapp.net' }))).toBe(
      false,
    );
    // A group whose subject happens to contain the number is not the canary.
    expect(isCanaryChat(chat({ instanceId: FELIPE_WHATSAPP_ID, externalId: '120363@g.us', chatType: 'group' }))).toBe(
      false,
    );
  });

  test('canMutateChatFlags: allowed off-production and on the canary, blocked on other production chats', () => {
    expect(canMutateChatFlags(chat({ instanceId: 'disposable' }))).toBe(true);
    expect(
      canMutateChatFlags(chat({ instanceId: FELIPE_WHATSAPP_ID, externalId: '5512982298888@s.whatsapp.net' })),
    ).toBe(true);
    expect(canMutateChatFlags(chat({ instanceId: FELIPE_WHATSAPP_ID, externalId: '5599999999@s.whatsapp.net' }))).toBe(
      false,
    );
  });

  test('canClearSession is false for any production chat, even the canary', () => {
    expect(canClearSession(chat({ instanceId: 'disposable' }))).toBe(true);
    expect(canClearSession(chat({ instanceId: FELIPE_WHATSAPP_ID, externalId: '5512982298888@s.whatsapp.net' }))).toBe(
      false,
    );
  });

  test('requiresSendConfirm gates every send on production non-canary chats only', () => {
    // Off-production: no confirm (text OR attachment).
    expect(requiresSendConfirm(chat({ instanceId: 'disposable' }))).toBe(false);
    // Production canary: no confirm (the sanctioned live chat).
    expect(
      requiresSendConfirm(chat({ instanceId: FELIPE_WHATSAPP_ID, externalId: '5512982298888@s.whatsapp.net' })),
    ).toBe(false);
    // Production, not the canary: confirm required.
    expect(requiresSendConfirm(chat({ instanceId: FELIPE_WHATSAPP_ID, externalId: '5599999999@s.whatsapp.net' }))).toBe(
      true,
    );
  });
});

describe('display names', () => {
  test('chatDisplayName prefers a real name, falls back to a cleaned jid', () => {
    expect(chatDisplayName(chat({ name: 'Felipe Rosa' }))).toBe('Felipe Rosa');
    expect(chatDisplayName(chat({ name: '54958418317348@lid', externalId: '5512982298888@s.whatsapp.net' }))).toBe(
      '5512982298888',
    );
  });

  test('senderLabel resolves You / display name / bare number', () => {
    expect(senderLabel(msg({ isFromMe: true }))).toBe('You');
    expect(senderLabel(msg({ senderDisplayName: 'Ana' }))).toBe('Ana');
    expect(senderLabel(msg({ senderDisplayName: '5511@lid', senderPlatformUserId: '5511987650000' }))).toBe(
      '5511987650000',
    );
  });
});

describe('media', () => {
  test('mediaUrl builds a BFF path only when cached', () => {
    expect(mediaUrl('/omni', msg({ mediaLocalPath: '506/2026-07/x.jpg' }))).toBe(
      '/omni/api/v2/media/506/2026-07/x.jpg',
    );
    expect(mediaUrl('/omni', msg({ mediaLocalPath: null }))).toBeNull();
  });

  test('mediaKind classifies by type and mime', () => {
    expect(mediaKind(msg({ messageType: 'image' }))).toBe('image');
    expect(mediaKind(msg({ messageType: 'text' }))).toBe('none');
    expect(mediaKind(msg({ messageType: 'ptt', mediaMimeType: 'audio/ogg' }))).toBe('audio');
    expect(mediaKind(msg({ messageType: 'document', mediaMimeType: 'application/pdf', hasMedia: true }))).toBe(
      'document',
    );
  });
});

describe('delivery ticks', () => {
  test('maps status to a glyph + tone', () => {
    expect(deliveryTick('sent')?.glyph).toBe('✓');
    expect(deliveryTick('delivered')?.tone).toBe('muted');
    expect(deliveryTick('read')?.tone).toBe('accent');
    expect(deliveryTick('failed')?.tone).toBe('danger');
    expect(deliveryTick('weird')).toBeNull();
  });
});

describe('message accumulation', () => {
  test('mergeMessagesById dedupes and sorts ascending by platform time', () => {
    const a = msg({ id: 'a', platformTimestamp: '2026-07-11T10:00:00Z' });
    const b = msg({ id: 'b', platformTimestamp: '2026-07-11T10:05:00Z' });
    const bUpdated = msg({ id: 'b', platformTimestamp: '2026-07-11T10:05:00Z', deliveryStatus: 'read' });
    const merged = mergeMessagesById([b, a], [bUpdated]);
    expect(merged.map((m) => m.id)).toEqual(['a', 'b']);
    expect(merged[1]?.deliveryStatus).toBe('read');
  });
});

describe('reactions', () => {
  test('reactionSummary reads reactionCounts and falls back to an array', () => {
    expect(reactionSummary(msg({ reactionCounts: { '👍': 2, '❤️': 0 } }))).toEqual([{ emoji: '👍', count: 2 }]);
    expect(reactionSummary(msg({ reactions: [{ emoji: '🔥' }, { emoji: '🔥' }] }))).toEqual([
      { emoji: '🔥', count: 2 },
    ]);
  });
});

describe('correlation', () => {
  const events: EventRow[] = [
    { id: 'e1', eventType: 'message.received', chatUuid: 'c1', externalId: 'X1' },
    { id: 'e2', eventType: 'message.sent', chatUuid: 'c2', externalId: 'X2' },
    { id: 'e3', eventType: 'agent.replied', chatUuid: 'c1', externalId: 'X1' },
  ];

  test('eventsForChat filters on chatUuid (the /events chatId param is ignored server-side)', () => {
    expect(eventsForChat(events, 'c1').map((e) => e.id)).toEqual(['e1', 'e3']);
  });

  test('correlateChatEvents catches DM events (chatUuid=null) via message externalIds', () => {
    const dmEvents: EventRow[] = [
      { id: 'd1', eventType: 'message.sent', chatUuid: null, externalId: 'WA1' },
      { id: 'd2', eventType: 'message.received', chatUuid: null, externalId: 'WA2' },
      { id: 'g1', eventType: 'message.received', chatUuid: 'c1', externalId: 'WA9' },
      { id: 'x1', eventType: 'other', chatUuid: null, externalId: 'WA_UNRELATED' },
    ];
    const ids = new Set(['WA1', 'WA2']);
    // Matches the two DM events by externalId AND the group event by chatUuid.
    expect(correlateChatEvents(dmEvents, 'c1', ids).map((e) => e.id)).toEqual(['d1', 'd2', 'g1']);
  });

  test('eventsForMessage joins on externalId', () => {
    expect(eventsForMessage(events, 'X1').map((e) => e.id)).toEqual(['e1', 'e3']);
    expect(eventsForMessage(events, null)).toEqual([]);
  });

  test('toTraceSteps orders by time and derives outcome + duration', () => {
    const steps = toTraceSteps([
      {
        id: 'e1',
        eventType: 'x',
        receivedAt: '2026-07-11T10:00:02Z',
        status: 'received',
        processedAt: '2026-07-11T10:00:02Z',
        totalLatencyMs: 120,
      },
      { id: 'e0', eventType: 'x', receivedAt: '2026-07-11T10:00:00Z', status: 'error', errorMessage: 'boom' },
    ]);
    expect(steps.map((s) => s.event.id)).toEqual(['e0', 'e1']);
    expect(steps[0]?.outcome).toBe('error');
    expect(steps[1]?.outcome).toBe('ok');
    expect(steps[1]?.durationMs).toBe(120);
  });
});

describe('agent state', () => {
  test('agentStatusDot maps statuses to StatusDot states', () => {
    expect(agentStatusDot('idle')).toBe('idle');
    expect(agentStatusDot('thinking')).toBe('working');
    expect(agentStatusDot('waiting')).toBe('away');
    expect(agentStatusDot('error')).toBe('error');
  });

  test('isPossiblyStalled: busy + no movement past threshold', () => {
    const now = 1_000_000;
    expect(isPossiblyStalled({ status: 'thinking', updatedAt: now - 90_000 }, now - 90_000, now)).toBe(true);
    // Recent activity → not stalled.
    expect(isPossiblyStalled({ status: 'thinking', updatedAt: now - 5_000 }, now - 5_000, now)).toBe(false);
    // Idle is never "stalled".
    expect(isPossiblyStalled({ status: 'idle', updatedAt: now - 90_000 }, now - 90_000, now)).toBe(false);
  });
});

describe('day separators', () => {
  test('labels Today / Yesterday / a date', () => {
    const now = new Date('2026-07-11T12:00:00Z').getTime();
    expect(formatDaySeparator(new Date('2026-07-11T09:00:00Z').getTime(), now)).toBe('Today');
    expect(formatDaySeparator(new Date('2026-07-10T09:00:00Z').getTime(), now)).toBe('Yesterday');
    expect(formatDaySeparator(new Date('2026-07-01T09:00:00Z').getTime(), now)).not.toBe('Today');
  });
});
