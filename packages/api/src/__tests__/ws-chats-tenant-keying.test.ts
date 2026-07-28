/**
 * Chat WebSocket tenant keying — G5 deliverable (e)
 * (wish: omni-full-multitenancy; ADR-0008).
 *
 * `createChatWebSocketHandler` lets a client `subscribe` to any `chatId` it can
 * name, and `broadcast` delivers to every subscriber whose filter matches. Under
 * multitenancy that chat id may belong to another tenant, so the filter must be
 * a tenant-narrowed one. These probes pin:
 *
 *   * a tenant-A update never reaches a tenant-B subscriber of the same chat id;
 *   * the connection's tenant comes from `open()` (the authenticated upgrade),
 *     never from the `subscribe` socket message — a client that puts a tenant in
 *     its payload does not change what it receives;
 *   * DUAL WORLD: with no tenant on the connection and none on the update, the
 *     pre-G5 filter behaviour is byte-identical.
 */

import { describe, expect, test } from 'bun:test';
import type { Database } from '@omni/db';
import { createChatWebSocketHandler } from '../ws/chats';

const TENANT_A = '11111111-1111-4111-8111-11111111111a';
const TENANT_B = '22222222-2222-4222-8222-22222222222b';
const db = {} as Database;

function socket() {
  const sent: string[] = [];
  return { sent, send: (d: string) => sent.push(d) };
}

describe('chat fan-out is narrowed by tenant', () => {
  test('tenant A update does not reach a tenant B subscriber of the same chat id', () => {
    const handler = createChatWebSocketHandler(db, null, 'instance-1');
    const a = socket();
    const b = socket();

    handler.open(a, { tenantId: TENANT_A, revocationEpoch: 1 });
    handler.open(b, { tenantId: TENANT_B, revocationEpoch: 1 });
    handler.message(a, JSON.stringify({ type: 'subscribe', chatId: 'chat-shared' }));
    handler.message(b, JSON.stringify({ type: 'subscribe', chatId: 'chat-shared' }));

    handler.broadcast({ type: 'message.new', chatId: 'chat-shared' }, TENANT_A);

    expect(a.sent).toHaveLength(1);
    expect(b.sent).toHaveLength(0);
  });

  test('a caller cannot widen its reach by claiming a tenant in the subscribe payload', () => {
    const handler = createChatWebSocketHandler(db, null, 'instance-1');
    const b = socket();

    handler.open(b, { tenantId: TENANT_B, revocationEpoch: 1 });
    handler.message(b, JSON.stringify({ type: 'subscribe', chatId: 'chat-shared', tenantId: TENANT_A }));

    handler.broadcast({ type: 'message.new', chatId: 'chat-shared' }, TENANT_A);

    expect(b.sent).toHaveLength(0);
  });

  test('a tenant-bound update never reaches a legacy (tenantless) subscriber', () => {
    const handler = createChatWebSocketHandler(db, null, 'instance-1');
    const legacy = socket();

    handler.open(legacy);
    handler.message(legacy, JSON.stringify({ type: 'subscribe', chatId: 'chat-shared' }));

    handler.broadcast({ type: 'message.new', chatId: 'chat-shared' }, TENANT_A);

    expect(legacy.sent).toHaveLength(0);
  });

  test('DUAL WORLD: a legacy update reaches legacy subscribers exactly as pre-G5', () => {
    const handler = createChatWebSocketHandler(db, null, 'instance-1');
    const one = socket();
    const two = socket();

    handler.open(one);
    handler.open(two);
    handler.message(one, JSON.stringify({ type: 'subscribe', chatId: 'chat-shared' }));
    handler.message(two, JSON.stringify({ type: 'subscribe' }));

    handler.broadcast({ type: 'message.new', chatId: 'chat-shared' });

    expect(one.sent).toHaveLength(1);
    expect(two.sent).toHaveLength(1);
  });

  test('a legacy update does not reach a tenant-bound subscriber', () => {
    const handler = createChatWebSocketHandler(db, null, 'instance-1');
    const bound = socket();

    handler.open(bound, { tenantId: TENANT_A, revocationEpoch: 1 });
    handler.message(bound, JSON.stringify({ type: 'subscribe', chatId: 'chat-shared' }));

    handler.broadcast({ type: 'message.new', chatId: 'chat-shared' });

    expect(bound.sent).toHaveLength(0);
  });

  test('the pre-G5 type filters still apply inside a tenant', () => {
    const handler = createChatWebSocketHandler(db, null, 'instance-1');
    const a = socket();

    handler.open(a, { tenantId: TENANT_A, revocationEpoch: 1 });
    handler.message(a, JSON.stringify({ type: 'subscribe', chatId: 'chat-1', includeTyping: false }));

    handler.broadcast({ type: 'chat.typing', chatId: 'chat-1' }, TENANT_A);
    expect(a.sent).toHaveLength(0);

    handler.broadcast({ type: 'message.new', chatId: 'chat-1' }, TENANT_A);
    expect(a.sent).toHaveLength(1);
  });
});

describe('revocation terminates chat subscriptions', () => {
  test('terminateTenant drops only the revoked tenant', () => {
    const handler = createChatWebSocketHandler(db, null, 'instance-1');
    const a = socket();
    const b = socket();
    const closedA: string[] = [];

    handler.open(a, { tenantId: TENANT_A, revocationEpoch: 1, close: (r: string) => closedA.push(r) });
    handler.open(b, { tenantId: TENANT_B, revocationEpoch: 1 });
    handler.message(a, JSON.stringify({ type: 'subscribe', chatId: 'chat-1' }));
    handler.message(b, JSON.stringify({ type: 'subscribe', chatId: 'chat-1' }));

    expect(handler.terminateTenant(TENANT_A, 'tenant_revoked')).toBe(1);
    expect(closedA).toEqual(['tenant_revoked']);

    handler.broadcast({ type: 'message.new', chatId: 'chat-1' }, TENANT_A);
    expect(a.sent).toHaveLength(0);

    handler.broadcast({ type: 'message.new', chatId: 'chat-1' }, TENANT_B);
    expect(b.sent).toHaveLength(1);
  });

  test('the sweep view lists the live tenants', () => {
    const handler = createChatWebSocketHandler(db, null, 'instance-1');
    handler.open(socket(), { tenantId: TENANT_A, revocationEpoch: 3 });
    handler.open(socket());

    expect(handler.streamRegistry.activeTenantIds()).toEqual([TENANT_A]);
    expect(handler.streamRegistry.size).toBe(2);
  });
});
