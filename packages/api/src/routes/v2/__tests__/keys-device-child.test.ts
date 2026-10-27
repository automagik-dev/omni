/**
 * Chat keys: children of a key, each locked to one chat (wish: omni-chat-threads).
 *
 * Group 1 (service): `ApiKeyService.mintChild`, `revokeChild`, `revokeSelf`, and
 * the parent's revoke, delete and PATCH reaching its children in the same
 * transaction, with the `access.key_*` events. The parent changes are driven
 * through the REAL `/keys` routes and each child is checked through the REAL
 * auth middleware on `POST /auth/validate`.
 *
 * The database is an in-memory fake of the Drizzle surface `ApiKeyService`
 * uses, which evaluates the service's own `where` conditions (eq, and, or,
 * is null, comparisons, in) against its rows and applies the FK cascade, so the
 * service's queries, not hand-picked answers, decide each result. Locking and
 * concurrency are database behaviour: `api-key-children-postgres.test.ts`
 * proves those on a disposable PostgreSQL.
 */

import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { CORE_EVENT_TYPES, type EventBus, STREAM_NAMES, getStreamForEventType } from '@omni/core';
import { type ApiKey, type Database, type NewApiKey, apiKeys } from '@omni/db';
import { Column, Param, SQL, StringChunk, getTableColumns, is } from 'drizzle-orm';
import { Hono } from 'hono';
import { DEFAULT_DEVICE_KEY_SCOPES } from '../../../login/config';
import { authMiddleware } from '../../../middleware/auth';
import type { Services } from '../../../services';
import {
  ApiKeyService,
  CS_CHILD_SCOPES,
  type ChildChat,
  MAX_LIVE_CHILDREN,
  type MintChildResult,
} from '../../../services/api-keys';
import type { ApiKeyData, AppVariables } from '../../../types';
import { authRoutes } from '../auth';
import { keysRoutes } from '../keys';

// ============================================================================
// In-memory api_keys table
// ============================================================================

type Row = ApiKey;
type Condition = SQL | undefined;

const COLUMN_KEYS = new Map<unknown, keyof Row>(
  Object.entries(getTableColumns(apiKeys)).map(([key, column]) => [column, key as keyof Row]),
);

function chunkText(chunk: unknown): string {
  return is(chunk, StringChunk) ? chunk.value.join('') : '';
}

function operand(value: unknown, row: Row): unknown {
  if (is(value, Column)) {
    const key = COLUMN_KEYS.get(value);
    if (!key) throw new Error(`fake db: unknown column ${value.name}`);
    return row[key];
  }
  if (is(value, Param)) return value.value;
  return value;
}

function comparable(value: unknown): unknown {
  return value instanceof Date ? value.getTime() : value;
}

function compare(op: string, left: unknown, right: unknown): boolean {
  const l = comparable(left);
  const r = comparable(right);
  switch (op) {
    case '=':
      return l === r;
    case '<>':
      return l !== r;
    case '>':
      return (l as number) > (r as number);
    case '>=':
      return (l as number) >= (r as number);
    case '<':
      return (l as number) < (r as number);
    case '<=':
      return (l as number) <= (r as number);
    default:
      throw new Error(`fake db: unsupported operator ${op}`);
  }
}

/** Evaluate the conditions drizzle's `eq`/`and`/`or`/`isNull`/`gt`/`inArray` build. */
function matches(condition: Condition, row: Row): boolean {
  if (!condition) return true;
  const parts = condition.queryChunks.filter((chunk) => !(is(chunk, StringChunk) && chunkText(chunk).trim() === ''));
  const [first, second, third] = parts;
  if (parts.length === 1 && is(first, SQL)) return matches(first, row);
  if (parts.length === 3 && chunkText(first).trim() === '(' && is(second, SQL)) {
    const joined = second.queryChunks;
    const op = chunkText(joined.find((chunk) => is(chunk, StringChunk))).trim();
    const terms = joined.filter((chunk): chunk is SQL => is(chunk, SQL));
    return op === 'or' ? terms.some((term) => matches(term, row)) : terms.every((term) => matches(term, row));
  }
  const op = chunkText(second).trim();
  if (parts.length === 2 && op === 'is null') return operand(first, row) == null;
  if (parts.length === 2 && op === 'is not null') return operand(first, row) != null;
  if (parts.length === 3 && op === 'in' && Array.isArray(third)) {
    const value = operand(first, row);
    return third.some((candidate) => operand(candidate, row) === value);
  }
  if (parts.length === 3) return compare(op, operand(first, row), operand(third, row));
  throw new Error('fake db: unsupported condition');
}

