/** Authoritative default/route bindings shared by live writes and startup repair. */
import type { EventBus } from '@omni/core';
import { type Agent, type ApiKey, type Database, agentRoutes, agents, instances } from '@omni/db';
import { DEFAULT_TURN_SCOPES } from '../constants/scopes';
import { agentKeyName, agentKeyNameCandidates } from '../lib/agent-key-name';
import {
  type AgentKeyBinding,
  type AgentKeyOwner,
  agentKeyBelongsToBinding,
  agentKeyGrantsMatch,
} from '../lib/agent-key-ownership';
import { scopedHandle } from '../tenancy/tenant-scope';
import { ApiKeyService } from './api-keys';

export type AgentInstanceBinding = AgentKeyBinding & { instanceId: string; metadata: Agent['metadata'] };
export type AgentKeyGraph = {
  agents: (AgentKeyBinding & { isActive: boolean })[];
  bindings: AgentInstanceBinding[];
  owners: Map<string, AgentKeyOwner>;
};

/** Tenant scopes constrain all three reads. Even without RLS a route/default
 * FK is authority only when the agent and instance have the same stored tenant.
 * Inactive routes still name their active agent until removed. Inactive agents
 * retain their identity for key retirement but contribute no binding grants.
 */
export async function readAgentKeyGraph(pool: Database): Promise<AgentKeyGraph> {
  const db = scopedHandle(pool);
  const [agentRows, instanceRows, routeRows] = await Promise.all([
    db
      .select({
        id: agents.id,
        name: agents.name,
        tenantId: agents.tenantId,
        metadata: agents.metadata,
        isActive: agents.isActive,
      })
      .from(agents),
    db.select({ id: instances.id, agentId: instances.agentId, tenantId: instances.tenantId }).from(instances),
    db.select({ instanceId: agentRoutes.instanceId, agentId: agentRoutes.agentId }).from(agentRoutes),
  ]);
  const byId = new Map(agentRows.map((agent) => [agent.id, agent]));
  const routesByInstance = new Map<string, string[]>();
  for (const route of routeRows) {
    if (route.agentId)
      routesByInstance.set(route.instanceId, [...(routesByInstance.get(route.instanceId) ?? []), route.agentId]);
  }
  const owners = new Map<string, AgentKeyOwner>();
  const bindings = new Map<string, AgentInstanceBinding>();
  for (const instance of instanceRows) {
    const routed = routesByInstance.get(instance.id) ?? [];
    const agentIds = new Set([instance.agentId, ...routed]);
    const valid = [...agentIds].flatMap((id) => {
      const agent = id ? byId.get(id) : undefined;
      if (!agent || !agent.isActive || agent.tenantId !== instance.tenantId) return [];
      bindings.set(`${instance.id}:${agent.id}`, {
        instanceId: instance.id,
        agentId: agent.id,
        tenantId: instance.tenantId,
        name: agent.name,
        metadata: agent.metadata,
      });
      return [agent.id];
    });
    owners.set(instance.id, {
      agentId: valid.includes(instance.agentId ?? '') ? instance.agentId : null,
      tenantId: instance.tenantId,
      routedAgentIds: valid,
    });
  }
  return {
    agents: agentRows.map((agent) => ({
      agentId: agent.id,
      name: agent.name,
      tenantId: agent.tenantId,
      isActive: agent.isActive,
    })),
    bindings: [...bindings.values()],
    owners,
  };
}

export function graphKeyNames(graph: AgentKeyGraph): string[] {
  return [...new Set(graph.agents.flatMap((agent) => agentKeyNameCandidates(agent.name, agent.tenantId)))];
}

export function bindingKeys(graph: AgentKeyGraph, keys: ApiKey[], binding: AgentKeyBinding): ApiKey[] {
  const names = agentKeyNameCandidates(binding.name, binding.tenantId);
  return keys.filter(
    (key) =>
      names.includes(key.name) &&
      agentKeyBelongsToBinding(key, binding, graph.owners) &&
      agentKeyGrantsMatch(key, binding, graph.owners),
  );
}

/** Qualified names prove which tenant may retire a stale key. A bare name
 * needs at least one visible grant in the matching tenant; another tenant's
 * invisible bare credential is never ours to modify. Any complete valid owner
 * wins over a same-name agent, so duplicate names cannot revoke a healthy key.
 */
export function staleBindingKeys(graph: AgentKeyGraph, keys: ApiKey[]): ApiKey[] {
  return keys.filter((key) => {
    const candidates = graph.agents.filter((agent) =>
      agentKeyNameCandidates(agent.name, agent.tenantId).includes(key.name),
    );
    if (candidates.some((agent) => agent.isActive && bindingKeys(graph, [key], agent).length > 0)) return false;
    return candidates.some(
      (agent) =>
        (agent.tenantId !== null && key.name === agentKeyName(agent.name, agent.tenantId)) ||
        key.instanceIds?.some((id) => graph.owners.get(id)?.tenantId === agent.tenantId),
    );
  });
}

