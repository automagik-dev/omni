/**
 * History-Push Sync Guard Tests
 *
 * Tests that manual per-chat sync (POST /instances/:id/sync with type 'messages'
 * or chatJids, and POST /instances/:id/resync) returns 409 when a history-push
 * job is active for the instance.
 *
 * Profile/contacts/groups sync types should NOT be blocked.
 */

import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { NotFoundError } from '@omni/core';
import type { Database, Instance } from '@omni/db';
import { instances, syncJobs } from '@omni/db';
import { createDbHandle } from '@omni/db';
import { pgRoleUrl, provisionMigratedDatabase } from '@omni/db/pg-migrated-template';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { instancesRoutes } from '../routes/v2/instances';
import { createServices } from '../services';
import type { Services } from '../services';
import type { AppVariables } from '../types';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';

postgresDescribe('History-Push Sync Guard', () => {
  let db: Database;
  const dbName = `omni_l2_${crypto.randomUUID().replaceAll('-', '')}`;
  let close: (() => Promise<void>) | undefined;
  let services: Services;
  let testInstance: Instance;
  const insertedInstanceIds: string[] = [];

  beforeAll(async () => {
    provisionMigratedDatabase({ superUrl, psqlBin }, dbName);
    const handle = createDbHandle({ url: pgRoleUrl(superUrl, dbName), maxConnections: 4 });
    close = handle.close;
    db = handle.db;
    services = createServices(db, null);

    const [inst] = await db
      .insert(instances)
      .values({
        name: `test-guard-${Date.now()}`,
        channel: 'whatsapp-baileys' as const,
      })
      .returning();
    if (!inst) throw new Error('Failed to create test instance');
    testInstance = inst;
    insertedInstanceIds.push(inst.id);
  });

  async function cleanupRows() {
    if (!db) return;
    // Clean up sync jobs first (foreign key)
    for (const id of insertedInstanceIds) {
      await db.delete(syncJobs).where(eq(syncJobs.instanceId, id));
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

  function createTestApp() {
    const mockRegistry = {
      get: mock(() => ({ capabilities: {} })),
      getAll: mock(() => []),
      has: mock(() => true),
    };

    const mockEventBus = {
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

    return app;
  }

  /** Insert a history-push sync job with the given status */
  async function insertHistoryPushJob(status: 'pending' | 'running' | 'completed' | 'failed') {
    const rows = await db
      .insert(syncJobs)
      .values({
        instanceId: testInstance.id,
        channel: 'whatsapp-baileys',
        type: 'history-push' as const,
        status,
        config: {},
        progress: { fetched: 0, stored: 0, duplicates: 0, mediaDownloaded: 0 },
      })
      .returning();
    return rows[0];
  }

  /** Clean up all sync jobs for the test instance */
  async function cleanSyncJobs() {
    await db.delete(syncJobs).where(eq(syncJobs.instanceId, testInstance.id));
  }

  // ============================================================================
  // POST /instances/:id/sync guards
  // ============================================================================

  test('POST /instances/:id/sync with type "messages" returns 409 when history-push is running', async () => {
    await cleanSyncJobs();
    await insertHistoryPushJob('running');
    const app = createTestApp();

    const res = await app.request(`/instances/${testInstance.id}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'messages' }),
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('SYNC_IN_PROGRESS');
  });

  test('POST /instances/:id/sync with chatJids returns 409 when history-push is running', async () => {
    await cleanSyncJobs();
    await insertHistoryPushJob('running');
    const app = createTestApp();

    const res = await app.request(`/instances/${testInstance.id}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'messages', chatJids: ['test@s.whatsapp.net'] }),
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('SYNC_IN_PROGRESS');
  });

  test('POST /instances/:id/sync with type "messages" works when history-push is completed', async () => {
    await cleanSyncJobs();
    await insertHistoryPushJob('completed');
    const app = createTestApp();

    const res = await app.request(`/instances/${testInstance.id}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'messages' }),
    });

    expect(res.status).toBe(201);
  });

  test('POST /instances/:id/sync with type "messages" works when no history-push job exists', async () => {
    await cleanSyncJobs();
    const app = createTestApp();

    const res = await app.request(`/instances/${testInstance.id}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'messages' }),
    });

    expect(res.status).toBe(201);
  });

  test('POST /instances/:id/sync with type "contacts" is NOT blocked by active history-push', async () => {
    await cleanSyncJobs();
    await insertHistoryPushJob('running');
    const app = createTestApp();

    const res = await app.request(`/instances/${testInstance.id}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'contacts' }),
    });

    // Should not be 409 - contacts sync is allowed
    expect(res.status).not.toBe(409);
  });

  test('POST /instances/:id/sync with type "groups" is NOT blocked by active history-push', async () => {
    await cleanSyncJobs();
    await insertHistoryPushJob('running');
    const app = createTestApp();

    const res = await app.request(`/instances/${testInstance.id}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'groups' }),
    });

    // Should not be 409 - groups sync is allowed
    expect(res.status).not.toBe(409);
  });

  test('POST /instances/:id/sync with type "profile" is NOT blocked by active history-push', async () => {
    await cleanSyncJobs();
    await insertHistoryPushJob('running');
    const app = createTestApp();

    const res = await app.request(`/instances/${testInstance.id}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'profile' }),
    });

    // Profile sync redirects to internal handler; should not be 409
    expect(res.status).not.toBe(409);
  });

  // ============================================================================
  // POST /instances/:id/resync guards
  // ============================================================================

  test('POST /instances/:id/resync returns 409 when history-push is running', async () => {
    await cleanSyncJobs();
    await insertHistoryPushJob('running');
    const app = createTestApp();

    const res = await app.request(`/instances/${testInstance.id}/resync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ since: '2h' }),
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('SYNC_IN_PROGRESS');
  });

  test('POST /instances/:id/resync works when history-push is completed', async () => {
    await cleanSyncJobs();
    await insertHistoryPushJob('completed');
    const app = createTestApp();

    const res = await app.request(`/instances/${testInstance.id}/resync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ since: '2h' }),
    });

    expect(res.status).toBe(200);
  });

  test('POST /instances/:id/resync works when no history-push job exists', async () => {
    await cleanSyncJobs();
    const app = createTestApp();

    const res = await app.request(`/instances/${testInstance.id}/resync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ since: '2h' }),
    });

    expect(res.status).toBe(200);
  });

  test('POST /instances/:id/sync with type "messages" returns 409 when history-push is pending', async () => {
    await cleanSyncJobs();
    await insertHistoryPushJob('pending');
    const app = createTestApp();

    const res = await app.request(`/instances/${testInstance.id}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'messages' }),
    });

    expect(res.status).toBe(409);
  });

  test('POST /instances/:id/sync with type "all" returns 409 when history-push is running', async () => {
    await cleanSyncJobs();
    await insertHistoryPushJob('running');
    const app = createTestApp();

    const res = await app.request(`/instances/${testInstance.id}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'all' }),
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('SYNC_IN_PROGRESS');
  });
});
