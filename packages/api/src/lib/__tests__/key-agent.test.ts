import { afterAll, afterEach, expect, spyOn, test } from 'bun:test';
import { createDbHandle } from '@omni/db';
import { PostgresJsPreparedQuery } from 'drizzle-orm/postgres-js/session';
import { requestProducerColumns, resolveKeyAgent } from '../key-agent';
import { currentProducingKeyId, runWithProducingKey } from '../producer-scope';

// The prepared-query seam returns fixtures before postgres.js opens any connection.
const handle = createDbHandle({ url: 'postgres://unused@127.0.0.1:1/unused' });
const execute = spyOn(PostgresJsPreparedQuery.prototype, 'execute');
afterEach(() => execute.mockReset());
afterAll(async () => {
  execute.mockRestore();
  await handle.close();
});
const keyId = crypto.randomUUID();
const agentId = crypto.randomUUID();
const instanceId = crypto.randomUUID();
const tenantId = crypto.randomUUID();
const key = { name: 'agent:proof', createdBy: 'system:auto-provision', status: 'active', instanceIds: [instanceId] };
const instance = { id: instanceId, agentId, tenantId };
const agent = { id: agentId, name: 'proof', isActive: true, tenantId };

test('ordinary and hand-made agent keys stop after exactly one primary-key read', async () => {
  for (const row of [
    { ...key, name: 'device' },
    { ...key, createdBy: 'human' },
  ]) {
    execute.mockReset().mockResolvedValueOnce([row]);
    expect(await resolveKeyAgent(handle.db, keyId)).toEqual({ kind: 'none' });
    expect(execute).toHaveBeenCalledTimes(1);
  }
});

test('no key performs no query', async () => {
  expect(await resolveKeyAgent(handle.db, null)).toEqual({ kind: 'none' });
  expect(execute).not.toHaveBeenCalled();
});

test('revoked and widened system keys remain unresolved', async () => {
  execute.mockResolvedValueOnce([{ ...key, status: 'revoked' }]);
  expect(await resolveKeyAgent(handle.db, keyId)).toEqual({ kind: 'unresolved', reason: 'revoked' });
  for (const instanceIds of [null, []]) {
    execute.mockResolvedValueOnce([{ ...key, instanceIds }]);
    expect(await resolveKeyAgent(handle.db, keyId)).toEqual({ kind: 'unresolved', reason: 'widened' });
  }
});

test('missing or unbound instances cannot prove ownership', async () => {
  for (const rows of [[], [{ ...instance, agentId: null }]]) {
    execute.mockResolvedValueOnce([key]).mockResolvedValueOnce(rows);
    expect(await resolveKeyAgent(handle.db, keyId)).toEqual({ kind: 'unresolved', reason: 'no_binding' });
  }
});

test('every listed instance must bind one common agent and tenant', async () => {
  const otherId = crypto.randomUUID();
  for (const other of [
    { ...instance, id: otherId, agentId: crypto.randomUUID() },
    { ...instance, id: otherId, tenantId: crypto.randomUUID() },
  ]) {
    execute.mockResolvedValueOnce([{ ...key, instanceIds: [instanceId, otherId] }]);
    execute.mockResolvedValueOnce([instance, other]);
    expect(await resolveKeyAgent(handle.db, keyId)).toEqual({ kind: 'unresolved', reason: 'mixed_binding' });
  }
});

test('inactive agents and tenant-mismatched names stay unresolved', async () => {
  execute
    .mockResolvedValueOnce([key])
    .mockResolvedValueOnce([instance])
    .mockResolvedValueOnce([{ ...agent, isActive: false }]);
  expect(await resolveKeyAgent(handle.db, keyId)).toEqual({ kind: 'unresolved', reason: 'inactive_agent' });
  execute.mockResolvedValueOnce([{ ...key, name: `agent:${crypto.randomUUID()}:proof` }]);
  execute.mockResolvedValueOnce([instance]).mockResolvedValueOnce([agent]);
  expect(await resolveKeyAgent(handle.db, keyId)).toEqual({ kind: 'unresolved', reason: 'name_mismatch' });
});

