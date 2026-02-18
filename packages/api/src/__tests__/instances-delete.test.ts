/**
 * Tests for DELETE /instances/:id behavior around auth cleanup ordering.
 */

import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { NotFoundError } from '@omni/core';
import type { Database, Instance } from '@omni/db';
import { instances } from '@omni/db';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { instancesRoutes } from '../routes/v2/instances';
import { createServices } from '../services';
import type { AppVariables } from '../types';
import { describeWithDb, getTestDb } from './db-helper';

describeWithDb('Instances Delete Endpoint', () => {
  let db: Database;
  let testInstance: Instance;
  const insertedInstanceIds: string[] = [];

  beforeAll(async () => {
    db = getTestDb();

    const [inst] = await db
      .insert(instances)
      .values({
        name: `test-delete-${Date.now()}`,
        channel: 'whatsapp-baileys' as const,
      })
      .returning();

    if (!inst) throw new Error('Failed to create test instance');
    testInstance = inst;
    insertedInstanceIds.push(inst.id);
  });

  afterAll(async () => {
    for (const id of insertedInstanceIds) {
      await db.delete(instances).where(eq(instances.id, id));
    }
  });

  function createTestApp(params: { deleteShouldFail: boolean }) {
    const services = createServices(db, null);

    const originalDelete = services.instances.delete.bind(services.instances);
    const deleteMock = mock(async (id: string) => {
      if (params.deleteShouldFail) {
        throw new Error('Transient DB error');
      }
      return originalDelete(id);
    });

    services.instances.delete = deleteMock as typeof services.instances.delete;

    const disconnectMock = mock(async () => {});
    const logoutMock = mock(async () => {});

    const plugin = {
      disconnect: disconnectMock,
      logout: logoutMock,
      capabilities: {},
    };

    const channelRegistry = {
      get: mock(() => plugin),
      getAll: mock(() => [plugin]),
      has: mock(() => true),
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
      c.set('channelRegistry', channelRegistry as unknown as AppVariables['channelRegistry']);
      c.set('apiKey', { id: 'test-key', name: 'test', scopes: ['*'], instanceIds: null, expiresAt: null });
      await next();
    });

    app.route('/instances', instancesRoutes);

    return { app, deleteMock, disconnectMock, logoutMock };
  }

  test('does not clear auth when delete fails', async () => {
    const { app, deleteMock, disconnectMock, logoutMock } = createTestApp({ deleteShouldFail: true });

    const res = await app.request(`/instances/${testInstance.id}`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(500);
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(deleteMock).toHaveBeenCalledWith(testInstance.id);
    expect(disconnectMock).toHaveBeenCalledTimes(1);
    expect(disconnectMock).toHaveBeenCalledWith(testInstance.id);
    expect(logoutMock).toHaveBeenCalledTimes(0);
  });
});
