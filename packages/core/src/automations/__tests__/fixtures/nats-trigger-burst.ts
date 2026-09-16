/**
 * Child process for engine-trigger-parallelism-nats.test.ts (#1206).
 *
 * Runs in its own `bun` process because other suites `mock.module('nats')`
 * and that mock is process-wide. Publishes four concurrent events against a
 * real JetStream server, runs one automation with a slow action, and prints
 * `{ elapsedMs, starts, queueWaits }` as JSON on stdout.
 *
 * Usage: bun nats-trigger-burst.ts <natsUrl> <maxConcurrency> <eventType> <actionMs>
 */

import { NatsEventBus } from '../../../events/nats/client';
import { createAutomationEngine } from '../../engine';
import type { Automation } from '../../types';

const [url, maxConcurrencyArg, eventType, actionMsArg] = process.argv.slice(2);
const maxConcurrency = Number(maxConcurrencyArg);
const actionMs = Number(actionMsArg);
if (!url || !eventType || !Number.isInteger(maxConcurrency) || !Number.isInteger(actionMs)) {
  throw new Error('usage: nats-trigger-burst.ts <natsUrl> <maxConcurrency> <eventType> <actionMs>');
}

const bus = new NatsEventBus({ url, serviceName: 'engine-parallelism-test' });
await bus.connect();

const automation = {
  id: `auto-${maxConcurrency}`,
  name: 'slow action',
  enabled: true,
  priority: 0,
  triggerEventType: eventType,
  triggerConditions: [],
  conditionLogic: 'and',
  actions: [{ type: 'send_message', config: { instanceId: 'inst-1', to: 'chat-1', contentTemplate: 'x' } }],
  debounce: { mode: 'none' },
  maxConcurrency,
} as unknown as Automation;

const starts: number[] = [];
const queueWaits: Array<number | undefined> = [];
let finished = 0;
const engine = createAutomationEngine({ reconcileIntervalMs: 0 });
engine.setLogger(async (log) => {
  queueWaits.push(log.queueWaitMs);
});
const t0 = Date.now();
await engine.start(bus, [automation], {
  sendMessage: async () => {
    starts.push(Date.now() - t0);
    await Bun.sleep(actionMs);
    finished++;
  },
});

const published = Date.now();
await Promise.all([0, 1, 2, 3].map((i) => bus.publishGeneric(eventType as never, { i }, { source: 'test' })));
while (finished < 4) {
  if (Date.now() - published > 10_000) throw new Error(`only ${finished}/4 runs finished`);
  await Bun.sleep(10);
}
const elapsedMs = Date.now() - published;
// Let the last log write land before reporting.
await Bun.sleep(20);

await engine.stop();
await bus.close();
process.stdout.write(`${JSON.stringify({ elapsedMs, starts, queueWaits })}\n`);
process.exit(0);
