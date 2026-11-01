/**
 * Upgrade repair for instances bound before POST provisioned agent keys.
 * Called only during startup, before the dispatcher starts. Bindings are the
 * source of authority; widened credentials are revoked before narrow replacement.
 */
import { createLogger } from '@omni/core';
import { type Agent, type ApiKey, type Database, type DbEnforcementMode, agents, instances, tenants } from '@omni/db';
import { eq, sql } from 'drizzle-orm';
import { DEFAULT_TURN_SCOPES } from '../constants/scopes';
import { agentKeyName, agentKeyNameCandidates } from '../lib/agent-key-name';
import { type AgentKeyOwner, agentKeyBelongsToBinding } from '../lib/agent-key-ownership';
import { scopedHandle } from '../tenancy/tenant-scope';
import { runInWorkerTenantScope } from '../tenancy/worker-tenant-context';
import { ApiKeyService } from './api-keys';

const log = createLogger('agent-key-reconciliation');
type Binding = {
  instanceId: string;
  agentId: string;
  tenantId: string | null;
  name: string;
  metadata: Agent['metadata'];
};

async function reconcileBinding(
  keys: ApiKeyService,
  binding: Binding,
  owners: Map<string, Binding>,
  byName: Map<string, ApiKey[]>,
): Promise<void> {
  const candidates = agentKeyNameCandidates(binding.name, binding.tenantId).flatMap((name) => byName.get(name) ?? []);
  const scoped = candidates.filter((key) => agentKeyBelongsToBinding(key, binding, owners));
  if (scoped.length === 0) {
    const { key } = await keys.create({
      name: agentKeyName(binding.name, binding.tenantId),
      description: `Auto-provisioned scoped key for agent ${binding.name}`,
      scopes: Array.isArray(binding.metadata?.omniScopes)
        ? (binding.metadata.omniScopes as string[])
        : [...DEFAULT_TURN_SCOPES],
      instanceIds: [binding.instanceId],
      createdBy: 'system:auto-provision',
    });
    byName.set(key.name, [...(byName.get(key.name) ?? []), key]);
    return;
  }
  for (const key of scoped) {
    if (key.instanceIds && !key.instanceIds.includes(binding.instanceId)) {
      const instanceIds = [...key.instanceIds, binding.instanceId];
      await keys.update(key.id, { instanceIds });
      key.instanceIds = instanceIds;
    }
  }
}

/** Read-only coverage probe: healthy boots take no advisory or instance row locks.
 * The bare-name arm mirrors agentKeyBelongsToBinding, including missing grants.
 */
async function needsBindingRepair(db: Database): Promise<boolean> {
  const missing = await db
    .select({ id: instances.id })
    .from(instances)
    .innerJoin(agents, eq(instances.agentId, agents.id))
    .where(sql`NOT EXISTS (
      SELECT 1 FROM api_keys k
      WHERE k.status = 'active' AND k.created_by = 'system:auto-provision'
        AND ${instances.id} = ANY(k.instance_ids)
        AND (
          (${instances.tenantId} IS NOT NULL
            AND k.name = 'agent:' || ${instances.tenantId}::text || ':' || ${agents.name})
          OR (k.name = 'agent:' || ${agents.name} AND NOT EXISTS (
            SELECT 1 FROM unnest(k.instance_ids) AS grant_id(id)
            LEFT JOIN instances AS owner ON owner.id = grant_id.id
            WHERE owner.agent_id IS DISTINCT FROM ${instances.agentId}
              OR owner.tenant_id IS DISTINCT FROM ${instances.tenantId}
          ))
        )
    )`)
    .limit(1);
  return missing.length > 0;
}

async function reconcileScope(db: Database, collectNames: boolean): Promise<string[]> {
  if (!(await needsBindingRepair(db)) && !collectNames) return [];
  return db.transaction(async (tx) => {
    // Concurrent boots must not both provision the same missing system key.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('omni:agent-key-reconciliation'))`);
    const keys = new ApiKeyService(tx as unknown as Database);
    const bindings = await tx
      .select({
        instanceId: instances.id,
        agentId: agents.id,
        tenantId: instances.tenantId,
        name: agents.name,
        metadata: agents.metadata,
      })
      .from(instances)
      .innerJoin(agents, eq(instances.agentId, agents.id))
      // Keep these bindings stable until their key grants have been repaired.
      .for('share', { of: instances });
    const names = [...new Set(bindings.flatMap((binding) => agentKeyNameCandidates(binding.name, binding.tenantId)))];
    if (names.length === 0) return [];
    const byName = new Map<string, ApiKey[]>();
    for (const key of await keys.findAgentKeysByNames(names)) {
      byName.set(key.name, [...(byName.get(key.name) ?? []), key]);
    }
    const owners = new Map(bindings.map((binding) => [binding.instanceId, binding]));
    for (const binding of bindings) await reconcileBinding(keys, binding, owners, byName);
    return bindings.flatMap((binding) => agentKeyNameCandidates(binding.name, binding.tenantId));
  });
}