function definedEntries(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && !is(value, SQL)));
}

function newRow(values: NewApiKey): Row {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    name: values.name,
    keyPrefix: values.keyPrefix,
    keyHash: values.keyHash,
    scopes: values.scopes as string[],
    description: null,
    profile: null,
    profileOverrides: {},
    chatAllowlist: [],
    instanceAllowlist: [],
    outboundRecipientAllowlist: [],
    instanceIds: null,
    parentKeyId: null,
    status: 'active',
    rateLimit: null,
    expiresAt: null,
    lastUsedAt: null,
    lastUsedIp: null,
    usageCount: 0,
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
    activeInstanceId: null,
    contextInstanceId: null,
    contextChatId: null,
    contextMessageId: null,
    contextUpdatedAt: null,
    createdAt: now,
    createdBy: null,
    updatedAt: now,
    ...definedEntries(values as Record<string, unknown>),
  } as Row;
}

/** A thenable query: drizzle builders are awaited directly or after `.returning()`. */
function query<T>(run: () => T, extra: Record<string, unknown> = {}) {
  const chain = {
    ...extra,
    // biome-ignore lint/suspicious/noThenProperty: drizzle query builders ARE thenables; the fake mirrors that surface
    then: <R1, R2>(resolve?: (value: T) => R1, reject?: (reason: unknown) => R2) =>
      Promise.resolve().then(run).then(resolve, reject),
    catch: (reject: (reason: unknown) => unknown) => Promise.resolve().then(run).catch(reject),
  };
  return chain;
}

function fakeKeyDb(): { db: Database; rows: Row[] } {
  let rows: Row[] = [];
  const project = (row: Row, fields?: Record<string, unknown>) =>
    fields
      ? Object.fromEntries(Object.entries(fields).map(([name, column]) => [name, operand(column, row)]))
      : { ...row };

  const db = {
    select(fields?: Record<string, unknown>) {
      let condition: Condition;
      let limit = Number.POSITIVE_INFINITY;
      const run = () =>
        rows
          .filter((row) => matches(condition, row))
          .slice(0, limit)
          .map((row) => project(row, fields));
      const chain = query(run, {
        from: () => chain,
        where: (next: Condition) => {
          condition = next;
          return chain;
        },
        limit: (n: number) => {
          limit = n;
          return chain;
        },
        orderBy: () => chain,
        for: () => chain,
      });
      return chain;
    },
    insert() {
      return {
        values(values: NewApiKey) {
          const run = () => {
            const row = newRow(values);
            rows.push(row);
            return [{ ...row }];
          };
          return query(run, { returning: () => query(run) });
        },
      };
    },
    update() {
      return {
        set(values: Record<string, unknown>) {
          return {
            where(condition: Condition) {
              const run = () => {
                const changed: Row[] = [];
                rows = rows.map((row) => {
                  if (!matches(condition, row)) return row;
                  const next = { ...row, ...definedEntries(values) } as Row;
                  changed.push({ ...next });
                  return next;
                });
                return changed;
              };
              return query(run, { returning: () => query(run) });
            },
          };
        },
      };
    },
    delete() {
      return {
        where(condition: Condition) {
          const run = () => {
            const removed = rows.filter((row) => matches(condition, row));
            // ON DELETE CASCADE on api_keys.parent_key_id.
            const gone = new Set(removed.map((row) => row.id));
            let grew = true;
            while (grew) {
              grew = false;
              for (const row of rows) {
                if (row.parentKeyId && gone.has(row.parentKeyId) && !gone.has(row.id)) {
                  gone.add(row.id);
                  grew = true;
                }
              }
            }
            rows = rows.filter((row) => !gone.has(row.id));
            return removed.map((row) => ({ ...row }));
          };
          return query(run, { returning: () => query(run) });
        },
      };
    },
    async transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      const before = rows.map((row) => ({ ...row }));
      try {
        return await fn(db);
      } catch (error) {
        rows = before;
        throw error;
      }
    },
  };
  return {
    db: db as unknown as Database,
    get rows() {
      return rows;
    },
  };
}

