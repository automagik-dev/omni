import { Database as SQLite } from 'bun:sqlite';
import { describe, expect, mock, spyOn, test } from 'bun:test';
import type { EventBus, OmniEvent as NativeEvent } from '@omni/core';
import type { Database, OmniEvent } from '@omni/db';
import { chats, messages, omniEvents } from '@omni/db';
import { proto } from 'baileys';
import type { WASocket } from 'baileys';
import { type SQL, getTableColumns, getTableName, sql } from 'drizzle-orm';
import { type PgColumn, PgDialect, type PgTable } from 'drizzle-orm/pg-core';
import { Hono } from 'hono';
import { scopeEnforcerMiddleware } from '../middleware/scope-enforcer';
import { setupEventPersistence } from '../plugins/event-persistence';
import { setupMessagePersistence } from '../plugins/message-persistence';
import { openApiSpec } from '../routes/openapi';
import { instancesRoutes } from '../routes/v2/instances';
import { messagesRoutes } from '../routes/v2/messages';
import { SelfHistorySchema, SelfMessagesSchema, SendSelfSchema } from '../schemas/openapi/instances';
import type { Services } from '../services';
import {
  type SelfPlugin,
  boundHistory,
  projectSelfEvent,
  readOwnedChats,
  readOwnedHistory,
  readSelfMessages,
  readSelfReceipt,
  verifySelf,
} from '../services/whatsapp-self';
import type { AppVariables } from '../types';

