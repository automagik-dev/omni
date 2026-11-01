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

function belongsToBinding(key: ApiKey, binding: Binding, owners: Map<string, Binding>): boolean {
  if (key.instanceIds === null) return false;
  if (binding.tenantId && key.name === agentKeyName(binding.name, binding.tenantId)) return true;
  // Bare names have no tenant namespace. Every existing grant must establish
  // this same agent and tenant before any instance is added. Empty grants
  // cannot establish an owner either.
  return (
    key.instanceIds.length > 0 &&
    key.instanceIds.every((id) => {
      const owner = owners.get(id);
      return owner?.agentId === binding.agentId && owner.tenantId === binding.tenantId;
    })
  );
}

async function reconcileBinding(keys: ApiKeyService, binding: Binding, owners: Map<string, Binding>): Promise<void> {
  const candidates = await keys.findAgentKeysByNames(agentKeyNameCandidates(binding.name, binding.tenantId));
  const scoped = candidates.filter((key) => belongsToBinding(key, binding, owners));
  if (scoped.length === 0) {
    await keys.create({
      name: agentKeyName(binding.name, binding.tenantId),
      description: `Auto-provisioned scoped key for agent ${binding.name}`,
      scopes: Array.isArray(binding.metadata?.omniScopes)
        ? (binding.metadata.omniScopes as string[])
        : [...DEFAULT_TURN_SCOPES],
      instanceIds: [binding.instanceId],
      createdBy: 'system:auto-provision',
    });
    return;
  }
  for (const key of scoped) {
    if (key.instanceIds && !key.instanceIds.includes(binding.instanceId)) {
      await keys.update(key.id, { instanceIds: [...key.instanceIds, binding.instanceId] });
    }
  }
}

async function reconcileScope(db: Database): Promise<string[]> {
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
    const owners = new Map(bindings.map((binding) => [binding.instanceId, binding]));
    for (const binding of bindings) await reconcileBinding(keys, binding, owners);
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
  const revoked = await db.transaction(async (tx) => {
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
    for (const name of await reconcileScope(db)) repairedNames.add(name);
  } else {
    const owners = await authPlaneDb.select({ id: tenants.id }).from(tenants);
    for (const owner of owners) {
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
