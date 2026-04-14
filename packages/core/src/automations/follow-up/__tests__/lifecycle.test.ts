/**
 * Unit tests for arm/disarm lifecycle primitives.
 *
 * Uses a fake in-memory repo + capturing event bus so we can assert on the
 * exact DB state transitions and emitted events. The schedule math is
 * covered separately in schedule.test.ts — here we only verify the
 * orchestration: "arm upserts a row and emits follow_up.armed", "disarm
 * no-ops when already disarmed", etc.
 *
 * @see issue #404 — Configurable Idle-Chat Follow-Up Sequences
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import type { EventBus } from '../../../events/bus';
import type { FollowUpSequenceConfig } from '../../../schemas/follow-up';
import { type ArmInput, type FollowUpLifecycleRepo, armSequence, disarmSequence } from '../lifecycle';

interface StoredRow {
  chatId: string;
  instanceId: string;
  agentId: string | null;
  config: FollowUpSequenceConfig;
  sequenceIndex: number;
  lastAgentMessageAt: Date;
  nextFireAt: Date | null;
  disarmReason: string | null;
  disarmedAt: Date | null;
  lastInboundCustomerMessageAt?: Date;
}

class FakeRepo implements FollowUpLifecycleRepo {
  public rows = new Map<string, StoredRow>();
  public upsertCalls = 0;
  public disarmCalls = 0;

  private key(chatId: string, instanceId: string) {
    return `${chatId}::${instanceId}`;
  }

  async upsertArmed(input: ArmInput): Promise<{ created: boolean }> {
    this.upsertCalls += 1;
    const key = this.key(input.chatId, input.instanceId);
    const existing = this.rows.get(key);
    const row: StoredRow = {
      chatId: input.chatId,
      instanceId: input.instanceId,
      agentId: input.agentId,
      config: input.config,
      sequenceIndex: 0,
      lastAgentMessageAt: input.lastAgentMessageAt,
      nextFireAt: input.nextFireAt,
      disarmReason: null,
      disarmedAt: null,
      ...(existing?.lastInboundCustomerMessageAt
        ? { lastInboundCustomerMessageAt: existing.lastInboundCustomerMessageAt }
        : {}),
    };
    this.rows.set(key, row);
    return { created: !existing };
  }

  async disarmActive(input: {
    chatId: string;
    instanceId: string;
    reason: string;
    at: Date;
    lastInboundCustomerMessageAt?: Date;
  }): Promise<{ disarmed: boolean }> {
    this.disarmCalls += 1;
    const key = this.key(input.chatId, input.instanceId);
    const row = this.rows.get(key);
    if (!row || row.disarmReason !== null) {
      return { disarmed: false };
    }
    row.disarmReason = input.reason;
    row.disarmedAt = input.at;
    row.nextFireAt = null;
    if (input.lastInboundCustomerMessageAt) {
      row.lastInboundCustomerMessageAt = input.lastInboundCustomerMessageAt;
    }
    return { disarmed: true };
  }
}

interface CapturedEvent {
  type: string;
  payload: unknown;
  metadata?: Record<string, unknown>;
}

function makeFakeBus(): { bus: Pick<EventBus, 'publish'>; events: CapturedEvent[] } {
  const events: CapturedEvent[] = [];
  const bus: Pick<EventBus, 'publish'> = {
    publish: async (type, payload, metadata) => {
      events.push({ type: type as string, payload, metadata: metadata as Record<string, unknown> });
      return { id: 'evt', sequence: events.length, stream: 'test' };
    },
  };
  return { bus, events };
}

function silentLogger() {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
}

const baseConfig: FollowUpSequenceConfig = {
  enabled: true,
  schedule: { kind: 'fixed', intervalsMinutes: [3, 5, 30] },
  maxFollowUps: 3,
  promptTemplate: 'please follow up with {{chatName}}',
  stopOutsideMessagingWindow: true,
  showTypingIndicator: true,
};

describe('armSequence', () => {
  let repo: FakeRepo;
  let bus: { bus: Pick<EventBus, 'publish'>; events: CapturedEvent[] };

  beforeEach(() => {
    repo = new FakeRepo();
    bus = makeFakeBus();
  });

  it('upserts a row and emits follow_up.armed on first arm', async () => {
    const lastAgentMessageAt = new Date('2026-04-14T12:00:00Z');

    const result = await armSequence(
      { repo, eventBus: bus.bus, logger: silentLogger() },
      {
        chatId: 'chat-1',
        instanceId: 'inst-1',
        agentId: 'agent-1',
        config: baseConfig,
        lastAgentMessageAt,
      },
    );

    expect(result.armed).toBe(true);
    expect(result.created).toBe(true);
    // First interval is 3min.
    expect(result.nextFireAt.getTime()).toBe(lastAgentMessageAt.getTime() + 3 * 60_000);

    const row = repo.rows.get('chat-1::inst-1');
    expect(row).toBeDefined();
    expect(row?.sequenceIndex).toBe(0);
    expect(row?.disarmReason).toBeNull();
    expect(row?.agentId).toBe('agent-1');

    expect(bus.events).toHaveLength(1);
    expect(bus.events[0]?.type).toBe('follow_up.armed');
    expect(bus.events[0]?.payload).toMatchObject({
      chatId: 'chat-1',
      instanceId: 'inst-1',
      agentId: 'agent-1',
      sequenceIndex: 0,
      nextFireAt: result.nextFireAt.getTime(),
    });
  });

  it('re-arming refreshes an existing row (created=false) and resets sequence state', async () => {
    const first = new Date('2026-04-14T12:00:00Z');
    await armSequence(
      { repo, eventBus: bus.bus, logger: silentLogger() },
      { chatId: 'c', instanceId: 'i', agentId: null, config: baseConfig, lastAgentMessageAt: first },
    );

    // Simulate mid-sequence advance (as if the sweeper fired once).
    const row = repo.rows.get('c::i');
    if (!row) throw new Error('row should exist');
    row.sequenceIndex = 1;

    const second = new Date('2026-04-14T12:10:00Z');
    const result = await armSequence(
      { repo, eventBus: bus.bus, logger: silentLogger() },
      { chatId: 'c', instanceId: 'i', agentId: null, config: baseConfig, lastAgentMessageAt: second },
    );

    expect(result.created).toBe(false);
    expect(result.armed).toBe(true);
    const after = repo.rows.get('c::i');
    expect(after?.sequenceIndex).toBe(0);
    expect(after?.lastAgentMessageAt).toEqual(second);
    expect(after?.nextFireAt?.getTime()).toBe(second.getTime() + 3 * 60_000);
  });

  it('is a no-op when config is disabled', async () => {
    const disabled: FollowUpSequenceConfig = { ...baseConfig, enabled: false };
    const result = await armSequence(
      { repo, eventBus: bus.bus, logger: silentLogger() },
      {
        chatId: 'c',
        instanceId: 'i',
        agentId: null,
        config: disabled,
        lastAgentMessageAt: new Date(),
      },
    );
    expect(result.armed).toBe(false);
    expect(repo.upsertCalls).toBe(0);
    expect(bus.events).toHaveLength(0);
  });

  it('swallows event bus publish errors without rolling back the upsert', async () => {
    const failingBus: Pick<EventBus, 'publish'> = {
      publish: (async () => {
        throw new Error('nats down');
      }) as Pick<EventBus, 'publish'>['publish'],
    };

    const result = await armSequence(
      { repo, eventBus: failingBus, logger: silentLogger() },
      {
        chatId: 'c',
        instanceId: 'i',
        agentId: null,
        config: baseConfig,
        lastAgentMessageAt: new Date(),
      },
    );

    expect(result.armed).toBe(true);
    expect(repo.rows.size).toBe(1);
  });
});

describe('disarmSequence', () => {
  let repo: FakeRepo;
  let bus: { bus: Pick<EventBus, 'publish'>; events: CapturedEvent[] };

  beforeEach(() => {
    repo = new FakeRepo();
    bus = makeFakeBus();
  });

  async function seedArmed() {
    await armSequence(
      { repo, eventBus: bus.bus, logger: silentLogger() },
      {
        chatId: 'c',
        instanceId: 'i',
        agentId: 'a',
        config: baseConfig,
        lastAgentMessageAt: new Date('2026-04-14T12:00:00Z'),
      },
    );
    bus.events.length = 0; // drop the arm event
  }

  it('disarms an active row and emits follow_up.disarmed', async () => {
    await seedArmed();

    const replyAt = new Date('2026-04-14T12:02:00Z');
    const result = await disarmSequence(
      { repo, eventBus: bus.bus, logger: silentLogger() },
      {
        chatId: 'c',
        instanceId: 'i',
        agentId: 'a',
        reason: 'customer_replied',
        lastInboundCustomerMessageAt: replyAt,
      },
    );

    expect(result.disarmed).toBe(true);
    const row = repo.rows.get('c::i');
    expect(row?.disarmReason).toBe('customer_replied');
    expect(row?.lastInboundCustomerMessageAt).toEqual(replyAt);

    expect(bus.events).toHaveLength(1);
    expect(bus.events[0]?.type).toBe('follow_up.disarmed');
    expect(bus.events[0]?.payload).toMatchObject({
      chatId: 'c',
      instanceId: 'i',
      reason: 'customer_replied',
    });
  });

  it('no-ops with no event when the row does not exist', async () => {
    const result = await disarmSequence(
      { repo, eventBus: bus.bus, logger: silentLogger() },
      { chatId: 'missing', instanceId: 'i', reason: 'customer_replied' },
    );
    expect(result.disarmed).toBe(false);
    expect(bus.events).toHaveLength(0);
  });

  it('no-ops when the row is already disarmed (idempotent second disarm)', async () => {
    await seedArmed();
    await disarmSequence(
      { repo, eventBus: bus.bus, logger: silentLogger() },
      { chatId: 'c', instanceId: 'i', reason: 'customer_replied' },
    );
    bus.events.length = 0;

    const second = await disarmSequence(
      { repo, eventBus: bus.bus, logger: silentLogger() },
      { chatId: 'c', instanceId: 'i', reason: 'handoff' },
    );
    expect(second.disarmed).toBe(false);
    expect(bus.events).toHaveLength(0);
    // The first reason sticks — no accidental overwrite.
    expect(repo.rows.get('c::i')?.disarmReason).toBe('customer_replied');
  });

  it('distinguishes disarm reasons on separate chats', async () => {
    await armSequence(
      { repo, eventBus: bus.bus, logger: silentLogger() },
      {
        chatId: 'c1',
        instanceId: 'i',
        agentId: null,
        config: baseConfig,
        lastAgentMessageAt: new Date(),
      },
    );
    await armSequence(
      { repo, eventBus: bus.bus, logger: silentLogger() },
      {
        chatId: 'c2',
        instanceId: 'i',
        agentId: null,
        config: baseConfig,
        lastAgentMessageAt: new Date(),
      },
    );
    bus.events.length = 0;

    await disarmSequence(
      { repo, eventBus: bus.bus, logger: silentLogger() },
      { chatId: 'c1', instanceId: 'i', reason: 'archived' },
    );
    await disarmSequence(
      { repo, eventBus: bus.bus, logger: silentLogger() },
      { chatId: 'c2', instanceId: 'i', reason: 'handoff' },
    );

    expect(repo.rows.get('c1::i')?.disarmReason).toBe('archived');
    expect(repo.rows.get('c2::i')?.disarmReason).toBe('handoff');
    expect(bus.events.map((e) => (e.payload as { reason: string }).reason)).toEqual(['archived', 'handoff']);
  });
});