const ID = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const GEN = '00000000-0000-4000-8000-000000000003';
const OWNER = '5511999998888@s.whatsapp.net';
const identity = {
  ownerIdentifier: OWNER,
  generation: GEN,
  selfJid: OWNER,
  connectedAt: new Date(Date.now() - 60000).toISOString(),
};
const expected = { expectedOwner: OWNER, expectedGeneration: GEN };
const before = new Date().toISOString();
const after = new Date(Date.now() - 60000).toISOString();
function app(scopes = ['instances:read', 'messages:self:read', 'messages:self:send']) {
  const sendSelf = mock(async () => ({ externalId: 'native-id', ownerIdentifier: OWNER, generation: GEN }));
  const plugin = { id: 'whatsapp-baileys', getSelfIdentity: () => identity, sendSelf };
  const hono = new Hono<{ Variables: AppVariables }>();
  hono.use('*', async (c, next) => {
    c.set('apiKey', { instanceIds: [ID], scopes } as AppVariables['apiKey']);
    c.set('services', {
      instances: { getById: async (id: string) => ({ id, channel: 'whatsapp-baileys' }) },
    } as unknown as AppVariables['services']);
    c.set('channelRegistry', { get: () => plugin } as unknown as AppVariables['channelRegistry']);
    await next();
  });
  hono.use('*', scopeEnforcerMiddleware);
  hono.route('/api/v2/instances', instancesRoutes);
  hono.route('/api/v2/messages', messagesRoutes);
  return { hono, sendSelf };
}
const request = (hono: ReturnType<typeof app>['hono'], path: string, body: unknown) =>
  hono.request(`/api/v2${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
describe('closed native self API', () => {
  test('live identity projection and foreign instance denial', async () => {
    const f = app();
    expect(await (await f.hono.request(`/api/v2/instances/${ID}/self`)).json()).toEqual({ data: identity });
    expect((await f.hono.request(`/api/v2/instances/${OTHER}/self`)).status).toBe(403);
  });
  test('send-self rejects arbitrary to and generic messages:send credential', async () => {
    const input = { instanceId: ID, ...expected, operationKey: 'fictional-operation', text: 'Fictional reply' };
    const f = app();
    expect((await request(f.hono, '/messages/send-self', { ...input, to: OWNER })).status).toBe(400);
    expect(f.sendSelf).not.toHaveBeenCalled();
    const generic = app(['messages:send']);
    expect((await request(generic.hono, '/messages/send-self', input)).status).toBe(403);
    expect((await request(f.hono, '/messages/send-self', input)).status).toBe(201);
    expect(f.sendSelf).toHaveBeenCalledTimes(1);
  });
  test('strict bounded producer and history window schemas', () => {
    expect(
      SelfMessagesSchema.safeParse({
        ...expected,
        connectionStartedAt: after,
        after,
        before,
        excludeExternalIds: ['same', 'same'],
      }).success,
    ).toBe(false);
    expect(
      SelfMessagesSchema.safeParse({
        ...expected,
        connectionStartedAt: after,
        after,
        before,
        excludeExternalIds: Array.from({ length: 1001 }, (_, i) => `${i}`),
      }).success,
    ).toBe(false);
    expect(
      SelfHistorySchema.safeParse({
        ...expected,
        after: '2026-01-01T00:00:00Z',
        before: '2026-01-09T00:00:00Z',
        chatId: ID,
      }).success,
    ).toBe(false);
    expect(
      SendSelfSchema.safeParse({ instanceId: ID, ...expected, operationKey: 'operation', text: 'x', chatId: OTHER })
        .success,
    ).toBe(false);
    expect(
      boundHistory([
        { externalId: 'a', text: 'x'.repeat(8000), at: new Date(), isFromMe: true },
        { externalId: 'b', text: 'y', at: new Date(), isFromMe: false },
      ]),
    ).toMatchObject({ partial: true, items: [{ externalId: 'a' }] });
  });
  test('forwarded and quoted self text are evidence, never command authority', () => {
    const row = {
      id: ID,
      externalId: 'external',
      chatId: OWNER,
      eventType: 'message.received',
      contentType: 'text',
      textContent: 'Fictional human',
      receivedAt: new Date(),
      metadata: { from: OWNER.split('@')[0] },
      rawPayload: {
        isFromMe: true,
        key: { fromMe: true, remoteJid: OWNER },
        message: { conversation: 'Fictional human' },
        messageTimestamp: Math.floor(Date.now() / 1000),
      },
    } as unknown as OmniEvent;
    expect(projectSelfEvent(row, OWNER, 'realtime').authority).toBe(true);
    expect(projectSelfEvent(row, OWNER, 'sync').authority).toBe(false);
    expect(projectSelfEvent(row, OWNER).authority).toBe(false);
    expect(projectSelfEvent({ ...row, replyToExternalId: 'quoted' }, OWNER, 'realtime').authority).toBe(false);
    expect(
      projectSelfEvent(
        {
          ...row,
          rawPayload: {
            ...row.rawPayload,
            message: { extendedTextMessage: { text: 'Fictional human', contextInfo: { isForwarded: true } } },
          },
        },
        OWNER,
        'realtime',
      ).authority,
    ).toBe(false);
  });
  test('SQL durable exclusions precede bounded limit and no timestamp-only cursor', async () => {
    let query!: SQL;
    let limit = 0;
    const queries: { sql: SQL; limit: number }[] = [];
    const builder = {
      leftJoin() {
        return this;
      },
      innerJoin() {
        return this;
      },
      from() {
        return this;
      },
      where(value: SQL) {
        query = value;
        return this;
      },
      orderBy() {
        return this;
      },
      async limit(value: number) {
        limit = value;
        queries.push({ sql: query, limit: value });
        return [];
      },
    };
    const db = { select: () => builder } as unknown as Database;
    const plugin = { getSelfIdentity: () => identity } as unknown as SelfPlugin;
    expect(
      await readSelfMessages(db, plugin, ID, {
        ...expected,
        connectionStartedAt: after,
        after,
        before,
        excludeExternalIds: ['outbox-before-http', 'processed-at-same-time'],
      }),
    ).toEqual({ items: [], hasMore: false, hasOlder: false });
    const sql = new PgDialect().sqlToQuery(query);
    expect(sql.sql).toContain('not in');
    expect(sql.params).toContain('outbox-before-http');
    expect(limit).toBe(1);
    expect(queries.map((row) => row.limit)).toEqual([51, 1]);
    const olderQuery = queries[1];
    if (!olderQuery) throw new Error('Missing older-unseen query');
    const older = new PgDialect().sqlToQuery(olderQuery.sql);
    expect(older.sql).toContain('"received_at" <');
    expect(older.params).toContain(OWNER);
    expect(older.params).toContain('realtime');
    const calls = mock(() => identity);
    const changed = { ...plugin, getSelfIdentity: calls } as SelfPlugin;
    calls.mockImplementationOnce(() => identity).mockImplementationOnce(() => ({ ...identity, generation: OTHER }));
    await expect(
      readSelfMessages(db, changed, ID, {
        ...expected,
        connectionStartedAt: after,
        after,
        before,
        excludeExternalIds: [],
      }),
    ).rejects.toThrow();
    expect(() => verifySelf(plugin, ID, { ...expected, expectedOwner: '5511888887777@s.whatsapp.net' })).toThrow();
  });
});

test('rolling inbox proof tolerates transport delay at seven days and blocks stale/nonanchored endpoints', async () => {
  const endpoint = new Date(Date.now() - 1).toISOString();
  const sampledNow = Date.parse(endpoint) + 1;
  const clock = spyOn(Date, 'now').mockReturnValue(sampledNow);
  try {
    const marker = new Date(Date.parse(endpoint) - 8 * 86400000).toISOString();
    const lower = new Date(Date.parse(endpoint) - 7 * 86400000).toISOString();
    let older = false;
    const queries: { sql: SQL; limit: number }[] = [];
    let query!: SQL;
    const builder = {
      from() {
        return this;
      },
      leftJoin() {
        return this;
      },
      innerJoin() {
        return this;
      },
      orderBy() {
        return this;
      },
      where(value: SQL) {
        query = value;
        return this;
      },
      async limit(n: number) {
        queries.push({ sql: query, limit: n });
        return n === 1 && older ? [{ id: ID }] : [];
      },
    };
    const db = { select: () => builder } as unknown as Database;
    const plugin = { getSelfIdentity: () => identity } as unknown as SelfPlugin;
    const input = {
      ...expected,
      connectionStartedAt: marker,
      after: lower,
      before: endpoint,
      excludeExternalIds: ['known'],
    };
    expect(SelfMessagesSchema.safeParse(input).success).toBe(true);
    expect(await readSelfMessages(db, plugin, ID, input)).toEqual({ items: [], hasMore: false, hasOlder: false });
    older = true;
    expect((await readSelfMessages(db, plugin, ID, input)).hasOlder).toBe(true);
    expect(queries.map((row) => row.limit)).toEqual([51, 1, 51, 1]);
    const olderQuery = queries[1];
    if (!olderQuery) throw new Error('Missing older-unseen query');
    const plan = new PgDialect().sqlToQuery(olderQuery.sql);
    expect(plan.sql).toContain('"received_at" <');
    expect(plan.params).toContain('known');
    for (const milliseconds of [-60001, 60001]) {
      const stale = new Date(Date.now() + milliseconds).toISOString();
      await expect(
        readSelfMessages(db, plugin, ID, {
          ...input,
          before: stale,
          after: new Date(Date.parse(stale) - 7 * 86400000).toISOString(),
        }),
      ).rejects.toThrow();
    }
    for (const milliseconds of [-60000, 60000]) {
      const accepted = new Date(sampledNow + milliseconds).toISOString();
      expect(
        (
          await readSelfMessages(db, plugin, ID, {
            ...input,
            before: accepted,
            after: new Date(Date.parse(accepted) - 7 * 86400000).toISOString(),
          })
        ).hasOlder,
      ).toBe(true);
    }
    expect(SelfMessagesSchema.safeParse({ ...input, after: marker }).success).toBe(false);
    expect(SelfMessagesSchema.safeParse({ ...input, connectionStartedAt: endpoint }).success).toBe(false);
    const calls = mock(() => identity);
    calls.mockImplementationOnce(() => identity).mockImplementationOnce(() => ({ ...identity, generation: OTHER }));
    await expect(
      readSelfMessages(db, { ...plugin, getSelfIdentity: calls } as SelfPlugin, ID, input),
    ).rejects.toThrow();
  } finally {
    clock.mockRestore();
  }
});

test('missing or invalid authenticated epoch is rejected by the strict native identity boundary', () => {
  const { connectedAt: _epoch, ...missing } = identity;
  const plugin = { getSelfIdentity: () => missing } as unknown as SelfPlugin;
  expect(() => verifySelf(plugin, ID)).toThrow();
  expect(() =>
    verifySelf(
      { getSelfIdentity: () => ({ ...identity, connectedAt: 'not-authenticated-time' }) } as unknown as SelfPlugin,
      ID,
    ),
  ).toThrow();
});

test('exact self receipt excludes foreign recipients and null does not send or prove absence', async () => {
  let query!: SQL;
  let rows: { externalId: string; text: string; at: Date }[] = [];
  const builder = {
    from() {
      return this;
    },
    innerJoin() {
      return this;
    },
    where(value: SQL) {
      query = value;
      return this;
    },
    async limit(n: number) {
      expect(n).toBe(1);
      return rows;
    },
  };
  const db = { select: () => builder } as unknown as Database;
  const plugin = { getSelfIdentity: () => identity } as unknown as SelfPlugin;
  const input = { ...expected, externalId: 'pre-persisted-native-id' };
  expect(await readSelfReceipt(db, plugin, ID, input)).toBeNull();
  const sql = new PgDialect().sqlToQuery(query);
  expect(sql.params).toContain(ID);
  expect(sql.params).toContain(OWNER);
  expect(sql.params).toContain(input.externalId);
  expect(sql.params).toContain('realtime');
  expect(sql.params).toContain('message.sent');
  rows = [{ externalId: input.externalId, text: 'Fictional confirmed native reply', at: new Date(before) }];
  expect(await readSelfReceipt(db, plugin, ID, input)).toEqual({
    externalId: input.externalId,
    text: 'Fictional confirmed native reply',
    at: before,
    ownerIdentifier: OWNER,
    generation: GEN,
  });
  const f = app();
  expect((await request(f.hono, `/instances/${ID}/self/receipt`, { ...input, chatId: OTHER })).status).toBe(400);
  expect(f.sendSelf).not.toHaveBeenCalled();
});

test('actual Baileys protobuf timestamp survives native JSON serialization without opening other authority', () => {
  const seconds = Math.floor(Date.now() / 1000);
  const raw = JSON.parse(
    JSON.stringify({
      ...proto.WebMessageInfo.fromObject({
        key: { fromMe: true, remoteJid: OWNER, id: 'native-human' },
        message: { conversation: 'Fictional native human' },
        messageTimestamp: seconds,
      }),
      isFromMe: true,
    }),
  );
  expect(raw.messageTimestamp).toEqual({ low: seconds, high: 0, unsigned: true });
  const row = {
    id: ID,
    externalId: 'native-human',
    chatId: OWNER,
    eventType: 'message.received',
    contentType: 'text',
    textContent: 'Fictional native human',
    receivedAt: new Date(),
    metadata: { from: OWNER.split('@')[0] },
    rawPayload: { ...raw, isFromMe: true },
  } as unknown as OmniEvent;
  expect(projectSelfEvent(row, OWNER, 'realtime')).toMatchObject({
    at: new Date(seconds * 1000).toISOString(),
    authority: true,
  });
  for (const timestamp of [
    { low: seconds, high: 0, unsigned: 'true' },
    { low: seconds + 0.5, high: 0, unsigned: true },
    { low: -1, high: -1, unsigned: false },
    { low: 1, high: 2147483647, unsigned: true },
    { low: seconds, high: 0, unsigned: true, other: 'forged' },
    '123',
    Number.NaN,
  ]) {
    expect(
      projectSelfEvent({ ...row, rawPayload: { ...row.rawPayload, messageTimestamp: timestamp } }, OWNER, 'realtime'),
    ).toMatchObject({ at: null, authority: false });
  }
  expect(projectSelfEvent(row, OWNER, 'sync').authority).toBe(false);
  expect(projectSelfEvent({ ...row, replyToExternalId: 'other-person-quote' }, OWNER, 'realtime').authority).toBe(
    false,
  );
  expect(
    projectSelfEvent(
      {
        ...row,
        rawPayload: {
          ...row.rawPayload,
          message: { extendedTextMessage: { text: 'Fictional native human', contextInfo: { isForwarded: true } } },
        },
      },
      OWNER,
      'realtime',
    ).authority,
  ).toBe(false);
});

test('actual native self send and message.sent consumers produce a readable realtime receipt, never a same-ID received row', async () => {
  const handlers = new Map<string, ((event: NativeEvent) => Promise<void>)[]>();
  const bus = {
    async subscribe(type: string, handler: (event: NativeEvent) => Promise<void>) {
      handlers.set(type, [...(handlers.get(type) ?? []), handler]);
    },
    async subscribePattern() {},
  } as unknown as EventBus;
  let unified: Record<string, unknown> | undefined;
  let journal: Record<string, unknown> | undefined;
  let query: SQL | undefined;
  const lookup = {
    from() {
      return this;
    },
    innerJoin() {
      return this;
    },
    where(value: SQL) {
      query = value;
      return this;
    },
    orderBy() {
      return this;
    },
    async limit() {
      if (!unified || !journal || !query) return [];
      const plan = new PgDialect().sqlToQuery(query);
      // Execute this focused repository predicate against rows captured from the real consumers.
      if (
        !plan.sql.includes('omni_events') ||
        !plan.params.includes(unified.source) ||
        !plan.params.includes(journal.eventType) ||
        !plan.params.includes(journal.instanceId) ||
        !plan.params.includes(journal.chatId) ||
        !plan.params.includes(journal.externalId) ||
        !plan.params.includes(journal.status) ||
        !plan.params.includes(journal.direction) ||
        !plan.params.includes(journal.contentType) ||
        unified.isFromMe !== true ||
        unified.textContent !== journal.textContent
      )
        return [];
      return [{ externalId: unified.externalId, text: unified.textContent, at: unified.platformTimestamp }];
    },
  };
  const db = {
    select: () => lookup,
    insert: () => ({
      values(value: Record<string, unknown>) {
        journal = value;
        return { async onConflictDoUpdate() {} };
      },
    }),
  } as unknown as Database;
  const services = {
    db,
    consumerOffsets: {
      async getOffset() {
        return null;
      },
    },
    chats: {
      async findOrCreate() {
        return { chat: { id: OTHER }, created: false };
      },
      async updateLastMessage() {},
    },
    messages: {
      async findOrCreate(chatId: string, externalId: string, input: Record<string, unknown>) {
        unified = { ...input, chatId, externalId };
        return { message: { id: GEN }, created: false };
      },
    },
  } as unknown as Services;
  await setupMessagePersistence(bus, services);
  await setupEventPersistence(bus, db);
  const native = (await import(new URL('../../../channel-whatsapp/src/plugin.ts', import.meta.url).href)) as {
    WhatsAppPlugin: new () => SelfPlugin & { handleConnected(id: string, socket: WASocket): Promise<void> };
  };
  const plugin = new native.WhatsAppPlugin();
  const fields = plugin as unknown as {
    sockets: Map<string, WASocket>;
    instances: { getStatus(id: string): { state: string } };
    waitForRateLimitBackoff(id: string): Promise<{ reset(): void }>;
    emitMessageSent(payload: unknown): Promise<void>;
    emitInstanceConnected(id: string, payload: unknown): Promise<void>;
    prefetchGroupMetadata(id: string, socket: WASocket): Promise<void>;
  };
  const sock = {
    user: { id: OWNER },
    async sendMessage(_jid: string, _content: unknown, options: { messageId: string }) {
      return { key: { id: options.messageId } };
    },
  } as unknown as WASocket;
  fields.sockets.set(ID, sock);
  fields.instances.getStatus = () => ({ state: 'connected' });
  fields.waitForRateLimitBackoff = async () => ({ reset() {} });
  fields.emitInstanceConnected = async () => {};
  fields.prefetchGroupMetadata = async () => {};
  await plugin.handleConnected(ID, sock);
  fields.emitMessageSent = async (payload) => {
    const event = {
      id: GEN,
      type: 'message.sent',
      timestamp: Date.parse(before),
      payload,
      metadata: { instanceId: ID, channelType: 'whatsapp-baileys' },
    } as NativeEvent;
    for (const handler of handlers.get('message.sent') ?? []) await handler(event);
  };
  const current = plugin.getSelfIdentity(ID);
  const sent = await plugin.sendSelf(ID, {
    expectedOwner: OWNER,
    expectedGeneration: current.generation,
    operationKey: 'native-persistence-regression',
    text: 'Fictional native persisted reply',
  });
  expect(unified?.source).toBe('realtime');
  expect(journal?.eventType).toBe('message.sent');
  expect(unified?.isFromMe).toBe(true);
  const input = { expectedOwner: OWNER, expectedGeneration: current.generation, externalId: sent.externalId };
  expect(await readSelfReceipt(db, plugin as SelfPlugin, ID, input)).toMatchObject({
    externalId: sent.externalId,
    text: 'Fictional native persisted reply',
    ownerIdentifier: OWNER,
    generation: current.generation,
  });
  const original = { ...journal };
  for (const alteration of [
    { eventType: 'message.received' },
    { instanceId: OTHER },
    { chatId: '5511888887777@s.whatsapp.net' },
    { status: 'failed' },
    { textContent: 'different observed text' },
  ]) {
    journal = { ...original, ...alteration };
    expect(await readSelfReceipt(db, plugin as SelfPlugin, ID, input)).toBeNull();
  }
  journal = original;
  unified = { ...unified, isFromMe: false };
  expect(await readSelfReceipt(db, plugin as SelfPlugin, ID, input)).toBeNull();
  await expect(readSelfReceipt(db, plugin as SelfPlugin, ID, { ...input, expectedGeneration: GEN })).rejects.toThrow();
});

test('native protobuf timestamps before original authentication or after sampled endpoint never grant ingress authority', async () => {
  const endpoint = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
  const marker = new Date(Date.parse(endpoint) - 60000).toISOString();
  const clock = spyOn(Date, 'now').mockReturnValue(Date.parse(endpoint));
  try {
    const timestamps = [Date.parse(marker) - 1000, Date.parse(endpoint) + 1000, Date.parse(marker) + 5000];
    const rows = timestamps.map((at, index) => ({
      event: {
        id: ID,
        externalId: `authored_${index}`,
        chatId: OWNER,
        eventType: 'message.received',
        contentType: 'text',
        textContent: 'Fictional attributed note',
        receivedAt: new Date(endpoint),
        metadata: { from: OWNER.split('@')[0] },
        rawPayload: JSON.parse(
          JSON.stringify({
            ...proto.WebMessageInfo.fromObject({
              key: { fromMe: true, remoteJid: OWNER },
              message: { conversation: 'Fictional attributed note' },
              messageTimestamp: at / 1000,
            }),
            isFromMe: true,
          }),
        ),
      } as unknown as OmniEvent,
      source: 'realtime',
    }));
    const builder = {
      from() {
        return this;
      },
      leftJoin() {
        return this;
      },
      innerJoin() {
        return this;
      },
      where() {
        return this;
      },
      orderBy() {
        return this;
      },
      async limit(value: number) {
        return value === 51 ? rows : [];
      },
    };
    const plugin = { getSelfIdentity: () => ({ ...identity, connectedAt: marker }) } as unknown as SelfPlugin;
    const page = await readSelfMessages({ select: () => builder } as unknown as Database, plugin, ID, {
      ...expected,
      connectionStartedAt: marker,
      after: marker,
      before: endpoint,
      excludeExternalIds: [],
    });
    expect(page.items.map((row) => row.authority)).toEqual([false, false, true]);
    expect(page.items.map((row) => row.at)).toEqual(timestamps.map((at) => new Date(at).toISOString()));
    expect(page.items.every((row) => row.receivedAt === endpoint)).toBe(true);
  } finally {
    clock.mockRestore();
  }
});

/** Runs the service's real Drizzle joins/predicates against disposable, fictional rows. */
function persistedSelfFixture() {
  const sqlite = new SQLite(':memory:');
  const events = new Map<string, OmniEvent>();
  const dialect = new PgDialect();
  const scalar = (value: unknown) =>
    value instanceof Date ? value.toISOString() : typeof value === 'boolean' ? Number(value) : (value ?? null);
  for (const table of [chats, messages, omniEvents]) {
    const columns = Object.values(getTableColumns(table)).map((column) => `"${column.name}"`);
    sqlite.exec(`create table "${getTableName(table)}" (${columns.join(', ')})`);
  }
  function insert(table: PgTable, row: Record<string, unknown>) {
    const columns = getTableColumns(table);
    const fields = Object.entries(row).filter(([key, value]) => columns[key] && value !== undefined);
    const names = fields.map(([key]) => `"${columns[key]?.name}"`).join(', ');
    const values = fields.map(([, value]) =>
      scalar(value !== null && typeof value === 'object' && !(value instanceof Date) ? JSON.stringify(value) : value),
    );
    sqlite
      .query(`insert into "${getTableName(table)}" (${names}) values (${fields.map(() => '?').join(', ')})`)
      .run(...(values as (string | number | null)[]));
    if (table === omniEvents) events.set(String(row.id), row as unknown as OmniEvent);
  }
  const db = {
    select(selection?: Record<string, PgColumn | PgTable>) {
      let table: PgTable;
      let predicate: SQL;
      let order: SQL[] = [];
      const joins: SQL[] = [];
      return {
        from(value: PgTable) {
          table = value;
          return this;
        },
        innerJoin(value: PgTable, condition: SQL) {
          joins.push(sql`inner join ${value} on ${condition}`);
          return this;
        },
        leftJoin(value: PgTable, condition: SQL) {
          joins.push(sql`left join ${value} on ${condition}`);
          return this;
        },
        where(value: SQL) {
          predicate = value;
          return this;
        },
        orderBy(...value: SQL[]) {
          order = value;
          return this;
        },
        async limit(limit: number) {
          const fields = Object.entries(selection ?? getTableColumns(table));
          const projected = fields.map(
            ([key, value]) => sql`${value === omniEvents ? omniEvents.id : value} as ${sql.identifier(key)}`,
          );
          const query = dialect.sqlToQuery(
            sql`select ${sql.join(projected, sql`, `)} from ${table} ${sql.join(joins, sql` `)} where ${predicate} ${order.length ? sql`order by ${sql.join(order, sql`, `)}` : sql``} limit ${limit}`,
          );
          const rows = sqlite
            .query(query.sql)
            .all(...(query.params.map(scalar) as (string | number | null)[])) as Record<string, unknown>[];
          return rows.map((row) =>
            Object.fromEntries(
              fields.map(([key, column]) => [
                key,
                column === omniEvents
                  ? events.get(String(row[key]))
                  : column instanceof Object && 'dataType' in column && column.dataType === 'date' && row[key]
                    ? new Date(String(row[key]))
                    : row[key],
              ]),
            ),
          );
        },
      };
    },
    insert(table: PgTable) {
      return {
        values(row: Record<string, unknown>) {
          return {
            async onConflictDoUpdate() {
              insert(table, row);
            },
          };
        },
      };
    },
    update() {
      return {
        set() {
          return { async where() {} };
        },
      };
    },
  } as unknown as Database;
  return { db, sqlite, insert };
}

test('actual received consumers join persisted chat/message identity without originalEventId and retain all inbox fences', async () => {
  const fixture = persistedSelfFixture();
  const handlers = new Map<string, ((event: NativeEvent) => Promise<void>)[]>();
  const bus = {
    async subscribe(type: string, handler: (event: NativeEvent) => Promise<void>) {
      handlers.set(type, [...(handlers.get(type) ?? []), handler]);
    },
    async subscribePattern() {},
  } as unknown as EventBus;
  const endpoint = Math.floor(Date.now() / 1000) * 1000;
  const marker = new Date(endpoint - 8 * 86400000).toISOString();
  const lower = new Date(endpoint - 7 * 86400000).toISOString();
  const input = {
    ...expected,
    connectionStartedAt: marker,
    after: lower,
    before: new Date(endpoint).toISOString(),
    excludeExternalIds: [] as string[],
  };
  const plugin = { getSelfIdentity: () => ({ ...identity, connectedAt: input.before }) } as unknown as SelfPlugin;
  const chat = {
    id: OTHER,
    instanceId: ID,
    externalId: OWNER,
    canonicalId: OWNER,
    name: 'Fictional self',
    deletedAt: null,
  };
  let unified: Record<string, unknown> = {};
  fixture.insert(chats, chat);
  const services = {
    db: fixture.db,
    consumerOffsets: {
      async getOffset() {
        return null;
      },
    },
    persons: {
      async findOrCreateIdentity() {
        return { identity: { id: GEN }, person: { id: GEN }, isNew: false };
      },
    },
    instances: { async updateLastMessageAt() {} },
    chats: {
      async findOrCreate() {
        return { chat, created: false };
      },
      async findOrCreateParticipant() {
        return { participant: { displayName: 'Fictional human' } };
      },
      async recordParticipantActivity() {},
      async updateLastMessage() {},
    },
    messages: {
      async findOrCreate(chatId: string, externalId: string, values: Record<string, unknown>) {
        unified = { ...values, id: GEN, chatId, externalId, deletedAt: null };
        fixture.insert(messages, unified);
        return { message: { id: GEN }, created: false };
      },
    },
  } as unknown as Services;
  try {
    await setupMessagePersistence(bus, services);
    await setupEventPersistence(bus, fixture.db);
    const callbacks = handlers.get('message.received') ?? [];
    expect(callbacks).toHaveLength(2);
    const rawPayload = JSON.parse(
      JSON.stringify({
        ...proto.WebMessageInfo.fromObject({
          key: { fromMe: true, remoteJid: OWNER, id: 'actual-human' },
          message: { conversation: 'Fictional phone-authored note' },
          messageTimestamp: endpoint / 1000,
        }),
        isFromMe: true,
      }),
    );
    const nativeEvent = {
      id: ID,
      type: 'message.received',
      timestamp: endpoint,
      payload: {
        chatId: OWNER,
        externalId: 'actual-human',
        from: OWNER.split('@')[0],
        content: { type: 'text', text: 'Fictional phone-authored note' },
        rawPayload,
      },
      metadata: { instanceId: ID, channelType: 'whatsapp-baileys' },
    } as NativeEvent;
    for (const callback of callbacks) await callback(nativeEvent);
    expect(unified).not.toHaveProperty('originalEventId');
    expect(fixture.sqlite.query('select original_event_id from messages').get()).toEqual({ original_event_id: null });
    const inbox = () => readSelfMessages(fixture.db, plugin, ID, input);
    expect(await inbox()).toMatchObject({ items: [{ externalId: 'actual-human', authority: true }], hasOlder: false });
    const reset = () => {
      fixture.sqlite.exec('delete from messages; delete from omni_events; delete from chats');
      fixture.insert(chats, chat);
    };
    const eventRow = {
      id: ID,
      instanceId: ID,
      externalId: 'actual-human',
      chatId: OWNER,
      eventType: 'message.received',
      contentType: 'text',
      textContent: 'Fictional phone-authored note',
      receivedAt: new Date(endpoint),
      metadata: { from: OWNER.split('@')[0] },
      rawPayload,
    };
    for (const [chatChange, messageChange, eventChange] of [
      [{ instanceId: GEN }, {}, {}],
      [{ externalId: 'foreign@s.whatsapp.net' }, {}, {}],
      [{ deletedAt: new Date(endpoint) }, {}, {}],
      [{}, { chatId: GEN }, {}],
      [{}, { externalId: 'different-id' }, {}],
      [{}, { source: 'sync' }, {}],
      [{}, { isFromMe: false }, {}],
      [{}, { deletedAt: new Date(endpoint) }, {}],
      [{}, {}, { instanceId: GEN }],
      [{}, {}, { chatId: 'foreign@s.whatsapp.net' }],
      [{}, {}, { eventType: 'message.sent' }],
      [{}, {}, { contentType: 'image' }],
      [{}, {}, { receivedAt: new Date(endpoint + 1) }],
      [{}, {}, { receivedAt: new Date(Date.parse(marker) - 1) }],
    ]) {
      reset();
      fixture.sqlite.exec('delete from chats');
      fixture.insert(chats, { ...chat, ...chatChange });
      fixture.insert(messages, { ...unified, ...messageChange });
      fixture.insert(omniEvents, { ...eventRow, ...eventChange });
      expect(await inbox()).toEqual({ items: [], hasMore: false, hasOlder: false });
      if (!('receivedAt' in (eventChange ?? {}))) {
        fixture.sqlite
          .query('update omni_events set received_at = ?')
          .run(new Date(Date.parse(lower) - 1).toISOString());
        expect(await inbox()).toEqual({ items: [], hasMore: false, hasOlder: false });
      }
    }
    reset();
    const add = (externalId: string, receivedAt = new Date(endpoint)) => {
      fixture.insert(messages, { ...unified, externalId });
      fixture.insert(omniEvents, { ...eventRow, id: externalId, externalId, receivedAt });
    };
    add('first');
    input.excludeExternalIds = ['first'];
    add('late-equal-time');
    expect((await inbox()).items.map((row) => row.externalId)).toEqual(['late-equal-time']);
    add('older-unseen', new Date(Date.parse(lower) - 1));
    expect((await inbox()).hasOlder).toBe(true);
    input.excludeExternalIds.push('older-unseen');
    expect((await inbox()).hasOlder).toBe(false);
    for (let index = 0; index < 51; index++) add(`bounded-${index}`);
    const bounded = await inbox();
    expect(bounded.items).toHaveLength(50);
    expect(bounded.hasMore).toBe(true);
  } finally {
    fixture.sqlite.close();
  }
});

test('deleted chats are unavailable to selection/history and generated cursor remains a strict UUID query', async () => {
  const fixture = persistedSelfFixture();
  const plugin = { getSelfIdentity: () => identity } as unknown as SelfPlugin;
  try {
    fixture.insert(chats, {
      id: ID,
      instanceId: ID,
      externalId: OWNER,
      name: 'Fictional deleted',
      deletedAt: new Date(),
    });
    fixture.insert(chats, {
      id: OTHER,
      instanceId: ID,
      externalId: 'foreign-chat',
      name: 'Fictional retained',
      deletedAt: null,
    });
    fixture.insert(messages, {
      id: GEN,
      chatId: ID,
      externalId: 'deleted-chat-text',
      textContent: 'Fictional deleted text',
      platformTimestamp: new Date(before),
      isFromMe: true,
      deletedAt: null,
    });
    expect(await readOwnedChats(fixture.db, plugin, ID)).toEqual({
      items: [{ id: OTHER, name: 'Fictional retained' }],
      meta: { hasMore: false, cursor: null },
    });
    expect((await readOwnedChats(fixture.db, plugin, ID, OTHER)).items).toEqual([]);
    await expect(readOwnedHistory(fixture.db, plugin, ID, { ...expected, chatId: ID, after, before })).rejects.toThrow(
      'Selected chat unavailable',
    );
    expect(
      (await readOwnedHistory(fixture.db, plugin, ID, { ...expected, chatId: OTHER, after, before })).items,
    ).toEqual([]);
    const parameters = openApiSpec.paths?.['/instances/{id}/self/chats']?.get?.parameters ?? [];
    expect(parameters).toContainEqual({
      name: 'cursor',
      in: 'query',
      required: false,
      schema: { type: 'string', format: 'uuid' },
    });
  } finally {
    fixture.sqlite.close();
  }
});
