import { describe, expect, mock, test } from 'bun:test';
import type { EventBus, OmniEvent as NativeEvent } from '@omni/core';
import type { Database, OmniEvent } from '@omni/db';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { Hono } from 'hono';
import { proto } from '../../../channel-whatsapp/node_modules/baileys/lib/index.js';
import type { WASocket } from '../../../channel-whatsapp/node_modules/baileys/lib/index.js';
import { scopeEnforcerMiddleware } from '../middleware/scope-enforcer';
import { setupEventPersistence } from '../plugins/event-persistence';
import { setupMessagePersistence } from '../plugins/message-persistence';
import { instancesRoutes } from '../routes/v2/instances';
import { messagesRoutes } from '../routes/v2/messages';
import { SelfHistorySchema, SelfMessagesSchema, SendSelfSchema } from '../schemas/openapi/instances';
import type { Services } from '../services';
import {
  type SelfPlugin,
  boundHistory,
  projectSelfEvent,
  readSelfMessages,
  readSelfReceipt,
  verifySelf,
} from '../services/whatsapp-self';
import type { AppVariables } from '../types';

const ID = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const GEN = '00000000-0000-4000-8000-000000000003';
const OWNER = '5511999998888@s.whatsapp.net';
const identity = { ownerIdentifier: OWNER, generation: GEN, selfJid: OWNER };
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
      SelfMessagesSchema.safeParse({ ...expected, after, before, excludeExternalIds: ['same', 'same'] }).success,
    ).toBe(false);
    expect(
      SelfMessagesSchema.safeParse({
        ...expected,
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
    const builder = {
      leftJoin() {
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
        return [];
      },
    };
    const db = { select: () => builder } as unknown as Database;
    const plugin = { getSelfIdentity: () => identity } as unknown as SelfPlugin;
    expect(
      await readSelfMessages(db, plugin, ID, {
        ...expected,
        after,
        before,
        excludeExternalIds: ['outbox-before-http', 'processed-at-same-time'],
      }),
    ).toEqual({ items: [], hasMore: false });
    const sql = new PgDialect().sqlToQuery(query);
    expect(sql.sql).toContain('not in');
    expect(sql.params).toContain('outbox-before-http');
    expect(limit).toBe(51);
    const calls = mock(() => identity);
    const changed = { ...plugin, getSelfIdentity: calls } as SelfPlugin;
    calls.mockImplementationOnce(() => identity).mockImplementationOnce(() => ({ ...identity, generation: OTHER }));
    await expect(
      readSelfMessages(db, changed, ID, { ...expected, after, before, excludeExternalIds: [] }),
    ).rejects.toThrow();
    expect(() => verifySelf(plugin, ID, { ...expected, expectedOwner: '5511888887777@s.whatsapp.net' })).toThrow();
  });
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
    WhatsAppPlugin: new () => SelfPlugin;
  };
  const plugin = new native.WhatsAppPlugin();
  const fields = plugin as unknown as {
    sockets: Map<string, WASocket>;
    instances: { getStatus(id: string): { state: string } };
    waitForRateLimitBackoff(id: string): Promise<{ reset(): void }>;
    emitMessageSent(payload: unknown): Promise<void>;
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
