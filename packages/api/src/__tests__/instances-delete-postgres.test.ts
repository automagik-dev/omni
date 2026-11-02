/**
 * Tests for DELETE /instances/:id behavior around auth cleanup ordering.
 */

import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { NotFoundError } from '@omni/core';
import { type Database, type Instance, createDbHandle } from '@omni/db';
import { instances } from '@omni/db';
import { pgRoleUrl, provisionMigratedDatabase } from '@omni/db/pg-migrated-template';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { instancesRoutes } from '../routes/v2/instances';
import { createServices } from '../services';
import type { AppVariables } from '../types';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';

postgresDescribe('Instances Delete Endpoint', () => {
  let db: Database;
  const dbName = `omni_l1_${crypto.randomUUID().replaceAll('-', '')}`;
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
        name: `test-delete-${Date.now()}`,
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
