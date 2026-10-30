/**
 * GET /chats/:id names a chat as GET /chats names it, against real PostgreSQL.
 *
 * WhatsApp stores a DM first seen by its LID under that raw id (`69003213045769@lid`).
 * The list fills such a name at read time from the chat's participants (`enrichDmNames`)
 * and a nameless group's from omni_groups (`enrichGroupNames`); the single-chat read
 * answered the stored row as is, so a client that opened a chat by id showed the LID
 * where the list showed the contact. Both reads now name the chat the same way, and
 * neither changes the stored row.
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
  const file = join(tmpdir(), `omni-chat-by-id-${crypto.randomUUID()}.sql`);
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
const CONTACT_LID = '69003213045769@lid';

postgresDescribe('GET /chats/:id names a chat as GET /chats does (real PostgreSQL)', () => {
  const dbName = `omni_chat_by_id_${crypto.randomUUID().replaceAll('-', '')}`;
  let db: Database;
  let closeDb: () => Promise<void>;
  let chatService: ChatService;
  let instanceId: string;
  const ids: Record<string, string> = {};

  async function addChat(key: string, chatType: 'dm' | 'group', externalId: string, name: string | null) {
    const [row] = await db
      .insert(chats)
      .values({ instanceId, externalId, chatType, channel: CHANNEL, name })
      .returning();
    if (!row) throw new Error('chat insert returned nothing');
    ids[key] = row.id;
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
      c.set('apiKey', { id: 'k', name: 'k', scopes: ['*'], instanceIds: null, expiresAt: null } as never);
      await next();
    });
    hono.route('/chats', chatsRoutes);
    return hono;
  }

  async function listedName(key: string): Promise<string | null> {
    const res = await app().request(`/chats?instanceId=${instanceId}&limit=100`);
    expect(res.status).toBe(200);
    const { items } = (await res.json()) as { items: Array<{ id: string; name: string | null }> };
    return items.find((chat) => chat.id === ids[key])?.name ?? null;
  }

  async function nameById(key: string): Promise<string | null> {
    const res = await app().request(`/chats/${ids[key]}`);
    expect(res.status).toBe(200);
    return ((await res.json()) as { data: { name: string | null } }).data.name;
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

    // A DM stored under the contact's raw LID; the contact's participant row carries the name.
    await addChat('lid', 'dm', CONTACT_LID, CONTACT_LID);
    await db.insert(chatParticipants).values([
      { chatId: ids.lid as string, platformUserId: '5511900000008', displayName: OWNER },
      { chatId: ids.lid as string, platformUserId: '69003213045769', displayName: 'Guga Alves' },
    ]);
    // A nameless group with no synced metadata.
    await addChat('group', 'group', '120363000000000001@g.us', null);
  }, 180_000);

  afterAll(async () => {
    if (closeDb) await closeDb();
    runSqlOn(superUrl, `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`);
  });

  test("a DM stored under a raw LID is answered with its contact's name, as the list names it", async () => {
    expect(await listedName('lid')).toBe('Guga Alves');
    expect(await nameById('lid')).toBe('Guga Alves');
  });

  test('a nameless group is named by id as the list names it', async () => {
    const listed = await listedName('group');
    expect(listed).toStartWith('Group ');
    expect(await nameById('group')).toBe(listed);
  });

  test('reading by id leaves the stored row as it was', async () => {
    await nameById('lid');
    await nameById('group');
    expect(await storedName('lid')).toBe(CONTACT_LID);
    expect(await storedName('group')).toBeNull();
  });
});
