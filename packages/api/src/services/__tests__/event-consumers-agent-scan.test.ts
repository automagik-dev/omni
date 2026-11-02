/** Exercise the public delivery paths with real Drizzle compilation, without a database. */
import { afterAll, afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { type DurableConsumer, createDbHandle } from '@omni/db';
import { PgDialect } from 'drizzle-orm/pg-core';
import { PostgresJsPreparedQuery } from 'drizzle-orm/postgres-js/session';
import { type ConsumerCaller, EventConsumerService } from '../event-consumers';

const A = crypto.randomUUID();
const I = crypto.randomUUID();
const K = crypto.randomUUID();
const T = crypto.randomUUID();
const holder = createDbHandle({ url: 'postgres://unused@127.0.0.1:1/unused' });
const execute = spyOn(PostgresJsPreparedQuery.prototype, 'execute');
const compile = spyOn(PgDialect.prototype, 'sqlToQuery');
const service = new EventConsumerService(holder.db);
const previous = { ...process.env };
const caller: ConsumerCaller = { keyId: K, instanceIds: [I], principal: { kind: 'agent', agentId: A } };
function consumer(overrides: Partial<DurableConsumer> = {}): DurableConsumer {
  return {
    id: crypto.randomUUID(),
    name: 'agent-scan',
    agentId: A,
    tenantId: T,
    eventType: 'custom.*',
    excludeTypes: ['custom.secret.*'],
    filters: null,
    cursor: 0,
    shared: false,
    waitForReady: false,
    leaseState: null,
    accessFilter: 'all',
    scoped: true,
    instanceIds: [I],
    ownerKeyId: K,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}
function event(journalSeq: number) {
  return { id: `event-${journalSeq}`, journalSeq, journalReady: true, rawPayload: {}, accessDecision: 'allowed' };
}
function queries() {
  return compile.mock.results
    .flatMap((result) => (result.type === 'return' ? [result.value] : []))
    .filter((query) => query.sql.includes('from "omni_events"') && !query.sql.includes('max('));
}
/** Inspect each parenthesized branch while retaining its actual bound parameters. */
function branches() {
  return queries().flatMap((query) =>
    query.sql.split(' union all ').map((sql) => ({
      sql,
      params: [...sql.matchAll(/\$(\d+)/g)].map((match) => query.params[Number(match[1]) - 1]),
    })),
  );
}
beforeEach(() => {
  process.env.OMNI_PAIRED_AGENT_CONSUMERS = 'true';
  Reflect.deleteProperty(process.env, 'OMNI_MULTITENANCY_ENABLED');
  execute.mockReset();
  compile.mockClear();
});
afterEach(() => {
  for (const name of ['OMNI_PAIRED_AGENT_CONSUMERS', 'OMNI_MULTITENANCY_ENABLED']) {
    if (previous[name] === undefined) Reflect.deleteProperty(process.env, name);
    else process.env[name] = previous[name];
  }
});
afterAll(async () => {
  execute.mockRestore();
  compile.mockRestore();
  await holder.close();
});

test('ordered union deduplicates S/A overlap and never advances past an unread match', async () => {
  const row = consumer();
  execute
    .mockResolvedValueOnce([row])
    .mockResolvedValueOnce([event(2), event(8), event(11), event(1), event(4), event(9), event(1), event(3), event(10)])
    .mockResolvedValueOnce([{ head: 11 }]);
  const first = await service.pull(row.name, { limit: 3 }, caller);
  expect(first.items.map((item) => item.journalSeq)).toEqual([1, 2, 3]);
  expect(first.cursor).toBe(3);
  expect(first.hasMore).toBe(true);
  execute
    .mockResolvedValueOnce([{ ...row, cursor: first.cursor }])
    .mockResolvedValueOnce([event(8), event(11), event(4), event(9), event(10)])
    .mockResolvedValueOnce([{ head: 11 }]);
  const second = await service.pull(row.name, { limit: 3 }, caller);
  expect(second.items.map((item) => item.journalSeq)).toEqual([4, 8, 9]);
  expect(second.cursor).toBe(9);
  expect(queries()).toHaveLength(2);
  expect(branches()).toHaveLength(6);
  for (const query of branches()) {
    expect(query.sql).toContain('order by "omni_events"."journal_seq" asc limit');
    expect(query.sql).toContain('not "omni_events"."event_type" like');
    expect(query.params).toContain(T);
  }
});

test('caller extra and consumer instance scopes occur only on I; S/A correlate active kind and id', async () => {
  const row = consumer({ accessFilter: 'allowed', waitForReady: true });
  execute
    .mockResolvedValueOnce([row])
    .mockResolvedValueOnce([event(1)])
    .mockResolvedValueOnce([{ head: 1 }]);
  expect((await service.pull(row.name, {}, caller)).items).toHaveLength(1);
  expect(queries()).toHaveLength(1);
  const [i, s, a] = branches();
  if (!i || !s || !a) throw new Error('Expected three branches');
  expect(i.sql).toContain('"instance_id" is not null');
  expect(i.params.filter((value) => value === I)).toHaveLength(2);
  for (const grant of [s, a]) {
    expect(grant.sql).toContain('"instance_id" is null');
    expect(grant.sql).toContain('"revoked_at" is null');
    expect(grant.sql).toContain('"agent_source_grants"."agent_id" =');
    expect(grant.sql).toContain('"access_decision" =');
    expect(grant.params).toContain(A);
    expect(grant.params).not.toContain(I);
  }
  expect(s.sql).toContain('"source_kind" = "omni_events"."source_kind"');
  expect(s.sql).toContain('"source_id" = "omni_events"."source_id"');
  expect(a.sql).toContain('"source_kind" = \'agent\'');
  expect(a.sql).toContain('"source_id" = "omni_events"."agent_id"');
});

test('expired shared reclaim bounds every branch by the original lease range', async () => {
  const old = { id: crypto.randomUUID(), from: 3, to: 7, expiresAt: 0, keyId: K };
  const row = consumer({ shared: true, cursor: 3, leaseState: { claimed: 12, leases: [old] } });
  execute
    .mockResolvedValueOnce([row])
    .mockResolvedValueOnce([event(5), event(6)])
    .mockResolvedValueOnce([row])
    .mockResolvedValueOnce([{ head: 12 }]);
  const result = await service.pull(row.name, { limit: 2 }, caller);
  expect(result.items.map((item) => item.journalSeq)).toEqual([5, 6]);
  expect(result.cursor).toBe(7);
  expect(result.leaseId).toBeDefined();
  expect(queries()).toHaveLength(1);
  expect(branches()).toHaveLength(3);
  for (const query of branches()) {
    expect(query.sql).toContain('"journal_seq" >');
    expect(query.sql).toContain('"journal_seq" <=');
    expect(query.params).toContain(3);
    expect(query.params).toContain(7);
  }
});

for (const state of ['unset', 'multitenancy'] as const) {
  test(`${state}: an existing owned consumer scans I only`, async () => {
    if (state === 'unset') Reflect.deleteProperty(process.env, 'OMNI_PAIRED_AGENT_CONSUMERS');
    else process.env.OMNI_MULTITENANCY_ENABLED = 'true';
    const row = consumer();
    execute
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([event(2)])
      .mockResolvedValueOnce([{ head: 3 }]);
    expect((await service.pull(row.name, {}, caller)).items.map((item) => item.journalSeq)).toEqual([2]);
    expect(queries()).toHaveLength(1);
    expect(queries()[0]?.sql).not.toContain('agent_source_grants');
    expect(queries()[0]?.sql).toContain('"instance_id" is not null');
  });
}

test('withLag dispatches an empty instance page to granted rows when deciding caughtUp', async () => {
  const row = consumer();
  execute
    .mockResolvedValueOnce([row])
    .mockResolvedValueOnce([{ head: 8 }])
    .mockResolvedValueOnce([event(4)]);
  expect((await service.inspect(row.name, caller)).caughtUp).toBe(false);
  expect(queries()).toHaveLength(1);
});

test('scanForStream uses the same merged page and caller instance restriction', async () => {
  const row = consumer({ tenantId: null });
  execute.mockResolvedValueOnce([row]).mockResolvedValueOnce([event(8), event(3), event(3), event(5)]);
  const result = await service.scanForStream(row.name, 1, { tenantId: null, caller }, 2);
  expect(result.items.map((item) => item.journalSeq)).toEqual([3, 5]);
  expect(result.through).toBe(5);
  expect(result.full).toBe(true);
  expect(queries()).toHaveLength(1);
});

test('fresh shared leases use the dispatcher and cap the lease at the merged page boundary', async () => {
  const row = consumer({ shared: true, leaseState: { claimed: 0, leases: [] } });
  execute
    .mockResolvedValueOnce([row])
    .mockResolvedValueOnce([event(8), event(1), event(3)])
    .mockResolvedValueOnce([row])
    .mockResolvedValueOnce([{ head: 8 }]);
  const result = await service.pull(row.name, { limit: 2 }, caller);
  expect(result.items.map((item) => item.journalSeq)).toEqual([1, 3]);
  expect(result.cursor).toBe(3);
  expect(result.leaseId).toBeDefined();
});

test('legacy consumer keeps its single scan without grant predicates', async () => {
  const row = consumer({ agentId: null });
  execute
    .mockResolvedValueOnce([row])
    .mockResolvedValueOnce([event(1)])
    .mockResolvedValueOnce([{ head: 1 }]);
  expect((await service.pull(row.name, {}, caller)).items).toHaveLength(1);
  expect(queries()).toHaveLength(1);
  expect(queries()[0]?.sql).not.toContain('agent_source_grants');
  expect(queries()[0]?.sql).not.toContain('"instance_id" is not null');
});

test('single snapshot cannot skip an instance commit before a later granted-source commit', async () => {
  let cursor = 0;
  let committed = false;
  const row = consumer();
  // Deterministic READ COMMITTED schedule: the first I snapshot sees neither row;
  // I(seq 10) then S(seq 11) commit in order before any subsequent statement.
  // One UNION statement must retain that first snapshot for all three branches.
  execute.mockImplementation(async () => {
    const compiled = compile.mock.results.at(-1);
    if (compiled?.type !== 'return') throw new Error('Expected a compiled statement');
    const query = compiled.value.sql;
    if (query.includes('from "durable_consumers"')) return [{ ...row, cursor }];
    if (query.includes('max(')) return [{ head: 11 }];
    if (!query.includes('from "omni_events"')) throw new Error(`Unexpected statement ${query}`);
    const visible = committed;
    committed = true;
    if (query.includes('union all')) return visible ? [event(10), event(11)] : [];
    if (query.includes('"instance_id" is not null')) return visible ? [event(10)] : [];
    if (query.includes('"source_kind" = "omni_events"."source_kind"')) return [event(11)];
    return [];
  });
  const first = await service.pull(row.name, { limit: 2 }, caller);
  expect(first.items).toEqual([]);
  expect(first.cursor).toBe(0);
  cursor = first.cursor;
  const second = await service.pull(row.name, { limit: 2 }, caller);
  expect(second.items.map((item) => item.journalSeq)).toEqual([10, 11]);
  expect(second.cursor).toBe(11);
  expect(queries()).toHaveLength(2);
  for (const query of queries()) expect(query.sql.match(/union all/g)).toHaveLength(2);
});