export async function grantBindingKey(
  keys: ApiKeyService,
  graph: AgentKeyGraph,
  active: ApiKey[],
  binding: AgentInstanceBinding,
): Promise<void> {
  const existing = bindingKeys(graph, active, binding);
  if (existing.length === 0) {
    const { key } = await keys.create({
      name: agentKeyName(binding.name, binding.tenantId),
      description: `Auto-provisioned scoped key for agent ${binding.name}`,
      scopes: Array.isArray(binding.metadata?.omniScopes)
        ? (binding.metadata.omniScopes as string[])
        : [...DEFAULT_TURN_SCOPES],
      instanceIds: [binding.instanceId],
      createdBy: 'system:auto-provision',
    });
    active.push(key);
    return;
  }
  for (const key of existing) {
    if (!key.instanceIds?.includes(binding.instanceId)) {
      const instanceIds = [...(key.instanceIds ?? []), binding.instanceId];
      await keys.update(key.id, { instanceIds });
      key.instanceIds = instanceIds;
    }
  }
}

/** Called after the route mutation: keep an instance grant while either its
 * default or any remaining route names this agent, otherwise narrow/revoke.
 */
export async function syncRouteAgentKeys(
  pool: Database,
  instanceId: string,
  agentIds: string[],
  eventBus: EventBus | null = null,
): Promise<void> {
  const ids = [...new Set(agentIds)].sort();
  if (ids.length === 0) return;
  await new ApiKeyService(scopedHandle(pool), { eventBus }).withAgentKeyLock(ids, async (keys, db) => {
    for (const agentId of ids) await syncLockedAgentKey(keys, db, instanceId, agentId);
  });
}

export async function syncLockedAgentKey(
  keys: ApiKeyService,
  db: Database,
  instanceId: string,
  agentId: string,
): Promise<void> {
  const graph = await readAgentKeyGraph(db);
  const agent = graph.agents.find((row) => row.agentId === agentId);
  const owner = graph.owners.get(instanceId);
  if (!agent || !owner || agent.tenantId !== owner.tenantId) return;
  const active = await keys.findAgentKeysByNames(agentKeyNameCandidates(agent.name, agent.tenantId));
  if (!agent.isActive) {
    for (const key of staleBindingKeys(graph, active))
      await keys.revoke(key.id, 'Agent is inactive', 'system:auto-provision');
    return;
  }
  const binding = graph.bindings.find((row) => row.instanceId === instanceId && row.agentId === agentId);
  if (binding) {
    const stale = staleBindingKeys(graph, active);
    for (const key of stale)
      await keys.revoke(key.id, 'Agent key contains grants without a live binding', 'system:auto-provision');
    const usable = active.filter((key) => !stale.includes(key));
    // Replacing a mixed credential must also restore its other live bindings,
    // not silence those instances until the next startup repair.
    const bindings = stale.length > 0 ? graph.bindings.filter((row) => row.agentId === agentId) : [binding];
    for (const current of bindings) await grantBindingKey(keys, graph, usable, current);
    return;
  }
  for (const key of active) {
    if (!key.instanceIds?.includes(instanceId)) continue;
    const remaining = key.instanceIds.filter((id) => id !== instanceId);
    if (remaining.length === 0)
      await keys.revoke(key.id, 'Agent has no assigned instances or routes', 'system:auto-provision');
    else await keys.update(key.id, { instanceIds: remaining });
  }
}

/** Restore an active agent's current bindings under the caller's per-agent lock. */
export async function restoreActiveAgentKeys(keys: ApiKeyService, db: Database, agentId: string): Promise<void> {
  const graph = await readAgentKeyGraph(db);
  const agent = graph.agents.find((row) => row.agentId === agentId);
  if (!agent?.isActive) return;
  const active = await keys.findAgentKeysByNames(agentKeyNameCandidates(agent.name, agent.tenantId));
  const stale = staleBindingKeys(graph, active);
  for (const key of stale)
    await keys.revoke(key.id, 'Agent key contains grants without a live binding', 'system:auto-provision');
  const usable = active.filter((key) => !stale.includes(key));
  for (const binding of graph.bindings.filter((row) => row.agentId === agentId))
    await grantBindingKey(keys, graph, usable, binding);
}

/** Identities remain in the graph after soft deletion to prove which keys may be retired. */
export async function revokeInactiveAgentKeys(keys: ApiKeyService, db: Database, agentId: string): Promise<void> {
  const graph = await readAgentKeyGraph(db);
  const agent = graph.agents.find((row) => row.agentId === agentId);
  if (!agent || agent.isActive) return;
  const active = await keys.findAgentKeysByNames(agentKeyNameCandidates(agent.name, agent.tenantId));
  for (const key of staleBindingKeys(graph, active))
    await keys.revoke(key.id, 'Agent is inactive', 'system:auto-provision');
}
