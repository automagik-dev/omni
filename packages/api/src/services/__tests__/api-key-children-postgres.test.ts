/**
 * Chat keys over REAL PostgreSQL (wish: omni-chat-threads, Group 1).
 *
 * What a fake cannot prove: migration 0088 (column, FK with ON DELETE CASCADE,
 * index) applies on the committed chain and again on top of itself; the cascade
 * removes a deleted parent's children; and the parent row's `FOR UPDATE`
 * serializes the one-live-child-per-chat re-mint, the child cap, and a PATCH
 * racing a mint, so every child stays inside its parent.
 *
 * Set `OMNI_G4_POSTGRES_URL` to a DISPOSABLE superuser URL; `scripts/pg-gate.ts`
 * does that for you. No ambient `DATABASE_URL` is read.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { EventBus } from '@omni/core';
import { type Database, apiKeys, createDbHandle } from '@omni/db';
import { provisionMigratedDatabase } from '@omni/db/pg-migrated-template';
import { and, eq, sql } from 'drizzle-orm';
import { DEFAULT_DEVICE_KEY_SCOPES } from '../../login/config';
import { ApiKeyService, type ChildChat, MAX_LIVE_CHILDREN, type MintChildResult } from '../api-keys';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl.length > 0 ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';

const MIGRATION_0088 = join(import.meta.dir, '..', '..', '..', '..', 'db', 'drizzle', '0088_api_key_parent.sql');
const INSTANCE = '11111111-1111-4111-8111-111111111111';
const OTHER_INSTANCE = '22222222-2222-4222-8222-222222222222';
const ALWAYS = () => true;

function urlFor(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

function chat(n: number, instanceId = INSTANCE): ChildChat {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    externalId: `55119${String(n).padStart(8, '0')}@s.whatsapp.net`,
    instanceId,
  };
}

function minted(result: MintChildResult): Extract<MintChildResult, { ok: true }> {
  if (!result.ok) throw new Error(`mint refused: ${result.code} ${result.message}`);
  return result;
}

postgresDescribe('chat keys (real PostgreSQL)', () => {
  const dbName = `omni_key_children_${crypto.randomUUID().replaceAll('-', '')}`;
  let close: () => Promise<void>;
  let db: Database;
  let service: ApiKeyService;
  const events: { type: string; payload: Record<string, unknown> }[] = [];
  const eventBus = {
    publish: async (type: string, payload: Record<string, unknown>) => {
      events.push({ type, payload });
      return { id: crypto.randomUUID() };
    },
  } as unknown as EventBus;

  const childrenOf = (parentId: string) => db.select().from(apiKeys).where(eq(apiKeys.parentKeyId, parentId));
  const liveChildrenOf = (parentId: string) =>
    db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.parentKeyId, parentId), eq(apiKeys.status, 'active')));
  const parent = (extra: { expiresAt?: Date; instanceIds?: string[] } = {}) =>
    service.create({ name: `sign-in-${crypto.randomUUID()}`, scopes: [...DEFAULT_DEVICE_KEY_SCOPES], ...extra });

  beforeAll(() => {
    provisionMigratedDatabase({ superUrl, psqlBin }, dbName);
    const handle = createDbHandle({ url: urlFor(superUrl, dbName), maxConnections: 6 });
    close = handle.close;
    db = handle.db;
    service = new ApiKeyService(db, { eventBus });
  });

  afterAll(async () => {
    await close?.().catch(() => undefined);
    Bun.spawnSync({
      cmd: [
        psqlBin,
        '-X',
        '--no-psqlrc',
        '--dbname',
        superUrl,
        '-c',
        `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`,
      ],
    });
  });

  test('migration 0088 applied with the chain, and applies again without error', async () => {
    const again = Bun.spawnSync({
      cmd: [
        psqlBin,
        '-X',
        '--no-psqlrc',
        '--set',
        'ON_ERROR_STOP=1',
        '--dbname',
        urlFor(superUrl, dbName),
        '-f',
        MIGRATION_0088,
      ],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(again.stderr.toString()).not.toContain('ERROR');
    expect(again.exitCode).toBe(0);

    const fk = await db.execute(
      sql`SELECT confdeltype, confrelid::regclass::text AS target FROM pg_constraint
          WHERE conname = 'api_keys_parent_key_id_fk' AND conrelid = '"api_keys"'::regclass`,
    );
    expect([...fk]).toEqual([{ confdeltype: 'c', target: 'api_keys' }]);
    const index = await db.execute(
      sql`SELECT indexdef FROM pg_indexes WHERE tablename = 'api_keys' AND indexname = 'api_keys_parent_key_id_idx'`,
    );
    expect([...index]).toHaveLength(1);
    expect(String((index[0] as { indexdef: string }).indexdef)).toContain('(parent_key_id)');
  });

  test('deleting a parent revokes its children, then the cascade removes their rows', async () => {
    const { key: root } = await parent();
    const a = minted(await service.mintChild(root.id, chat(1)));
    const b = minted(await service.mintChild(root.id, chat(2)));
    await service.revokeChild(root.id, b.child.id, root.name);
    events.length = 0;

    expect(await service.delete(root.id)).toBe(true);
    expect(await childrenOf(root.id)).toHaveLength(0);
    expect(await service.getById(a.child.id)).toBeNull();
    expect(await service.getById(b.child.id)).toBeNull();
    expect(await service.validate(a.plainTextKey)).toBeNull();
    // Only the live child is revoked by the delete; the already revoked one leaves no second event.
    expect(events.map((event) => [event.type, event.payload.keyId, event.payload.reason])).toEqual([
      ['access.key_revoked', a.child.id, 'parent_deleted'],
    ]);
  });

  test('a raw delete that skips the service still removes live children (the FK cascade)', async () => {
    const { key: root } = await parent();
    minted(await service.mintChild(root.id, chat(1)));
    await db.delete(apiKeys).where(eq(apiKeys.id, root.id));
    expect(await childrenOf(root.id)).toHaveLength(0);
  });

  test('two concurrent mints for one chat leave exactly one live child', async () => {
    const { key: root } = await parent();
    const [first, second] = (await Promise.all([
      service.mintChild(root.id, chat(1)),
      service.mintChild(root.id, chat(1)),
    ])) as [MintChildResult, MintChildResult];
    const both = [minted(first), minted(second)];

    const live = await liveChildrenOf(root.id);
    expect(live).toHaveLength(1);
    expect(await childrenOf(root.id)).toHaveLength(2);
    // The later mint replaced the earlier one, whichever ran first.
    const later = both.find((result) => result.replacedKeyId !== null);
    const earlier = both.find((result) => result.replacedKeyId === null);
    expect(later?.child.id).toBe(live[0]?.id as string);
    expect(later?.replacedKeyId).toBe(earlier?.child.id as string);
  });

  test(`two concurrent mints at ${MAX_LIVE_CHILDREN - 1} live children: one mints, one gets child_limit`, async () => {
    const { key: root } = await parent();
    await db.insert(apiKeys).values(
      Array.from({ length: MAX_LIVE_CHILDREN - 1 }, (_, i) => {
        const target = chat(1_000 + i);
        return {
          name: `seed-${i}`,
          keyPrefix: 'seed',
          keyHash: `${String(i).padStart(4, '0')}${root.id.replaceAll('-', '')}`.padEnd(64, '0'),
          scopes: ['messages:send', 'chats:read'],
          profile: 'cs' as const,
          chatAllowlist: [target.id, target.externalId],
          instanceAllowlist: [INSTANCE],
          outboundRecipientAllowlist: [target.externalId],
          instanceIds: [INSTANCE],
          parentKeyId: root.id,
        };
      }),
    );

    const results = await Promise.all([service.mintChild(root.id, chat(1)), service.mintChild(root.id, chat(2))]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      expect.objectContaining({ ok: false, code: 'child_limit' }),
    ]);
    expect(await liveChildrenOf(root.id)).toHaveLength(MAX_LIVE_CHILDREN);
  });

  test('a parent revoke revokes its children', async () => {
    const { key: root } = await parent();
    const a = minted(await service.mintChild(root.id, chat(1)));
    const b = minted(await service.mintChild(root.id, chat(2)));

    await service.revoke(root.id, 'lost laptop', 'owner');
    expect(await liveChildrenOf(root.id)).toHaveLength(0);
    for (const child of [a, b]) {
      expect(await service.validate(child.plainTextKey)).toBeNull();
      expect((await service.getById(child.child.id))?.revokeReason).toBe('parent_revoked');
    }
  });

  test('a revoke or delete that names a chat key itself publishes its access.key_revoked, once', async () => {
    const { key: root } = await parent();
    const a = minted(await service.mintChild(root.id, chat(1)));
    const b = minted(await service.mintChild(root.id, chat(2)));
    events.length = 0;

    await service.revoke(a.child.id, 'leaked', 'owner');
    await service.revoke(a.child.id, 'again', 'owner');
    expect(await service.delete(b.child.id)).toBe(true);
    expect(await service.delete(a.child.id)).toBe(true);
    expect(
      events.map((event) => [event.type, event.payload.keyId, event.payload.reason, event.payload.revokedBy]),
    ).toEqual([
      ['access.key_revoked', a.child.id, 'operator', 'owner'],
      ['access.key_revoked', b.child.id, 'operator', null],
    ]);
  });

  test('a guarded PATCH that shortens the expiry clamps every child; lengthening changes none', async () => {
    const week = new Date(Date.now() + 7 * 86_400_000);
    const { key: root } = await parent({ expiresAt: week });
    const a = minted(await service.mintChild(root.id, chat(1)));
    const b = minted(await service.mintChild(root.id, chat(2)));
    for (const child of [a, b]) expect(child.child.expiresAt?.getTime()).toBe(week.getTime());

    const day = new Date(Date.now() + 86_400_000);
    expect((await service.updateWithAuthorityGuard(root.id, { expiresAt: day }, ALWAYS)).status).toBe('updated');
    for (const child of await childrenOf(root.id)) expect(child.expiresAt?.getTime()).toBe(day.getTime());

    const before = (await childrenOf(root.id)).map((child) => [child.id, child.expiresAt?.getTime(), child.status]);
    const month = new Date(Date.now() + 30 * 86_400_000);
    expect((await service.updateWithAuthorityGuard(root.id, { expiresAt: month }, ALWAYS)).status).toBe('updated');
    expect((await service.updateWithAuthorityGuard(root.id, { expiresAt: null }, ALWAYS)).status).toBe('updated');
    const after = (await childrenOf(root.id)).map((child) => [child.id, child.expiresAt?.getTime(), child.status]);
    expect(after.sort()).toEqual(before.sort());
  });

  test('a guarded PATCH that narrows the scopes revokes every child', async () => {
    const { key: root } = await parent();
    minted(await service.mintChild(root.id, chat(1)));
    minted(await service.mintChild(root.id, chat(2)));

    const narrowed = DEFAULT_DEVICE_KEY_SCOPES.filter((scope) => scope !== 'messages:*');
    expect((await service.updateWithAuthorityGuard(root.id, { scopes: narrowed }, ALWAYS)).status).toBe('updated');
    const children = await childrenOf(root.id);
    expect(children).toHaveLength(2);
    for (const child of children) {
      expect(child.status).toBe('revoked');
      expect(child.revokeReason).toBe('parent_narrowed');
    }
  });

  test('a denied guarded PATCH changes no child', async () => {
    const { key: root } = await parent({ expiresAt: new Date(Date.now() + 7 * 86_400_000) });
    const a = minted(await service.mintChild(root.id, chat(1)));
    const result = await service.updateWithAuthorityGuard(
      root.id,
      { expiresAt: new Date(Date.now() + 60_000) },
      () => false,
    );
    expect(result.status).toBe('denied');
    expect((await service.getById(a.child.id))?.expiresAt?.getTime()).toBe(a.child.expiresAt?.getTime() as number);
  });

  test('a mint racing a PATCH that shortens the expiry never outlives the parent', async () => {
    const { key: root } = await parent({ expiresAt: new Date(Date.now() + 7 * 86_400_000) });
    const day = new Date(Date.now() + 86_400_000);
    const [mint] = await Promise.all([
      service.mintChild(root.id, chat(1)),
      service.updateWithAuthorityGuard(root.id, { expiresAt: day }, ALWAYS),
    ]);
    minted(mint);
    for (const child of await liveChildrenOf(root.id)) expect(child.expiresAt?.getTime()).toBe(day.getTime());
  });

  test('a mint racing an instanceIds narrowing leaves no live child outside the parent', async () => {
    for (let round = 0; round < 5; round++) {
      const { key: root } = await parent({ instanceIds: [INSTANCE, OTHER_INSTANCE] });
      await Promise.all([
        service.mintChild(root.id, chat(1, OTHER_INSTANCE)),
        service.updateWithAuthorityGuard(root.id, { instanceIds: [INSTANCE] }, ALWAYS),
      ]);
      const live = await liveChildrenOf(root.id);
      expect(live.filter((child) => child.instanceIds?.includes(OTHER_INSTANCE))).toEqual([]);
    }
  });

  test("a guarded PATCH cannot widen a child past its parent's expiry, scopes or instances", async () => {
    const week = new Date(Date.now() + 7 * 86_400_000);
    const { key: root } = await parent({ expiresAt: week, instanceIds: [INSTANCE] });
    const { child } = minted(await service.mintChild(root.id, chat(1)));

    for (const options of [
      { expiresAt: null },
      { expiresAt: new Date(week.getTime() + 60_000) },
      { scopes: [...child.scopes, 'keys:write'] },
      { instanceIds: [INSTANCE, OTHER_INSTANCE] },
    ]) {
      expect((await service.updateWithAuthorityGuard(child.id, options, ALWAYS)).status).toBe('denied');
    }
    const row = await service.getById(child.id);
    expect(row?.expiresAt?.getTime()).toBe(week.getTime());
    expect(row?.instanceIds).toEqual([INSTANCE]);
    expect([...(row?.scopes ?? [])].sort()).toEqual([...child.scopes].sort());
  });
});
