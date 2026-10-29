/**
 * POST /chats/sync-names and ChatService.list() DM enrichment against real
 * PostgreSQL — the owner's own name must neither show nor block the repair.
 *
 * History sync named contacts' DMs after the account owner, and stored the
 * owner's pushName on participant rows (the contact's row from history
 * messages we sent; the owner's own row from live ones). `list()` fills a
 * nameless DM from participant displayNames at read time, so a repair that
 * judged list() output saw the owner's name again on every run. These tests
 * run the real route over the real ChatService: sync-names judges STORED
 * names (both chats of an @lid/phone pair included), enrichment skips the
 * owner's name, and a second run has nothing left to do.
 *
 * Set `OMNI_G4_POSTGRES_URL` to a DISPOSABLE superuser URL; the gate does that.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Database, chatParticipants, chats, createDbHandle, instances } from '@omni/db';
import { provisionMigratedDatabase } from '@omni/db/pg-migrated-template';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { errorHandler } from '../../../middleware/error';
import { ChatService } from '../../../services/chats';
import type { AppVariables } from '../../../types';
import { chatsRoutes } from '../chats';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl.length > 0 ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';

function runSqlOn(url: string, script: string): { exitCode: number; stderr: string } {
  const file = join(tmpdir(), `omni-sync-names-${crypto.randomUUID()}.sql`);
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

const OWNER = 'Owner Name';
const CHANNEL = 'whatsapp-baileys' as const;
const PAIR_PHONE = '5511900008006@s.whatsapp.net';

postgresDescribe('POST /chats/sync-names over stored names (real PostgreSQL)', () => {
  const dbName = `omni_sync_names_${crypto.randomUUID().replaceAll('-', '')}`;
  let db: Database;
  let closeDb: () => Promise<void>;
  let chatService: ChatService;
  let instanceId: string;
  const ids: Record<string, string> = {};

  async function addChat(key: string, externalId: string, name: string | null, canonicalId: string | null = null) {
    const [row] = await db
      .insert(chats)
      .values({ instanceId, externalId, canonicalId, chatType: 'dm', channel: CHANNEL, name })
      .returning();
    if (!row) throw new Error('chat insert returned nothing');
    ids[key] = row.id;
  }

  async function addParticipant(key: string, platformUserId: string, displayName: string) {
    await db.insert(chatParticipants).values({ chatId: ids[key] as string, platformUserId, displayName });
  }

  async function storedName(key: string): Promise<string | null> {
    const [row] = await db
      .select({ name: chats.name })
      .from(chats)
      .where(eq(chats.id, ids[key] as string));
    return row?.name ?? null;
  }

  function app() {
    const hono = new Hono<{ Variables: AppVariables }>();
    hono.onError(errorHandler);
    hono.use('*', async (c, next) => {
      c.set('services', {
        instances: {
          getById: async (id: string) => (await db.select().from(instances).where(eq(instances.id, id)))[0],
        },
        chats: chatService,
      } as never);
      c.set('channelRegistry', {
        get: () => ({
          capabilities: {},
          fetchContacts: async () => ({
            contacts: [
              { platformUserId: '5511900006521@s.whatsapp.net', name: 'Bob', isGroup: false },
              { platformUserId: PAIR_PHONE, name: 'Carol', isGroup: false },
            ],
          }),
        }),
      } as never);
      c.set('apiKey', { id: 'k', name: 'k', scopes: ['*'], instanceIds: null, expiresAt: null } as never);
      await next();
    });
    hono.route('/chats', chatsRoutes);
    return hono;
  }

  async function syncNames(): Promise<{ chatsUpdated: number; chatsCleared: number }> {
    const res = await app().request('/chats/sync-names', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instanceId }),
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { data: { chatsUpdated: number; chatsCleared: number } }).data;
  }

  beforeAll(async () => {
    provisionMigratedDatabase({ superUrl, psqlBin }, dbName);
    const handle = createDbHandle({ url: urlFor(superUrl, dbName), maxConnections: 3 });
    db = handle.db;
    closeDb = () => handle.close().catch(() => undefined);
    chatService = new ChatService(db, null);

    const [instance] = await db
      .insert(instances)
      .values({
        name: 'pessoal-whatsapp',
        channel: CHANNEL,
        profileName: OWNER,
        ownerIdentifier: '5511900000008:45@s.whatsapp.net',
      })
      .returning();
    if (!instance) throw new Error('instance insert returned nothing');
    instanceId = instance.id;

    // Owner-named DM with a known contact; the contact's participant row got the owner's pushName.
    await addChat('bob', '5511900006521@s.whatsapp.net', OWNER);
    await addParticipant('bob', '5511900006521', OWNER);
    // Owner-named DM with no contact name: the owner's own row and a leaked contact row.
    await addChat('unknown', '5511900001111@s.whatsapp.net', OWNER);
    await addParticipant('unknown', '5511900000008:45', OWNER);
    await addParticipant('unknown', '5511900001111', OWNER);
    // Both chats of an @lid/phone pair, owner-named.
    await addChat('pairPhone', PAIR_PHONE, OWNER);
    await addChat('pairLid', '100000007669@lid', OWNER, PAIR_PHONE);
    // A real stored name, a nameless DM with a real participant name, and the self-chat.
    await addChat('marina', '5511900004444@s.whatsapp.net', 'Marina');
    await addChat('dave', '5511900003333@s.whatsapp.net', null);
    await addParticipant('dave', '5511900000008', OWNER);
    await addParticipant('dave', '5511900003333', 'Dave');
    // The owner's own row under an older profile name, alone in a nameless DM.
    await addChat('ownerRow', '5511900002222@s.whatsapp.net', null);
    await addParticipant('ownerRow', '5511900000008', 'Old Owner Name');
    // The self-chat may show the owner's own name.
    await addChat('self', '5511900000008@s.whatsapp.net', null, '5511900000008@s.whatsapp.net');
    await addParticipant('self', '5511900000008', OWNER);
  }, 180_000);

  afterAll(async () => {
    if (closeDb) await closeDb();
    runSqlOn(superUrl, `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`);
  });

  test('first run repairs every owner-named DM, both chats of the pair included', async () => {
    const result = await syncNames();

    expect(result).toMatchObject({ chatsUpdated: 3, chatsCleared: 1 });
    expect(await storedName('bob')).toBe('Bob');
    expect(await storedName('pairPhone')).toBe('Carol');
    expect(await storedName('pairLid')).toBe('Carol');
    expect(await storedName('unknown')).toBeNull();
    expect(await storedName('marina')).toBe('Marina');
  });

  test('list() never shows the owner name on a cleared DM, and still enriches a real one', async () => {
    const { items } = await chatService.list({ instanceId, chatType: ['dm'], limit: 100 });
    const nameOf = (key: string) => items.find((chat) => chat.id === ids[key])?.name ?? null;

    expect(nameOf('unknown')).toBeNull();
    expect(nameOf('ownerRow')).toBeNull();
    expect(nameOf('dave')).toBe('Dave');
    expect(nameOf('self')).toBe(OWNER);
  });

  test('a second run has nothing left to repair', async () => {
    const result = await syncNames();

    expect(result.chatsUpdated).toBe(0);
    expect(result.chatsCleared).toBe(0);
    expect(await storedName('marina')).toBe('Marina');
  });
});
