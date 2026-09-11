/**
 * Custom debounce grouping key (#1110).
 *
 * The debounce window already coalesced well — but only ever around a
 * CONVERSATION, because the key was hardcoded to `${instanceId}:${personId}`.
 * Any event that is not a chat message from a person could not use the
 * primitive at all, even when several of its events describe one underlying
 * fact (the motivating case: `opened`/`synchronize`/`enqueued`/`closed` for one
 * pull request).
 *
 * `debounce.key` is a template over the event payload naming the window. What
 * this file pins down:
 *   1. one flush per distinct rendered key per window, for an event type with
 *      no sender at all — the whole point of the issue;
 *   2. a row WITHOUT `key` still groups by conversation, byte-for-byte as
 *      before, including the senderless payload falling through to immediate;
 *   3. causal identity (#956) survives the flush of a custom-keyed window,
 *      exactly as it does for a conversation window — that guarantee is not
 *      conversation-shaped and must not quietly become so. Its ADR-0008 twin
 *      (the tenant envelope) is pinned alongside the conversation-window
 *      cases it mirrors, in `engine-tenant-threading.test.ts`;
 *   4. two instances never share a window.
 *
 * Runs the REAL engine over the in-memory bus (the same harness
 * `causation-chain.test.ts` uses), so the assertions are about what NATS and
 * the action callbacks actually see.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { InMemoryEventBus } from '../../events/__tests__/memory-bus';
import { AutomationEngine } from '../engine';
import type { Automation } from '../types';

/** An event type with NO `from` in its payload — unreachable before #1110. */
const PR_EVENT = 'custom.repo.pull_request';

function makeAutomation(
  partial: Partial<Automation> & Pick<Automation, 'id' | 'triggerEventType' | 'actions'>,
): Automation {
  return {
    name: `automation-${partial.id}`,
    description: null,
    triggerConditions: [],
    conditionLogic: 'and',
    debounce: null,
    enabled: true,
    priority: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  } as Automation;
}

/** Re-emits one event per flush, so the journal counts the windows for us. */
function loggingAutomation(partial: Partial<Automation> & Pick<Automation, 'id' | 'triggerEventType'>): Automation {
  return makeAutomation({
    actions: [{ type: 'emit_event', config: { eventType: 'custom.repo.flushed' } }],
    ...partial,
  });
}

const DELAY_MS = 25;
const SETTLE_MS = 120;

async function settle(bus: InMemoryEventBus): Promise<void> {
  await bus.idle();
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  await bus.idle();
}