// ============================================================================
// Harness
// ============================================================================

const INSTANCE = '11111111-1111-4111-8111-111111111111';
const OTHER_INSTANCE = '22222222-2222-4222-8222-222222222222';
/** The DSH plugin's own device key (`apps/omni-channels-dsh/src/host/omni-discover.js`). */
const DEVICE_SCOPES = ['instances:*', 'chats:*', 'messages:*', 'media:*', 'events:*', 'system:read', 'system:update'];
const ADMIN: ApiKeyData = {
  id: '99999999-9999-4999-8999-999999999999',
  name: 'operator',
  scopes: ['*'],
  instanceIds: null,
  expiresAt: null,
  profile: null,
  chatAllowlist: [],
  instanceAllowlist: [],
  outboundRecipientAllowlist: [],
  profileOverrides: null,
};

interface Published {
  type: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
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

function harness() {
  const store = fakeKeyDb();
  const events: Published[] = [];
  const eventBus = {
    publish: async (type: string, payload: Record<string, unknown>, metadata?: Record<string, unknown>) => {
      events.push({ type, payload, metadata });
      return { id: crypto.randomUUID(), stream: getStreamForEventType(type), sequence: events.length };
    },
  } as unknown as EventBus;
  const service = new ApiKeyService(store.db, { eventBus });

  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('services', { apiKeys: service } as unknown as Services);
    await next();
  });
  app.use('/auth/*', authMiddleware);
  app.route('/auth', authRoutes);
  // The operator's own request, past auth and the scope enforcer (keys:write on '*').
  app.use('/keys/*', async (c, next) => {
    c.set('apiKey', ADMIN);
    await next();
  });
  app.route('/keys', keysRoutes);

  const call = (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const validates = async (plainTextKey: string) =>
    (await app.request('/auth/validate', { method: 'POST', headers: { 'x-api-key': plainTextKey } })).status;
  const parent = async (scopes: string[] = [...DEFAULT_DEVICE_KEY_SCOPES], extra: Partial<NewApiKey> = {}) =>
    service.create({ name: 'sign-in', scopes, ...(extra as object) });
  const row = (id: string) => store.rows.find((candidate) => candidate.id === id);
  const ofType = (type: string) => events.filter((event) => event.type === type);

  return { store, service, events, call, validates, parent, row, ofType };
}

afterEach(() => {
  setSystemTime();
});

// ============================================================================
// Events
// ============================================================================

describe('chat key events', () => {
  test('are core event types routed to the ACCESS stream, not CUSTOM', () => {
    for (const type of ['access.key_minted', 'access.key_revoked', 'access.key_updated']) {
      expect(CORE_EVENT_TYPES as readonly string[]).toContain(type);
      expect(getStreamForEventType(type)).toBe(STREAM_NAMES.ACCESS);
    }
  });
});

// ============================================================================
// mintChild
// ============================================================================

