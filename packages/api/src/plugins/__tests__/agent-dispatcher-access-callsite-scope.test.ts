/**
 * The ACCESS CALL SITES thread the envelope-derived tenant (G5; ADR-0008).
 *
 * `services/__tests__/access-worker-scope.test.ts` proves `AccessService` HONOURS
 * a threaded tenant — it invokes `checkAccess`/`requestPairing` with a literal
 * tenant and asserts the rule read lands in that scope. What it cannot prove is
 * that any real caller threads one, and that is the whole conversion: the
 * db-access-guard justification for `access.ts::access_rules` names the two
 * consumer callers as scoped and names that probe as the pin.
 *
 * The gap was mechanically invisible. Dropping the trailing `trustedTenantId`
 * argument at the two `checkAccessWithFallback` call sites left `tsc` at exit 0
 * (the parameter is optional), biome clean, and the whole suite green — while
 * every inbound message's ALLOW/DENY decision silently returned to the ambient
 * pool: cross-boundary before enforcement, and after it a fail-CLOSED read for
 * allowlist instances but a fail-OPEN one for the default blocklist mode, where
 * an empty rule read means "allowed".
 *
 * So these probes drive the GUARDS — `shouldProcessMessage` and
 * `shouldProcessReaction` — and assert the value that reaches `checkAccess`.
 * They fail if the argument is dropped at either call site.
 */

import { describe, expect, test } from 'bun:test';
import type { Database } from '@omni/db';
import { currentTenantScope } from '../../tenancy/tenant-scope';
import { __test__ } from '../agent-dispatcher';

const TENANT_A = '11111111-1111-4111-8111-11111111111a';

interface AccessCall {
  senderId: string;
  tenantId: string | undefined;
  /** The scope observed AT the call — the service scopes its own block. */
  scope: string | null;
}

/** Chainable drizzle stub: builders return self, awaiting yields `rows`. */
function chain<T>(rows: T): T {
  const self: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') {
          return (onOk: (v: T) => unknown, onErr?: (e: unknown) => unknown) => Promise.resolve(rows).then(onOk, onErr);
        }
        return () => self;
      },
    },
  );
  return self as T;
}

function fakeDb(): Database {
  const db = {
    select: () => chain([{ ownerIdentifier: 'owner-x' }]),
    transaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> =>
      cb({ execute: async () => [] as unknown, select: () => chain([{ ownerIdentifier: 'owner-x' }]) }),
    execute: async () => [],
  };
  return db as unknown as Database;
}

function fakeInstance(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inst-1',
    channel: 'whatsapp-baileys',
    agentId: 'agent-1',
    ownerIdentifier: 'owner-self',
    allowFirstParty: true,
    agentReplyFilter: null,
    inboundMaxAgeMinutes: null,
    accessMode: 'blocklist',
    ...overrides,
  };
}

function harness(instanceOverrides: Record<string, unknown> = {}) {
  const calls: AccessCall[] = [];
  const accessService = {
    checkAccess: async (_instance: unknown, senderId: string, _channel: string, tenantId?: string) => {
      calls.push({ senderId, tenantId, scope: currentTenantScope()?.tenantId ?? null });
      return { allowed: true, reason: 'ok' };
    },
    requestPairing: async () => {},
  } as never;

  const agentRunner = {
    getInstanceWithProvider: async () => fakeInstance(instanceOverrides),
  } as never;

  const chatsService = {
    getById: async () => null,
    findOrCreate: async () => ({ chat: { id: 'chat-1' } }),
    findByExternalIdSmart: async () => null,
    getAllExternalIds: async () => [],
  } as never;
  const messagesService = { getByExternalId: async () => null } as never;
  const routeResolver = { resolve: async () => null } as never;

  return { calls, accessService, agentRunner, chatsService, messagesService, routeResolver };
}

const PAYLOAD = {
  externalId: 'ext-1',
  chatId: '5511999999999@s.whatsapp.net',
  from: '5511999999999',
  content: { type: 'text', text: 'hi' },
  rawPayload: {},
} as never;

const METADATA = { instanceId: 'inst-1', channelType: 'whatsapp-baileys' };

describe('shouldProcessMessage threads the envelope tenant into the access read', () => {
  test('tenant envelope: checkAccess receives the envelope-derived tenant', async () => {
    const h = harness();

    const instance = await __test__.shouldProcessMessage(
      h.agentRunner,
      h.accessService,
      h.chatsService,
      h.messagesService,
      h.routeResolver,
      fakeDb(),
      PAYLOAD,
      METADATA,
      TENANT_A,
    );

    expect(instance).not.toBeNull();
    expect(h.calls.length).toBeGreaterThan(0);
    // The threading is the assertion. `undefined` here is the unconverted world:
    // the ALLOW/DENY rules would be read on the ambient pool.
    for (const call of h.calls) expect(call.tenantId).toBe(TENANT_A);
    // Threaded, NOT wrapped: the service scopes its own block because it
    // publishes `access.allowed`/`access.denied` between blocks.
    for (const call of h.calls) expect(call.scope).toBeNull();
  });

  test('legacy envelope: nothing is threaded — byte-identical to pre-G5', async () => {
    const h = harness();

    await __test__.shouldProcessMessage(
      h.agentRunner,
      h.accessService,
      h.chatsService,
      h.messagesService,
      h.routeResolver,
      fakeDb(),
      PAYLOAD,
      METADATA,
      undefined,
    );

    expect(h.calls.length).toBeGreaterThan(0);
    for (const call of h.calls) expect(call.tenantId).toBeUndefined();
  });
});

describe('shouldProcessReaction threads the envelope tenant into the access read', () => {
  const reactionPayload = {
    messageId: 'msg-1',
    emoji: '👍',
    from: '5511999999999',
    chatId: '5511999999999@s.whatsapp.net',
    rawPayload: {},
  } as never;

  const dedup = { isDuplicate: () => false } as never;

  test('tenant envelope: checkAccess receives the envelope-derived tenant', async () => {
    const h = harness({ triggerEvents: ['reaction.received'] });

    const instance = await __test__.shouldProcessReaction(
      h.agentRunner,
      h.accessService,
      dedup,
      reactionPayload,
      METADATA,
      'reaction.received',
      fakeDb(),
      TENANT_A,
    );

    expect(instance).not.toBeNull();
    expect(h.calls.length).toBeGreaterThan(0);
    for (const call of h.calls) expect(call.tenantId).toBe(TENANT_A);
  });

  test('legacy envelope: nothing is threaded', async () => {
    const h = harness({ triggerEvents: ['reaction.received'] });

    await __test__.shouldProcessReaction(
      h.agentRunner,
      h.accessService,
      dedup,
      reactionPayload,
      METADATA,
      'reaction.received',
      fakeDb(),
      undefined,
    );

    expect(h.calls.length).toBeGreaterThan(0);
    for (const call of h.calls) expect(call.tenantId).toBeUndefined();
  });
});
