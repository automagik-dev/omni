/**
 * Opt-in ingest access journal (0083) — DB-free.
 *
 * With OMNI_JOURNAL_ACCESS_DECISION unset the message.received and
 * reaction.* fills must be exactly as before: no `accessDecision` key in the
 * upsert and no instance/access-rule read. With it 'true', inbound
 * not-from-me rows get 'disabled' | 'allowed' | 'denied' from the pure
 * evaluation, and an evaluation failure leaves the column unset while the
 * fill still lands.
 *
 * The handlers are driven through a captured mock bus and a chainable mock
 * db that answers by table identity — no module mocks (they leak across
 * files in the single-process sweep).
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import type { EventBus } from '@omni/core';
import type { AccessMode, AccessRule, Database } from '@omni/db';
import { accessRules, instances } from '@omni/db';
import { setupEventPersistence } from '../plugins/event-persistence';

const ENV = 'OMNI_JOURNAL_ACCESS_DECISION';
const INSTANCE_ID = '00000000-0000-4000-8000-0000000000aa';

type Handler = (event: unknown) => Promise<void>;

interface World {
  /** accessMode of the instance row, or an Error to make the lookup throw. */
  instance?: AccessMode | Error;
  rules?: AccessRule[];
}

/** A thenable that accepts any builder method and resolves to `rows`. */
function chain(rows: unknown[] | Error): unknown {
  const settle = () => (rows instanceof Error ? Promise.reject(rows) : Promise.resolve(rows));
  const proxy: unknown = new Proxy(() => undefined, {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => settle().then(resolve, reject);
      }
      return () => proxy;
    },
  });
  return proxy;
}

function rule(overrides: Partial<AccessRule>): AccessRule {
  return {
    id: 'rule-1',
    tenantId: null,
    instanceId: INSTANCE_ID,
    ruleType: 'allow',
    phonePattern: null,
    platformUserId: null,
    personId: null,
    priority: 0,
    enabled: true,
    reason: null,
    expiresAt: null,
    action: 'block',
    blockMessage: null,
    metadata: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function setup(world: World) {
  const froms: unknown[] = [];
  const upserts: Record<string, unknown>[] = [];
  const db = {
    select: mock(() => ({
      from: (table: unknown) => {
        froms.push(table);
        if (table === instances) {
          const mode = world.instance;
          if (mode instanceof Error) return chain(mode);
          return chain(mode ? [{ id: INSTANCE_ID, accessMode: mode }] : []);
        }
        if (table === accessRules) return chain(world.rules ?? []);
        return chain([]);
      },
    })),
    insert: mock(() => ({
      values: () => ({
        onConflictDoUpdate: (cfg: { set: Record<string, unknown> }) => {
          upserts.push(cfg.set);
          return Promise.resolve();
        },
        onConflictDoNothing: () => Promise.resolve(),
      }),
    })),
    update: mock(() => chain([])),
  } as unknown as Database;

  const handlers = new Map<string, Handler>();
  const eventBus = {
    subscribe: mock(async (type: string, handler: Handler) => {
      handlers.set(type, handler);
    }),
    subscribePattern: mock(async () => {}),
    publish: mock(async () => {}),
    publishGeneric: mock(async () => {}),
  } as unknown as EventBus;

  const touchedAccess = () => froms.some((t) => t === instances || t === accessRules);
  const readRules = () => froms.includes(accessRules);
  return { db, eventBus, handlers, upserts, touchedAccess, readRules, publish: eventBus.publish };
}

function messageEvent(from: string, rawPayload: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    type: 'message.received',
    timestamp: Date.now(),
    payload: {
      externalId: `ext-${randomUUID()}`,
      chatId: `${from}@s.whatsapp.net`,
      from,
      content: { type: 'text', text: 'hi' },
      rawPayload,
    },
    metadata: { correlationId: randomUUID(), instanceId: INSTANCE_ID, channelType: 'whatsapp' },
  };
}

function reactionEvent(from: string, rawPayload: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    type: 'reaction.received',
    timestamp: Date.now(),
    payload: { messageId: `ext-${randomUUID()}`, chatId: `${from}@s.whatsapp.net`, from, emoji: '👍', rawPayload },
    metadata: { correlationId: randomUUID(), instanceId: INSTANCE_ID, channelType: 'whatsapp' },
  };
}