describe('mintChild', () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness();
  });

  test("a sign-in key's child is a cs key locked to one chat, with all four scopes and the parent's expiry", async () => {
    const expiresAt = new Date(Date.now() + 86_400_000);
    const { key: parent } = await h.parent(undefined, { expiresAt });
    const target = chat(1);
    const result = minted(await h.service.mintChild(parent.id, target));

    expect(result.child).toMatchObject({
      profile: 'cs',
      parentKeyId: parent.id,
      chatAllowlist: [target.id, target.externalId],
      outboundRecipientAllowlist: [target.externalId],
      instanceAllowlist: [INSTANCE],
      instanceIds: [INSTANCE],
      status: 'active',
    });
    expect([...result.child.scopes].sort()).toEqual([...CS_CHILD_SCOPES].sort());
    expect(result.child.expiresAt?.getTime()).toBe(expiresAt.getTime());
    expect(result.replacedKeyId).toBeNull();
    expect(await h.validates(result.plainTextKey)).toBe(200);

    expect(h.ofType('access.key_minted')).toEqual([
      {
        type: 'access.key_minted',
        payload: {
          keyId: result.child.id,
          parentKeyId: parent.id,
          chatId: target.id,
          chatExternalId: target.externalId,
          instanceId: INSTANCE,
          scopes: result.child.scopes,
          expiresAt: expiresAt.getTime(),
          replacedKeyId: null,
        },
        metadata: { instanceId: INSTANCE },
      },
    ]);
    // No event carries key text.
    expect(JSON.stringify(h.events)).not.toContain(result.plainTextKey);
  });

  test("a DEVICE_SCOPES key's child has exactly messages:send and chats:read", async () => {
    const { key: parent } = await h.parent(DEVICE_SCOPES);
    const result = minted(await h.service.mintChild(parent.id, chat(1)));
    expect([...result.child.scopes].sort()).toEqual(['chats:read', 'messages:send']);
    expect(result.child.expiresAt).toBeNull();
  });

  test('a parent limited by instanceIds mints only on its own instances, read from its locked row', async () => {
    const { key: other } = await h.parent(undefined, { instanceIds: [OTHER_INSTANCE] });
    expect(await h.service.mintChild(other.id, chat(1, INSTANCE))).toMatchObject({ ok: false, code: 'not_mintable' });
    minted(await h.service.mintChild(other.id, chat(2, OTHER_INSTANCE)));

    const { key: none } = await h.parent(undefined, { instanceIds: [] });
    expect(await h.service.mintChild(none.id, chat(3, INSTANCE))).toMatchObject({ ok: false, code: 'not_mintable' });

    // Narrowed after the caller's view of it was taken: the row decides.
    const { key: narrowed } = await h.parent();
    await h.service.update(narrowed.id, { instanceIds: [OTHER_INSTANCE] });
    expect(await h.service.mintChild(narrowed.id, chat(4, INSTANCE))).toMatchObject({
      ok: false,
      code: 'not_mintable',
    });
    expect(h.store.rows.filter((row) => row.parentKeyId !== null).map((row) => row.instanceIds)).toEqual([
      [OTHER_INSTANCE],
    ]);
  });

  test('a parent without messages:send or chats:read gets missing_scope', async () => {
    const { key: parent } = await h.parent(['chats:read', 'context:write']);
    const result = await h.service.mintChild(parent.id, chat(1));
    expect(result).toMatchObject({ ok: false, code: 'missing_scope' });
    expect(h.store.rows).toHaveLength(1);
  });

  test('a child, a locked, a revoked, an expired or an unknown parent gets not_mintable', async () => {
    const { key: root } = await h.parent();
    const child = minted(await h.service.mintChild(root.id, chat(1))).child;
    const { key: chatLocked } = await h.parent(undefined, { chatAllowlist: [chat(9).id] });
    const { key: instanceLocked } = await h.parent(undefined, { instanceAllowlist: [INSTANCE] });
    const { key: recipientLocked } = await h.parent(undefined, { outboundRecipientAllowlist: [chat(9).externalId] });
    const { key: revoked } = await h.parent();
    await h.service.revoke(revoked.id, 'gone');
    const { key: expired } = await h.parent(undefined, { expiresAt: new Date(Date.now() - 1_000) });

    for (const id of [
      child.id,
      chatLocked.id,
      instanceLocked.id,
      recipientLocked.id,
      revoked.id,
      expired.id,
      crypto.randomUUID(),
      'not-a-uuid',
    ]) {
      expect(await h.service.mintChild(id, chat(2))).toMatchObject({ ok: false, code: 'not_mintable' });
    }
    expect(h.store.rows.filter((row) => row.parentKeyId !== null)).toHaveLength(1);
  });

  test('a chat with a non-uuid id or instance, or an empty or oversized externalId, gets not_mintable', async () => {
    const { key: parent } = await h.parent();
    for (const bad of [
      { ...chat(1), id: 'not-a-uuid' },
      { ...chat(1), instanceId: 'not-a-uuid' },
      { ...chat(1), externalId: '' },
      { ...chat(1), externalId: 'x'.repeat(257) },
    ]) {
      expect(await h.service.mintChild(parent.id, bad)).toMatchObject({ ok: false, code: 'not_mintable' });
    }
    expect(h.store.rows).toHaveLength(1);
    minted(await h.service.mintChild(parent.id, { ...chat(1), externalId: 'x'.repeat(256) }));
  });

  test('a second mint for the same chat revokes the first and leaves one live child', async () => {
    const { key: parent } = await h.parent();
    const first = minted(await h.service.mintChild(parent.id, chat(1)));
    expect(await h.validates(first.plainTextKey)).toBe(200);
    const second = minted(await h.service.mintChild(parent.id, chat(1)));

    expect(second.replacedKeyId).toBe(first.child.id);
    expect(await h.validates(first.plainTextKey)).toBe(401);
    expect(await h.validates(second.plainTextKey)).toBe(200);
    const live = h.store.rows.filter((row) => row.parentKeyId === parent.id && row.status === 'active');
    expect(live.map((row) => row.id)).toEqual([second.child.id]);
    expect(h.ofType('access.key_revoked').map((event) => event.payload)).toEqual([
      {
        keyId: first.child.id,
        parentKeyId: parent.id,
        chatId: chat(1).id,
        instanceId: INSTANCE,
        reason: 'remint',
        revokedBy: null,
      },
    ]);
    expect(h.ofType('access.key_minted').at(-1)?.payload.replacedKeyId).toBe(first.child.id);
    expect(h.events.map((event) => event.type).slice(-2)).toEqual(['access.key_revoked', 'access.key_minted']);
  });

  test(`a parent with ${MAX_LIVE_CHILDREN} live children gets child_limit; a re-mint and an expired child do not count`, async () => {
    const { key: parent } = await h.parent();
    for (let n = 1; n <= MAX_LIVE_CHILDREN; n++) {
      const target = chat(n);
      h.store.rows.push({
        ...(h.row(parent.id) as Row),
        id: crypto.randomUUID(),
        keyHash: `hash-${n}`,
        parentKeyId: parent.id,
        chatAllowlist: [target.id, target.externalId],
        scopes: ['messages:send', 'chats:read'],
      });
    }

    expect(await h.service.mintChild(parent.id, chat(MAX_LIVE_CHILDREN + 1))).toMatchObject({
      ok: false,
      code: 'child_limit',
    });
    // Replacing an existing chat's key keeps the count where it is.
    minted(await h.service.mintChild(parent.id, chat(7)));

    const expiredChild = h.store.rows.find((row) => row.chatAllowlist.includes(chat(8).id));
    if (expiredChild) expiredChild.expiresAt = new Date(Date.now() - 1_000);
    minted(await h.service.mintChild(parent.id, chat(MAX_LIVE_CHILDREN + 1)));
  });
});

