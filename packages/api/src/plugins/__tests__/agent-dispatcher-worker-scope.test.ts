/**
 * Agent-dispatcher read-path worker scope (wish: omni-full-multitenancy, Group
 * G5; ADR-0008).
 *
 * The dispatcher already ran its WRITE blocks through `runDispatchDb` (leg A/E).
 * Its READ helpers did not: `resolveQuotedMessage`, `resolveContactName`,
 * `resolvePersonId`, `resolveCustomerContext`, `fetchSenderMetadata`,
 * `fetchChatMetadata`, `buildContextMessages` and the media-wait recovery all
 * called `services.chats` / `services.messages` / `services.persons` bare, so
 * they reached the ambient pool even for a tenant-world envelope. That kept
 * `services/chats.ts::chat_id_mappings`, `services/messages.ts::{messages,chats}`
 * and `services/persons.ts::platform_identities` at `pending-G5-conversion`
 * however well the consumers around them were converted — a site is only as
 * scoped as its least-scoped caller.
 *
 * Two of these helpers POLL for another consumer's commit (`resolvePersonId`
 * waits for message-persistence to create the identity; `awaitMediaProcessing`
 * waits for the media row). A single transaction spanning the poll could never
 * observe those commits — REPEATABLE READ would pin the snapshot — and it would
 * also outlive its work item. So the contract asserted here is per-READ scoping:
 * each attempt opens and closes its own short worker transaction.
 *
 * Probes: for each helper, a trusted tenant scopes every service read to that
 * tenant, and no trusted tenant (the legacy world) leaves the read completely
 * unscoped — byte-identical to pre-G5.
 */

import { describe, expect, test } from 'bun:test';
import type { Database } from '@omni/db';
import { currentTenantScope } from '../../tenancy/tenant-scope';
import { __test__ } from '../agent-dispatcher';

const {
  resolveQuotedMessage,
  resolveContactName,
  resolvePersonId,
  resolveCustomerContext,
  resolveLidMentionBot,
  resolveEffectiveReplyFilter,
  resolveSlackThreadReply,
  fetchSenderMetadata,
  fetchChatMetadata,
  buildContextMessages,
  applyCloseContactGate,
} = __test__;

const TENANT_A = '11111111-1111-4111-8111-1111111111aa';

/** A db fake that records the tenant each worker scope stamps. */
function fakeDb(stamped: string[]): Database {
  return {
    transaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> =>
      cb({
        execute: async (q: unknown) => {
          const text = JSON.stringify(q);
          const match = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.exec(text);
          if (match) stamped.push(match[0]);
          return [] as unknown;
        },
      }),
  } as unknown as Database;
}

interface Harness {
  services: never;
  scopes: (string | null)[];
  stamped: string[];
}

/**
 * A services fake whose every db-backed method records the tenant scope active
 * at the moment it runs.
 */
function harness(): Harness {
  const stamped: string[] = [];
  const scopes: (string | null)[] = [];
  const db = fakeDb(stamped);
  const observe = () => {
    scopes.push(currentTenantScope()?.tenantId ?? null);
  };
  const chat = {
    id: 'chat-uuid',
    name: 'Group Name',
    participantCount: 3,
    chatType: 'group',
    settings: {},
  };
  const services = {
    db,
    chats: {
      findByExternalIdSmart: async () => {
        observe();
        return chat;
      },
      update: async () => {
        observe();
        return chat;
      },
      findLidMapping: async () => {
        observe();
        return '5511999999999@s.whatsapp.net';
      },
    },
    messages: {
      getByExternalId: async () => {
        observe();
        return {
          id: 'message-uuid',
          textContent: 'quoted body',
          senderDisplayName: 'Someone',
          isFromMe: false,
          platformTimestamp: new Date('2026-01-01T00:00:00Z'),
        };
      },
      list: async () => {
        observe();
        return { messages: [], total: 0 };
      },
      hasBotRepliedInThread: async () => {
        observe();
        return true;
      },
    },
    // routeResolver manages its own scope via the trustedTenantId it is passed;
    // it must NOT observe here, so the only reads these probes record are the
    // chat/message reads under test.
    routeResolver: {
      resolve: async () => null,
    },
    persons: {
      getIdentityByPlatformId: async () => {
        observe();
        return { personId: 'person-uuid', profilePicUrl: 'https://x/y.png', platformUsername: 'someone' };
      },
      getById: async () => {
        observe();
        return { id: 'person-uuid', metadata: {} };
      },
    },
  } as never;
  return { services, scopes, stamped };
}

