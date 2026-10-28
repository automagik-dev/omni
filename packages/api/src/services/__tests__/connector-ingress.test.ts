/**
 * Inbound delivery envelope, without PostgreSQL.
 *
 * The real dedupe authority is the `omni_events.idempotency_key` unique index;
 * `connector-ingress-postgres.test.ts` proves that against a disposable server.
 * This suite pins the envelope's behaviour with a recording fake database:
 * verification before parse, paused `ignored`, duplicate `200`, failure `500`
 * with the claim released, filters, the payload shape and — importantly — that
 * no `instances`, `chats` or `messages` table is ever touched.
 */

import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { clickupManifest } from '@omni/connector-clickup';
import { ConnectorRegistry } from '@omni/connector-sdk';
import type { EventBus } from '@omni/core';
import { getTableName } from 'drizzle-orm';
import {
  ConnectorService,
  buildConnectorEventPayload,
  deriveConnectorIdempotencyKey,
  matchesFilters,
} from '../connectors';

const CONNECTOR_ID = '11111111-1111-1111-1111-111111111111';
const SUBSCRIPTION_ID = '22222222-2222-2222-2222-222222222222';
const AUTOMATION_ID = '33333333-3333-3333-3333-333333333333';
const TENANT_ID = '44444444-4444-4444-4444-444444444444';
const SECRET = 'clickup-webhook-secret';
const TOKEN = 'pk_secret_token';
const BODY = JSON.stringify({
  event: 'taskStatusUpdated',
  task_id: 'task-123',
  history_items: [{ id: 'history-1', date: 1_780_000_000_000, field: 'status', after: 'done' }],
});

function signature(body = BODY): string {
  return createHmac('sha256', SECRET).update(body).digest('hex');
}

interface Fakes {
  db: unknown;
  published: Array<{ type: string; payload: Record<string, unknown>; metadata?: Record<string, unknown> }>;
  touchedTables: string[];
  updates: Array<Record<string, unknown>>;
  deletes: number;
  publishError?: Error;
}

function makeFakes(options: {
  resolved?: unknown[];
  claimRows?: Array<{ id: string }>;
  originalId?: string;
  publishError?: Error;
}): Fakes {
  const published: Fakes['published'] = [];
  const touchedTables: string[] = [];
  const updates: Array<Record<string, unknown>> = [];
  let deletes = 0;
  let selectCalls = 0;

  const selectChain = {
    from() {
      return selectChain;
    },
    innerJoin() {
      return selectChain;
    },
    where() {
      return selectChain;
    },
    async limit() {
      selectCalls += 1;
      if (selectCalls === 1) return options.resolved ?? [];
      return options.originalId ? [{ id: options.originalId }] : [];
    },
  };

  const db = {
    select: () => selectChain,
    insert: (table: unknown) => {
      touchedTables.push(getTableName(table as never));
      return {
        values: (values: { id: string }) => ({
          onConflictDoNothing: () => ({
            returning: async () => options.claimRows ?? [{ id: values.id }],
          }),
        }),
      };
    },
    update: (table: unknown) => {
      touchedTables.push(getTableName(table as never));
      return {
        set: (values: Record<string, unknown>) => ({
          where: async () => {
            updates.push(values);
            return {};
          },
        }),
      };
    },
    delete: (table: unknown) => {
      touchedTables.push(getTableName(table as never));
      return {
        where: async () => {
          deletes += 1;
          return {};
        },
      };
    },
  };

  return {
    db,
    published,
    touchedTables,
    updates,
    get deletes() {
      return deletes;
    },
    ...(options.publishError ? { publishError: options.publishError } : {}),
  } as Fakes;
}