// ============================================================================
// revokeChild / revokeSelf
// ============================================================================

describe('revokeChild and revokeSelf', () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness();
  });

  test('a parent revokes its own child once; a child of another key is not its own', async () => {
    const { key: parent } = await h.parent();
    const { key: other } = await h.parent();
    const own = minted(await h.service.mintChild(parent.id, chat(1)));
    const foreign = minted(await h.service.mintChild(other.id, chat(2)));

    expect(await h.service.revokeChild(parent.id, foreign.child.id, 'sign-in')).toEqual({ status: 'not_own_child' });
    expect(await h.service.revokeChild(parent.id, other.id, 'sign-in')).toEqual({ status: 'not_own_child' });
    expect(await h.service.revokeChild(parent.id, crypto.randomUUID(), 'sign-in')).toEqual({ status: 'not_found' });
    expect(await h.service.revokeChild(parent.id, 'self', 'sign-in')).toEqual({ status: 'not_found' });
    expect(await h.validates(foreign.plainTextKey)).toBe(200);

    expect(await h.service.revokeChild(parent.id, own.child.id, 'sign-in')).toEqual({ status: 'revoked' });
    expect(await h.validates(own.plainTextKey)).toBe(401);
    expect(await h.service.revokeChild(parent.id, own.child.id, 'sign-in')).toEqual({ status: 'already_revoked' });
    expect(h.ofType('access.key_revoked').map((event) => event.payload)).toEqual([
      {
        keyId: own.child.id,
        parentKeyId: parent.id,
        chatId: chat(1).id,
        instanceId: INSTANCE,
        reason: 'own_child',
        revokedBy: 'sign-in',
      },
    ]);
  });

  test('ownership is parent_key_id, never createdBy', async () => {
    const { key: parent } = await h.parent();
    const { key: impostor } = await h.parent();
    const own = minted(await h.service.mintChild(parent.id, chat(1)));
    const childRow = h.row(own.child.id) as Row;
    childRow.createdBy = impostor.name;
    expect(await h.service.revokeChild(impostor.id, own.child.id, impostor.name)).toEqual({ status: 'not_own_child' });
  });

  test('a child revokes itself; a key with no parent is not a child', async () => {
    const { key: parent } = await h.parent();
    const own = minted(await h.service.mintChild(parent.id, chat(1)));
    const validated = await h.service.validate(own.plainTextKey);
    const validatedParent = await h.service.validate((await h.parent()).plainTextKey);
    if (!validated || !validatedParent) throw new Error('keys did not validate');

    expect(await h.service.revokeSelf(validatedParent)).toEqual({ status: 'not_a_child' });
    expect(await h.service.revokeSelf(validated)).toEqual({ status: 'revoked' });
    expect(await h.validates(own.plainTextKey)).toBe(401);
    expect(await h.service.revokeSelf(validated)).toEqual({ status: 'already_revoked' });
    expect(h.ofType('access.key_revoked').map((event) => event.payload.reason)).toEqual(['self']);
  });
});

