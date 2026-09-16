/**
 * Trigger deliveries reach the engine in parallel (#1181).
 *
 * The subscription wrapper defaults to concurrency 1 and awaits each handler
 * before pulling the next message, so four custom events with a 500ms action
 * took ~2s whatever `maxConcurrency` said. Drives the REAL subscription
 * wrapper with a fake JetStream consumer so the delivery loop is exercised.
 */

import { describe, expect, test } from 'bun:test';
import type { JsMsg } from 'nats';
import type { EventBus, SubscribeOptions, Subscription } from '../../events/bus';
import { createSubscription } from '../../events/nats/subscription';
import type { OmniEvent } from '../../events/types';
import { createAutomationEngine } from '../engine';
import type { Automation } from '../types';

const ACTION_MS = 500;

function fakeMsg(event: OmniEvent, onAck: () => void): JsMsg {
  return {
    data: new TextEncoder().encode(JSON.stringify(event)),
    info: { streamSequence: 1, redeliveryCount: 0 },
    headers: undefined,
    ack: onAck,
    nak: () => {},
    term: () => {},
  } as unknown as JsMsg;
}

async function runBurst(maxConcurrency: number | undefined): Promise<{ elapsedMs: number; acks: number }> {
  const events = [0, 1, 2, 3].map(
    (i) =>
      ({
        id: `evt-${i}`,
        type: 'custom.stress.conc',
        payload: { i },
        metadata: { correlationId: `corr-${i}` },
        timestamp: Date.now(),
      }) as unknown as OmniEvent,
  );

  let acks = 0;
  let allAcked: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    allAcked = resolve;
  });
  const onAck = () => {
    acks++;
    if (acks === events.length) allAcked();
  };

  let subscription: Subscription | null = null;
  const bus = {
    subscribePattern: async (pattern: string, handler: (e: OmniEvent) => Promise<void>, o: SubscribeOptions = {}) => {
      async function* consumer() {
        for (const e of events) yield fakeMsg(e, onAck);
      }
      const iterable = Object.assign(consumer(), { close: async () => {} });
      subscription = createSubscription({
        pattern,
        consumer: iterable as never,
        handler: handler as never,
        concurrency: o.concurrency,
      });
      return subscription;
    },
  } as unknown as EventBus;

  const automation = {
    id: 'auto-1',
    name: 'slow webhook',
    enabled: true,
    priority: 0,
    triggerEventType: 'custom.stress.conc',
    triggerConditions: [],
    conditionLogic: 'and',
    actions: [{ type: 'send_message', config: { instanceId: 'inst-1', to: 'chat-1', contentTemplate: 'x' } }],
    debounce: { mode: 'none' },
    maxConcurrency,
  } as unknown as Automation;

  const engine = createAutomationEngine();
  const start = Date.now();
  await engine.start(bus, [automation], {
    sendMessage: () => new Promise((resolve) => setTimeout(resolve, ACTION_MS)),
  });
  await done;
  const elapsedMs = Date.now() - start;
  await engine.stop();
  return { elapsedMs, acks };
}

describe('AutomationEngine — trigger delivery parallelism (#1181)', () => {
  test('maxConcurrency 4: four 500ms runs overlap (~500ms, not ~2s)', async () => {
    const { elapsedMs, acks } = await runBurst(4);
    expect(acks).toBe(4);
    expect(elapsedMs).toBeLessThan(ACTION_MS * 2);
  });

  test('engine default (5) also runs them in parallel', async () => {
    const { elapsedMs } = await runBurst(undefined);
    expect(elapsedMs).toBeLessThan(ACTION_MS * 2);
  });

  test('maxConcurrency 1 stays strictly serial', async () => {
    const { elapsedMs, acks } = await runBurst(1);
    expect(acks).toBe(4);
    expect(elapsedMs).toBeGreaterThanOrEqual(ACTION_MS * 4 - 20);
  });
});