test('both narrow system key name shapes prove an active agent', async () => {
  for (const name of ['agent:proof', `agent:${tenantId}:proof`]) {
    execute
      .mockResolvedValueOnce([{ ...key, name }])
      .mockResolvedValueOnce([instance])
      .mockResolvedValueOnce([agent]);
    expect(await resolveKeyAgent(handle.db, keyId)).toEqual({ kind: 'agent', agentId });
  }
});

test('a tenant-mismatched agent cannot acquire provenance through a bare key name', async () => {
  execute.mockResolvedValueOnce([key]).mockResolvedValueOnce([instance]);
  execute.mockResolvedValueOnce([{ ...agent, tenantId: crypto.randomUUID() }]);
  expect(await resolveKeyAgent(handle.db, keyId)).toEqual({ kind: 'unresolved', reason: 'name_mismatch' });
});

test('a bare name cannot bridge different tenants even when agent ids match', async () => {
  const otherId = crypto.randomUUID();
  execute.mockResolvedValueOnce([{ ...key, instanceIds: [instanceId, otherId] }]);
  execute.mockResolvedValueOnce([instance, { ...instance, id: otherId, tenantId: crypto.randomUUID() }]);
  expect(await resolveKeyAgent(handle.db, keyId)).toEqual({ kind: 'unresolved', reason: 'mixed_binding' });
});

test('producer scopes isolate concurrent requests and restore after exceptions', async () => {
  let resume = () => {};
  const barrier = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const a = runWithProducingKey('a', async () => {
    await barrier;
    expect(currentProducingKeyId()).toBe('a');
  });
  await runWithProducingKey('b', async () => {
    expect(currentProducingKeyId()).toBe('b');
    resume();
    await a;
    expect(currentProducingKeyId()).toBe('b');
  });
  await expect(
    runWithProducingKey('c', async () => {
      throw new Error('proof');
    }),
  ).rejects.toThrow('proof');
  expect(currentProducingKeyId()).toBeNull();
});

test('one request memoizes concurrent agent resolution; another request always rechecks', async () => {
  for (let request = 0; request < 2; request++) {
    execute.mockResolvedValueOnce([key]).mockResolvedValueOnce([instance]).mockResolvedValueOnce([agent]);
    await runWithProducingKey(keyId, async () => {
      const resolutions = await Promise.all([resolveKeyAgent(handle.db, keyId), resolveKeyAgent(handle.db, keyId)]);
      expect(resolutions).toEqual([
        { kind: 'agent', agentId },
        { kind: 'agent', agentId },
      ]);
      expect(await resolveKeyAgent(handle.db, keyId)).toEqual({ kind: 'agent', agentId });
    });
    expect(execute).toHaveBeenCalledTimes((request + 1) * 3);
  }
});

test('a direct claim whose principal read outlives the request loses its producer', async () => {
  const previous = process.env.OMNI_PAIRED_AGENT_CONSUMERS;
  const tenancy = process.env.OMNI_MULTITENANCY_ENABLED;
  process.env.OMNI_PAIRED_AGENT_CONSUMERS = 'true';
  Reflect.deleteProperty(process.env, 'OMNI_MULTITENANCY_ENABLED');
  let release: (rows: unknown[]) => void = () => {};
  const read = new Promise<unknown[]>((resolve) => {
    release = resolve;
  });
  execute.mockImplementationOnce(() => read);
  let claim: ReturnType<typeof requestProducerColumns> | undefined;
  try {
    await runWithProducingKey(keyId, async () => {
      claim = requestProducerColumns(handle.db);
    });
    release([{ ...key, createdBy: 'human' }]);
    expect(await claim).toEqual({ producingKeyId: null, agentId: null });
  } finally {
    if (previous === undefined) Reflect.deleteProperty(process.env, 'OMNI_PAIRED_AGENT_CONSUMERS');
    else process.env.OMNI_PAIRED_AGENT_CONSUMERS = previous;
    if (tenancy === undefined) Reflect.deleteProperty(process.env, 'OMNI_MULTITENANCY_ENABLED');
    else process.env.OMNI_MULTITENANCY_ENABLED = tenancy;
  }
});