describe('debounce.key: coalescing beyond a conversation (#1110)', () => {
  let bus: InMemoryEventBus;
  let engine: AutomationEngine;

  beforeEach(() => {
    bus = new InMemoryEventBus();
    engine = new AutomationEngine({ defaultConcurrency: 5, reconcileIntervalMs: 0 });
  });

  afterEach(async () => {
    await engine.stop();
    await bus.close();
  });

  test('fires once per distinct rendered key, for events that carry no sender', async () => {
    await engine.start(
      bus,
      [
        loggingAutomation({
          id: 'auto-pr',
          triggerEventType: PR_EVENT,
          debounce: { mode: 'fixed', delayMs: DELAY_MS, key: '{{payload.pull_request.id}}' },
        }),
      ],
      {},
    );

    // Five events, two pull requests, NO `from` anywhere.
    for (const [prId, action] of [
      [7, 'opened'],
      [7, 'synchronize'],
      [9, 'opened'],
      [7, 'closed'],
      [9, 'closed'],
    ] as const) {
      await bus.publishGeneric(PR_EVENT, { pull_request: { id: prId }, action }, { instanceId: 'inst-1' });
    }
    await settle(bus);

    const flushes = bus.journal.filter((e) => e.type === 'custom.repo.flushed');
    expect(flushes).toHaveLength(2);
    // Each flush carries the LAST payload of its window.
    const flushed = flushes
      .map((e) => (e.payload as { pull_request: { id: number }; action: string }).pull_request.id)
      .sort();
    expect(flushed).toEqual([7, 9]);
  });

  test('two instances never share a window for the same rendered key', async () => {
    await engine.start(
      bus,
      [
        loggingAutomation({
          id: 'auto-pr-ns',
          triggerEventType: PR_EVENT,
          debounce: { mode: 'fixed', delayMs: DELAY_MS, key: '{{payload.pull_request.id}}' },
        }),
      ],
      {},
    );

    await bus.publishGeneric(PR_EVENT, { pull_request: { id: 1 } }, { instanceId: 'inst-1' });
    await bus.publishGeneric(PR_EVENT, { pull_request: { id: 1 } }, { instanceId: 'inst-2' });
    await settle(bus);

    expect(bus.journal.filter((e) => e.type === 'custom.repo.flushed')).toHaveLength(2);
  });

  test('a key template that renders empty coalesces nothing — every event goes through', async () => {
    await engine.start(
      bus,
      [
        loggingAutomation({
          id: 'auto-pr-empty',
          triggerEventType: PR_EVENT,
          // Nothing in the payload resolves this path.
          debounce: { mode: 'fixed', delayMs: DELAY_MS, key: '{{payload.missing.id}}' },
        }),
      ],
      {},
    );

    await bus.publishGeneric(PR_EVENT, { action: 'opened' }, { instanceId: 'inst-1' });
    await bus.publishGeneric(PR_EVENT, { action: 'closed' }, { instanceId: 'inst-1' });
    await settle(bus);

    // Losing an event to a bucket with no shared fact is worse than not
    // grouping, so an unrenderable key must not group.
    expect(bus.journal.filter((e) => e.type === 'custom.repo.flushed')).toHaveLength(2);
  });

  test('causal identity survives the flush: the parent is the LAST REAL event, not the synthetic id', async () => {
    await engine.start(
      bus,
      [
        loggingAutomation({
          id: 'auto-pr-causal',
          triggerEventType: PR_EVENT,
          debounce: { mode: 'fixed', delayMs: DELAY_MS, key: '{{payload.pull_request.id}}' },
        }),
      ],
      {},
    );

    const FLOW = 'flow-1110';
    await bus.publishGeneric(
      PR_EVENT,
      { pull_request: { id: 42 }, action: 'opened' },
      { instanceId: 'inst-1', correlationId: FLOW },
    );
    const last = await bus.publishGeneric(
      PR_EVENT,
      { pull_request: { id: 42 }, action: 'closed' },
      { instanceId: 'inst-1', correlationId: FLOW },
    );
    await settle(bus);

    const flush = bus.journal.find((e) => e.type === 'custom.repo.flushed');
    // Parent is a PUBLISHED event, never the id the flush minted for itself.
    expect(flush?.metadata.causationId).toBe(last.id);
    // And the debounced hop continues the flow instead of minting a fresh
    // correlation and breaking the chain here.
    expect(flush?.metadata.correlationId).toBe(FLOW);
  });
});

describe('no debounce.key: conversation grouping is untouched (#1110)', () => {
  let bus: InMemoryEventBus;
  let engine: AutomationEngine;

  beforeEach(() => {
    bus = new InMemoryEventBus();
    engine = new AutomationEngine({ defaultConcurrency: 5, reconcileIntervalMs: 0 });
  });

  afterEach(async () => {
    await engine.stop();
    await bus.close();
  });

  test('still groups per sender, and the payload sender is still what keys the window', async () => {
    await engine.start(
      bus,
      [
        loggingAutomation({
          id: 'auto-chat',
          triggerEventType: PR_EVENT,
          debounce: { mode: 'fixed', delayMs: DELAY_MS },
        }),
      ],
      {},
    );

    for (const [userId, text] of [
      ['user-1', 'a'],
      ['user-1', 'b'],
      ['user-2', 'c'],
    ] as const) {
      await bus.publishGeneric(
        PR_EVENT,
        { from: { id: userId }, content: { type: 'text', text } },
        { instanceId: 'inst-1' },
      );
    }
    await settle(bus);

    const flushes = bus.journal.filter((e) => e.type === 'custom.repo.flushed');
    expect(flushes).toHaveLength(2);
    expect(flushes.map((e) => (e.payload as { from: { id: string } }).from.id).sort()).toEqual(['user-1', 'user-2']);
  });

  test('a payload with no sender still falls through to immediate execution', async () => {
    await engine.start(
      bus,
      [
        loggingAutomation({
          id: 'auto-chat-nosender',
          triggerEventType: PR_EVENT,
          debounce: { mode: 'fixed', delayMs: DELAY_MS },
        }),
      ],
      {},
    );

    await bus.publishGeneric(PR_EVENT, { pull_request: { id: 1 } }, { instanceId: 'inst-1' });
    await bus.publishGeneric(PR_EVENT, { pull_request: { id: 1 } }, { instanceId: 'inst-1' });
    await settle(bus);

    expect(bus.journal.filter((e) => e.type === 'custom.repo.flushed')).toHaveLength(2);
  });
});
