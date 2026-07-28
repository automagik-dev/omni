/**
 * `FollowUpLifecycleService.evaluateIdleTimeoutFreshness` against real
 * PostgreSQL — the consumer-side gate for `chat.idle_timeout` deliveries.
 *
 * WHY THIS FILE EXISTS SEPARATELY
 * ------------------------------
 * These assertions first shipped inside `follow-up-lifecycle.test.ts`, behind
 * `describeWithDb` → `ENABLE_DB_TESTS`, which nothing in this repository ever
 * sets. They therefore never executed anywhere, and the arm-epoch bug below
 * (a re-arm resets `sequenceIndex` to 0, colliding with the previous cycle's
 * claims and silently dropping a legitimate follow-up) shipped uncaught.
 *
 * `*-postgres.test.ts` is the naming `scripts/pg-gate.ts` discovers, and the
 * gate fails loudly when a discovered suite skips — so these run in CI.
 *
 * Set `OMNI_G4_POSTGRES_URL` to a DISPOSABLE superuser URL; the gate does that.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EventBus, FollowUpSequenceConfig } from '@omni/core';
import { type Database, chatFollowUpState, chats, createDbHandle, instances } from '@omni/db';
import { and, eq } from 'drizzle-orm';
import {
  FollowUpLifecycleService,
  releaseIdleTimeoutClaim,
  resetIdleTimeoutClaims,
} from '../services/follow-up-lifecycle';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl.length > 0 ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';

const here = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(here, '..', '..', '..', 'db', 'drizzle');

function runSqlOn(url: string, script: string): { exitCode: number; stderr: string } {
  const file = join(tmpdir(), `omni-followup-${crypto.randomUUID()}.sql`);
  writeFileSync(file, script);
  try {
    const result = Bun.spawnSync({
      cmd: [psqlBin, '-X', '--no-psqlrc', '-A', '-t', '--set', 'ON_ERROR_STOP=1', '--dbname', url, '-f', file],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return { exitCode: result.exitCode, stderr: result.stderr.toString() };
  } finally {
    rmSync(file, { force: true });
  }
}

function urlFor(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

const config = (overrides: Partial<FollowUpSequenceConfig> = {}): FollowUpSequenceConfig => ({
  enabled: true,
  schedule: { kind: 'fixed', intervalsMinutes: [3, 5, 30] },
  maxFollowUps: 3,
  promptTemplate: 'Check in with {{chatName}}',
  stopOutsideMessagingWindow: false,
  showTypingIndicator: false,
  ...overrides,
});

postgresDescribe('evaluateIdleTimeoutFreshness (real PostgreSQL)', () => {
  const dbName = `omni_followup_${crypto.randomUUID().replaceAll('-', '')}`;
  let db: Database;
  let closeDb: () => Promise<void>;
  let service: FollowUpLifecycleService;
  let instanceId: string;
  let chatId: string;

  const eventBus = {
    connect: async () => {},
    close: async () => {},
    isConnected: () => true,
    publish: mock(async () => ({ id: 'evt', sequence: 0 })),
    publishGeneric: mock(async () => ({ id: 'evt', sequence: 0 })),
    subscribe: mock(async () => ({ id: '', pattern: '', unsubscribe: async () => {} })),
    subscribePattern: mock(async () => ({ id: '', pattern: '', unsubscribe: async () => {} })),
    subscribeMany: mock(async () => ({ id: '', pattern: '', unsubscribe: async () => {} })),
    subscribeAll: mock(async () => ({ id: '', pattern: '', unsubscribe: async () => {} })),
  } as unknown as EventBus;

  beforeAll(async () => {
    const created = runSqlOn(superUrl, `CREATE DATABASE "${dbName}";`);
    if (created.exitCode !== 0) throw new Error(`could not create database: ${created.stderr}`);

    const migrations = readdirSync(drizzleDir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => readFileSync(join(drizzleDir, f), 'utf-8'))
      .join('\n');
    const dbUrl = urlFor(superUrl, dbName);
    const migrated = runSqlOn(dbUrl, migrations);
    if (migrated.exitCode !== 0) throw new Error(`migrations failed: ${migrated.stderr}`);

    const handle = createDbHandle({ url: dbUrl, maxConnections: 3 });
    db = handle.db;
    closeDb = () => handle.close().catch(() => undefined);

    const [instance] = await db
      .insert(instances)
      .values({ name: 'follow-up-freshness', channel: 'whatsapp-baileys' as const })
      .returning();
    if (!instance) throw new Error('instance insert returned nothing');
    instanceId = instance.id;

    const [chat] = await db
      .insert(chats)
      .values({
        instanceId,
        externalId: 'chat-follow-up-freshness',
        chatType: 'dm' as const,
        channel: 'whatsapp-baileys' as const,
        name: 'Alice Freshness',
      })
      .returning();
    if (!chat) throw new Error('chat insert returned nothing');
    chatId = chat.id;

    service = new FollowUpLifecycleService(db, eventBus);
  }, 180_000);

  afterAll(async () => {
    if (closeDb) await closeDb();
    runSqlOn(superUrl, `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`);
  });

  beforeEach(async () => {
    resetIdleTimeoutClaims();
    await db.delete(chatFollowUpState).where(eq(chatFollowUpState.chatId, chatId));
  });

  /** Arm the row, then force it to the sequence index the sweeper would have left. */
  async function armAtIndex(sequenceIndex: number, lastAgentMessageAt = new Date()): Promise<void> {
    await service.armForOutbound({
      chatId,
      instanceId,
      agentId: null,
      lastAgentMessageAt,
      config: config(),
    });
    await db
      .update(chatFollowUpState)
      .set({ sequenceIndex })
      .where(and(eq(chatFollowUpState.chatId, chatId), eq(chatFollowUpState.instanceId, instanceId)));
  }

  test('lets the first delivery through while the row is one step ahead', async () => {
    // publish(0) → recordFired(1): the healthy publish/consume race that the
    // old strictly-greater gate dropped for ~14% of armed chats (f149179a).
    await armAtIndex(1);

    const verdict = await service.evaluateIdleTimeoutFreshness(chatId, instanceId, 0);

    expect(verdict.skip).toBe(false);
  });

  test('drops a redelivery of an event it already let through', async () => {
    await armAtIndex(1);

    const first = await service.evaluateIdleTimeoutFreshness(chatId, instanceId, 0);
    const redelivery = await service.evaluateIdleTimeoutFreshness(chatId, instanceId, 0);

    expect(first.skip).toBe(false);
    expect(redelivery.skip).toBe(true);
    expect(redelivery.reason).toBe('duplicate_delivery_event_0');
  });

  test('lets the next event through after the previous one fired', async () => {
    await armAtIndex(1);
    await service.evaluateIdleTimeoutFreshness(chatId, instanceId, 0);

    await armAtIndex(2);
    const next = await service.evaluateIdleTimeoutFreshness(chatId, instanceId, 1);

    expect(next.skip).toBe(false);
  });

  test('still drops a historical replay two or more steps behind', async () => {
    await armAtIndex(3);

    const verdict = await service.evaluateIdleTimeoutFreshness(chatId, instanceId, 0);

    expect(verdict.skip).toBe(true);
    expect(verdict.reason).toBe('sequence_advanced_row_at_3_event_0');
  });

  test('a re-armed sequence delivers event 0 again instead of seeing a duplicate', async () => {
    // The everyday cycle: follow-up 0 fires → customer replies (disarm) →
    // agent replies (re-arm, which resets sequenceIndex to 0) → chat idles
    // again → the sweeper publishes event 0 for the NEW cycle. Keying the
    // claim on (chat, instance, index) alone made this second, entirely
    // legitimate event 0 look like a redelivery for the claim's whole 6h TTL,
    // and the follow-up was silently dropped.
    const firstArmAt = new Date(Date.now() - 40 * 60_000);
    await armAtIndex(1, firstArmAt);
    const cycleOne = await service.evaluateIdleTimeoutFreshness(chatId, instanceId, 0);
    expect(cycleOne.skip).toBe(false);

    await service.disarm({ chatId, instanceId, reason: 'customer_replied' });
    await armAtIndex(1, new Date());

    const cycleTwo = await service.evaluateIdleTimeoutFreshness(chatId, instanceId, 0);
    expect(cycleTwo.skip).toBe(false);

    // Dedupe still holds INSIDE the new cycle.
    const cycleTwoRedelivery = await service.evaluateIdleTimeoutFreshness(chatId, instanceId, 0);
    expect(cycleTwoRedelivery.skip).toBe(true);
    expect(cycleTwoRedelivery.reason).toBe('duplicate_delivery_event_0');
  });

  test('releasing the claim of a failed delivery lets the redelivery through', async () => {
    // The gate claims BEFORE the engine executes. A delivery that fails
    // (queue full → nak) must give the claim back, or its own redelivery is
    // dropped as a duplicate and the follow-up is lost permanently.
    await armAtIndex(1);

    const first = await service.evaluateIdleTimeoutFreshness(chatId, instanceId, 0);
    expect(first.skip).toBe(false);
    expect(first.claimToken).toBeString();

    releaseIdleTimeoutClaim(first.claimToken as string);

    const redelivery = await service.evaluateIdleTimeoutFreshness(chatId, instanceId, 0);
    expect(redelivery.skip).toBe(false);
  });
});
