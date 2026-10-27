/**
 * Chat keys: children of a key, each locked to one chat (wish: omni-chat-threads).
 *
 * Group 1 (service): `ApiKeyService.mintChild`, `revokeChild`, `revokeSelf`, and
 * the parent's revoke, delete and PATCH reaching its children in the same
 * transaction, with the `access.key_*` events. The parent changes are driven
 * through the REAL `/keys` routes and each child is checked through the REAL
 * auth middleware on `POST /auth/validate`.
 *
 * Group 4 (routes): `POST /keys/children`, `POST /keys/children/self/revoke`
 * and `POST /keys/children/:id/revoke`, called with real keys through the REAL
 * auth middleware and the REAL scope enforcer, and a minted child's sends held
 * to its own chat by that same enforcer.
 *
 * The database is an in-memory fake of the Drizzle surface `ApiKeyService`
 * uses, which evaluates the service's own `where` conditions (eq, and, or,
 * is null, comparisons, in) against its rows and applies the FK cascade, so the
 * service's queries, not hand-picked answers, decide each result. Locking and
 * concurrency are database behaviour: `api-key-children-postgres.test.ts`
 * proves those on a disposable PostgreSQL.
 */

import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { CORE_EVENT_TYPES, type EventBus, NotFoundError, STREAM_NAMES, getStreamForEventType } from '@omni/core';
import { type ApiKey, type Database, type NewApiKey, apiKeys } from '@omni/db';
import { Column, Param, SQL, StringChunk, getTableColumns, is } from 'drizzle-orm';
import { Hono } from 'hono';
import type { z } from 'zod';
import { DEFAULT_DEVICE_KEY_SCOPES } from '../../../login/config';
import { authMiddleware } from '../../../middleware/auth';
import { scopeEnforcerMiddleware } from '../../../middleware/scope-enforcer';
import type { ChildKeyRevokeResultSchema, ChildKeySchema } from '../../../schemas/openapi/keys';
import type { Services } from '../../../services';
import {
  ApiKeyService,
  CS_CHILD_SCOPES,
  type ChildChat,
  MAX_LIVE_CHILDREN,
  type MintChildResult,
} from '../../../services/api-keys';
import type { TenantAuthContext } from '../../../tenancy/auth-context';
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

  test('POST /keys/:id/revoke on a chat key itself publishes its access.key_revoked, once', async () => {
    const { parent, a, b } = await family();
    expect((await h.call('POST', `/keys/${a.child.id}/revoke`, { reason: 'leaked' })).status).toBe(200);
    expect(await h.validates(a.plainTextKey)).toBe(401);
    expect(await h.validates(b.plainTextKey)).toBe(200);
    expect(h.ofType('access.key_revoked').map((event) => event.payload)).toEqual([
      {
        keyId: a.child.id,
        parentKeyId: parent.id,
        chatId: chat(1).id,
        instanceId: INSTANCE,
        reason: 'operator',
        revokedBy: ADMIN.name,
      },
    ]);
    // A second revoke of a revoked key publishes nothing more.
    expect((await h.call('POST', `/keys/${a.child.id}/revoke`, {})).status).toBe(200);
    expect(h.ofType('access.key_revoked')).toHaveLength(1);
  });

  test('DELETE /keys/:id on a chat key itself publishes its access.key_revoked; a revoked one publishes none', async () => {
    const { parent, a, b } = await family();
    expect((await h.call('DELETE', `/keys/${b.child.id}`)).status).toBe(200);
    expect(await h.validates(b.plainTextKey)).toBe(401);
    expect(h.ofType('access.key_revoked').map((event) => event.payload)).toEqual([
      {
        keyId: b.child.id,
        parentKeyId: parent.id,
        chatId: chat(2, OTHER_INSTANCE).id,
        instanceId: OTHER_INSTANCE,
        reason: 'operator',
        revokedBy: null,
      },
    ]);
    expect(await h.service.revokeChild(parent.id, a.child.id, 'sign-in')).toEqual({ status: 'revoked' });
    h.events.length = 0;
    expect((await h.call('DELETE', `/keys/${a.child.id}`)).status).toBe(200);
    expect(h.events).toHaveLength(0);
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

// ============================================================================
// The child-key routes (Group 4), through the real auth and scope enforcer
// ============================================================================

/** A tenant credential's context; the route only needs to see that one is there. */
const TENANT_CONTEXT = { credentialClass: 'tenant', tenantId: 'tenant-a' } as unknown as TenantAuthContext;

/** The mint answer, or (with `status`) a revoke answer. */
type ChildKeyAnswer = z.infer<typeof ChildKeySchema> & Partial<z.infer<typeof ChildKeyRevokeResultSchema>>;

interface RouteCall {
  status: number;
  json: { data: ChildKeyAnswer; error: { code: string; message: string; lock?: string } };
}

/**
 * `/api/v2` as app.ts assembles it for a legacy key: the real auth middleware,
 * then the real scope enforcer, then the real keys routes. The two send routes
 * are stubs behind that same enforcer, so a 200 there means the lock let the
 * send through (Decision 14: the thread tools send to the chat's JID).
 */
function routeHarness() {
  const h = harness();
  const chats = [chat(1), chat(2), chat(3, OTHER_INSTANCE)];
  const sent: Array<{ path: string; body: unknown }> = [];

  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('services', {
      apiKeys: h.service,
      chats: {
        getById: async (id: string) => {
          const row = chats.find((candidate) => candidate.id === id);
          if (!row) throw new NotFoundError('Chat', id);
          return { ...row, visibility: 'visible' };
        },
      },
    } as unknown as Services);
    await next();
  });
  const v2 = new Hono<{ Variables: AppVariables }>();
  v2.use('*', authMiddleware);
  v2.use('*', async (c, next) => {
    if (c.req.header('x-test-tenant')) c.set('authContext', TENANT_CONTEXT);
    await next();
  });
  v2.use('*', scopeEnforcerMiddleware);
  v2.route('/keys', keysRoutes);
  for (const path of ['/messages/send', '/messages/send/reaction']) {
    v2.post(path, async (c) => {
      sent.push({ path, body: await c.req.json() });
      return c.json({ data: { sent: true } });
    });
  }
  app.route('/api/v2', v2);

  const as = async (
    key: string,
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<RouteCall> => {
    const res = await app.request(`/api/v2${path}`, {
      method,
      headers: {
        'x-api-key': key,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, json: (await res.json().catch(() => null)) as RouteCall['json'] };
  };
  const mint = (key: string, chatId: string, headers?: Record<string, string>) =>
    as(key, 'POST', '/keys/children', { chatId }, headers);
  const children = (parentId: string) => h.store.rows.filter((row) => row.parentKeyId === parentId);

  return { ...h, as, mint, children, sent };
}

describe('POST /keys/children', () => {
  let r: ReturnType<typeof routeHarness>;
  beforeEach(() => {
    r = routeHarness();
  });

  test("a sign-in key with today's default scopes mints a cs key locked to one chat and its instance", async () => {
    const expiresAt = new Date(Date.now() + 86_400_000);
    const { key: parent, plainTextKey } = await r.parent(undefined, { expiresAt });
    const target = chat(1);

    const res = await r.mint(plainTextKey, target.id);
    expect(res.status).toBe(201);
    expect(res.json.data).toEqual({
      id: expect.any(String),
      plainTextKey: expect.any(String),
      parentKeyId: parent.id,
      chatId: target.id,
      chatExternalId: target.externalId,
      instanceId: INSTANCE,
      scopes: expect.any(Array),
      expiresAt: expiresAt.toISOString(),
      replacedKeyId: null,
    });
    expect([...res.json.data.scopes].sort()).toEqual(['chats:read', 'context:write', 'messages:send', 'turns:close']);
    // The row, not just the answer: one chat (UUID and JID), its instance, its recipient.
    expect(r.row(res.json.data.id)).toMatchObject({
      profile: 'cs',
      parentKeyId: parent.id,
      chatAllowlist: [target.id, target.externalId],
      instanceAllowlist: [INSTANCE],
      outboundRecipientAllowlist: [target.externalId],
      instanceIds: [INSTANCE],
    });
    expect(JSON.stringify(res.json)).not.toContain('keyHash');
    expect(await r.validates(res.json.data.plainTextKey)).toBe(200);
    expect(r.ofType('access.key_minted')).toHaveLength(1);
  });

  test('a linkWithKey key with DEVICE_SCOPES mints one with exactly messages:send and chats:read', async () => {
    const { plainTextKey } = await r.parent(DEVICE_SCOPES);
    const res = await r.mint(plainTextKey, chat(1).id);
    expect(res.status).toBe(201);
    expect([...res.json.data.scopes].sort()).toEqual(['chats:read', 'messages:send']);
    expect(res.json.data.expiresAt).toBeNull();
  });

  test('no caller gains a keys:* scope (nor anything outside the cs set) from a wildcard parent', async () => {
    const { plainTextKey } = await r.parent(['*']);
    const res = await r.mint(plainTextKey, chat(1).id);
    expect(res.status).toBe(201);
    expect([...res.json.data.scopes].sort()).toEqual(['chats:read', 'context:write', 'messages:send', 'turns:close']);
    expect(res.json.data.scopes.some((scope: string) => scope.startsWith('keys:') || scope === '*')).toBe(false);
  });

  test('a body field besides chatId is a 400, a profile among them; so is a JID for chatId', async () => {
    const { key: parent, plainTextKey } = await r.parent();
    for (const body of [
      { chatId: chat(1).id, profile: 'admin' },
      { chatId: chat(1).id, profile: 'cs' },
      { chatId: chat(1).id, scopes: ['*'] },
      { chatId: chat(1).id, instanceId: OTHER_INSTANCE },
      { chatId: chat(1).externalId },
      {},
    ]) {
      expect((await r.as(plainTextKey, 'POST', '/keys/children', body)).status).toBe(400);
    }
    expect(r.children(parent.id)).toHaveLength(0);
  });

  test('a chat id with no row is a 404', async () => {
    const { key: parent, plainTextKey } = await r.parent();
    const res = await r.mint(plainTextKey, crypto.randomUUID());
    expect(res.status).toBe(404);
    expect(r.children(parent.id)).toHaveLength(0);
  });

  test('a child, a chat-, instance- or recipient-locked key and a tenant-context caller get 403', async () => {
    const { key: root, plainTextKey: rootKey } = await r.parent();
    const child = await r.mint(rootKey, chat(1).id);
    const callers = [
      child.json.data.plainTextKey as string,
      (await r.parent(undefined, { chatAllowlist: [chat(2).id] })).plainTextKey,
      (await r.parent(undefined, { instanceAllowlist: [INSTANCE] })).plainTextKey,
      (await r.parent(undefined, { outboundRecipientAllowlist: [chat(2).externalId] })).plainTextKey,
    ];
    for (const key of callers) expect((await r.mint(key, chat(2).id)).status).toBe(403);
    expect((await r.mint(rootKey, chat(2).id, { 'x-test-tenant': '1' })).status).toBe(403);
    expect(r.children(root.id)).toHaveLength(1);
    expect(r.store.rows.filter((row) => row.parentKeyId !== null)).toHaveLength(1);
  });

  test('a caller without chats:keys, chats:read or messages:send gets 403', async () => {
    for (const scopes of [
      ['chats:read', 'chats:write', 'messages:send'],
      ['chats:keys', 'messages:send'],
      ['chats:keys', 'chats:read'],
    ]) {
      const { key: parent, plainTextKey } = await r.parent(scopes);
      expect((await r.mint(plainTextKey, chat(1).id)).status).toBe(403);
      expect(r.children(parent.id)).toHaveLength(0);
    }
    // chats:keys on its own, with the two it needs, is enough.
    const { plainTextKey } = await r.parent(['chats:keys', 'chats:read', 'messages:send']);
    expect((await r.mint(plainTextKey, chat(1).id)).status).toBe(201);
  });

  test(`a parent with ${MAX_LIVE_CHILDREN} live children gets 409 CHILD_LIMIT`, async () => {
    const { key: parent, plainTextKey } = await r.parent();
    for (let n = 1; n <= MAX_LIVE_CHILDREN; n++) {
      const target = chat(1000 + n);
      r.store.rows.push({
        ...(r.row(parent.id) as Row),
        id: crypto.randomUUID(),
        keyHash: `hash-${n}`,
        parentKeyId: parent.id,
        chatAllowlist: [target.id, target.externalId],
        scopes: ['messages:send', 'chats:read'],
      });
    }
    const res = await r.mint(plainTextKey, chat(1).id);
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe('CHILD_LIMIT');
    expect(r.children(parent.id)).toHaveLength(MAX_LIVE_CHILDREN);
  });

  test('a second mint for the same chat revokes the first and leaves one live child', async () => {
    const { key: parent, plainTextKey } = await r.parent();
    const first = await r.mint(plainTextKey, chat(1).id);
    const second = await r.mint(plainTextKey, chat(1).id);
    expect(second.status).toBe(201);
    expect(second.json.data.replacedKeyId).toBe(first.json.data.id);

    expect(await r.validates(first.json.data.plainTextKey)).toBe(401);
    expect(await r.validates(second.json.data.plainTextKey)).toBe(200);
    expect(
      r
        .children(parent.id)
        .filter((row) => row.status === 'active')
        .map((row) => row.id),
    ).toEqual([second.json.data.id]);
    expect(r.ofType('access.key_revoked').map((event) => [event.payload.keyId, event.payload.reason])).toEqual([
      [first.json.data.id, 'remint'],
    ]);
  });

  test('a caller limited by instanceIds mints on its own instance; a chat on another reads as missing', async () => {
    const { key: parent, plainTextKey } = await r.parent(undefined, { instanceIds: [INSTANCE] });
    // The same 404 as no chat at all: the answer says nothing of chats out of reach.
    const outside = await r.mint(plainTextKey, chat(3, OTHER_INSTANCE).id);
    const missing = await r.mint(plainTextKey, crypto.randomUUID());
    expect(outside.status).toBe(404);
    expect(outside.json).toEqual(missing.json);
    expect(r.children(parent.id)).toHaveLength(0);
    const res = await r.mint(plainTextKey, chat(1).id);
    expect(res.status).toBe(201);
    expect(res.json.data.instanceId).toBe(INSTANCE);
  });
});

describe('POST /keys/children/:id/revoke and /keys/children/self/revoke', () => {
  let r: ReturnType<typeof routeHarness>;
  beforeEach(() => {
    r = routeHarness();
  });

  test("revokes the caller's own child, then answers already_revoked; a revoked child is refused next call", async () => {
    const { plainTextKey } = await r.parent();
    const live = (await r.mint(plainTextKey, chat(2).id)).json.data;

    const first = await r.as(plainTextKey, 'POST', `/keys/children/${live.id}/revoke`, { reason: 'chat removed' });
    expect<unknown>(first).toEqual({ status: 200, json: { data: { id: live.id, status: 'revoked' } } });
    expect(await r.validates(live.plainTextKey)).toBe(401);
    expect((await r.as(live.plainTextKey, 'POST', '/messages/send', { to: chat(2).externalId })).status).toBe(401);

    // No body at all is a revoke too.
    const again = await r.as(plainTextKey, 'POST', `/keys/children/${live.id}/revoke`);
    expect<unknown>(again).toEqual({ status: 200, json: { data: { id: live.id, status: 'already_revoked' } } });
    expect(r.ofType('access.key_revoked').find((event) => event.payload.keyId === live.id)?.payload).toMatchObject({
      reason: 'own_child',
      revokedBy: 'sign-in',
    });
  });

  test('revokedBy comes from the caller, never the body; any other body field is a 400', async () => {
    const { plainTextKey } = await r.parent();
    const child = (await r.mint(plainTextKey, chat(1).id)).json.data;
    expect(
      (await r.as(plainTextKey, 'POST', `/keys/children/${child.id}/revoke`, { revokedBy: 'someone-else' })).status,
    ).toBe(400);
    expect(await r.validates(child.plainTextKey)).toBe(200);
    expect(
      (await r.as(plainTextKey, 'POST', `/keys/children/${child.id}/revoke`, { reason: 'x'.repeat(501) })).status,
    ).toBe(400);
  });

  test('a key whose parent is not the caller gets 403, a child of another link key among them', async () => {
    const { key: mine, plainTextKey: mineKey } = await r.parent();
    const { plainTextKey: otherKey } = await r.parent();
    const foreign = (await r.mint(otherKey, chat(1).id)).json.data;

    expect((await r.as(mineKey, 'POST', `/keys/children/${foreign.id}/revoke`)).status).toBe(403);
    // A root key is nobody's child; the caller itself is not its own child.
    expect((await r.as(mineKey, 'POST', `/keys/children/${mine.id}/revoke`)).status).toBe(403);
    expect(await r.validates(foreign.plainTextKey)).toBe(200);
    expect((await r.as(mineKey, 'POST', `/keys/children/${crypto.randomUUID()}/revoke`)).status).toBe(404);
  });

  test('a locked caller, a child among them, or a tenant-context caller gets 403 on own-child revoke', async () => {
    const { plainTextKey } = await r.parent();
    const child = (await r.mint(plainTextKey, chat(1).id)).json.data;
    const sibling = (await r.mint(plainTextKey, chat(2).id)).json.data;
    expect((await r.as(child.plainTextKey, 'POST', `/keys/children/${sibling.id}/revoke`)).status).toBe(403);
    expect(
      (await r.as(plainTextKey, 'POST', `/keys/children/${sibling.id}/revoke`, {}, { 'x-test-tenant': '1' })).status,
    ).toBe(403);
    expect(await r.validates(sibling.plainTextKey)).toBe(200);
  });

  test('a cs child with its locks set cuts itself through the lock, never a 403 or 404 from :id = self', async () => {
    const { key: parent, plainTextKey } = await r.parent();
    const child = (await r.mint(plainTextKey, chat(1).id)).json.data;
    expect(r.row(child.id)?.chatAllowlist).toEqual([chat(1).id, chat(1).externalId]);

    const res = await r.as(child.plainTextKey, 'POST', '/keys/children/self/revoke');
    expect<unknown>(res).toEqual({ status: 200, json: { data: { id: child.id, status: 'revoked' } } });
    expect(await r.validates(child.plainTextKey)).toBe(401);
    expect(r.ofType('access.key_revoked').map((event) => event.payload)).toEqual([
      expect.objectContaining({ keyId: child.id, parentKeyId: parent.id, reason: 'self' }),
    ]);
  });

  test('a non-child is refused on the self route', async () => {
    const { key: parent, plainTextKey } = await r.parent();
    const res = await r.as(plainTextKey, 'POST', '/keys/children/self/revoke');
    expect(res.status).toBe(403);
    expect(r.row(parent.id)?.status).toBe('active');
  });

  test('after DELETE /keys/:id of a parent, an own-child revoke of one of its removed children answers 404', async () => {
    const { key: parent, plainTextKey } = await r.parent();
    const { plainTextKey: operatorKey } = await r.parent();
    const child = (await r.mint(plainTextKey, chat(1).id)).json.data;
    expect((await r.call('DELETE', `/keys/${parent.id}`)).status).toBe(200);

    expect((await r.as(operatorKey, 'POST', `/keys/children/${child.id}/revoke`)).status).toBe(404);
    // The parent itself is gone with it.
    expect((await r.as(plainTextKey, 'POST', `/keys/children/${child.id}/revoke`)).status).toBe(401);
  });

  test('POST /keys/:id/revoke still needs keys:write', async () => {
    const { plainTextKey } = await r.parent();
    const child = (await r.mint(plainTextKey, chat(1).id)).json.data;
    const res = await r.as(plainTextKey, 'POST', `/keys/${child.id}/revoke`, {});
    expect(res.status).toBe(403);
    expect(res.json.error.message).toContain('keys:write');
    expect(await r.validates(child.plainTextKey)).toBe(200);
  });
});

describe("a minted child's sends stay in its own chat (Decision 14: to is the chat's JID)", () => {
  let r: ReturnType<typeof routeHarness>;
  let childKey: string;
  beforeEach(async () => {
    r = routeHarness();
    const { plainTextKey } = await r.parent();
    childKey = (await r.mint(plainTextKey, chat(1).id)).json.data.plainTextKey;
  });

  const send = { instanceId: INSTANCE, text: 'hi' };
  const reaction = { instanceId: INSTANCE, messageId: 'MSG-1', emoji: '👍' };

  test('a send and a reaction to its own chat by JID pass the scope enforcer and the recipient lock', async () => {
    expect((await r.as(childKey, 'POST', '/messages/send', { ...send, to: chat(1).externalId })).status).toBe(200);
    expect(
      (await r.as(childKey, 'POST', '/messages/send/reaction', { ...reaction, to: chat(1).externalId })).status,
    ).toBe(200);
    expect(r.sent.map((entry) => entry.path)).toEqual(['/messages/send', '/messages/send/reaction']);
  });

  test('the same calls to another chat get 403', async () => {
    for (const [path, body] of [
      ['/messages/send', send],
      ['/messages/send/reaction', reaction],
    ] as const) {
      expect((await r.as(childKey, 'POST', path, { ...body, to: chat(2).externalId })).status).toBe(403);
      expect((await r.as(childKey, 'POST', path, { ...body, to: chat(2).id })).status).toBe(403);
    }
    expect(r.sent).toEqual([]);
  });

  test('the same calls to its own chat by UUID get 403 from the recipient lock', async () => {
    for (const [path, body] of [
      ['/messages/send', send],
      ['/messages/send/reaction', reaction],
    ] as const) {
      const res = await r.as(childKey, 'POST', path, { ...body, to: chat(1).id });
      expect(res.status).toBe(403);
      expect(res.json.error.lock).toBe('outboundRecipientAllowlist');
    }
    expect(r.sent).toEqual([]);
  });

  test('a send on another instance gets 403', async () => {
    const res = await r.as(childKey, 'POST', '/messages/send', {
      ...send,
      instanceId: OTHER_INSTANCE,
      to: chat(1).externalId,
    });
    expect(res.status).toBe(403);
  });
});
