/**
 * Resync Endpoint Tests
 *
 * Tests for POST /instances/:id/resync - history backfill trigger.
 */

import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { NotFoundError } from '@omni/core';
import type { Database, Instance } from '@omni/db';
import { instances } from '@omni/db';
import { createDbHandle } from '@omni/db';
import { pgRoleUrl, provisionMigratedDatabase } from '@omni/db/pg-migrated-template';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { instancesRoutes } from '../routes/v2/instances';
import { createServices } from '../services';
import type { AppVariables } from '../types';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';

postgresDescribe('Resync Endpoint', () => {
  let db: Database;
  const dbName = `omni_l2_${crypto.randomUUID().replaceAll('-', '')}`;
  let close: (() => Promise<void>) | undefined;
  let testInstance: Instance;
  const insertedInstanceIds: string[] = [];

  beforeAll(async () => {
    provisionMigratedDatabase({ superUrl, psqlBin }, dbName);
    const handle = createDbHandle({ url: pgRoleUrl(superUrl, dbName), maxConnections: 4 });
    close = handle.close;
    db = handle.db;

    const [inst] = await db
      .insert(instances)
      .values({
        name: `test-resync-${Date.now()}`,
        channel: 'whatsapp-baileys' as const,
      })
      .returning();
    if (!inst) throw new Error('Failed to create test instance');
    testInstance = inst;
    insertedInstanceIds.push(inst.id);
  });

  async function cleanupRows() {
    if (!db) return;
    for (const id of insertedInstanceIds) {
      await db.delete(instances).where(eq(instances.id, id));
    }
  }

  afterAll(async () => {
    const errors: unknown[] = [];
    try {
      await cleanupRows();
    } catch (error) {
      errors.push(error);
    }
    try {
      await close?.();
    } catch (error) {
      errors.push(error);
    }
    try {
      const result = Bun.spawnSync({
        cmd: [
          psqlBin,
          '-X',
          '--no-psqlrc',
          '--set',
          'ON_ERROR_STOP=1',
          '--dbname',
          pgRoleUrl(superUrl, 'postgres'),
          '-c',
          `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`,
        ],
        stdout: 'pipe',
        stderr: 'pipe',
      });
      if (result.exitCode !== 0) errors.push(new Error(`Failed to drop legacy test database: ${result.stderr}`));
    } catch (error) {
      errors.push(error);
    }
    if (errors.length > 0) throw new AggregateError(errors, 'Legacy database teardown failed');
  });

  function createTestApp(eventBusMock?: unknown) {
    const services = createServices(db, null);
    const mockRegistry = {
      get: mock(() => ({ capabilities: {} })),
      getAll: mock(() => []),
      has: mock(() => true),
    };

    const mockEventBus = eventBusMock ?? {
      subscribe: mock(async () => {}),
      publish: mock(async () => ({ id: 'test-event-id', sequence: 1 })),
      publishGeneric: mock(async () => ({ id: 'test-event-id', sequence: 1 })),
      close: mock(async () => {}),
    };

    const app = new Hono<{ Variables: AppVariables }>();

    app.onError((error, c) => {
      if (error instanceof NotFoundError) {
        return c.json({ error: { code: 'NOT_FOUND', message: error.message } }, 404);
      }
      return c.json({ error: { code: 'INTERNAL_ERROR', message: error.message } }, 500);
    });

    app.use('*', async (c, next) => {
      c.set('services', services);
      c.set('db', db);
      c.set('channelRegistry', mockRegistry as unknown as AppVariables['channelRegistry']);
      c.set('eventBus', mockEventBus as unknown as AppVariables['eventBus']);
      c.set('apiKey', { id: 'test-key', name: 'test', scopes: ['*'], instanceIds: null, expiresAt: null });
      await next();
    });

    app.route('/instances', instancesRoutes);

    return { app, mockEventBus };
  }

  test('POST /instances/:id/resync creates sync job and returns jobId', async () => {
    const { app } = createTestApp();

    const res = await app.request(`/instances/${testInstance.id}/resync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ since: '2h' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { instanceId: string; jobId: string } };
    expect(body.success).toBe(true);
    expect(body.data.instanceId).toBe(testInstance.id);
    // jobId should be a valid UUID (from sync_jobs table)
    expect(body.data.jobId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  test('POST /instances/:id/resync accepts ISO timestamp', async () => {
    const { app } = createTestApp();

    const res = await app.request(`/instances/${testInstance.id}/resync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ since: '2026-02-09T10:00:00Z' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { since: string } };
    expect(body.data.since).toBe('2026-02-09T10:00:00.000Z');
  });

  test('POST /instances/:id/resync defaults since to 2h ago', async () => {
    const { app } = createTestApp();
    const beforeTime = Date.now() - 2 * 60 * 60 * 1000;

    const res = await app.request(`/instances/${testInstance.id}/resync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { since: string } };
    const sinceTime = new Date(body.data.since).getTime();
    // Should be approximately 2h ago (within 5 seconds)
    expect(Math.abs(sinceTime - beforeTime)).toBeLessThan(5000);
  });

  test('POST /instances/:id/resync returns 404 for unknown instance', async () => {
    const { app } = createTestApp();

    const res = await app.request('/instances/00000000-0000-0000-0000-000000000000/resync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ since: '1h' }),
    });

    expect(res.status).toBe(404);
  });

  test('POST /instances/:id/resync returns 503 when eventBus unavailable', async () => {
    const services = createServices(db, null);
    const app = new Hono<{ Variables: AppVariables }>();

    app.onError((error, c) => {
      if (error instanceof NotFoundError) {
        return c.json({ error: { code: 'NOT_FOUND', message: error.message } }, 404);
      }
      return c.json({ error: { code: 'INTERNAL_ERROR', message: error.message } }, 500);
    });

    app.use('*', async (c, next) => {
      c.set('services', services);
      c.set('db', db);
      c.set('channelRegistry', null as unknown as AppVariables['channelRegistry']);
      c.set('eventBus', null as unknown as AppVariables['eventBus']);
      c.set('apiKey', { id: 'test-key', name: 'test', scopes: ['*'], instanceIds: null, expiresAt: null });
      await next();
    });

    app.route('/instances', instancesRoutes);

    const res = await app.request(`/instances/${testInstance.id}/resync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ since: '1h' }),
    });

    expect(res.status).toBe(503);
  });
});
