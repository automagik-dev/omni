/**
 * Per-automation concurrency control (#1108).
 *
 * Runs are queued per INSTANCE, so two events describing the same business
 * fact both entered execution and both read the shared state before either
 * had written it — a lost update. `maxConcurrency` moves the automation onto
 * its own queue (1 = strict single-flight) and `concurrencyKey` partitions
 * that queue by a template over the payload, so unrelated keys stay parallel.
 *
 * The probe below is exactly that race: the action READS a ledger, yields,
 * then WRITES what it read. Serialized, the second run sees the first's row.
 */

import { describe, expect, mock, test } from 'bun:test';
import type { EventBus, SubscribeOptions, Subscription } from '../../events/bus';
import type { OmniEvent } from '../../events/types';
import { createAutomationEngine } from '../engine';
import type { Automation } from '../types';

function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 'auto-1',
    name: 'Append to ledger',
    enabled: true,
    priority: 0,
    triggerEventType: 'custom.order.confirmed',
    triggerConditions: [],
    conditionLogic: 'and',
    actions: [
      {
        type: 'send_message',
        config: { instanceId: 'inst-1', to: 'chat-1', contentTemplate: '{{payload.account}}|{{payload.ref}}' },
      },
    ],
    debounce: { mode: 'none' },
    ...overrides,
  } as unknown as Automation;
}

function orderEvent(id: string, payload: Record<string, unknown>): OmniEvent {
  return {
    id,
    type: 'custom.order.confirmed',
    payload,
    metadata: { correlationId: `corr-${id}`, instanceId: 'inst-1' },
    timestamp: Date.now(),
  } as unknown as OmniEvent;
}

function makeBus(): { bus: EventBus; deliver: (event: OmniEvent) => Promise<void> } {
  let handler: ((event: OmniEvent) => Promise<void>) | null = null;
  const subscription: Subscription = { id: 'sub', pattern: '*', unsubscribe: async () => {} };
  const bus = {
    connect: mock(async () => {}),
    publish: mock(async () => ({ id: '', sequence: 0, stream: '' })),
    publishGeneric: mock(async () => ({ id: '', sequence: 0, stream: '' })),
    subscribe: mock(async () => subscription),
    subscribePattern: mock(async (_p: string, h: (e: OmniEvent) => Promise<void>, _o?: SubscribeOptions) => {
      handler = h;
      return subscription;
    }),
    subscribeMany: mock(async () => subscription),
    subscribeAll: mock(async () => subscription),
    close: mock(async () => {}),
    isConnected: mock(() => true),
  } as unknown as EventBus;
  return {
    bus,
    deliver: async (event) => {
      if (!handler) throw new Error('engine never subscribed');
      await handler(event);
    },
  };
}

type ActionDep = (instanceId: string, to: string, content: string) => Promise<void>;

/**
 * A read-before-write action, one ledger per account (the rendered
 * `<account>|<ref>` content). Each entry records the ledger size the run SAW
 * before writing, so `['a@0', 'b@0']` is the lost update and `['a@0', 'b@1']`
 * is a run that observed its predecessor's side effect.
 */
function makeLedgerAction(): { rows: (account?: string) => string[]; sendMessage: ActionDep } {
  const ledgers = new Map<string, string[]>();
  const sendMessage = async (_instanceId: string, _to: string, content: string): Promise<void> => {
    const [account = '', ref = ''] = content.split('|');
    const seen = (ledgers.get(account) ?? []).length;
    await new Promise((resolve) => setTimeout(resolve, 15));
    ledgers.set(account, [...(ledgers.get(account) ?? []), `${ref}@${seen}`]);
  };
  return { rows: (account = '') => ledgers.get(account) ?? [], sendMessage };
}

