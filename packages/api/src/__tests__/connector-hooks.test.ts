/** Fault injection for typed ingress, independent of Postgres availability. */
import { expect, spyOn, test } from 'bun:test';
import { ConnectorRegistry } from '@omni/connector-sdk';
import { type LogEntry, configureLogging, getLogBuffer, getLogConfig } from '@omni/core';
import { ConnectorService } from '../services/connectors';
import { createConnectorTestDb } from './connector-test-harness';
import {
  HOOK_SECRET,
  TYPED_EVENT,
  connectorHookBus,
  eventsOnlyConnector,
  signHook,
} from './fixtures/events-only-connector';

test('publish and claim-release failures still record every matched failure and log the original publish error', async () => {
  const connectorId = crypto.randomUUID();
  const subscriptionIds = [crypto.randomUUID(), crypto.randomUUID()];
  const fixture = createConnectorTestDb(
    {
      connectors: [{ id: connectorId, provider: 'gitlab', hookSecret: HOOK_SECRET, tenantId: null }],
      connector_event_subscriptions: subscriptionIds.map((id, index) => ({
        id,
        connectorId,
        providerEventKey: index === 0 ? TYPED_EVENT : 'connector.gitlab.*',
        ingress: 'connector',
        status: 'active',
        targetAutomationId: null,
        tenantId: null,
        filters: {},
        consecutiveFailures: 0,
      })),
    },
    { deleteError: new Error('Synthetic claim release failure') },
  );
  const remove = spyOn(fixture.db, 'delete');
  const transport = connectorHookBus();
  transport.failNextPublish(true);
  const service = new ConnectorService(fixture.db, transport.bus, new ConnectorRegistry([eventsOnlyConnector]));
  const config = getLogConfig();
  const logs: LogEntry[] = [];
  const unsubscribe = getLogBuffer().subscribe(
    (entry) => {
      logs.push(entry);
    },
    { modules: ['connector-service'] },
  );
  try {
    configureLogging({ level: 'debug', format: 'json', modules: '*' });
    const body = JSON.stringify({ id: crypto.randomUUID() });
    expect((await service.receiveForConnector(connectorId, body, signHook(body))).status).toBe(500);
    expect(remove).toHaveBeenCalledTimes(1);
    // The failed release keeps the claim, exactly as on legacy ingress.
    const row = fixture.tables.omni_events[0];
    expect(fixture.tables.omni_events).toHaveLength(1);
    for (const subscription of fixture.tables.connector_event_subscriptions) {
      expect(subscription).toMatchObject({ consecutiveFailures: 1, lastError: 'Connector delivery publish failed' });
      expect(subscription.lastFailureAt).toBeInstanceOf(Date);
    }
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          msg: 'Failed to release connector delivery claim after publish failure',
          connectorId,
          eventId: row?.id,
          error: 'Synthetic claim release failure',
        }),
        expect.objectContaining({
          msg: 'Connector hook delivery failed',
          connectorId,
          error: 'Synthetic publish failure',
        }),
      ]),
    );
    expect(transport.events).toHaveLength(0);
  } finally {
    unsubscribe();
    configureLogging(config);
    remove.mockRestore();
  }
});
