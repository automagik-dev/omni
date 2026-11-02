import { afterAll, afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { createEventBus } from '@omni/core';
import { type DurableConsumer, createDbHandle } from '@omni/db';
import { PgDialect } from 'drizzle-orm/pg-core';
import { PostgresJsPreparedQuery } from 'drizzle-orm/postgres-js/session';
import { isAdminTierKey } from '../../lib/key-agent';
import { type ConsumerCaller, EventConsumerService, canAccessConsumer, consumerAccessClause } from '../event-consumers';

const A = crypto.randomUUID();
const B = crypto.randomUUID();
const I = crypto.randomUUID();
const K = crypto.randomUUID();
const T = crypto.randomUUID();
const otherTenant = crypto.randomUUID();
const holder = createDbHandle({ url: 'postgres://unused@127.0.0.1:1/unused' });
const execute = spyOn(PostgresJsPreparedQuery.prototype, 'execute');
const service = new EventConsumerService(holder.db);
const previous = { ...process.env };
beforeEach(() => {
  process.env.OMNI_PAIRED_AGENT_CONSUMERS = 'true';
  Reflect.deleteProperty(process.env, 'OMNI_MULTITENANCY_ENABLED');
});
afterEach(() => {
  execute.mockReset();
  for (const name of ['OMNI_PAIRED_AGENT_CONSUMERS', 'OMNI_MULTITENANCY_ENABLED']) {
    if (previous[name] === undefined) Reflect.deleteProperty(process.env, name);
    else process.env[name] = previous[name];
  }
});
afterAll(async () => {
  execute.mockRestore();
  await holder.close();
});
function row(agentId: string | null): DurableConsumer {
  return {
    id: crypto.randomUUID(),
    tenantId: T,
    agentId,
    name: 'owner-unit',
    eventType: 'custom.*',
    excludeTypes: null,
    filters: null,
    cursor: 0,
    shared: false,
    waitForReady: false,
    leaseState: null,
    accessFilter: 'all',
    scoped: false,
    instanceIds: null,
    ownerKeyId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
const cases: { name: string; caller?: ConsumerCaller; allowed: boolean; created: string | null | 'forbidden' }[] = [
  {
    name: 'owner wildcard',
    caller: { keyId: K, tenantId: T, instanceIds: null, principal: { kind: 'none' }, admin: true },
    allowed: true,
    created: null,
  },
  {
    name: 'device',
    caller: { keyId: K, tenantId: T, instanceIds: null, principal: { kind: 'none' }, admin: false },
    allowed: false,
    created: null,
  },
  {
    name: 'restricted wildcard',
    caller: { keyId: K, tenantId: T, instanceIds: [I], principal: { kind: 'none' }, admin: false },
    allowed: false,
    created: null,
  },
  {
    name: 'events unrestricted',
    caller: { keyId: K, tenantId: T, instanceIds: null, principal: { kind: 'none' }, admin: false },
    allowed: false,
    created: null,
  },
  {
    name: 'agent A',
    caller: { keyId: K, tenantId: T, instanceIds: [I], principal: { kind: 'agent', agentId: A } },
    allowed: true,
    created: A,
  },
  {
    name: 'agent B',
    caller: { keyId: K, tenantId: T, instanceIds: [I], principal: { kind: 'agent', agentId: B } },
    allowed: false,
    created: B,
  },
  {
    name: 'unresolved',
    caller: {
      keyId: K,
      tenantId: T,
      instanceIds: [I],
      principal: { kind: 'unresolved', reason: 'inactive_agent' },
      admin: true,
    },
    allowed: false,
    created: 'forbidden',
  },
  {
    name: 'widened forged admin',
    caller: {
      keyId: K,
      tenantId: T,
      instanceIds: null,
      principal: { kind: 'unresolved', reason: 'widened' },
      admin: true,
    },
    allowed: false,
    created: 'forbidden',
  },
  {
    name: 'other tenant admin',
    caller: { keyId: K, tenantId: otherTenant, instanceIds: null, principal: { kind: 'none' }, admin: true },
    allowed: false,
    created: null,
  },
  { name: 'internal no caller', allowed: true, created: null },
];
for (const entry of cases) {
  test(`${entry.name}: JS access, SQL access and create agree with the ownership contract`, async () => {
    expect(canAccessConsumer(row(A), entry.caller)).toBe(entry.allowed);
    const clause = consumerAccessClause(entry.caller);
    if (clause) {
      const query = new PgDialect().sqlToQuery(clause);
      if (entry.caller?.tenantId) expect(query.params).toContain(entry.caller.tenantId);
      if (entry.caller?.principal?.kind === 'agent') expect(query.params).toContain(entry.caller.principal.agentId);
      if (!entry.caller?.admin || entry.caller.principal?.kind === 'unresolved')
        expect(query.sql).toContain('"agent_id" is null');
      if (entry.caller?.principal?.kind === 'unresolved') {
        expect(query.sql).not.toContain('"agent_id" =');
        expect(query.params).not.toContain(A);
      }
    } else expect(entry.caller).toBeUndefined();
    if (entry.created === 'forbidden') {
      await expect(service.create({ name: 'test', eventType: 'custom.*', agentId: A }, entry.caller)).rejects.toThrow(
        /unresolved agent key cannot create consumers/i,
      );
      await expect(service.create({ name: 'test', eventType: 'custom.*' }, entry.caller)).rejects.toThrow(
        /unresolved agent key cannot create consumers/i,
      );
      expect(execute).not.toHaveBeenCalled();
      return;
    }
    const scoped = entry.caller?.instanceIds !== undefined && entry.caller.instanceIds !== null;
    if (scoped) execute.mockResolvedValueOnce([{ id: I }]);
    execute.mockResolvedValueOnce([{ head: 0 }]);
    const created = { ...row(entry.created), scoped, instanceIds: scoped ? [I] : null, ownerKeyId: scoped ? K : null };
    execute.mockResolvedValueOnce([created]);
    expect((await service.create({ name: 'test', eventType: 'custom.*' }, entry.caller)).agentId).toBe(entry.created);
  });
}
test('owner tier requires exactly wildcard scope and null instance restriction', () => {
  for (const scopes of [['*'], ['events:*'], ['instances:*', 'events:*']])
    for (const instanceIds of [null, [], [I]]) {
      expect(isAdminTierKey({ scopes, instanceIds })).toBe(scopes.includes('*') && instanceIds === null);
    }
});
test('flag-off explicit ownership names the flag and multitenancy refusal before any query', async () => {
  for (const tenancy of [false, true]) {
    if (tenancy) {
      process.env.OMNI_MULTITENANCY_ENABLED = 'true';
      process.env.OMNI_PAIRED_AGENT_CONSUMERS = 'true';
    } else Reflect.deleteProperty(process.env, 'OMNI_PAIRED_AGENT_CONSUMERS');
    await expect(service.create({ name: 'x', eventType: 'custom.*', agentId: A })).rejects.toThrow(
      tenancy ? /OMNI_MULTITENANCY_ENABLED/ : /OMNI_PAIRED_AGENT_CONSUMERS/,
    );
  }
  expect(execute).not.toHaveBeenCalled();
});
test('an explicit different agent is forbidden before database access', async () => {
  await expect(service.create({ name: 'x', eventType: 'custom.*', agentId: B }, cases[4]!.caller)).rejects.toThrow(
    /another agent/,
  );
  expect(execute).not.toHaveBeenCalled();
});

test('consumer-created event includes ownership only when set', async () => {
  const bus = createEventBus();
  const publish = spyOn(bus, 'publishGeneric').mockResolvedValue({ id: K, sequence: 1, stream: 'test' });
  try {
    for (const agentId of [A, null]) {
      execute.mockResolvedValueOnce([{ head: 0 }]).mockResolvedValueOnce([row(agentId)]);
      await new EventConsumerService(holder.db, bus).create(
        { name: 'test', eventType: 'custom.*', ...(agentId ? { agentId } : {}) },
        cases[0]!.caller,
      );
      const payload = publish.mock.calls.at(-1)?.[1];
      if (agentId) expect(payload).toHaveProperty('agentId', A);
      else expect(payload).not.toHaveProperty('agentId');
    }
  } finally {
    publish.mockRestore();
  }
});