function resolvedRow(
  overrides: {
    subscription?: Record<string, unknown>;
    connector?: Record<string, unknown>;
  } = {},
) {
  return [
    {
      subscription: {
        id: SUBSCRIPTION_ID,
        connectorId: CONNECTOR_ID,
        providerEventKey: 'taskStatusUpdated',
        filters: {},
        targetAutomationId: AUTOMATION_ID,
        verificationSecret: SECRET,
        status: 'active',
        lastDeliveryAt: null,
        lastFailureAt: null,
        consecutiveFailures: 0,
        totalDeliveries: 0,
        totalDuplicates: 0,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        tenantId: TENANT_ID,
        ...overrides.subscription,
      },
      connector: {
        id: CONNECTOR_ID,
        provider: 'clickup',
        name: 'ClickUp',
        credentials: JSON.stringify({ token: TOKEN }),
        config: {},
        status: 'connected',
        lastValidatedAt: null,
        lastError: null,
        lastErrorCode: null,
        createdBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        tenantId: TENANT_ID,
        ...overrides.connector,
      },
    },
  ];
}

function service(fakes: Fakes): ConnectorService {
  return new ConnectorService(fakes.db as never, makeBus(fakes), new ConnectorRegistry([clickupManifest]));
}

function makeBus(fakes: Fakes): EventBus {
  return {
    async publishGeneric(type: string, payload: Record<string, unknown>, metadata?: Record<string, unknown>) {
      if (fakes.publishError) throw fakes.publishError;
      fakes.published.push({ type, payload, metadata });
      return { id: metadata?.publishEventId ?? 'event', type, timestamp: Date.now(), payload, metadata };
    },
  } as unknown as EventBus;
}

describe('connector inbound envelope', () => {
  test('a signed delivery publishes exactly one connector.event and accepts 202', async () => {
    const fakes = makeFakes({ resolved: resolvedRow() });
    const result = await service(fakes).receive(SUBSCRIPTION_ID, BODY, { 'x-signature': signature() });

    expect(result.status).toBe(202);
    expect(result.body).toMatchObject({ received: true });
    expect(fakes.published).toHaveLength(1);
    expect(fakes.published[0]?.type).toBe('connector.event');
    expect(fakes.published[0]?.payload).toMatchObject({
      connectorId: CONNECTOR_ID,
      subscriptionId: SUBSCRIPTION_ID,
      targetAutomationId: AUTOMATION_ID,
      provider: 'clickup',
      eventKey: 'taskStatusUpdated',
      providerEventId: 'history-1',
      task_id: 'task-123',
    });
    expect(fakes.published[0]?.metadata).toMatchObject({ source: 'connector', tenantId: TENANT_ID });
    // Only the journal is inserted; the subscription counters are updated.
    expect(fakes.touchedTables).toContain('omni_events');
    expect(fakes.touchedTables).toContain('connector_event_subscriptions');
    expect(fakes.touchedTables).not.toContain('instances');
    expect(fakes.touchedTables).not.toContain('chats');
    expect(fakes.touchedTables).not.toContain('messages');
    expect(fakes.updates.some((update) => 'totalDeliveries' in update)).toBe(true);
  });

  test('a provider redelivery is a duplicate 200 with no second publish', async () => {
    const fakes = makeFakes({ resolved: resolvedRow(), claimRows: [], originalId: 'original-event' });
    const result = await service(fakes).receive(SUBSCRIPTION_ID, BODY, { 'x-signature': signature() });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ received: true, duplicate: true, eventId: 'original-event' });
    expect(fakes.published).toHaveLength(0);
    expect(fakes.updates.some((update) => 'totalDuplicates' in update)).toBe(true);
  });

  test('a bad signature and an unknown subscription both return the same 401 with no publish', async () => {
    const bad = makeFakes({ resolved: resolvedRow() });
    const badResult = await service(bad).receive(SUBSCRIPTION_ID, BODY, { 'x-signature': 'deadbeef' });
    expect(badResult.status).toBe(401);
    expect(bad.published).toHaveLength(0);

    const unknown = makeFakes({ resolved: [] });
    const unknownResult = await service(unknown).receive(SUBSCRIPTION_ID, BODY, { 'x-signature': signature() });
    expect(unknownResult).toEqual(badResult);
    expect(unknown.published).toHaveLength(0);
  });

  test('a paused subscription verifies, acks 202 ignored and publishes nothing', async () => {
    const fakes = makeFakes({ resolved: resolvedRow({ subscription: { status: 'paused' } }) });
    const result = await service(fakes).receive(SUBSCRIPTION_ID, BODY, { 'x-signature': signature() });

    expect(result.status).toBe(202);
    expect(result.body).toEqual({ received: true, ignored: true });
    expect(fakes.published).toHaveLength(0);
    expect(fakes.updates).toHaveLength(0);
  });

  test('a mismatched event key or filter is acked 202 ignored', async () => {
    const key = makeFakes({ resolved: resolvedRow({ subscription: { providerEventKey: 'taskCreated' } }) });
    expect((await service(key).receive(SUBSCRIPTION_ID, BODY, { 'x-signature': signature() })).status).toBe(202);
    expect(key.published).toHaveLength(0);

    const filtered = makeFakes({ resolved: resolvedRow({ subscription: { filters: { task_id: 'other' } } }) });
    expect((await service(filtered).receive(SUBSCRIPTION_ID, BODY, { 'x-signature': signature() })).status).toBe(202);
    expect(filtered.published).toHaveLength(0);
  });

  test('a malformed body is 400 and never verified', async () => {
    const fakes = makeFakes({ resolved: resolvedRow() });
    expect((await service(fakes).receive(SUBSCRIPTION_ID, 'not-json', {})).status).toBe(400);
    expect(fakes.published).toHaveLength(0);
  });

  test('a publish failure releases the claim and returns 500', async () => {
    const fakes = makeFakes({ resolved: resolvedRow(), publishError: new Error('bus down') });
    const result = await service(fakes).receive(SUBSCRIPTION_ID, BODY, { 'x-signature': signature() });

    expect(result.status).toBe(500);
    expect(fakes.deletes).toBe(1);
    expect(fakes.updates.some((update) => update.consecutiveFailures === 1)).toBe(true);
  });
});

