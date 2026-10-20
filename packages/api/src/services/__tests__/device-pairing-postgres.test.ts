/**
 * Device pairing over REAL PostgreSQL (wish: omni-labs-distribution, Group 2):
 * migration 0086, the single-winner approve and consume transitions, the key
 * minted at the consuming poll, and every way a code must fail to approve.
 *
 * Set `OMNI_G4_POSTGRES_URL` to a DISPOSABLE superuser URL; `scripts/pg-gate.ts`
 * does that for you. No ambient `DATABASE_URL` is read.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type Database, apiKeys, createDbHandle, devicePairings } from '@omni/db';
import { provisionMigratedDatabase } from '@omni/db/pg-migrated-template';
import { eq } from 'drizzle-orm';
import { ApiKeyService } from '../api-keys';
import {
  DevicePairingService,
  MAX_PENDING_PER_INSTANCE,
  MAX_PENDING_PER_IP,
  type PairingConfig,
  type PairingMessage,
} from '../device-pairing';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl.length > 0 ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';

const INSTANCE = '11111111-1111-4111-8111-111111111111';
const OTHER_INSTANCE = '22222222-2222-4222-8222-222222222222';
const OWNER = '5511999990000:12@s.whatsapp.net';

const CONFIG: PairingConfig = {
  enabled: true,
  instanceId: INSTANCE,
  allowedNumbers: ['5511988887777'],
  scopes: ['instances:read', 'chats:read'],
  keyTtlDays: 30,
  keyRateLimit: 120,
  publicUrl: null,
};

function urlFor(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

const ownerMessage = (text: string, overrides: Partial<PairingMessage> = {}): PairingMessage => ({
  instanceId: INSTANCE,
  text,
  ownerSelfChat: true,
  directSenderPhone: null,
  sender: OWNER,
  sentAt: new Date(),
  ...overrides,
});

postgresDescribe('device pairing (real PostgreSQL)', () => {
  const dbName = `omni_device_pairing_${crypto.randomUUID().replaceAll('-', '')}`;
  let close: () => Promise<void>;
  let db: Database;
  let service: DevicePairingService;

  let ips = 0;
  const start = (deviceName = 'Test laptop', instanceId = INSTANCE, clientIp = `203.0.113.${++ips}`) =>
    service.start({ deviceName, instanceId, channelType: 'whatsapp-baileys', clientIp });

  beforeAll(() => {
    provisionMigratedDatabase({ superUrl, psqlBin }, dbName);
    const handle = createDbHandle({ url: urlFor(superUrl, dbName), maxConnections: 4 });
    close = handle.close;
    db = handle.db;
    service = new DevicePairingService(db, new ApiKeyService(db), null);
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

  test('the owner sends the code: the next poll gets a scoped key exactly once', async () => {
    const started = await start();
    if (!started) throw new Error('start refused');
    expect(started.code).toMatch(/^[2-9A-Z]{4}-[2-9A-Z]{4}$/);

    const [stored] = await db.select().from(devicePairings).where(eq(devicePairings.id, started.pairingId));
    expect(stored?.codeHash).not.toContain(started.code);
    expect(JSON.stringify(stored)).not.toContain(started.pollToken);

    expect(await service.poll(started.pairingId, started.pollToken, CONFIG)).toEqual({ status: 'pending' });

    const approval = await service.approveFromMessage(ownerMessage(`Omni ${started.code}`), CONFIG);
    expect(approval?.approver).toBe('owner');
    expect(approval?.pairing.approvedBy).toBe(OWNER);

    const first = await service.poll(started.pairingId, started.pollToken, CONFIG);
    expect(first?.status).toBe('approved');
    expect(first?.apiKey).toMatch(/^omni_sk_/);
    expect(first?.scopes).toEqual(CONFIG.scopes);

    const [key] = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, first?.keyId ?? ''));
    expect(key?.scopes).toEqual(CONFIG.scopes);
    expect(key?.rateLimit).toBe(120);
    expect(key?.name).toBe('paired: Test laptop');
    const ttl = (key?.expiresAt?.getTime() ?? 0) - Date.now();
    expect(ttl).toBeGreaterThan(29 * 86_400_000);
    expect(ttl).toBeLessThanOrEqual(30 * 86_400_000);

    const [after] = await db.select().from(devicePairings).where(eq(devicePairings.id, started.pairingId));
    expect(after?.status).toBe('consumed');
    expect(after?.apiKeyId).toBe(first?.keyId ?? null);

    expect(await service.poll(started.pairingId, started.pollToken, CONFIG)).toEqual({ status: 'consumed' });
  });

  test('two polls racing an approved pairing mint one key', async () => {
    const started = await start('Racer');
    if (!started) throw new Error('start refused');
    await service.approveFromMessage(ownerMessage(started.code), CONFIG);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => service.poll(started.pairingId, started.pollToken, CONFIG)),
    );
    expect(results.filter((result) => result?.apiKey).length).toBe(1);
    const minted = await db.select().from(apiKeys).where(eq(apiKeys.name, 'paired: Racer'));
    expect(minted.length).toBe(1);
  });

  test('a wrong poll token reads nothing and consumes nothing', async () => {
    const started = await start('Token check');
    if (!started) throw new Error('start refused');
    await service.approveFromMessage(ownerMessage(started.code), CONFIG);
    expect(await service.poll(started.pairingId, `${started.pollToken}x`, CONFIG)).toBeNull();
    expect(await service.poll(crypto.randomUUID(), started.pollToken, CONFIG)).toBeNull();
    expect(await service.cancel(started.pairingId, 'omni_pt_wrong-token-value')).toBeNull();
    expect((await service.poll(started.pairingId, started.pollToken, CONFIG))?.status).toBe('approved');
  });

  test('a code approves once; a second send of it approves nothing', async () => {
    const started = await start('Once');
    if (!started) throw new Error('start refused');
    expect(await service.approveFromMessage(ownerMessage(started.code), CONFIG)).not.toBeNull();
    expect(await service.approveFromMessage(ownerMessage(started.code), CONFIG)).toBeNull();
  });

  test('non-approvers, other instances, quoted codes and wrong codes never approve', async () => {
    const started = await start('Strangers');
    if (!started) throw new Error('start refused');
    const refused: PairingMessage[] = [
      // Someone else, in a direct chat, not on the allowlist.
      ownerMessage(started.code, { ownerSelfChat: false, directSenderPhone: '5511900001111', sender: '5511900001111' }),
      // Someone else in a group (no direct sender phone).
      ownerMessage(started.code, { ownerSelfChat: false, directSenderPhone: null, sender: '5511988887777' }),
      // The right owner, on another instance.
      ownerMessage(started.code, { instanceId: OTHER_INSTANCE }),
      // The code inside a longer message.
      ownerMessage(`hey can you send me ${started.code} please`),
      // A different code.
      ownerMessage('ABCD-EFGH'),
    ];
    for (const message of refused) expect(await service.approveFromMessage(message, CONFIG)).toBeNull();
    expect(await service.poll(started.pairingId, started.pollToken, CONFIG)).toEqual({ status: 'pending' });
  });

  test('an allowlisted number approves from a direct chat', async () => {
    const started = await start('Second phone');
    if (!started) throw new Error('start refused');
    const approval = await service.approveFromMessage(
      ownerMessage(started.code.replace('-', ''), {
        ownerSelfChat: false,
        directSenderPhone: '5511988887777',
        sender: '5511988887777@s.whatsapp.net',
      }),
      CONFIG,
    );
    expect(approval?.approver).toBe('allowlist');
  });

  test('a code written before its pairing existed does not approve it', async () => {
    const started = await start('Replay');
    if (!started) throw new Error('start refused');
    const old = ownerMessage(started.code, { sentAt: new Date(Date.now() - 5 * 60_000) });
    expect(await service.approveFromMessage(old, CONFIG)).toBeNull();
  });

  test('pairing off, or no instance configured, approves nothing', async () => {
    const started = await start('Flag');
    if (!started) throw new Error('start refused');
    expect(await service.approveFromMessage(ownerMessage(started.code), { ...CONFIG, enabled: false })).toBeNull();
    expect(await service.approveFromMessage(ownerMessage(started.code), { ...CONFIG, instanceId: null })).toBeNull();
  });

  test('an expired pairing reads expired and never approves', async () => {
    const started = await start('Late');
    if (!started) throw new Error('start refused');
    await db
      .update(devicePairings)
      .set({ expiresAt: new Date(Date.now() - 1000), createdAt: new Date(Date.now() - 11 * 60_000) })
      .where(eq(devicePairings.id, started.pairingId));
    expect(await service.approveFromMessage(ownerMessage(started.code), CONFIG)).toBeNull();
    expect(await service.poll(started.pairingId, started.pollToken, CONFIG)).toEqual({ status: 'expired' });
  });

  test('an approved pairing that expires before its poll mints nothing', async () => {
    const started = await start('Approved late');
    if (!started) throw new Error('start refused');
    await service.approveFromMessage(ownerMessage(started.code), CONFIG);
    await db
      .update(devicePairings)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(devicePairings.id, started.pairingId));
    expect(await service.poll(started.pairingId, started.pollToken, CONFIG)).toEqual({ status: 'expired' });
    expect((await db.select().from(apiKeys).where(eq(apiKeys.name, 'paired: Approved late'))).length).toBe(0);
  });

  test('a cancelled pairing stays cancelled and never approves', async () => {
    const started = await start('Cancel me');
    if (!started) throw new Error('start refused');
    expect(await service.cancel(started.pairingId, started.pollToken)).toBe(true);
    expect(await service.cancel(started.pairingId, started.pollToken)).toBe(false);
    expect(await service.approveFromMessage(ownerMessage(started.code), CONFIG)).toBeNull();
    expect(await service.poll(started.pairingId, started.pollToken, CONFIG)).toEqual({ status: 'cancelled' });
  });

  test('an instance holds at most MAX_PENDING_PER_INSTANCE pending pairings', async () => {
    const busy = '33333333-3333-4333-8333-333333333333';
    for (let i = 0; i < MAX_PENDING_PER_INSTANCE; i++) expect(await start(`Busy ${i}`, busy)).not.toBeNull();
    expect(await start('One too many', busy)).toBeNull();
    // Others are unaffected.
    expect(await start('Elsewhere')).not.toBeNull();
  });

  test('one client IP holds at most MAX_PENDING_PER_IP pending pairings', async () => {
    const ip = '198.51.100.77';
    const instance = '44444444-4444-4444-8444-444444444444';
    for (let i = 0; i < MAX_PENDING_PER_IP; i++) expect(await start(`Same IP ${i}`, instance, ip)).not.toBeNull();
    expect(await start('One more from it', instance, ip)).toBeNull();
    expect(await start('Another address', instance)).not.toBeNull();
  });
});
