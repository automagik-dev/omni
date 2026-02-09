/**
 * Consumer Offset Service Tests
 *
 * Tests for sequence tracking, upsert behavior, and gap detection.
 */

import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import type { Database } from '@omni/db';
import { consumerOffsets } from '@omni/db';
import { eq } from 'drizzle-orm';
import { ConsumerOffsetService } from '../services/consumer-offsets';
import { describeWithDb, getTestDb } from './db-helper';

const TEST_PREFIX = 'test-consumer-';

describeWithDb('ConsumerOffsetService', () => {
  let db: Database;
  let service: ConsumerOffsetService;

  beforeAll(() => {
    db = getTestDb();
    service = new ConsumerOffsetService(db);
  });

  afterAll(async () => {
    // Clean up test data
    const rows = await db.select().from(consumerOffsets);
    for (const row of rows) {
      if (row.consumerName.startsWith(TEST_PREFIX)) {
        await db.delete(consumerOffsets).where(eq(consumerOffsets.consumerName, row.consumerName));
      }
    }
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