async function fire(world: World, type: string, event: unknown) {
  const s = setup(world);
  await setupEventPersistence(s.eventBus, s.db);
  const handler = s.handlers.get(type);
  if (!handler) throw new Error(`no handler for ${type}`);
  await handler(event);
  expect(s.upserts).toHaveLength(1); // the fill always lands
  return { ...s, set: s.upserts[0] as Record<string, unknown> };
}

let saved: string | undefined;
beforeEach(() => {
  saved = process.env[ENV];
  delete process.env[ENV];
});
afterEach(() => {
  if (saved === undefined) delete process.env[ENV];
  else process.env[ENV] = saved;
});

describe('access decision journal — env unset (default)', () => {
  test('message.received fill has no accessDecision key and runs no access lookup', async () => {
    const r = await fire({ instance: 'allowlist' }, 'message.received', messageEvent('5511999000001'));
    expect('accessDecision' in r.set).toBe(false);
    expect(r.touchedAccess()).toBe(false);
  });

  test('reaction.received / reaction.removed fills are unchanged too', async () => {
    for (const type of ['reaction.received', 'reaction.removed']) {
      const r = await fire({ instance: 'allowlist' }, type, { ...reactionEvent('5511999000001'), type });
      expect('accessDecision' in r.set).toBe(false);
      expect(r.touchedAccess()).toBe(false);
    }
  });

  test("any value other than 'true' keeps it off", async () => {
    process.env[ENV] = 'false';
    const r = await fire({ instance: 'allowlist' }, 'message.received', messageEvent('5511999000001'));
    expect('accessDecision' in r.set).toBe(false);
    expect(r.touchedAccess()).toBe(false);
  });
});

describe('access decision journal — env on', () => {
  beforeEach(() => {
    process.env[ENV] = 'true';
  });

  test("blocklist with no deny rule journals 'allowed'", async () => {
    const r = await fire({ instance: 'blocklist' }, 'message.received', messageEvent('5511999000001'));
    expect(r.set.accessDecision).toBe('allowed');
  });

  test("allowlist with no matching rule journals 'denied' and publishes nothing", async () => {
    const r = await fire({ instance: 'allowlist' }, 'message.received', messageEvent('5511999000001'));
    expect(r.set.accessDecision).toBe('denied');
    expect(r.publish).not.toHaveBeenCalled();
  });

  test("access mode disabled journals 'disabled' without reading rules", async () => {
    const r = await fire({ instance: 'disabled' }, 'message.received', messageEvent('5511999000001'));
    expect(r.set.accessDecision).toBe('disabled');
    expect(r.readRules()).toBe(false);
  });

  test('the dispatcher fallback chain applies (LID sender allowed via resolvedSenderPhone)', async () => {
    const r = await fire(
      { instance: 'allowlist', rules: [rule({ ruleType: 'allow', platformUserId: '5511999000001' })] },
      'message.received',
      messageEvent('100000001', { resolvedSenderPhone: '5511999000001' }),
    );
    expect(r.set.accessDecision).toBe('allowed');
  });

  test('reactions get a decision too', async () => {
    const r = await fire({ instance: 'allowlist' }, 'reaction.received', reactionEvent('5511999000001'));
    expect(r.set.accessDecision).toBe('denied');
  });

  test('outbound own-device echoes (isFromMe) are left unset with no lookup', async () => {
    const msg = await fire({ instance: 'allowlist' }, 'message.received', messageEvent('me', { isFromMe: true }));
    expect('accessDecision' in msg.set).toBe(false);
    expect(msg.touchedAccess()).toBe(false);
    const reaction = await fire(
      { instance: 'allowlist' },
      'reaction.received',
      reactionEvent('me', { isFromMe: true }),
    );
    expect('accessDecision' in reaction.set).toBe(false);
  });

  test('an evaluation error leaves the column unset and the fill still succeeds', async () => {
    const r = await fire({ instance: new Error('boom') }, 'message.received', messageEvent('5511999000001'));
    expect('accessDecision' in r.set).toBe(false);
    expect(r.set.eventType).toBe('message.received');
  });
});