/**
 * A structural view of the harness's service fakes. The harness types `services`
 * as `never` so it stays assignable to the full `Services` param of the 8
 * whole-`services` probes; these three helpers take individual services, so we
 * project the pieces back out with their exact param types.
 */
function pieces(h: Harness): {
  db: Parameters<typeof resolveEffectiveReplyFilter>[5];
  chats: Parameters<typeof resolveEffectiveReplyFilter>[0];
  messages: Parameters<typeof resolveSlackThreadReply>[1];
  routeResolver: Parameters<typeof resolveEffectiveReplyFilter>[1];
} {
  return h.services as unknown as {
    db: Parameters<typeof resolveEffectiveReplyFilter>[5];
    chats: Parameters<typeof resolveEffectiveReplyFilter>[0];
    messages: Parameters<typeof resolveSlackThreadReply>[1];
    routeResolver: Parameters<typeof resolveEffectiveReplyFilter>[1];
  };
}

/** Every recorded read saw the same expectation. */
function expectAllScopes(scopes: (string | null)[], expected: string | null) {
  expect(scopes.length).toBeGreaterThan(0);
  for (const s of scopes) expect(s).toBe(expected);
}

describe('agent-dispatcher read helpers scope their db reads (G5, ADR-0008)', () => {
  test('resolveQuotedMessage: tenant world scopes the chat + message reads', async () => {
    const h = harness();
    await resolveQuotedMessage(h.services, 'inst-1', 'chat-ext', 'reply-ext', [], { trustedTenantId: TENANT_A });
    expectAllScopes(h.scopes, TENANT_A);
    expect(h.stamped.every((t) => t === TENANT_A)).toBe(true);
  });

  test('resolveQuotedMessage: legacy world leaves the reads unscoped', async () => {
    const h = harness();
    await resolveQuotedMessage(h.services, 'inst-1', 'chat-ext', 'reply-ext', [], {});
    expectAllScopes(h.scopes, null);
    expect(h.stamped).toEqual([]);
  });

  test('resolveContactName: tenant world scopes the chat read; legacy does not', async () => {
    const tenant = harness();
    await resolveContactName(tenant.services, 'inst-1', 'jid-1', new Map(), TENANT_A);
    expectAllScopes(tenant.scopes, TENANT_A);

    const legacy = harness();
    await resolveContactName(legacy.services, 'inst-1', 'jid-1', new Map());
    expectAllScopes(legacy.scopes, null);
  });

  test('resolvePersonId: each poll attempt gets its OWN short scope', async () => {
    const tenant = harness();
    await resolvePersonId(tenant.services, 'whatsapp-baileys', 'inst-1', 'sender-1', undefined, TENANT_A);
    expectAllScopes(tenant.scopes, TENANT_A);
    // One transaction per attempt — never one spanning the poll.
    expect(tenant.stamped.length).toBe(tenant.scopes.length);

    const legacy = harness();
    await resolvePersonId(legacy.services, 'whatsapp-baileys', 'inst-1', 'sender-1');
    expectAllScopes(legacy.scopes, null);
  });

  test('resolveCustomerContext: tenant world scopes the person read; legacy does not', async () => {
    const tenant = harness();
    await resolveCustomerContext(tenant.services, 'person-uuid', undefined, TENANT_A);
    expectAllScopes(tenant.scopes, TENANT_A);

    const legacy = harness();
    await resolveCustomerContext(legacy.services, 'person-uuid', undefined);
    expectAllScopes(legacy.scopes, null);
  });

  test('fetchSenderMetadata: tenant world scopes the identity read; legacy does not', async () => {
    const tenant = harness();
    await fetchSenderMetadata(tenant.services, 'whatsapp-baileys', 'inst-1', 'sender-1', TENANT_A);
    expectAllScopes(tenant.scopes, TENANT_A);

    const legacy = harness();
    await fetchSenderMetadata(legacy.services, 'whatsapp-baileys', 'inst-1', 'sender-1');
    expectAllScopes(legacy.scopes, null);
  });

  test('fetchChatMetadata: tenant world scopes the chat read; legacy does not', async () => {
    const tenant = harness();
    await fetchChatMetadata(tenant.services, 'inst-1', 'chat-ext', 'group', TENANT_A);
    expectAllScopes(tenant.scopes, TENANT_A);

    const legacy = harness();
    await fetchChatMetadata(legacy.services, 'inst-1', 'chat-ext', 'group');
    expectAllScopes(legacy.scopes, null);
  });

  test('buildContextMessages: tenant world scopes the chat + history reads; legacy does not', async () => {
    const instance = { id: 'inst-1', config: {} } as never;
    const tenant = harness();
    await buildContextMessages(tenant.services, instance, 'chat-ext', [], TENANT_A);
    expectAllScopes(tenant.scopes, TENANT_A);

    const legacy = harness();
    await buildContextMessages(legacy.services, instance, 'chat-ext', []);
    expectAllScopes(legacy.scopes, null);
  });

  test('resolveLidMentionBot: tenant world scopes the LID mapping read; legacy does not', async () => {
    // Phone-JID owner (not a LID) forces the DB-resolution branch — the direct
    // LID compare is skipped, so `findLidMapping` (chat_id_mappings) must run.
    const owner = '5511999999999@s.whatsapp.net';
    const mentionedJids = ['888888888888@lid'];

    const tenant = harness();
    const ts = pieces(tenant);
    await resolveLidMentionBot(
      ts.chats,
      'inst-1',
      owner,
      mentionedJids,
      { mentionsBot: false } as never,
      ts.db,
      TENANT_A,
    );
    expectAllScopes(tenant.scopes, TENANT_A);
    expect(tenant.stamped.every((t) => t === TENANT_A)).toBe(true);

    const legacy = harness();
    const ls = pieces(legacy);
    await resolveLidMentionBot(ls.chats, 'inst-1', owner, mentionedJids, { mentionsBot: false } as never, ls.db);
    expectAllScopes(legacy.scopes, null);
    expect(legacy.stamped).toEqual([]);
  });

  test('resolveEffectiveReplyFilter: tenant world scopes the chat read; legacy does not', async () => {
    const tenant = harness();
    const ts = pieces(tenant);
    await resolveEffectiveReplyFilter(
      ts.chats,
      ts.routeResolver,
      'inst-1',
      'chat-ext',
      'all' as never,
      ts.db,
      TENANT_A,
    );
    expectAllScopes(tenant.scopes, TENANT_A);

    const legacy = harness();
    const ls = pieces(legacy);
    await resolveEffectiveReplyFilter(ls.chats, ls.routeResolver, 'inst-1', 'chat-ext', 'all' as never, ls.db);
    expectAllScopes(legacy.scopes, null);
  });

  test('resolveSlackThreadReply: tenant world scopes the chat + thread reads; legacy does not', async () => {
    const instance = { id: 'inst-1', channel: 'slack' } as never;
    const payload = { chatId: 'chat-ext', rawPayload: { isThreadReply: true, threadTs: '123.456' } } as never;

    const tenant = harness();
    const ts = pieces(tenant);
    await resolveSlackThreadReply(
      ts.chats,
      ts.messages,
      instance,
      payload,
      { isReplyToBot: false } as never,
      ts.db,
      TENANT_A,
    );
    expectAllScopes(tenant.scopes, TENANT_A);
    expect(tenant.stamped.every((t) => t === TENANT_A)).toBe(true);

    const legacy = harness();
    const ls = pieces(legacy);
    await resolveSlackThreadReply(ls.chats, ls.messages, instance, payload, { isReplyToBot: false } as never, ls.db);
    expectAllScopes(legacy.scopes, null);
    expect(legacy.stamped).toEqual([]);
  });

  test('applyCloseContactGate: tenant world scopes its chat write; legacy does not', async () => {
    // A soft close whose cooldown has expired: the gate clears `closeUntil`,
    // which is the only write path in this function.
    const settings = { closeUntil: '2020-01-01T00:00:00.000Z' } as never;
    const tenant = harness();
    await applyCloseContactGate(tenant.services, 'chat-uuid', 'inst-1', 'chat-ext', settings, TENANT_A);
    expectAllScopes(tenant.scopes, TENANT_A);

    const legacy = harness();
    await applyCloseContactGate(legacy.services, 'chat-uuid', 'inst-1', 'chat-ext', settings);
    expectAllScopes(legacy.scopes, null);
  });
});