describe('AutomationEngine — per-automation concurrency (#1108)', () => {
  test('maxConcurrency 1 serializes two events in the same tick; the second sees the first write', async () => {
    const engine = createAutomationEngine({ defaultConcurrency: 5 });
    const { bus, deliver } = makeBus();
    const { rows, sendMessage } = makeLedgerAction();

    await engine.start(bus, [makeAutomation({ maxConcurrency: 1 })], { sendMessage });
    await Promise.all([deliver(orderEvent('evt-a', { ref: 'a' })), deliver(orderEvent('evt-b', { ref: 'b' }))]);

    expect(rows()).toEqual(['a@0', 'b@1']);
    await engine.stop();
  });

  test('without the fields the same two events race on the shared per-instance queue', async () => {
    const engine = createAutomationEngine({ defaultConcurrency: 5 });
    const { bus, deliver } = makeBus();
    const { rows, sendMessage } = makeLedgerAction();

    await engine.start(bus, [makeAutomation()], { sendMessage });
    await Promise.all([deliver(orderEvent('evt-a', { ref: 'a' })), deliver(orderEvent('evt-b', { ref: 'b' }))]);

    // Both read the pre-write snapshot — the bug #1108 exists to fix. Kept as
    // the regression guard that the default path was NOT quietly serialized.
    expect(rows()).toEqual(['a@0', 'b@0']);
    expect(engine.getMetrics().instanceQueues.map((q) => q.instanceId)).toEqual(['inst-1']);
    await engine.stop();
  });

  test('an automation without the fields keeps sharing one queue with another automation', async () => {
    const engine = createAutomationEngine({ defaultConcurrency: 1 });
    const { bus, deliver } = makeBus();
    const { rows, sendMessage } = makeLedgerAction();

    const other = makeAutomation({ id: 'auto-2', name: 'Other' });
    await engine.start(bus, [makeAutomation(), other], { sendMessage });
    await deliver(orderEvent('evt-a', { ref: 'a' }));

    // One instance queue serving both automations, at the engine's default
    // limit — unchanged from before the feature.
    expect(engine.getMetrics().instanceQueues).toEqual([{ instanceId: 'inst-1', activeCount: 0, pendingCount: 0 }]);
    expect(rows()).toEqual(['a@0', 'a@1']);
    await engine.stop();
  });

  test('concurrencyKey renders over the payload: same key serializes, different keys stay parallel', async () => {
    const engine = createAutomationEngine({ defaultConcurrency: 5 });
    const { bus, deliver } = makeBus();
    const { rows, sendMessage } = makeLedgerAction();
    const automation = makeAutomation({ maxConcurrency: 1, concurrencyKey: '{{payload.account}}' });

    // Queues are sampled from inside a run — a partitioned queue is evicted
    // once idle, so after the last run the map is empty by design.
    const liveKeys = new Set<string>();
    const probe: ActionDep = async (instanceId, to, content) => {
      for (const q of engine.getMetrics().instanceQueues) liveKeys.add(q.instanceId);
      await sendMessage(instanceId, to, content);
    };

    await engine.start(bus, [automation], { sendMessage: probe });
    await Promise.all([
      deliver(orderEvent('evt-a', { ref: 'a', account: 'acct-1' })),
      deliver(orderEvent('evt-b', { ref: 'b', account: 'acct-1' })),
      deliver(orderEvent('evt-c', { ref: 'c', account: 'acct-2' })),
    ]);

    // acct-1 serialized behind itself — b read the ledger AFTER a wrote it —
    // while acct-2 ran against its own queue, untouched by either.
    expect(rows('acct-1')).toEqual(['a@0', 'b@1']);
    expect(rows('acct-2')).toEqual(['c@0']);
    expect([...liveKeys].sort()).toEqual(['inst-1:auto-1:acct-1', 'inst-1:auto-1:acct-2']);
    expect(engine.getMetrics().instanceQueues).toEqual([]);
    await engine.stop();
  });

  test('a concurrencyKey that renders empty falls back to the automation-wide queue', async () => {
    const engine = createAutomationEngine({ defaultConcurrency: 5 });
    const { bus, deliver } = makeBus();
    const { rows, sendMessage } = makeLedgerAction();
    const automation = makeAutomation({ maxConcurrency: 1, concurrencyKey: '{{payload.missing}}' });

    await engine.start(bus, [automation], { sendMessage });
    await Promise.all([deliver(orderEvent('evt-a', { ref: 'a' })), deliver(orderEvent('evt-b', { ref: 'b' }))]);

    // Merging into ONE queue is the conservative direction: an unresolvable
    // partition must never make a single-flight automation run in parallel.
    expect(rows()).toEqual(['a@0', 'b@1']);
    await engine.stop();
  });

  test('backpressure still applies on a per-automation queue', async () => {
    const engine = createAutomationEngine({ defaultConcurrency: 5, maxQueueDepth: 1 });
    const { bus, deliver } = makeBus();
    const { sendMessage } = makeLedgerAction();

    await engine.start(bus, [makeAutomation({ maxConcurrency: 1 })], { sendMessage });
    // One running, one pending (depth 1 = full), the third is refused.
    const settled = await Promise.allSettled([
      deliver(orderEvent('evt-a', { ref: 'a' })),
      deliver(orderEvent('evt-b', { ref: 'b' })),
      deliver(orderEvent('evt-c', { ref: 'c' })),
    ]);

    const rejected = settled.filter((s) => s.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      name: 'QueueFullError',
      queueKey: 'inst-1:auto-1',
      maxDepth: 1,
    });
    await engine.stop();
  });
});
