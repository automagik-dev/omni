/**
 * Sweeper handler unit tests.
 *
 * These tests exercise sweep semantics with an in-memory repo double. The
 * concrete Drizzle implementation is integration-tested separately.
 *
 * @see issue #404 — Configurable Idle-Chat Follow-Up Sequences
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { EventBus } from '../../../events/bus';
import type { Logger } from '../../../logger/types';
import type { FollowUpSequenceConfig } from '../../../schemas/follow-up';
import type { AdvanceInput, FollowUpStateRepo, FollowUpStateRow, MessagingWindowProbe } from '../sweeper';
import { renderSyntheticPrompt, sweepFollowUps } from '../sweeper';

type PublishFn = EventBus['publish'];

const MS_PER_MINUTE = 60_000;

const silentLogger: Pick<Logger, 'debug' | 'info' | 'warn' | 'error'> = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

interface CapturedPublish {
  type: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

function makeEventBus() {
  const calls: CapturedPublish[] = [];
  const publish = mock((type, payload, metadata) => {
    calls.push({
      type: type as string,
      payload: payload as Record<string, unknown>,
      metadata: metadata as Record<string, unknown> | undefined,
    });
    return Promise.resolve({ id: 'evt', sequence: calls.length });
  }) as unknown as PublishFn;
  return {
    bus: { publish } as Pick<EventBus, 'publish'>,
    calls,
    publish,
  };
}

function makeRepo(due: FollowUpStateRow[]) {
  const fired: AdvanceInput[] = [];
  const disarmed: Array<{ id: string; reason: string; at: Date }> = [];
  const repo: FollowUpStateRepo = {
    findAndLockDue: mock(async () => due),
    recordFired: mock(async (input: AdvanceInput) => {
      fired.push(input);
    }),
    recordDisarmed: mock(async (id: string, reason: string, at: Date) => {
      disarmed.push({ id, reason, at });
    }),
  };
  return { repo, fired, disarmed };
}

const baseConfig = (overrides: Partial<FollowUpSequenceConfig> = {}): FollowUpSequenceConfig => ({
  enabled: true,
  schedule: { kind: 'fixed', intervalsMinutes: [3, 5, 30] },
  maxFollowUps: 3,
  promptTemplate: 'Follow up with {{chatName}} ({{minutes}}min / #{{sequenceIndex}})',
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
  lastAgentMessageAt: new Date(now.getTime() - 3 * MS_PER_MINUTE),
  ...overrides,
});

describe('renderSyntheticPrompt', () => {
  test('substitutes minutes, sequenceIndex, chatName', () => {
    const result = renderSyntheticPrompt('hi {{chatName}} — {{minutes}}m since msg #{{sequenceIndex}}', {
      minutes: 5,
      sequenceIndex: 2,
      chatName: 'Bob',
    });
    expect(result).toBe('hi Bob — 5m since msg #2');
  });

  test('handles whitespace inside braces', () => {
    const result = renderSyntheticPrompt('{{ chatName }} {{ minutes }}', {
      minutes: 7,
      sequenceIndex: 0,
      chatName: 'Carol',
    });
    expect(result).toBe('Carol 7');
  });

  test('empty chatName renders as empty string', () => {
    expect(renderSyntheticPrompt('Hello {{chatName}}!', { minutes: 1, sequenceIndex: 0, chatName: null })).toBe(
      'Hello !',
    );
  });

  test('leaves {{syntheticPrompt}} literal so downstream templates can substitute', () => {
    const tmpl = 'Please follow up: {{syntheticPrompt}}';
    expect(renderSyntheticPrompt(tmpl, { minutes: 1, sequenceIndex: 0, chatName: 'X' })).toBe(tmpl);
  });
});

describe('sweepFollowUps', () => {
  let fixedNow: Date;

  beforeEach(() => {
    fixedNow = now;
  });

  test('no due rows → returns zero stats and no side-effects', async () => {
    const { repo } = makeRepo([]);
    const { bus, calls } = makeEventBus();
    const stats = await sweepFollowUps({
      repo,
      eventBus: bus,
      logger: silentLogger,
      now: () => fixedNow,
    });
    expect(stats).toEqual({ scanned: 0, fired: 0, disarmed: 0, skipped: 0 });
    expect(calls).toHaveLength(0);
  });

  test('one due row fires chat.idle_timeout + follow_up.fired + follow_up.armed, advances sequence', async () => {
    const r = row();
    const { repo, fired } = makeRepo([r]);
    const { bus, calls } = makeEventBus();

    const stats = await sweepFollowUps({
      repo,
      eventBus: bus,
      logger: silentLogger,
      now: () => fixedNow,
    });

    expect(stats).toEqual({ scanned: 1, fired: 1, disarmed: 0, skipped: 0 });

    // Events in order
    expect(calls.map((c) => c.type)).toEqual(['chat.idle_timeout', 'follow_up.fired', 'follow_up.armed']);

    // chat.idle_timeout payload
    const idle = calls[0] as CapturedPublish;
    expect(idle.payload).toMatchObject({
      chatId: 'chat-1',
      instanceId: 'inst-1',
      agentId: 'agent-1',
      sequenceIndex: 0,
      minutesSinceLastAgentReply: 3,
      chatName: 'Alice',
    });
    expect(idle.payload.syntheticPrompt).toBe('Follow up with Alice (3min / #0)');

    // Advance recorded: next fire at +5min, next index = 1, not disarmed
    expect(fired).toHaveLength(1);
    expect(fired[0]?.nextSequenceIndex).toBe(1);
    expect(fired[0]?.nextFireAt?.getTime()).toBe(fixedNow.getTime() + 5 * MS_PER_MINUTE);
    expect(fired[0]?.disarmReason).toBeNull();

    // Re-armed event
    const armed = calls[2] as CapturedPublish;
    expect(armed.payload).toMatchObject({
      chatId: 'chat-1',
      sequenceIndex: 1,
      nextFireAt: fixedNow.getTime() + 5 * MS_PER_MINUTE,
    });
  });

  test('final fire disarms with sequence_complete', async () => {
    const r = row({ sequenceIndex: 2, sequenceConfig: baseConfig({ maxFollowUps: 3 }) });
    const { repo, fired } = makeRepo([r]);
    const { bus, calls } = makeEventBus();

    const stats = await sweepFollowUps({
      repo,
      eventBus: bus,
      logger: silentLogger,
      now: () => fixedNow,
    });

    expect(stats).toEqual({ scanned: 1, fired: 1, disarmed: 1, skipped: 0 });
    expect(calls.map((c) => c.type)).toEqual(['chat.idle_timeout', 'follow_up.fired', 'follow_up.disarmed']);
    expect(fired[0]?.nextFireAt).toBeNull();
    expect(fired[0]?.disarmReason).toBe('sequence_complete');
    expect(fired[0]?.nextSequenceIndex).toBe(3);

    const disarmed = calls[2] as CapturedPublish;
    expect(disarmed.payload).toMatchObject({
      sequenceIndex: 3,
      reason: 'sequence_complete',
    });
  });

  test('messagingWindowProbe=expired disarms with window_expired, does NOT fire idle_timeout', async () => {
    const r = row();
    const { repo, disarmed, fired } = makeRepo([r]);
    const { bus, calls } = makeEventBus();
    const probe: MessagingWindowProbe = () => 'expired';

    const stats = await sweepFollowUps({
      repo,
      eventBus: bus,
      logger: silentLogger,
      messagingWindowProbe: probe,
      now: () => fixedNow,
    });

    expect(stats).toEqual({ scanned: 1, fired: 0, disarmed: 1, skipped: 0 });
    expect(calls.map((c) => c.type)).toEqual(['follow_up.disarmed']);
    expect(fired).toHaveLength(0);
    expect(disarmed).toHaveLength(1);
    expect(disarmed[0]?.reason).toBe('window_expired');
  });

  test('messagingWindowProbe=within allows fire', async () => {
    const r = row();
    const { repo } = makeRepo([r]);
    const { bus, calls } = makeEventBus();
    const probe: MessagingWindowProbe = () => 'within';

    await sweepFollowUps({
      repo,
      eventBus: bus,
      logger: silentLogger,
      messagingWindowProbe: probe,
      now: () => fixedNow,
    });

    expect(calls.map((c) => c.type)).toContain('chat.idle_timeout');
  });

  test('probe not consulted when stopOutsideMessagingWindow=false', async () => {
    const r = row({ sequenceConfig: baseConfig({ stopOutsideMessagingWindow: false }) });
    const { repo } = makeRepo([r]);
    const { bus } = makeEventBus();
    const probe = mock<MessagingWindowProbe>(() => 'expired');

    await sweepFollowUps({
      repo,
      eventBus: bus,
      logger: silentLogger,
      messagingWindowProbe: probe,
      now: () => fixedNow,
    });

    expect(probe).not.toHaveBeenCalled();
  });

  test('per-row exception is isolated, emits follow_up.skipped, continues processing', async () => {
    const good = row({ id: 'row-good', chatId: 'chat-good' });
    const bad = row({ id: 'row-bad', chatId: 'chat-bad' });
    const { repo } = makeRepo([bad, good]);

    // Wire repo.recordFired to throw for `row-bad` only.
    const original = repo.recordFired;
    repo.recordFired = mock(async (input: AdvanceInput) => {
      if (input.id === 'row-bad') throw new Error('boom');
      return original(input);
    });

    const { bus, calls } = makeEventBus();
    const stats = await sweepFollowUps({
      repo,
      eventBus: bus,
      logger: silentLogger,
      now: () => fixedNow,
    });

    expect(stats).toEqual({ scanned: 2, fired: 1, disarmed: 0, skipped: 1 });
    const types = calls.map((c) => c.type);
    expect(types).toContain('follow_up.skipped');
    // `row-good` still fired end-to-end.
    const idleForGood = calls.find((c) => c.type === 'chat.idle_timeout' && c.payload.chatId === 'chat-good');
    expect(idleForGood).toBeDefined();
  });

  test('respects batchLimit by passing it to the repo', async () => {
    const { repo } = makeRepo([]);
    const { bus } = makeEventBus();
    await sweepFollowUps({
      repo,
      eventBus: bus,
      logger: silentLogger,
      batchLimit: 25,
      now: () => fixedNow,
    });
    expect(repo.findAndLockDue).toHaveBeenCalledWith(fixedNow, 25);
  });

  test('syntheticPrompt in follow_up.fired payload matches chat.idle_timeout', async () => {
    const r = row();
    const { repo } = makeRepo([r]);
    const { bus, calls } = makeEventBus();

    await sweepFollowUps({
      repo,
      eventBus: bus,
      logger: silentLogger,
      now: () => fixedNow,
    });

    const idle = calls.find((c) => c.type === 'chat.idle_timeout');
    const fired = calls.find((c) => c.type === 'follow_up.fired');
    expect(idle?.payload.syntheticPrompt).toBeDefined();
    expect(fired?.payload.syntheticPrompt).toBe(idle?.payload.syntheticPrompt);
  });
});
