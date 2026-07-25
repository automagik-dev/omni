/**
 * `services/access.ts` worker-context boundary (G5; ADR-0008).
 *
 * Two consumer paths reach this service with no scope of any kind:
 *
 *   * `plugins/agent-dispatcher.ts` `checkAccessWithFallback` — up to three
 *     `checkAccess` calls per inbound message (primary id, Baileys
 *     `participantAlt`, LID→phone `resolvedSenderPhone`) plus a fire-and-forget
 *     `requestPairing`;
 *   * `plugins/agent-responder.ts` `processIncomingMessage` — the same pair.
 *
 * Both run inside a converted consumer that already derived the envelope's
 * trusted tenant, but the access read itself landed on the ambient pool: an
 * ALLOW/DENY decision — the gate that decides whether a message reaches an agent
 * at all — was being evaluated against rules read outside any tenant boundary.
 *
 * The conversion THREADS that tenant rather than wrapping the call, because
 * `checkAccess` PUBLISHES `access.allowed`/`access.denied` and `requestPairing`
 * publishes `access.pairing_requested`; a worker transaction held across a
 * publish makes the event a pre-commit side effect.
 *
 * NOTE ON THE REGISTRY: this closes the ASYNC half of
 * `access.ts::access_rules`. That entry stays `pending-G5-conversion` because
 * `trpc/router.ts` — a second synchronous edge with no tenant boundary at all —
 * also reaches `list`/`getById`/`create`/`checkAccess`. That is the same open
 * decision that holds `instances.ts::instances` and
 * `persons.ts::platform_identities`, not G5 async work.
 */

import { describe, expect, test } from 'bun:test';
import type { Database } from '@omni/db';
import { currentTenantScope, runInTenantScope } from '../../tenancy/tenant-scope';
import { AccessService } from '../access';

const TENANT_A = '11111111-1111-4111-8111-11111111111a';

function scope(): string | null {
  return currentTenantScope()?.tenantId ?? null;
}

function chain<T>(result: T): T {
  const self: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') {
          return (onOk: (v: T) => unknown, onErr?: (e: unknown) => unknown) =>
            Promise.resolve(result).then(onOk, onErr);
        }
        return () => self;
      },
    },
  );
  return self as T;
}

interface Observed {
  op: string;
  scope: string | null;
}

function makeDb(observed: Observed[], counters: { transactions: number }): Database {
  const db = {
    select: () => {
      observed.push({ op: 'select', scope: scope() });
      return chain([] as unknown[]);
    },
    insert: () => {
      observed.push({ op: 'insert', scope: scope() });
      return chain([{ id: 'rule-1', createdAt: new Date() }]);
    },
    delete: () => {
      observed.push({ op: 'delete', scope: scope() });
      return chain([]);
    },
    update: () => {
      observed.push({ op: 'update', scope: scope() });
      return chain([]);
    },
    transaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => {
      counters.transactions += 1;
      return cb(db);
    },
    execute: async () => [],
  };
  return db as unknown as Database;
}

function makeService(observed: Observed[], counters: { transactions: number }) {
  const publishScopes: Array<string | null> = [];
  const eventBus = {
    publish: async () => {
      publishScopes.push(scope());
    },
  } as unknown as ConstructorParameters<typeof AccessService>[1];
  return { service: new AccessService(makeDb(observed, counters), eventBus, null), publishScopes };
}

const INSTANCE = { id: 'inst-1', accessMode: 'allowlist' as const };

