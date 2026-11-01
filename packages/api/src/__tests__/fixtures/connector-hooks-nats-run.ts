/** Isolated from process-wide NATS mocks; optionally uses the PG gate's real runtime handle. */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { ConnectorRegistry } from '@omni/connector-sdk';
import { setTenantSecretMasterKey } from '@omni/core';
import { NatsEventBus } from '@omni/core/events';
import { createDbHandle, omniEvents } from '@omni/db';
import { eq } from 'drizzle-orm';
import { AckPolicy, DeliverPolicy, connect } from 'nats';
import { z } from 'zod';
import { ConnectorService } from '../../services/connectors';
import { scopedHandle } from '../../tenancy/tenant-scope';
import { runTenantWorkDb } from '../../tenancy/worker-tenant-context';
import { createConnectorTestDb } from '../connector-test-harness';
import { HOOK_SECRET, TYPED_EVENT, eventsOnlyConnector, signHook } from './events-only-connector';

const config = z
  .object({
    url: z.string(),
    tenantId: z.string().uuid(),
    connectorId: z.string().uuid(),
    subscriptionId: z.string().uuid(),
  })
  .optional()
  .parse(process.argv[2] ? JSON.parse(process.argv[2]) : undefined);
const binary = [
  process.env.NATS_SERVER_BIN,
  join(import.meta.dir, '../../../../../bin/nats-server'),
  join(homedir(), '.omni/nats-server'),
].find((candidate): candidate is string => !!candidate && existsSync(candidate));
if (!binary) throw new Error('nats-server not found: run scripts/ensure-nats.sh');
const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
const port = probe.port;
if (!port) throw new Error('No random loopback port');
probe.stop(true);
const store = mkdtempSync(join(tmpdir(), 'omni-hooks-nats-'));
const server = Bun.spawn([binary, '-js', '-a', '127.0.0.1', '-p', String(port), '-sd', store], {
  stdout: 'ignore',
  stderr: 'ignore',
});
const url = `nats://127.0.0.1:${port}`;
const bus = new NatsEventBus({ url, serviceName: 'connector-hooks-proof' });
const connectorId = config?.connectorId ?? crypto.randomUUID();
const subscriptionId = config?.subscriptionId ?? crypto.randomUUID();
const fake = createConnectorTestDb({
  connectors: [{ id: connectorId, provider: 'gitlab', hookSecret: HOOK_SECRET, tenantId: null }],
  connector_event_subscriptions: [
    {
      id: subscriptionId,
      connectorId,
      providerEventKey: 'merge_request.merged',
      ingress: 'subscription',
      verificationSecret: HOOK_SECRET,
      targetAutomationId: crypto.randomUUID(),
      tenantId: null,
    },
    {
      id: crypto.randomUUID(),
      connectorId,
      providerEventKey: TYPED_EVENT,
      ingress: 'connector',
      status: 'active',
      targetAutomationId: null,
      tenantId: null,
    },
  ],
});
const handle = config ? createDbHandle({ url: config.url, maxConnections: 4 }) : null;
const db = handle?.db ?? fake.db;
const service = new ConnectorService(db, bus, new ConnectorRegistry([eventsOnlyConnector]));
let connection: Awaited<ReturnType<typeof connect>> | undefined;
try {
  setTenantSecretMasterKey(Buffer.alloc(32, 0x42));
  await bus.connect();
  connection = await connect({ servers: url });
  const maxPayload = connection.info?.max_payload;
  if (!maxPayload) throw new Error('NATS did not advertise max_payload');
  const manager = await connection.jetstreamManager();
  await manager.consumers.add('CUSTOM', {
    durable_name: 'hooks-proof',
    filter_subject: 'connector.>',
    ack_policy: AckPolicy.Explicit,
    deliver_policy: DeliverPolicy.All,
  });
  const legacy = JSON.stringify({ event: 'merge_request.merged', id: `legacy-${crypto.randomUUID()}` });
  const typed = JSON.stringify({
    id: `typed-${crypto.randomUUID()}`,
    eventType: TYPED_EVENT,
    text: 'x'.repeat(Math.floor(maxPayload * 0.6)),
    echo: HOOK_SECRET,
  });
  const receipts = [
    await service.receive(subscriptionId, legacy, signHook(legacy)),
    await service.receiveForConnector(connectorId, typed, signHook(typed)),
  ];
  if (receipts.some((receipt) => receipt.status !== 202))
    throw new Error(`Ingress refused: ${JSON.stringify(receipts)}`);
  const consumer = await connection.jetstream().consumers.get('CUSTOM', 'hooks-proof');
  const fetched = await consumer.fetch({ max_messages: 2, expires: 4000 });
  const delivered = [];
  for await (const message of fetched) {
    const event = z
      .object({ id: z.string(), type: z.string(), payload: z.record(z.string(), z.unknown()) })
      .parse(JSON.parse(message.string()));
    const rows = await runTenantWorkDb(db, config?.tenantId ?? null, () =>
      scopedHandle(db).select().from(omniEvents).where(eq(omniEvents.id, event.id)).limit(1),
    );
    const row = rows[0];
    if (!row || !isDeepStrictEqual(row.rawPayload, event.payload)) throw new Error('Journal and bus payload differ');
    if (JSON.stringify(event).includes(HOOK_SECRET)) throw new Error('Hook secret leaked');
    if (event.type === TYPED_EVENT && 'rawPayload' in event.payload) throw new Error('Typed body duplicated');
    delivered.push({ id: event.id, type: event.type, bytes: message.data.byteLength });
    message.ack();
  }
  await connection.flush();
  if (delivered.length !== 2) throw new Error('Durable consumer missed delivery');
  process.stdout.write(
    `${JSON.stringify({ delivered, maxPayload, bodyBytes: Buffer.byteLength(typed), realPostgres: !!config })}\n`,
  );
} finally {
  setTenantSecretMasterKey(null);
  await connection?.close();
  await bus.close();
  await handle?.close();
  server.kill();
  await server.exited;
  rmSync(store, { recursive: true, force: true });
}