describe('delivery identity and payload', () => {
  test('the key is subscription-scoped on provider event id, with a body-hash fallback', () => {
    expect(deriveConnectorIdempotencyKey(SUBSCRIPTION_ID, 'history-1', BODY)).toBe(
      `connector:${SUBSCRIPTION_ID}:history-1`,
    );
    expect(deriveConnectorIdempotencyKey(SUBSCRIPTION_ID, undefined, BODY)).toMatch(
      new RegExp(`^connector:${SUBSCRIPTION_ID}:[0-9a-f]{64}$`),
    );
    // The same bytes derive the same fallback key; different bytes do not.
    expect(deriveConnectorIdempotencyKey(SUBSCRIPTION_ID, undefined, BODY)).toBe(
      deriveConnectorIdempotencyKey(SUBSCRIPTION_ID, undefined, BODY),
    );
    expect(deriveConnectorIdempotencyKey(SUBSCRIPTION_ID, undefined, `${BODY} `)).not.toBe(
      deriveConnectorIdempotencyKey(SUBSCRIPTION_ID, undefined, BODY),
    );
  });

  test('reserved keys win over provider fields and rawPayload keeps the provider body', () => {
    const payload = buildConnectorEventPayload({
      connectorId: 'c',
      subscriptionId: 's',
      targetAutomationId: 'a',
      provider: 'clickup',
      eventKey: 'taskStatusUpdated',
      providerEventId: 'h',
      data: { connectorId: 'provider-value', task_id: 't', rawPayload: { spoofed: true } },
    });
    expect(payload).toMatchObject({
      connectorId: 'c',
      subscriptionId: 's',
      targetAutomationId: 'a',
      provider: 'clickup',
      eventKey: 'taskStatusUpdated',
      providerEventId: 'h',
      task_id: 't',
      rawPayload: { connectorId: 'provider-value', task_id: 't', rawPayload: { spoofed: true } },
    });
  });

  test('filters are exact matches over dot paths', () => {
    expect(matchesFilters({ task_id: 't', status: 'done' }, { task_id: 't', status: 'done' })).toBe(true);
    expect(matchesFilters({ task_id: 't' }, { task_id: 'other' })).toBe(false);
    expect(matchesFilters({ history_items: [{ field: 'status' }] }, { 'history_items.0.field': 'status' })).toBe(true);
  });
});