/**
 * Legacy databases can read all bindings. Enforced databases require a tenant
 * on every row: each persisted tenant is read through its own runtime scope.
 * The runtime revokes legacy global keys; the auth plane enumerates tenant IDs
 * only and never reads business rows.
 */
export async function reconcileAgentKeys(
  db: Database,
  authPlaneDb: Database,
  enforcementMode: DbEnforcementMode,
): Promise<void> {
  // Keys have no tenant column. Revoke unsafe global credentials once, including
  // route-only agents, before rebuilding grants from tenant-scoped bindings.
  const widened = await new ApiKeyService(db).findWidenedAgentKeys();
  const revoked =
    widened.length === 0
      ? []
      : await db.transaction(async (tx) => {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('omni:agent-key-reconciliation'))`);
          const keys = new ApiKeyService(tx as unknown as Database);
          const widened = await keys.findWidenedAgentKeys();
          for (const key of widened) {
            await keys.revoke(
              key.id,
              'Upgrade: replace widened agent key with explicit instance grants',
              'system:auto-provision',
            );
          }
          return widened;
        });
  const repairedNames = new Set<string>();
  if (enforcementMode !== 'enforced') {
    for (const name of await reconcileScope(db, revoked.length > 0)) repairedNames.add(name);
  } else {
    const owners = await authPlaneDb.select({ id: tenants.id }).from(tenants);
    for (const owner of owners) {
      const names = await runInWorkerTenantScope(db, owner.id, () =>
        reconcileScope(scopedHandle(db), revoked.length > 0),
      );
      for (const name of names) repairedNames.add(name);
    }
  }
  for (const key of revoked) {
    if (!repairedNames.has(key.name)) {
      log.warn('Revoked widened agent key has no bound instance; bind the agent to an instance to restore dispatch', {
        agent: key.name.slice('agent:'.length),
        keyId: key.id,
      });
    }
  }
}

/** Failure-only diagnostic: never runs on healthy boots or from public health probes. */
export type AgentWithoutKey = { id: string; name: string };

type CoverageRow = {
  id: string;
  name: string;
  tenantId: string | null;
  instanceId: string | null;
  instanceTenantId: string | null;
};

function hasDispatchKey(row: CoverageRow, byName: Map<string, ApiKey[]>, owners: Map<string, AgentKeyOwner>): boolean {
  const tenantId = row.instanceId ? row.instanceTenantId : row.tenantId;
  const names = agentKeyNameCandidates(row.name, tenantId);
  if (row.instanceId && !tenantId) {
    // Match the legacy dispatcher's newest-key lookup, including its universal
    // rejection of NULL/empty grants, without adding a membership requirement.
    return Boolean(byName.get(names[0] ?? '')?.[0]?.instanceIds?.length);
  }
  const keys = names.flatMap((name) => byName.get(name) ?? []);
  const instanceId = row.instanceId;
  if (instanceId) return keys.some((key) => key.instanceIds?.includes(instanceId));
  // Route-only agents count too; a foreign tenant's bare key is not coverage.
  return keys.some(
    (key) =>
      Boolean(key.instanceIds?.length) &&
      agentKeyBelongsToBinding(key, { agentId: row.id, tenantId, name: row.name }, owners),
  );
}

async function agentsWithoutKeysInScope(db: Database): Promise<AgentWithoutKey[]> {
  const rows = await db
    .select({
      id: agents.id,
      name: agents.name,
      tenantId: agents.tenantId,
      instanceId: instances.id,
      instanceTenantId: instances.tenantId,
    })
    .from(agents)
    .leftJoin(instances, eq(instances.agentId, agents.id));
  const names = [
    ...new Set(
      rows.flatMap((row) => agentKeyNameCandidates(row.name, row.instanceId ? row.instanceTenantId : row.tenantId)),
    ),
  ];
  if (names.length === 0) return [];
  const byName = new Map<string, ApiKey[]>();
  for (const key of await new ApiKeyService(db).findAgentKeysByNames(names)) {
    byName.set(key.name, [...(byName.get(key.name) ?? []), key]);
  }
  const owners = new Map<string, AgentKeyOwner>();
  for (const row of rows) {
    if (row.instanceId)
      owners.set(row.instanceId, {
        agentId: row.id,
        tenantId: row.instanceTenantId,
      });
  }
  const missing = new Map<string, AgentWithoutKey>();
  for (const row of rows) {
    if (!hasDispatchKey(row, byName, owners)) missing.set(row.id, { id: row.id, name: row.name });
  }
  return [...missing.values()];
}

export async function findAgentsWithoutKeys(
  db: Database,
  authPlaneDb: Database,
  enforcementMode: DbEnforcementMode,
): Promise<AgentWithoutKey[]> {
  if (enforcementMode !== 'enforced') return agentsWithoutKeysInScope(db);
  const missing = new Map<string, AgentWithoutKey>();
  for (const tenant of await authPlaneDb.select({ id: tenants.id }).from(tenants)) {
    const rows = await runInWorkerTenantScope(db, tenant.id, () => agentsWithoutKeysInScope(scopedHandle(db)));
    for (const row of rows) missing.set(row.id, row);
  }
  return [...missing.values()];
}
