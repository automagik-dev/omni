/**
 * Transactional publication (G5, RFC #925, issue #988).
 *
 * With `automations.transactional_emissions` ON, a run's `emit_event`
 * publishes are accumulated in a run-scoped buffer and flushed IN ORDER only
 * when every action of the run succeeded — a failed run publishes zero.
 * Non-emission actions keep the continue-on-failure semantics either way,
 * and with the flag OFF behavior is byte-for-byte today's immediate
 * mid-sequence publishing.
 *
 * The #958 derived idempotency keys
 * (`derived:{parentEventId}:{automationId}:{actionIndex}`) are stamped at
 * ENQUEUE time with the action's position in the automation, so a DLQ-retried
 * run reproduces byte-identical keys and a successful retry cannot duplicate.
 */

import { describe, expect, mock, test } from 'bun:test';
import type { EventBus, Subscription } from '../../events/bus';
import type { EventType, OmniEvent } from '../../events/types';
import { type ActionDependencies, executeActions } from '../actions';
import { AutomationEngine } from '../engine';
import type { TemplateContext } from '../templates';
import type { Automation, AutomationAction } from '../types';

// ============================================================================
// Executor-level harness (injected publish fakes — the main vehicle)
// ============================================================================

interface CapturedPublish {
  type: string;
  payload: Record<string, unknown>;
  options: Record<string, unknown> | undefined;
}

interface Timeline {
  entries: string[];
}

function makeContext(overrides: Partial<TemplateContext> = {}): TemplateContext {
  return {
    payload: {
      instanceId: 'wa-001',
      from: { id: 'user-1', name: 'Alice' },
      chatId: 'chat-1',
      content: 'hello',
    },
    variables: {},
    env: {},
    ...overrides,
  };
}

function makeDeps(options: {
  published: CapturedPublish[];
  timeline?: Timeline;
  claimedKeys?: Set<string>;
  claims?: Array<{ idempotencyKey: string; eventId: string }>;
  releasedClaims?: string[];
  failPublishOfType?: string;
  withSendMessage?: boolean;
}): ActionDependencies {
  const deps: ActionDependencies = {
    eventBus: {
      publishGeneric: mock(async (type: string, payload: Record<string, unknown>, opts?: Record<string, unknown>) => {
        if (options.failPublishOfType === type) {
          throw new Error(`NATS down for ${type}`);
        }
        options.published.push({ type, payload, options: opts });
        options.timeline?.entries.push(`publish:${type}`);
        return { id: `pub-${options.published.length}`, type, timestamp: Date.now(), metadata: {}, payload };
      }),
    } as unknown as EventBus,
  };
  if (options.claimedKeys) {
    const claimedKeys = options.claimedKeys;
    deps.claimEmittedEvent = mock(async (claim: { idempotencyKey: string; eventId: string }) => {
      options.claims?.push({ idempotencyKey: claim.idempotencyKey, eventId: claim.eventId });
      if (claimedKeys.has(claim.idempotencyKey)) return false;
      claimedKeys.add(claim.idempotencyKey);
      return true;
    });
    deps.releaseEmittedEventClaim = mock(async (eventId: string) => {
      options.releasedClaims?.push(eventId);
      // Mirror the API implementation: the journal row (and its key) go away.
      const claim = options.claims?.find((c) => c.eventId === eventId);
      if (claim) claimedKeys.delete(claim.idempotencyKey);
    });
  }
  if (options.withSendMessage) {
    deps.sendMessage = mock(async (_instanceId: string, _to: string, _content: string) => {
      options.timeline?.entries.push('send');
    });
  }
  return deps;
}

function emit(eventType: string): AutomationAction {
  return { type: 'emit_event', config: { eventType, payloadTemplate: { marker: eventType } } };
}

/** Deterministic failure: send_message without a sendMessage dependency. */
const FAILING_ACTION: AutomationAction = {
  type: 'send_message',
  config: { instanceId: 'wa-001', to: 'chat-1', contentTemplate: 'x' },
};

const SEND_ACTION: AutomationAction = {
  type: 'send_message',
  config: { instanceId: 'wa-001', to: 'chat-1', contentTemplate: 'ok' },
};

const PROVENANCE = { parentEventId: 'evt-parent', automationId: 'auto-1' };

