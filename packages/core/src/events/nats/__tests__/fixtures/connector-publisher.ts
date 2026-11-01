/** Isolated real-NATS proof: other test files mock the nats module globally. */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { AckPolicy, DeliverPolicy, connect } from 'nats';
import { NatsEventBus } from '../../client';

const binary = [
  process.env.NATS_SERVER_BIN,
  join(import.meta.dir, '../../../../../../../bin/nats-server'),
  join(homedir(), '.omni/nats-server'),
].find((candidate): candidate is string => !!candidate && existsSync(candidate));
if (!binary) throw new Error('nats-server missing: run scripts/ensure-nats.sh');
const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
const port = probe.port;
probe.stop(true);
const store = mkdtempSync(join(tmpdir(), 'omni-connector-nats-'));
const server = Bun.spawn([binary, '-js', '-a', '127.0.0.1', '-p', String(port), '-sd', store], {
  stdout: 'ignore',
  stderr: 'ignore',
});
const bus = new NatsEventBus({ url: `nats://127.0.0.1:${port}`, serviceName: 'connector-publisher-test' });
let connection: Awaited<ReturnType<typeof connect>> | undefined;
try {
  await bus.connect();
  connection = await connect({ servers: `nats://127.0.0.1:${port}` });
  const delivered: string[] = [];
  const manager = await connection.jetstreamManager();
  await manager.consumers.add('CUSTOM', {
    durable_name: 'connector-proof',
    filter_subject: 'connector.>',
    ack_policy: AckPolicy.Explicit,
    deliver_policy: DeliverPolicy.All,
  });
  const published = [];
  for (const type of ['connector.event', 'connector.x.y'] as const) {
    let refused = false;
    try {
      await bus.publishGeneric(type, {});
    } catch {
      refused = true;
    }
    if (!refused) throw new Error('publishGeneric accepted connector namespace');
    published.push(
      await bus.publishConnector(
        type,
        { subscriptionIds: ['subscription'], targetAutomationIds: [] },
        { publishEventId: crypto.randomUUID() },
      ),
    );
  }
  const consumer = await connection.jetstream().consumers.get('CUSTOM', 'connector-proof');
  const messages = await consumer.fetch({ max_messages: 2, expires: 3000 });
  for await (const message of messages) {
    delivered.push(JSON.parse(message.string()).id);
    message.ack();
  }
  await connection.flush();
  process.stdout.write(`${JSON.stringify({ published, delivered })}\n`);
} finally {
  await connection?.close();
  await bus.close();
  server.kill();
  await server.exited;
  rmSync(store, { recursive: true, force: true });
}
