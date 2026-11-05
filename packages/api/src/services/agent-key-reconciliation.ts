/**
 * Upgrade repair for default bindings and routes created before key provisioning.
 * Called only during startup, before the dispatcher starts. Bindings are the
 * source of authority; widened credentials are revoked before narrow replacement.
 */
import { createLogger } from '@omni/core';
import { type ApiKey, type Database, type DbEnforcementMode, agentRoutes, agents, instances, tenants } from '@omni/db';
import { sql } from 'drizzle-orm';
import { agentKeyNameCandidates } from '../lib/agent-key-name';
import { type AgentKeyOwner, agentKeyBelongsToBinding } from '../lib/agent-key-ownership';
import { scopedHandle } from '../tenancy/tenant-scope';
import { runInWorkerTenantScope } from '../tenancy/worker-tenant-context';
import { bindingKeys, grantBindingKey, graphKeyNames, readAgentKeyGraph, staleBindingKeys } from './agent-key-bindings';
import { ApiKeyService } from './api-keys';

const log = createLogger('agent-key-reconciliation');
async function bindingState(db: Database) {
  const graph = await readAgentKeyGraph(db);
  const names = graphKeyNames(graph);
  const active = names.length ? await new ApiKeyService(db).findAgentKeysByNames(names) : [];
  return { graph, active };
}

async function prepareScope(db: Database): Promise<boolean> {
  const { graph, active } = await bindingState(db);
  if (staleBindingKeys(graph, active).length > 0) {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('omni:agent-key-reconciliation'))`);
      const state = await bindingState(tx as unknown as Database);
      const keys = new ApiKeyService(tx as unknown as Database);
      for (const key of staleBindingKeys(state.graph, state.active)) {
        await keys.revoke(key.id, 'Upgrade: agent key contains grants without a live binding', 'system:auto-provision');
      }
    });
    return true;
  }
  return graph.bindings.some(
    (binding) => !bindingKeys(graph, active, binding).some((key) => key.instanceIds?.includes(binding.instanceId)),
  );
}

async function reconcileScope(db: Database): Promise<string[]> {
  return db.transaction(async (tx) => {
    // Concurrent boots must not both provision the same missing system key.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('omni:agent-key-reconciliation'))`);
    // Keep the active-agent ownership snapshot valid until all grants commit.
    await tx.select({ id: agents.id }).from(agents).for('share');
    await tx.select({ id: instances.id }).from(instances).for('share');
    await tx.select({ id: agentRoutes.id }).from(agentRoutes).for('share');
    const state = await bindingState(tx as unknown as Database);
    const keys = new ApiKeyService(tx as unknown as Database);
    for (const binding of state.graph.bindings) await grantBindingKey(keys, state.graph, state.active, binding);
    return state.graph.bindings.flatMap((binding) => agentKeyNameCandidates(binding.name, binding.tenantId));
  });
}

/** Keys have no tenant column. Retire widened credentials once, before any
 * tenant-scoped replacement, so provisioning failures cannot undo revocation.
 */
async function revokeWidenedKeys(db: Database): Promise<ApiKey[]> {
  const widened = await new ApiKeyService(db).findWidenedAgentKeys();
  return widened.length === 0
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
  const revoked = await revokeWidenedKeys(db);
  const repairedNames = new Set<string>();
  if (enforcementMode !== 'enforced') {
    if ((await prepareScope(db)) || revoked.length > 0) {
      for (const name of await reconcileScope(db)) repairedNames.add(name);
    }
  } else {
    const owners = await authPlaneDb.select({ id: tenants.id }).from(tenants);
    for (const owner of owners) {
      // Separate tenant scopes COMMIT stale-key revocation before replacement.
      // A savepoint inside one worker scope would roll both back on failure.
      const needsRepair = await runInWorkerTenantScope(db, owner.id, () => prepareScope(scopedHandle(db)));
      if (!needsRepair && revoked.length === 0) continue;
      const names = await runInWorkerTenantScope(db, owner.id, () => reconcileScope(scopedHandle(db)));
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
  const graph = await readAgentKeyGraph(db);
  const rows: CoverageRow[] = graph.agents
    .filter((agent) => agent.isActive)
    .flatMap<CoverageRow>((agent) => {
      const bound = graph.bindings.filter((binding) => binding.agentId === agent.agentId);
      const base = { id: agent.agentId, name: agent.name, tenantId: agent.tenantId };
      return bound.length
        ? bound.map((binding) => ({ ...base, instanceId: binding.instanceId, instanceTenantId: binding.tenantId }))
        : [{ ...base, instanceId: null, instanceTenantId: null }];
    });
  const names = graphKeyNames(graph);
  if (names.length === 0) return [];
  const byName = new Map<string, ApiKey[]>();
  for (const key of await new ApiKeyService(db).findAgentKeysByNames(names)) {
    byName.set(key.name, [...(byName.get(key.name) ?? []), key]);
  }
  const owners = graph.owners;
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