describe('flag off — today behavior pinned byte-for-byte', () => {
  test('emissions publish immediately, even after a failed earlier action', async () => {
    const published: CapturedPublish[] = [];
    const deps = makeDeps({ published });

    const results = await executeActions(
      [emit('custom.first'), FAILING_ACTION, emit('custom.second')],
      makeContext(),
      deps,
      null,
      PROVENANCE,
    );

    // Both emissions published despite the failed middle action.
    expect(published.map((p) => p.type)).toEqual(['custom.first', 'custom.second']);
    expect(results.map((r) => r.status)).toEqual(['success', 'failed', 'success']);
  });

  test('emissions interleave with other actions mid-sequence', async () => {
    const published: CapturedPublish[] = [];
    const timeline: Timeline = { entries: [] };
    const deps = makeDeps({ published, timeline, withSendMessage: true });

    await executeActions([emit('custom.a'), SEND_ACTION, emit('custom.b')], makeContext(), deps, null, PROVENANCE);

    expect(timeline.entries).toEqual(['publish:custom.a', 'send', 'publish:custom.b']);
  });
});

describe('flag on — successful run flushes in order after the last action', () => {
  test('emissions publish only AFTER the last action, in enqueue order', async () => {
    const published: CapturedPublish[] = [];
    const timeline: Timeline = { entries: [] };
    const deps = makeDeps({ published, timeline, withSendMessage: true });

    const results = await executeActions(
      [emit('custom.a'), SEND_ACTION, emit('custom.b')],
      makeContext(),
      deps,
      null,
      PROVENANCE,
      { transactionalEmissions: true },
    );

    // The send happens first; both publishes land after it, preserving order.
    expect(timeline.entries).toEqual(['send', 'publish:custom.a', 'publish:custom.b']);
    expect(results.map((r) => r.status)).toEqual(['success', 'success', 'success']);
    // Flushed results carry the same shape immediate publishing produces.
    expect(results[0]?.result).toEqual({ eventId: 'pub-1', eventType: 'custom.a' });
    expect(results[2]?.result).toEqual({ eventId: 'pub-2', eventType: 'custom.b' });
  });

  test('buffered publishes carry an envelope identical to immediate publishing', async () => {
    const immediate: CapturedPublish[] = [];
    const immediateClaims: Array<{ idempotencyKey: string; eventId: string }> = [];
    const buffered: CapturedPublish[] = [];
    const bufferedClaims: Array<{ idempotencyKey: string; eventId: string }> = [];

    const context = makeContext({
      event: {
        id: 'evt-parent',
        type: 'custom.trigger' as never,
        payload: {},
        metadata: { correlationId: 'corr-1' },
        timestamp: 1,
      } as never,
    });

    await executeActions(
      [emit('custom.a'), SEND_ACTION, emit('custom.b')],
      context,
      makeDeps({ published: immediate, claimedKeys: new Set(), claims: immediateClaims, withSendMessage: true }),
      'tenant-1',
      PROVENANCE,
    );
    await executeActions(
      [emit('custom.a'), SEND_ACTION, emit('custom.b')],
      context,
      makeDeps({ published: buffered, claimedKeys: new Set(), claims: bufferedClaims, withSendMessage: true }),
      'tenant-1',
      PROVENANCE,
      { transactionalEmissions: true },
    );

    // Same types, payloads, correlation/causation/tenant metadata — the
    // publishEventId differs only by the random claim-row id, so compare the
    // rest field-by-field.
    expect(buffered.map((p) => p.type)).toEqual(immediate.map((p) => p.type));
    expect(buffered.map((p) => p.payload)).toEqual(immediate.map((p) => p.payload));
    for (const [i, publish] of buffered.entries()) {
      const { publishEventId: _b, ...bufferedOptions } = publish.options ?? {};
      const { publishEventId: _i, ...immediateOptions } = immediate[i]?.options ?? {};
      expect(bufferedOptions).toEqual(immediateOptions);
    }
    // CRITICAL (#958 invariant): derived keys are byte-identical — actionIndex
    // is stamped at ENQUEUE time from the action's position (0 and 2, not the
    // buffer positions 0 and 1).
    expect(bufferedClaims.map((c) => c.idempotencyKey)).toEqual([
      'derived:evt-parent:auto-1:0',
      'derived:evt-parent:auto-1:2',
    ]);
    expect(bufferedClaims.map((c) => c.idempotencyKey)).toEqual(immediateClaims.map((c) => c.idempotencyKey));
  });
});

