/**
 * Consumer Offset Service Tests
 *
 * Tests for sequence tracking, upsert behavior, and gap detection.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { type Database, createDbHandle } from '@omni/db';
import { consumerOffsets } from '@omni/db';
import { pgRoleUrl, provisionMigratedDatabase } from '@omni/db/pg-migrated-template';
import { eq } from 'drizzle-orm';
import { ConsumerOffsetService } from '../services/consumer-offsets';

const TEST_PREFIX = 'test-consumer-';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';

postgresDescribe('ConsumerOffsetService', () => {
  let db: Database;
  const dbName = `omni_l1_${crypto.randomUUID().replaceAll('-', '')}`;
  let close: (() => Promise<void>) | undefined;
  let service: ConsumerOffsetService;

  beforeAll(async () => {
    provisionMigratedDatabase({ superUrl, psqlBin }, dbName);
    const handle = createDbHandle({ url: pgRoleUrl(superUrl, dbName), maxConnections: 4 });
    close = handle.close;
    db = handle.db;
    service = new ConsumerOffsetService(db);
  });

  async function cleanupRows() {
    if (!db) return;
    // Clean up test data
    const rows = await db.select().from(consumerOffsets);
    for (const row of rows) {
      if (row.consumerName.startsWith(TEST_PREFIX)) {
        await db.delete(consumerOffsets).where(eq(consumerOffsets.consumerName, row.consumerName));
      }
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

  beforeEach(async () => {
    // Clean test consumers before each test
    const rows = await db.select().from(consumerOffsets);
    for (const row of rows) {
      if (row.consumerName.startsWith(TEST_PREFIX)) {
        await db.delete(consumerOffsets).where(eq(consumerOffsets.consumerName, row.consumerName));
      }
    }
  });

  test('getOffset() returns 0 for unknown consumer', async () => {
    const offset = await service.getOffset(`${TEST_PREFIX}unknown`);
    expect(offset).toBe(0);
  });

  test('updateOffset() inserts new offset', async () => {
    const name = `${TEST_PREFIX}insert-${Date.now()}`;
    await service.updateOffset(name, 'MESSAGE', 42, '00000000-0000-0000-0000-000000000001');

    const offset = await service.getOffset(name);
    expect(offset).toBe(42);
  });

  test('updateOffset() advances sequence via GREATEST', async () => {
    const name = `${TEST_PREFIX}greatest-${Date.now()}`;

    // Insert initial
    await service.updateOffset(name, 'MESSAGE', 10);

    // Advance forward
    await service.updateOffset(name, 'MESSAGE', 50);
    expect(await service.getOffset(name)).toBe(50);

    // Attempt to go backward — should keep 50
    await service.updateOffset(name, 'MESSAGE', 30);
    expect(await service.getOffset(name)).toBe(50);
  });

  test('getAllOffsets() returns all tracked consumers', async () => {
    const name1 = `${TEST_PREFIX}all-a-${Date.now()}`;
    const name2 = `${TEST_PREFIX}all-b-${Date.now()}`;

    await service.updateOffset(name1, 'MESSAGE', 100);
    await service.updateOffset(name2, 'SYNC', 200);

    const all = await service.getAllOffsets();
    const testOffsets = all.filter((o) => o.consumerName.startsWith(TEST_PREFIX));

    expect(testOffsets.length).toBeGreaterThanOrEqual(2);
    expect(testOffsets.find((o) => o.consumerName === name1)?.lastSequence).toBe(100);
    expect(testOffsets.find((o) => o.consumerName === name2)?.lastSequence).toBe(200);
  });

  test('detectGaps() finds consumers behind stream', async () => {
    const name = `${TEST_PREFIX}gap-${Date.now()}`;
    await service.updateOffset(name, 'MESSAGE', 500);

    const streamInfo = new Map([['MESSAGE', { messages: 800 }]]);
    const gaps = await service.detectGaps(streamInfo);

    const testGap = gaps.find((g) => g.consumerName === name);
    expect(testGap).toBeDefined();
    expect(testGap?.gap).toBe(300);
    expect(testGap?.lastOffset).toBe(500);
    expect(testGap?.streamTotal).toBe(800);
  });

  test('detectGaps() returns empty when consumer is caught up', async () => {
    const name = `${TEST_PREFIX}caught-up-${Date.now()}`;
    await service.updateOffset(name, 'MESSAGE', 800);

    const streamInfo = new Map([['MESSAGE', { messages: 800 }]]);
    const gaps = await service.detectGaps(streamInfo);

    const testGap = gaps.find((g) => g.consumerName === name);
    expect(testGap).toBeUndefined();
  });
});