// ============================================================================
// A parent change reaches its children
// ============================================================================

describe("a parent's revoke, delete and PATCH reach its children", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness();
  });

  async function family(expiresAt: Date | null = null) {
    const { key: parent, plainTextKey } = await h.parent(undefined, expiresAt ? { expiresAt } : {});
    const a = minted(await h.service.mintChild(parent.id, chat(1)));
    const b = minted(await h.service.mintChild(parent.id, chat(2, OTHER_INSTANCE)));
    for (const child of [a, b]) expect(await h.validates(child.plainTextKey)).toBe(200);
    h.events.length = 0;
    return { parent, plainTextKey, a, b };
  }

  test('POST /keys/:id/revoke revokes every child: 401 on /auth/validate and an event each', async () => {
    const { parent, a, b } = await family();
    const response = await h.call('POST', `/keys/${parent.id}/revoke`, { reason: 'lost laptop' });
    expect(response.status).toBe(200);

    expect(await h.validates(a.plainTextKey)).toBe(401);
    expect(await h.validates(b.plainTextKey)).toBe(401);
    const revoked = h.ofType('access.key_revoked').map((event) => event.payload);
    expect(revoked).toHaveLength(2);
    expect(revoked).toContainEqual({
      keyId: a.child.id,
      parentKeyId: parent.id,
      chatId: chat(1).id,
      instanceId: INSTANCE,
      reason: 'parent_revoked',
      revokedBy: ADMIN.name,
    });
    expect(revoked.find((payload) => payload.keyId === b.child.id)).toMatchObject({
      instanceId: OTHER_INSTANCE,
      reason: 'parent_revoked',
    });
  });

  test('DELETE /keys/:id revokes the children first, then the cascade removes their rows', async () => {
    const { parent, a, b } = await family();
    const response = await h.call('DELETE', `/keys/${parent.id}`);
    expect(response.status).toBe(200);

    expect(await h.validates(a.plainTextKey)).toBe(401);
    expect(await h.validates(b.plainTextKey)).toBe(401);
    expect(h.ofType('access.key_revoked').map((event) => [event.payload.keyId, event.payload.reason])).toEqual(
      expect.arrayContaining([
        [a.child.id, 'parent_deleted'],
        [b.child.id, 'parent_deleted'],
      ]),
    );
    expect(h.ofType('access.key_revoked')).toHaveLength(2);
    expect(h.store.rows.map((row) => row.id)).not.toContain(a.child.id);
    // An own-child revoke of a removed child finds nothing.
    expect(await h.service.revokeChild(parent.id, a.child.id, 'sign-in')).toEqual({ status: 'not_found' });
  });

  test('a PATCH that shortens the expiry clamps every child, with access.key_updated', async () => {
    const { parent, a, b } = await family(new Date(Date.now() + 7 * 86_400_000));
    const shorter = new Date(Date.now() + 86_400_000);
    const response = await h.call('PATCH', `/keys/${parent.id}`, { expiresAt: shorter.toISOString() });
    expect(response.status).toBe(200);

    for (const child of [a, b]) expect(h.row(child.child.id)?.expiresAt?.getTime()).toBe(shorter.getTime());
    expect(h.ofType('access.key_updated').map((event) => event.payload)).toEqual(
      expect.arrayContaining([
        {
          keyId: a.child.id,
          parentKeyId: parent.id,
          chatId: chat(1).id,
          instanceId: INSTANCE,
          expiresAt: shorter.getTime(),
        },
        {
          keyId: b.child.id,
          parentKeyId: parent.id,
          chatId: chat(2).id,
          instanceId: OTHER_INSTANCE,
          expiresAt: shorter.getTime(),
        },
      ]),
    );
    expect(h.ofType('access.key_revoked')).toHaveLength(0);
  });

  test('a PATCH that sets an expiry on a never-expiring parent clamps the children too', async () => {
    const { parent, a } = await family(null);
    const set = new Date(Date.now() + 3_600_000);
    expect((await h.call('PATCH', `/keys/${parent.id}`, { expiresAt: set.toISOString() })).status).toBe(200);
    expect(h.row(a.child.id)?.expiresAt?.getTime()).toBe(set.getTime());
    expect(h.ofType('access.key_updated')).toHaveLength(2);
  });

  test('a PATCH that lengthens or removes the expiry changes no child', async () => {
    const original = new Date(Date.now() + 86_400_000);
    const { parent, a, b } = await family(original);
    const before = h.store.rows.filter((row) => row.parentKeyId === parent.id).map((row) => ({ ...row }));

    const longer = new Date(Date.now() + 30 * 86_400_000);
    expect((await h.call('PATCH', `/keys/${parent.id}`, { expiresAt: longer.toISOString() })).status).toBe(200);
    expect((await h.call('PATCH', `/keys/${parent.id}`, { expiresAt: null })).status).toBe(200);

    expect(h.store.rows.filter((row) => row.parentKeyId === parent.id)).toEqual(before);
    expect(h.events).toHaveLength(0);
    for (const child of [a, b]) expect(await h.validates(child.plainTextKey)).toBe(200);
  });

  test('a PATCH that drops messages:send revokes the children', async () => {
    const { parent, a, b } = await family();
    const narrowed = DEFAULT_DEVICE_KEY_SCOPES.filter((scope) => scope !== 'messages:*');
    expect((await h.call('PATCH', `/keys/${parent.id}`, { scopes: narrowed })).status).toBe(200);

    expect(await h.validates(a.plainTextKey)).toBe(401);
    expect(await h.validates(b.plainTextKey)).toBe(401);
    expect(h.ofType('access.key_revoked').map((event) => event.payload.reason)).toEqual([
      'parent_narrowed',
      'parent_narrowed',
    ]);
  });

  test("an instanceIds change revokes only the children on instances the parent lost (the instances route's update)", async () => {
    const { parent, a, b } = await family();
    await h.service.update(parent.id, { instanceIds: [INSTANCE] });

    expect(await h.validates(a.plainTextKey)).toBe(200);
    expect(await h.validates(b.plainTextKey)).toBe(401);
    expect(h.ofType('access.key_revoked').map((event) => [event.payload.keyId, event.payload.reason])).toEqual([
      [b.child.id, 'parent_narrowed'],
    ]);
  });

  test('a context-only update touches no child', async () => {
    const { parent } = await family(new Date(Date.now() + 86_400_000));
    const before = h.store.rows.filter((row) => row.parentKeyId === parent.id).map((row) => ({ ...row }));
    await h.service.update(parent.id, { contextInstanceId: INSTANCE });
    expect(h.store.rows.filter((row) => row.parentKeyId === parent.id)).toEqual(before);
    expect(h.events).toHaveLength(0);
  });

  test("a child is refused once its parent's expiry passes", async () => {
    const start = new Date('2026-03-01T12:00:00.000Z');
    setSystemTime(start);
    const { a, plainTextKey } = await family(new Date(start.getTime() + 3_600_000));

    setSystemTime(new Date(start.getTime() + 3_600_001));
    expect(await h.validates(plainTextKey)).toBe(401);
    expect(await h.validates(a.plainTextKey)).toBe(401);
  });
});