describe('flag on — failed run publishes zero', () => {
  test('an action failure discards every buffered emission, nothing reaches the bus or the claim journal', async () => {
    const published: CapturedPublish[] = [];
    const claims: Array<{ idempotencyKey: string; eventId: string }> = [];
    const deps = makeDeps({ published, claimedKeys: new Set(), claims });

    const results = await executeActions(
      [emit('custom.first'), FAILING_ACTION, emit('custom.second')],
      makeContext(),
      deps,
      null,
      PROVENANCE,
      { transactionalEmissions: true },
    );

    expect(published).toEqual([]);
    // No claim rows burned either — the DLQ retry starts completely clean.
    expect(claims).toEqual([]);
    // The discard is visible in the run's action results.
    expect(results[0]?.status).toBe('failed');
    expect(results[0]?.error).toContain('discarded');
    expect(results[0]?.result).toEqual({ eventType: 'custom.first', buffered: true, discarded: true });
    expect(results[2]?.status).toBe('failed');
    expect(results[2]?.error).toContain('discarded');
  });

  test('a failing emit_event PREPARE (schema gate) also discards the rest of the buffer', async () => {
    const published: CapturedPublish[] = [];
    const deps = makeDeps({ published });
    deps.validateEmitEvent = mock(async (eventType: string) =>
      eventType === 'custom.bad' ? { valid: false, errors: ['nope'] } : { valid: true },
    );

    const results = await executeActions(
      [emit('custom.good'), emit('custom.bad')],
      makeContext(),
      deps,
      null,
      PROVENANCE,
      { transactionalEmissions: true },
    );

    expect(published).toEqual([]);
    expect(results[0]?.status).toBe('failed');
    expect(results[1]?.status).toBe('failed');
    expect(results[1]?.error).toContain('nope');
  });
});

describe('flag on — multi-emit ordering', () => {
  test('three emissions flush in exact enqueue order', async () => {
    const published: CapturedPublish[] = [];
    const deps = makeDeps({ published });

    await executeActions(
      [emit('custom.one'), emit('custom.two'), emit('custom.three')],
      makeContext(),
      deps,
      null,
      PROVENANCE,
      { transactionalEmissions: true },
    );

    expect(published.map((p) => p.type)).toEqual(['custom.one', 'custom.two', 'custom.three']);
  });
});

describe('flag on — retry semantics (#958 derived keys)', () => {
  test('re-executing the same run reproduces identical keys and dedupes instead of duplicating', async () => {
    const published: CapturedPublish[] = [];
    const claimedKeys = new Set<string>();
    const firstClaims: Array<{ idempotencyKey: string; eventId: string }> = [];
    const secondClaims: Array<{ idempotencyKey: string; eventId: string }> = [];
    const actions = [emit('custom.a'), emit('custom.b')];

    const first = await executeActions(
      actions,
      makeContext(),
      makeDeps({ published, claimedKeys, claims: firstClaims }),
      null,
      PROVENANCE,
      { transactionalEmissions: true },
    );
    const second = await executeActions(
      actions,
      makeContext(),
      makeDeps({ published, claimedKeys, claims: secondClaims }),
      null,
      PROVENANCE,
      { transactionalEmissions: true },
    );

    // Key equality is the invariant — the #958 dedup does the rest.
    expect(secondClaims.map((c) => c.idempotencyKey)).toEqual(firstClaims.map((c) => c.idempotencyKey));
    expect(firstClaims.map((c) => c.idempotencyKey)).toEqual([
      'derived:evt-parent:auto-1:0',
      'derived:evt-parent:auto-1:1',
    ]);
    expect(published.map((p) => p.type)).toEqual(['custom.a', 'custom.b']);
    expect(first.map((r) => r.status)).toEqual(['success', 'success']);
    expect(second.map((r) => r.status)).toEqual(['success', 'success']);
    expect(second.map((r) => (r.result as { duplicate?: boolean }).duplicate)).toEqual([true, true]);
  });

  test('a mid-flush publish failure keeps published events an exact prefix and releases the failed claim', async () => {
    const published: CapturedPublish[] = [];
    const claimedKeys = new Set<string>();
    const claims: Array<{ idempotencyKey: string; eventId: string }> = [];
    const releasedClaims: string[] = [];
    const deps = makeDeps({
      published,
      claimedKeys,
      claims,
      releasedClaims,
      failPublishOfType: 'custom.two',
    });

    const results = await executeActions(
      [emit('custom.one'), emit('custom.two'), emit('custom.three')],
      makeContext(),
      deps,
      null,
      PROVENANCE,
      { transactionalEmissions: true },
    );

    // Prefix only: one published, the failed slot's claim released (so a DLQ
    // retry can re-emit it), the rest discarded unclaimed.
    expect(published.map((p) => p.type)).toEqual(['custom.one']);
    expect(releasedClaims).toHaveLength(1);
    expect(claimedKeys).toEqual(new Set(['derived:evt-parent:auto-1:0']));
    expect(results.map((r) => r.status)).toEqual(['success', 'failed', 'failed']);
    expect(results[1]?.error).toContain('NATS down');
    expect(results[2]?.error).toContain('discarded');
  });
});

