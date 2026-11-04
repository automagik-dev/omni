/**
 * GET /events/types lists durable consumer names per event type. An ownOnly key
 * (events:consume without events:write, #1461) may list only the consumers it owns,
 * under the consumer routes' own rule; every other caller's service call is unchanged.
 * The real-PostgreSQL proof is in agent-host-device-key-postgres.test.ts.
 */

import { describe, expect, mock, test } from 'bun:test';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { Hono } from 'hono';
import type { AppVariables } from '../../../types';
import { eventsRoutes } from '../events';

const HOST = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

type TypesInput = Record<string, unknown> & { consumerAccess?: SQL };

function mount(scopes: string[]): { app: Hono<{ Variables: AppVariables }>; calls: TypesInput[]; dbReads: string[] } {
  const calls: TypesInput[] = [];
  const dbReads: string[] = [];
  // The key lookup consumerCaller makes (resolveKeyAgent): a key that is not an agent's.
  const db = {
    select: () => {
      dbReads.push('select');
      return { from: () => ({ where: () => ({ limit: async () => [] }) }) };
    },
  };
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('services', {
      db,
      automations: { list: mock(async () => []) },
      events: {
        getTypes: mock(async (input: TypesInput) => {
          calls.push(input);
          return [];
        }),
      },
    } as never);
    c.set('apiKey', { id: HOST, name: 'key', scopes, instanceIds: null, expiresAt: null } as never);
    await next();
  });
  app.route('/events', eventsRoutes);
  return { app, calls, dbReads };
}

describe('GET /events/types: consumer names for an ownOnly key (#1461)', () => {
  test('an events:consume key without events:write passes the owner rule to the inventory', async () => {
    const { app, calls } = mount(['events:read', 'events:consume']);
    const res = await app.request('/events/types');
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    const access = calls[0]?.consumerAccess;
    if (!access) throw new Error('no consumerAccess for an ownOnly key');
    const query = new PgDialect().sqlToQuery(access);
    expect(query.sql).toContain('"owner_key_id"');
    expect(query.params).toContain(HOST);
  });

  for (const scopes of [
    ['events:read'],
    ['events:read', 'events:write'],
    ['events:read', 'events:consume', 'events:write'],
    ['events:*'],
    ['*'],
  ]) {
    test(`a key with ${scopes.join(', ')} gets the inventory call it had before`, async () => {
      const { app, calls, dbReads } = mount(scopes);
      const res = await app.request('/events/types?since=2024-01-01T00:00:00.000Z');
      expect(res.status).toBe(200);
      expect(calls).toHaveLength(1);
      expect(Object.keys(calls[0] ?? {})).toEqual(['since', 'automations', 'tenantId']);
      expect(dbReads).toEqual([]);
    });
  }
});