describe('access — consumer caller threads the envelope tenant', () => {
  test('checkAccess reads the rules INSIDE the tenant scope', async () => {
    const observed: Observed[] = [];
    const counters = { transactions: 0 };
    const { service } = makeService(observed, counters);

    await service.checkAccess(INSTANCE, '5511999999999', 'whatsapp-baileys', TENANT_A);

    const reads = observed.filter((o) => o.op === 'select');
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) expect(read.scope).toBe(TENANT_A);
  });

  test('the access-decision publish happens OUTSIDE the scope', async () => {
    const observed: Observed[] = [];
    const counters = { transactions: 0 };
    const { service, publishScopes } = makeService(observed, counters);

    // allowlist + no matching rule = default deny, which publishes access.denied.
    const result = await service.checkAccess(INSTANCE, '5511999999999', 'whatsapp-baileys', TENANT_A);

    expect(result.allowed).toBe(false);
    expect(publishScopes.length).toBe(1);
    expect(publishScopes).toEqual([null]);
  });

  test('requestPairing runs its read-count-insert transaction inside the tenant scope', async () => {
    const observed: Observed[] = [];
    const counters = { transactions: 0 };
    const { service, publishScopes } = makeService(observed, counters);

    await service.requestPairing('inst-1', '5511999999999', {}, TENANT_A);

    const inside = observed.filter((o) => o.op !== 'select' || true);
    expect(inside.length).toBeGreaterThan(0);
    for (const entry of inside) expect(entry.scope).toBe(TENANT_A);
    // …and the pairing publish is outside it.
    expect(publishScopes).toEqual([null]);
  });
});

describe('access — the `instances` half of the file is request-only', () => {
  test('approvePairingRequest — its channel lookup observes the REQUEST scope', async () => {
    const observed: Observed[] = [];
    const counters = { transactions: 0 };
    const publishScopes: Array<string | null> = [];
    const eventBus = {
      publish: async () => {
        publishScopes.push(scope());
      },
    } as unknown as ConstructorParameters<typeof AccessService>[1];

    // `access_rules` reads inside the transaction must return a pending request,
    // then a consumed row; the trailing `instances` read is the site under test.
    const db = {
      select: () => {
        observed.push({ op: 'select', scope: scope() });
        return chain([{ id: 'req-1', instanceId: 'inst-1', platformUserId: 'u', metadata: {}, expiresAt: null }]);
      },
      update: () => {
        observed.push({ op: 'update', scope: scope() });
        return chain([{ id: 'req-1' }]);
      },
      insert: () => {
        observed.push({ op: 'insert', scope: scope() });
        return chain([{ id: 'rule-1' }]);
      },
      delete: () => {
        observed.push({ op: 'delete', scope: scope() });
        return chain([]);
      },
      transaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => {
        counters.transactions += 1;
        return cb(db);
      },
      execute: async () => [],
    } as unknown as Database;

    const service = new AccessService(db, eventBus, null);

    await runInTenantScope(
      db,
      {
        credentialClass: 'tenant',
        requestId: 'req',
        principalId: 'p',
        credentialId: 'c',
        tenantId: TENANT_A,
        tenantSlug: null,
        actorRole: 'tenant-admin',
        scopes: [],
        membershipId: 'm',
        resourceConstraints: {},
        expiresAt: null,
        rateLimit: null,
        budget: null,
        delegationDepth: 0,
        rootKeyId: 'r',
        policyVersion: 0,
        revocationEpoch: 0,
        tenantKeyLineageId: 'l',
      } as never,
      () => service.approvePairingRequest('req-1', 'inst-1'),
    );

    // Every statement, including the `instances` channel lookup that follows the
    // transaction, ran on the request's tenant transaction.
    expect(observed.length).toBeGreaterThan(0);
    for (const entry of observed) expect(entry.scope).toBe(TENANT_A);
  });
});

describe('access — legacy world is byte-identical', () => {
  test('no threaded tenant: no scope, no worker transaction', async () => {
    const observed: Observed[] = [];
    const counters = { transactions: 0 };
    const { service } = makeService(observed, counters);

    await service.checkAccess(INSTANCE, '5511999999999', 'whatsapp-baileys');
    const workerTransactions = counters.transactions;

    expect(workerTransactions).toBe(0);
    expect(observed.every((o) => o.scope === null)).toBe(true);
  });
});