// ============================================================================
// Engine-level: the per-automation flag threads from the Automation row
// ============================================================================

function captureBus(): {
  bus: EventBus;
  handlers: Map<string, (event: OmniEvent) => Promise<void>>;
  published: CapturedPublish[];
} {
  const handlers = new Map<string, (event: OmniEvent) => Promise<void>>();
  const published: CapturedPublish[] = [];
  const bus = {
    publish: async () => ({ id: 'pub', timestamp: Date.now() }),
    publishGeneric: async (type: string, payload: Record<string, unknown>, options?: Record<string, unknown>) => {
      published.push({ type, payload, options });
      return { id: 'pub-generic', timestamp: Date.now() };
    },
    subscribe: async () => ({ unsubscribe: async () => {} }) as Subscription,
    subscribePattern: async (pattern: string, handler: (event: OmniEvent) => Promise<void>) => {
      handlers.set(pattern, handler);
      return { unsubscribe: async () => {} } as Subscription;
    },
    flush: async () => {},
    close: async () => {},
  } as unknown as EventBus;
  return { bus, handlers, published };
}

function makeAutomation(overrides: Partial<Automation> & { actions: Automation['actions'] }): Automation {
  return {
    id: 'auto-1',
    name: 'transactional probe',
    enabled: true,
    priority: 0,
    triggerEventType: 'custom.txn-probe',
    triggerConditions: [],
    conditionLogic: 'and',
    debounce: null,
    ...overrides,
  } as Automation;
}

function makeEvent(): OmniEvent {
  return {
    id: 'evt-1',
    type: 'custom.txn-probe' as EventType,
    payload: { instanceId: 'inst-1', chatId: 'chat-1', content: 'hi' },
    metadata: { correlationId: 'corr-1', instanceId: 'inst-1' },
    timestamp: Date.now(),
  } as OmniEvent;
}

const ENGINE_ACTIONS: AutomationAction[] = [
  { type: 'emit_event', config: { eventType: 'custom.engine-emit' } },
  // Fails: the engine harness injects no sendMessage dependency.
  { type: 'send_message', config: { instanceId: 'inst-1', to: 'chat-1', contentTemplate: 'x' } },
];

async function fireThroughEngine(automationRow: Automation): Promise<{ published: CapturedPublish[]; status: string }> {
  const { bus, handlers, published } = captureBus();
  const engine = new AutomationEngine({ defaultConcurrency: 2, reconcileIntervalMs: 0 });
  let status = 'unknown';
  engine.setLogger(async (log) => {
    status = log.status as string;
  });
  await engine.start(bus, [automationRow], {});
  try {
    const handler = handlers.get('custom.txn-probe.>');
    if (!handler) throw new Error('engine did not subscribe to the trigger');
    await handler(makeEvent());
  } finally {
    await engine.stop();
  }
  return { published, status };
}

describe('engine threads automations.transactional_emissions (#988)', () => {
  test('flag on: a failed run publishes zero', async () => {
    const { published, status } = await fireThroughEngine(
      makeAutomation({ actions: ENGINE_ACTIONS, transactionalEmissions: true }),
    );
    expect(status).toBe('failed');
    expect(published).toEqual([]);
  });

  test('flag off (and flag absent): the emission still publishes despite the later failure', async () => {
    const explicitOff = await fireThroughEngine(
      makeAutomation({ actions: ENGINE_ACTIONS, transactionalEmissions: false }),
    );
    expect(explicitOff.status).toBe('failed');
    expect(explicitOff.published.map((p) => p.type)).toEqual(['custom.engine-emit']);

    const absent = await fireThroughEngine(makeAutomation({ actions: ENGINE_ACTIONS }));
    expect(absent.status).toBe('failed');
    expect(absent.published.map((p) => p.type)).toEqual(['custom.engine-emit']);
  });
});