// ============================================================================
// A child is never widened past its parent
// ============================================================================

describe('PATCH /keys/:childId stays inside the parent', () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness();
  });

  async function child(scopes: string[] = [...DEFAULT_DEVICE_KEY_SCOPES]) {
    const expiresAt = new Date(Date.now() + 7 * 86_400_000);
    const { key: parent } = await h.parent(scopes, { expiresAt, instanceIds: [INSTANCE] });
    const result = minted(await h.service.mintChild(parent.id, chat(1)));
    return { parent, expiresAt, child: result.child };
  }

  test('a longer, removed or later expiry is refused with 403; an earlier one is allowed', async () => {
    const { expiresAt, child: row } = await child();
    const later = new Date(expiresAt.getTime() + 86_400_000).toISOString();
    for (const body of [{ expiresAt: null }, { expiresAt: later }]) {
      expect((await h.call('PATCH', `/keys/${row.id}`, body)).status).toBe(403);
    }
    expect(h.row(row.id)?.expiresAt?.getTime()).toBe(expiresAt.getTime());

    const earlier = new Date(expiresAt.getTime() - 86_400_000);
    expect((await h.call('PATCH', `/keys/${row.id}`, { expiresAt: earlier.toISOString() })).status).toBe(200);
    expect(h.row(row.id)?.expiresAt?.getTime()).toBe(earlier.getTime());
  });

  test('a scope the parent lacks is refused; a narrower set is allowed', async () => {
    const { child: row } = await child(DEVICE_SCOPES);
    const wider = ['messages:send', 'chats:read', 'context:write'];
    expect((await h.call('PATCH', `/keys/${row.id}`, { scopes: wider })).status).toBe(403);
    expect([...(h.row(row.id)?.scopes ?? [])].sort()).toEqual(['chats:read', 'messages:send']);
    expect((await h.call('PATCH', `/keys/${row.id}`, { scopes: ['chats:read'] })).status).toBe(200);
  });

  test('an instance outside the parent, or no instance list at all, is refused', async () => {
    const { child: row } = await child();
    for (const body of [
      { instanceIds: [OTHER_INSTANCE] },
      { instanceIds: [INSTANCE, OTHER_INSTANCE] },
      { instanceIds: null },
    ]) {
      expect((await h.call('PATCH', `/keys/${row.id}`, body)).status).toBe(403);
    }
    expect(h.row(row.id)?.instanceIds).toEqual([INSTANCE]);
    // A rename is not an authority change.
    expect((await h.call('PATCH', `/keys/${row.id}`, { name: 'renamed' })).status).toBe(200);
  });

  test('the unguarded update refuses to widen a child too', async () => {
    const { child: row } = await child();
    await expect(h.service.update(row.id, { instanceIds: [OTHER_INSTANCE] })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'A child key cannot exceed its parent key',
    });
    expect(h.row(row.id)?.instanceIds).toEqual([INSTANCE]);
  });
});
