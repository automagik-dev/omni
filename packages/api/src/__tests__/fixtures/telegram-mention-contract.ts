/** Real producers/consumer, fake bot transport and journal DB; no services or module mocks. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { type DedupeCache, type PluginContext, createInboundDedupeCache } from '@omni/channel-sdk';
import type { EventBus } from '@omni/core';
import { type Database, chats, omniEvents } from '@omni/db';
import { setupEventPersistence } from '../../plugins/event-persistence';

// URL imports follow whatsapp-self.test.ts: keep cross-package test sources outside API rootDir.
const { TelegramPlugin } = (await import(
  new URL('../../../../channel-telegram/src/plugin.ts', import.meta.url).href
)) as {
  TelegramPlugin: new () => { initialize(context: PluginContext): Promise<void>; destroy(): Promise<void> };
};
const { setupMessageHandlers } = (await import(
  new URL('../../../../channel-telegram/src/handlers/messages.ts', import.meta.url).href
)) as {
  setupMessageHandlers(bot: unknown, plugin: unknown, instanceId: string, cache: DedupeCache): () => void;
};
const { removeChatQueue } = (await import(
  new URL('../../../../channel-telegram/src/middleware/sequentialize.ts', import.meta.url).href
)) as {
  removeChatQueue(instanceId: string): void;
};
const { matches } = (await import(
  new URL('../../../../../apps/omni-channels-dsh/src/host/omni-events.js', import.meta.url).href
)) as {
  matches(sub: unknown, row: unknown): boolean;
};

const INSTANCE_ID = randomUUID();
const CHAT_UUID = randomUUID();
const subscriptions = new Map<string, (event: unknown) => Promise<void>>();
const rows: Record<string, unknown>[] = [];
let journaled: (() => void) | undefined;
const db = {
  select: () => ({
    from(table: unknown) {
      assert.equal(table, chats);
      return { where: () => ({ limit: async () => [{ id: CHAT_UUID, canonicalId: '-100' }] }) };
    },
  }),
  insert(table: unknown) {
    assert.equal(table, omniEvents);
    return {
      values(row: Record<string, unknown>) {
        return {
          async onConflictDoUpdate() {
            // Same JSON boundary as the SSE route; the raw payload is NEVER hand-built here.
            rows.push(JSON.parse(JSON.stringify(row)));
            journaled?.();
          },
        };
      },
    };
  },
} as unknown as Database;
const bus = {
  async subscribe(type: string, handler: (event: unknown) => Promise<void>) {
    subscriptions.set(type, handler);
  },
  async subscribePattern() {},
  async publish(type: string, payload: unknown, metadata: unknown) {
    const handler = subscriptions.get(type);
    assert.ok(handler, `No journal subscription for ${type}`);
    await handler({ id: randomUUID(), type, payload, metadata, timestamp: Date.now() });
  },
} as unknown as EventBus;
await setupEventPersistence(bus, db);

const plugin = new TelegramPlugin();
const noop = () => {};
const logger = { debug: noop, info: noop, warn: noop, error: noop, child: () => logger };
await plugin.initialize({ eventBus: bus, storage: {}, config: {}, db: {}, logger } as unknown as PluginContext);
const callbacks = new Map<string, (ctx: unknown) => unknown | Promise<unknown>>();
const bot = {
  botInfo: { id: 1, username: 'testbot' },
  on(event: string, handler: (ctx: unknown) => unknown | Promise<unknown>) {
    callbacks.set(event, handler);
  },
  // Album fixture declines media download without touching the network or filesystem.
  api: { getFile: async () => ({}) },
};
const cache = createInboundDedupeCache();
const stop = setupMessageHandlers(bot, plugin, INSTANCE_ID, cache);
const receive = callbacks.get('message');
assert.ok(receive);
const sub = { on: true, sources: [{ kind: 'chat', id: CHAT_UUID }], trigger: { kind: 'mention' } };
const messageSub = { ...sub, trigger: { kind: 'message' } };
const mention = { type: 'mention', offset: 3, length: 8 };
const cases = [
  { name: 'structured group bot mention', text: 'hi @testbot', entities: [mention], expected: true },
  {
    name: 'structured supergroup bot mention',
    text: 'hi @testbot',
    entities: [mention],
    expected: true,
    chatType: 'supergroup',
  },
  { name: 'unrelated user mention', text: 'hi @someone', entities: [mention], expected: false },
  { name: 'text without Telegram entities', text: 'hi @testbot', expected: false },
  { name: 'unrelated entity type', text: 'hi @testbot', entities: [{ ...mention, type: 'bold' }], expected: false },
  { name: 'ordinary group message', text: 'hello', expected: false },
  { name: 'direct message without mention', text: 'hello', expected: false, chatType: 'private' },
  { name: 'album without bot mention', expected: false, album: true },
];

try {
  for (const [index, item] of cases.entries()) {
    const before = rows.length;
    const persisted = new Promise<void>((resolve) => {
      journaled = resolve;
    });
    await receive({
      message: {
        message_id: index + 1,
        date: 1_700_000_000,
        chat: { id: -100, type: item.chatType ?? 'group' },
        from: { id: 2, first_name: 'Sender', is_bot: false },
        text: item.text,
        entities: item.entities,
        ...(item.album ? { media_group_id: 'album-1', photo: [{ file_id: 'fake-photo' }], caption: 'photo' } : {}),
      },
    });
    // The handler reserves album work on a queue; wait for the actual insert, never a fixed sleep.
    await persisted;
    journaled = undefined;
    assert.equal(rows.length, before + 1, item.name);
    const row = rows.at(-1);
    assert.ok(row);
    assert.equal(row.channel, 'telegram', item.name);
    assert.equal(row.direction, 'inbound', item.name);
    assert.equal(row.chatUuid, CHAT_UUID, item.name);
    assert.equal(matches(sub, row), item.expected, item.name);
    const raw = row.rawPayload as Record<string, unknown>;
    assert.equal(raw.isMention, item.expected, `${item.name}: legacy flag retained`);
    assert.equal(raw.isMentioningInstance, item.expected, `${item.name}: canonical flag`);
    if (item.album) assert.equal(raw.isAlbum, true);
    if (item.chatType === 'private') {
      assert.equal(raw.isDM, true);
      assert.equal(matches(messageSub, row), true, 'DM message subscription is independent of group mentions');
    }
  }
  const positive = rows[0];
  assert.ok(positive);
  for (const rawPayload of [
    {},
    { isMention: true },
    { isMentioningInstance: 'true' },
    { isMentioningInstance: false },
  ]) {
    assert.equal(matches(sub, { ...positive, rawPayload }), false, 'matcher still requires strict canonical true');
  }
  assert.equal(matches(sub, { ...positive, direction: 'outbound' }), false);
  assert.equal(matches(sub, { ...positive, chatUuid: randomUUID() }), false);
  assert.equal(matches({ ...sub, on: false }, positive), false);
  process.stdout.write('Telegram producer → journal → DSH: 8 cases passed\n');
} finally {
  stop();
  cache.dispose();
  removeChatQueue(INSTANCE_ID);
  await plugin.destroy();
}
