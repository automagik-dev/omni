/**
 * causationId stamping (#957, RFC #925 G3 feature half).
 *
 * `correlationId` groups a flow; `causationId` gives the tree — the id of the
 * IMMEDIATE parent event. Three stamp points: automation emit_event (the
 * triggering event), agent/action sends (the event that woke the run, via the
 * ambient causality scope), and external ingress (root: no causation, fresh
 * correlation).
 *
 * Runs the REAL engine over the in-memory bus that shares the production
 * envelope factory, so the stamps asserted here are the stamps NATS gets.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { InMemoryEventBus } from '../../events/__tests__/memory-bus';
import { currentEventCausality, runWithEventCausality } from '../../events/causality';
import { createOmniEvent } from '../../events/factory';
import { AutomationEngine } from '../engine';
import type { Automation } from '../types';

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

describe('ambient causality in the envelope factory (#957)', () => {
  test('outside any scope: no causationId, root self-references correlation (byte-identical pre-#957)', () => {
    const event = createOmniEvent('custom.root.event', { a: 1 }, undefined, 'test');
    expect(event.metadata.causationId).toBeUndefined();
    expect('causationId' in event.metadata).toBe(false);
    expect(event.metadata.correlationId).toBe(event.id);
  });

  test('inside a scope: causation and correlation fall back to the ambient context', () => {
    const event = runWithEventCausality({ correlationId: 'flow-1', causationId: 'parent-1' }, () =>
      createOmniEvent('custom.reaction.event', {}, undefined, 'test'),
    );
    expect(event.metadata.causationId).toBe('parent-1');
    expect(event.metadata.correlationId).toBe('flow-1');
  });

  test('explicit metadata beats the ambient context', () => {
    const event = runWithEventCausality({ correlationId: 'flow-1', causationId: 'parent-1' }, () =>
      createOmniEvent('custom.explicit.event', {}, { correlationId: 'flow-2', causationId: 'parent-2' }, 'test'),
    );
    expect(event.metadata.causationId).toBe('parent-2');
    expect(event.metadata.correlationId).toBe('flow-2');
  });

  test('the scope does not leak outside runWithEventCausality', () => {
    runWithEventCausality({ causationId: 'parent-1' }, () => {
      expect(currentEventCausality()?.causationId).toBe('parent-1');
    });
    expect(currentEventCausality()).toBeUndefined();
  });
});

describe('causation chain: webhook → emit_event → send (#957 acceptance)', () => {
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

  test('chain is traversable root→leaf via causationId, all sharing one correlationId', async () => {
    const emitHop = makeAutomation({
      id: 'auto-emit',
      triggerEventType: 'custom.webhook.tracetest',
      actions: [{ type: 'emit_event', config: { eventType: 'custom.trace.hop' } }],
    });
    // The send hop models call_agent/send_message: the injected sendMessage
    // publishes message-sent-style feedback WITHOUT any explicit causality —
    // exactly like a channel plugin — so the stamp must come from the
    // engine's ambient causality scope propagating through the dependency.
    const sendHop = makeAutomation({
      id: 'auto-send',
      triggerEventType: 'custom.trace.hop',
      actions: [
        {
          type: 'send_message',
          config: { instanceId: 'inst-1', to: '{{payload.chatId}}', contentTemplate: 'reply to {{payload.chatId}}' },
        },
      ],
    });

    await engine.start(bus, [emitHop, sendHop], {
      sendMessage: async () => {
        // Simulates BaseChannelPlugin.publishEventInternal: fresh explicit
        // correlation (journey key), NOTHING about causation.
        await bus.publishGeneric('custom.trace.sent', { delivered: true }, { correlationId: crypto.randomUUID() });
      },
    });

    const root = await bus.publishGeneric(
      'custom.webhook.tracetest',
      { chatId: 'chat-1', from: { id: 'user-1' }, content: { type: 'text', text: 'hi' } },
      { source: 'webhook' },
    );
    await bus.idle();

    expect(bus.journal).toHaveLength(3);
    const rootEvent = bus.journal.find((e) => e.id === root.id);
    const hopEvent = bus.journal.find((e) => e.type === 'custom.trace.hop');
    const leafEvent = bus.journal.find((e) => e.type === 'custom.trace.sent');
    if (!rootEvent || !hopEvent || !leafEvent) throw new Error('chain incomplete');

    // Root: fresh self-referencing correlation, NO causation.
    expect(rootEvent.metadata.causationId).toBeUndefined();
    expect(rootEvent.metadata.correlationId).toBe(rootEvent.id);

    // Tree: leaf → hop → root, walkable via causationId.
    expect(hopEvent.metadata.causationId).toBe(rootEvent.id);
    expect(leafEvent.metadata.causationId).toBe(hopEvent.id);

    // Flow: emit hops share the root correlation. The leaf models a channel
    // plugin that mints its own explicit correlation (journey tracking), so
    // only causation links it — that is precisely what #957 adds.
    expect(hopEvent.metadata.correlationId).toBe(rootEvent.metadata.correlationId);
  });

  test('debounced execution stamps the LAST REAL event as parent, never the synthetic flush id', async () => {
    const debounced = makeAutomation({
      id: 'auto-debounced-causation',
      triggerEventType: 'custom.trace.debounced',
      actions: [{ type: 'emit_event', config: { eventType: 'custom.trace.debounced_hop' } }],
      debounce: { mode: 'fixed', delayMs: 30 },
    });

    await engine.start(bus, [debounced], {});

    await bus.publishGeneric(
      'custom.trace.debounced',
      { from: { id: 'user-1' }, content: { type: 'text', text: 'first' } },
      { instanceId: 'inst-1' },
    );
    const last = await bus.publishGeneric(
      'custom.trace.debounced',
      { from: { id: 'user-1' }, content: { type: 'text', text: 'second' } },
      { instanceId: 'inst-1' },
    );
    await bus.idle();
    await new Promise((resolve) => setTimeout(resolve, 120));
    await bus.idle();

    const hop = bus.journal.find((e) => e.type === 'custom.trace.debounced_hop');
    expect(hop?.metadata.causationId).toBe(last.id);
  });
});
