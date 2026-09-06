/**
 * Correlation-chain integration tests (#956).
 *
 * The RFC #925 defect: `emit_event` used to propagate correlation from the
 * PAYLOAD (which never carries it), so every automation hop was born with a
 * fresh correlation and the chain `webhook → automation → emit_event →
 * automation` restarted its correlation at every hop.
 *
 * These tests run the REAL engine over an in-memory bus that shares the real
 * envelope factory (`createOmniEvent`), so root self-reference and metadata
 * defaulting behave exactly as the NATS bus.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { InMemoryEventBus } from '../../events/__tests__/memory-bus';
import { executeActions } from '../actions';
import { AutomationEngine } from '../engine';
import { createTemplateContext } from '../templates';
import type { Automation, NewAutomationLog } from '../types';

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

describe('correlation chain across automation hops (#956)', () => {
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

  test('webhook → automation(emit_event) → automation(emit_event) shares ONE correlationId across all three journal entries', async () => {
    const logs: NewAutomationLog[] = [];

    const hopOne = makeAutomation({
      id: 'auto-hop-one',
      triggerEventType: 'custom.webhook.chaintest',
      actions: [{ type: 'emit_event', config: { eventType: 'custom.chain.hop_one' } }],
    });
    const hopTwo = makeAutomation({
      id: 'auto-hop-two',
      triggerEventType: 'custom.chain.hop_one',
      actions: [{ type: 'emit_event', config: { eventType: 'custom.chain.hop_two' } }],
    });

    await engine.start(bus, [hopOne, hopTwo], {});
    engine.setLogger(async (log) => {
      logs.push(log);
    });

    // Root publish, exactly as the webhook ingress does after #956: no
    // correlationId threaded — the bus self-references (fresh correlation,
    // root event).
    const root = await bus.publishGeneric(
      'custom.webhook.chaintest',
      { source: 'chaintest', hello: 'world' },
      { source: 'webhook' },
    );
    await bus.idle();

    expect(bus.journal).toHaveLength(3);
    const [rootEvent, hopOneEvent, hopTwoEvent] = bus.journal;
    if (!rootEvent || !hopOneEvent || !hopTwoEvent) throw new Error('journal incomplete');

    // Root self-references: correlationId === its own id.
    expect(rootEvent.id).toBe(root.id);
    expect(rootEvent.metadata.correlationId).toBe(rootEvent.id);

    // Every hop carries the SAME correlation — the chain never restarts.
    expect(hopOneEvent.type).toBe('custom.chain.hop_one');
    expect(hopTwoEvent.type).toBe('custom.chain.hop_two');
    expect(hopOneEvent.metadata.correlationId).toBe(rootEvent.metadata.correlationId);
    expect(hopTwoEvent.metadata.correlationId).toBe(rootEvent.metadata.correlationId);

    // automation_logs reference events of the SAME correlation as their
    // trigger: each log's eventId is a journal event carrying the root
    // correlation.
    expect(logs).toHaveLength(2);
    for (const log of logs) {
      const triggering = bus.journal.find((e) => e.id === log.eventId);
      expect(triggering).toBeDefined();
      expect(triggering?.metadata.correlationId).toBe(rootEvent.metadata.correlationId);
    }
  });

  test('debounced automation continues the correlation of the flow it grouped', async () => {
    const debounced = makeAutomation({
      id: 'auto-debounced',
      triggerEventType: 'custom.chain.debounced',
      actions: [{ type: 'emit_event', config: { eventType: 'custom.chain.debounced_hop' } }],
      debounce: { mode: 'fixed', delayMs: 30 },
    });

    await engine.start(bus, [debounced], {});

    const root = await bus.publishGeneric(
      'custom.chain.debounced',
      { from: { id: 'user-1', name: 'U' }, content: { type: 'text', text: 'hi' } },
      { source: 'webhook', instanceId: 'inst-1' },
    );
    await bus.idle();
    // Wait for the debounce window to flush and the emitted hop to publish.
    await new Promise((resolve) => setTimeout(resolve, 120));
    await bus.idle();

    const hop = bus.journal.find((e) => e.type === 'custom.chain.debounced_hop');
    expect(hop).toBeDefined();
    const rootEvent = bus.journal.find((e) => e.id === root.id);
    expect(hop?.metadata.correlationId).toBe(rootEvent?.metadata.correlationId);
  });
});

describe('executeEmitEventAction correlation source (#956)', () => {
  test('threads the triggering ENVELOPE correlation, ignoring any payload claim', async () => {
    const bus = new InMemoryEventBus();
    const context = createTemplateContext(
      { correlationId: 'payload-claimed-correlation', foo: 'bar' },
      {
        event: {
          id: 'trigger-event-id',
          type: 'custom.webhook.x',
          timestamp: Date.now(),
          metadata: { correlationId: 'envelope-correlation' },
        },
      },
    );

    await executeActions([{ type: 'emit_event', config: { eventType: 'custom.next.hop' } }], context, {
      eventBus: bus,
    });

    expect(bus.journal).toHaveLength(1);
    expect(bus.journal[0]?.metadata.correlationId).toBe('envelope-correlation');
  });

  test('falls back to payload correlation only when no envelope is threaded (manual execute path)', async () => {
    const bus = new InMemoryEventBus();
    const context = createTemplateContext({ correlationId: 'payload-correlation' });

    await executeActions([{ type: 'emit_event', config: { eventType: 'custom.next.hop' } }], context, {
      eventBus: bus,
    });

    expect(bus.journal[0]?.metadata.correlationId).toBe('payload-correlation');
  });
});
