/**
 * Unit tests for channel-capability helpers used by the follow-up system.
 *
 * Covers:
 *   - `channelHasMessagingWindow` — only WhatsApp Cloud today.
 *   - `channelSupportsTypingIndicator` — the known messaging channels.
 *   - `createMessagingWindowProbe` — expired / within / unknown verdicts.
 *   - `playTypingIndicator` — silent no-ops + the happy path.
 *
 * @see issue #404 — Configurable Idle-Chat Follow-Up Sequences
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FollowUpSequenceConfig } from '../../../schemas/follow-up';
import type { ChannelType } from '../../../types/channel';
import {
  DEFAULT_TYPING_INDICATOR_MS,
  MESSAGING_WINDOW_MS,
  channelHasMessagingWindow,
  channelSupportsTypingIndicator,
  createMessagingWindowProbe,
  playTypingIndicator,
} from '../capabilities';
import type { FollowUpStateRow } from '../sweeper';

const baseConfig = (overrides: Partial<FollowUpSequenceConfig> = {}): FollowUpSequenceConfig => ({
  enabled: true,
  schedule: { kind: 'fixed', intervalsMinutes: [3, 5, 30] },
  maxFollowUps: 3,
  promptTemplate: 'follow up',
  stopOutsideMessagingWindow: true,
  showTypingIndicator: true,
  ...overrides,
});

const now = new Date('2026-04-14T12:00:00.000Z');

const row = (overrides: Partial<FollowUpStateRow> = {}): FollowUpStateRow => ({
  id: 'row-1',
  chatId: 'chat-1',
  instanceId: 'inst-1',
  agentId: 'agent-1',
  chatName: 'Alice',
  sequenceConfig: baseConfig(),
  sequenceIndex: 0,
  lastAgentMessageAt: now,
  ...overrides,
});

describe('channelHasMessagingWindow', () => {
  test('WhatsApp Cloud is the only channel with a 24h window', () => {
    expect(channelHasMessagingWindow('whatsapp-cloud')).toBe(true);
    expect(channelHasMessagingWindow('whatsapp-baileys')).toBe(false);
    expect(channelHasMessagingWindow('discord')).toBe(false);
    expect(channelHasMessagingWindow('telegram')).toBe(false);
    expect(channelHasMessagingWindow('slack')).toBe(false);
    expect(channelHasMessagingWindow('a2a')).toBe(false);
    expect(channelHasMessagingWindow('internal')).toBe(false);
  });

  test('null / undefined channel types have no window', () => {
    expect(channelHasMessagingWindow(null)).toBe(false);
    expect(channelHasMessagingWindow(undefined)).toBe(false);
  });
});

describe('channelSupportsTypingIndicator', () => {
  test.each<[ChannelType, boolean]>([
    ['whatsapp-baileys', true],
    ['whatsapp-cloud', true],
    ['discord', true],
    ['telegram', true],
    ['slack', true],
    ['a2a', false],
    ['internal', false],
  ])('%s → %s', (channelType, expected) => {
    expect(channelSupportsTypingIndicator(channelType)).toBe(expected);
  });

  test('null / undefined → false', () => {
    expect(channelSupportsTypingIndicator(null)).toBe(false);
    expect(channelSupportsTypingIndicator(undefined)).toBe(false);
  });
});

describe('createMessagingWindowProbe', () => {
  test('returns unknown when channel does not enforce a window', () => {
    const probe = createMessagingWindowProbe();
    const r = row({
      channelType: 'whatsapp-baileys',
      lastInboundCustomerMessageAt: new Date(now.getTime() - MESSAGING_WINDOW_MS - 1),
    });
    expect(probe(r, now)).toBe('unknown');
  });

  test('returns unknown when channelType is missing', () => {
    const probe = createMessagingWindowProbe();
    const r = row({
      channelType: null,
      lastInboundCustomerMessageAt: new Date(now.getTime() - 60_000),
    });
    expect(probe(r, now)).toBe('unknown');
  });

  test('returns unknown when lastInboundCustomerMessageAt is missing', () => {
    const probe = createMessagingWindowProbe();
    const r = row({ channelType: 'whatsapp-cloud', lastInboundCustomerMessageAt: null });
    expect(probe(r, now)).toBe('unknown');
  });

  test('returns within when last inbound is inside the 24h window', () => {
    const probe = createMessagingWindowProbe();
    const r = row({
      channelType: 'whatsapp-cloud',
      lastInboundCustomerMessageAt: new Date(now.getTime() - (MESSAGING_WINDOW_MS - 60_000)),
    });
    expect(probe(r, now)).toBe('within');
  });

  test('returns expired when last inbound is older than 24h', () => {
    const probe = createMessagingWindowProbe();
    const r = row({
      channelType: 'whatsapp-cloud',
      lastInboundCustomerMessageAt: new Date(now.getTime() - MESSAGING_WINDOW_MS - 1),
    });
    expect(probe(r, now)).toBe('expired');
  });

  test('honours custom windowMs override (test-only)', () => {
    const probe = createMessagingWindowProbe({ windowMs: 60_000 });
    const r = row({
      channelType: 'whatsapp-cloud',
      lastInboundCustomerMessageAt: new Date(now.getTime() - 61_000),
    });
    expect(probe(r, now)).toBe('expired');
  });
});

describe('playTypingIndicator', () => {
  let waitCalls: number[];
  let wait: (ms: number) => Promise<void>;

  beforeEach(() => {
    waitCalls = [];
    wait = async (ms: number) => {
      waitCalls.push(ms);
    };
  });

  test('no-op when showTypingIndicator=false', async () => {
    const sender = { sendTyping: mock(async () => {}) };
    const duration = await playTypingIndicator({
      channelType: 'whatsapp-baileys',
      instanceId: 'inst-1',
      chatId: 'chat-1',
      showTypingIndicator: false,
      sender,
      wait,
    });
    expect(duration).toBe(0);
    expect(sender.sendTyping).not.toHaveBeenCalled();
    expect(waitCalls).toEqual([]);
  });

  test('no-op when channelType is null', async () => {
    const sender = { sendTyping: mock(async () => {}) };
    const duration = await playTypingIndicator({
      channelType: null,
      instanceId: 'inst-1',
      chatId: 'chat-1',
      sender,
      wait,
    });
    expect(duration).toBe(0);
    expect(sender.sendTyping).not.toHaveBeenCalled();
  });

  test('no-op when channel does not support typing (internal, a2a)', async () => {
    const sender = { sendTyping: mock(async () => {}) };
    const duration = await playTypingIndicator({
      channelType: 'internal',
      instanceId: 'inst-1',
      chatId: 'chat-1',
      sender,
      wait,
    });
    expect(duration).toBe(0);
    expect(sender.sendTyping).not.toHaveBeenCalled();
  });

  test('no-op when resolver returns null (plugin not registered)', async () => {
    const resolver = mock(() => null);
    const duration = await playTypingIndicator({
      channelType: 'discord',
      instanceId: 'inst-1',
      chatId: 'chat-1',
      resolver,
      wait,
    });
    expect(duration).toBe(0);
    expect(resolver).toHaveBeenCalledWith('discord');
  });

  test('happy path: invokes sender.sendTyping and waits the default duration', async () => {
    const sender = { sendTyping: mock(async () => {}) };
    const duration = await playTypingIndicator({
      channelType: 'whatsapp-baileys',
      instanceId: 'inst-1',
      chatId: 'chat-1',
      sender,
      wait,
    });
    expect(duration).toBe(DEFAULT_TYPING_INDICATOR_MS);
    expect(sender.sendTyping).toHaveBeenCalledWith('inst-1', 'chat-1', DEFAULT_TYPING_INDICATOR_MS);
    expect(waitCalls).toEqual([DEFAULT_TYPING_INDICATOR_MS]);
  });

  test('custom durationMs is passed through and awaited', async () => {
    const sender = { sendTyping: mock(async () => {}) };
    const duration = await playTypingIndicator({
      channelType: 'whatsapp-baileys',
      instanceId: 'inst-1',
      chatId: 'chat-1',
      sender,
      durationMs: 1500,
      wait,
    });
    expect(duration).toBe(1500);
    expect(sender.sendTyping).toHaveBeenCalledWith('inst-1', 'chat-1', 1500);
    expect(waitCalls).toEqual([1500]);
  });

  test('direct sender takes precedence over resolver', async () => {
    const directSender = { sendTyping: mock(async () => {}) };
    const resolverSender = { sendTyping: mock(async () => {}) };
    const resolver = mock(() => resolverSender);
    await playTypingIndicator({
      channelType: 'discord',
      instanceId: 'inst-1',
      chatId: 'chat-1',
      sender: directSender,
      resolver,
      wait,
    });
    expect(directSender.sendTyping).toHaveBeenCalledTimes(1);
    expect(resolverSender.sendTyping).not.toHaveBeenCalled();
    expect(resolver).not.toHaveBeenCalled();
  });

  test('sender error is swallowed and returns 0 ms (silent no-op)', async () => {
    const sender = { sendTyping: mock(async () => Promise.reject(new Error('boom'))) };
    const logger = { debug: mock(() => {}) };
    const duration = await playTypingIndicator({
      channelType: 'whatsapp-baileys',
      instanceId: 'inst-1',
      chatId: 'chat-1',
      sender,
      logger,
      wait,
    });
    expect(duration).toBe(0);
    expect(logger.debug).toHaveBeenCalled();
    // No wait when the indicator failed to start.
    expect(waitCalls).toEqual([]);
  });
});
