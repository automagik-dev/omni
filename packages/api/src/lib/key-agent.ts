import { type Database, agents, apiKeys, instances } from '@omni/db';
import { eq, inArray } from 'drizzle-orm';
import { pairedAgentFlagState } from '../tenancy/feature-flag';
import { scopedHandle } from '../tenancy/tenant-scope';
import { agentKeyNameCandidates } from './agent-key-name';
import { agentKeyBelongsToBinding } from './agent-key-ownership';
import { currentProducingKeyId, memoizeProducingKeyResolution } from './producer-scope';

export type KeyAgentResolution =
  | { kind: 'none' }
  | { kind: 'agent'; agentId: string }
  | {
      kind: 'unresolved';
      reason: 'revoked' | 'widened' | 'no_binding' | 'mixed_binding' | 'inactive_agent' | 'name_mismatch';
    };

/** Slice 3 replaces this binding proof with the backfilled api_keys.agent_id. */
export async function resolveKeyAgent(db: Database, keyId: string | null): Promise<KeyAgentResolution> {
  if (!keyId) return { kind: 'none' };
  return memoizeProducingKeyResolution(db, keyId, () => resolveKeyAgentUncached(db, keyId));
}

async function resolveKeyAgentUncached(db: Database, keyId: string): Promise<KeyAgentResolution> {
  const [key] = await db
    .select({
      name: apiKeys.name,
      instanceIds: apiKeys.instanceIds,
      createdBy: apiKeys.createdBy,
      status: apiKeys.status,
    })
    .from(apiKeys)
    .where(eq(apiKeys.id, keyId))
    .limit(1);
  if (!key || key.createdBy !== 'system:auto-provision' || !key.name.startsWith('agent:')) return { kind: 'none' };
  if (key.status !== 'active') return { kind: 'unresolved', reason: 'revoked' };
  if (!key.instanceIds?.length) return { kind: 'unresolved', reason: 'widened' };

  const sdb = scopedHandle(db);
  const bindings = await sdb
    .select({ id: instances.id, agentId: instances.agentId, tenantId: instances.tenantId })
    .from(instances)
    .where(inArray(instances.id, key.instanceIds));
  const owners = new Map(bindings.map((binding) => [binding.id, binding]));
  const first = bindings[0];
  if (!first?.agentId || key.instanceIds.some((id) => !owners.get(id)?.agentId))
    return { kind: 'unresolved', reason: 'no_binding' };
  if (bindings.some((binding) => binding.agentId !== first.agentId || binding.tenantId !== first.tenantId))
    return { kind: 'unresolved', reason: 'mixed_binding' };
  const [agent] = await sdb
    .select({ id: agents.id, name: agents.name, isActive: agents.isActive, tenantId: agents.tenantId })
    .from(agents)
    .where(eq(agents.id, first.agentId))
    .limit(1);
  if (!agent?.isActive) return { kind: 'unresolved', reason: 'inactive_agent' };
  const binding = { agentId: agent.id, tenantId: agent.tenantId, name: agent.name };
  if (
    agent.tenantId !== first.tenantId ||
    !agentKeyNameCandidates(agent.name, first.tenantId).includes(key.name) ||
    !agentKeyBelongsToBinding(key, binding, owners)
  )
    return { kind: 'unresolved', reason: 'name_mismatch' };
  return { kind: 'agent', agentId: agent.id };
}

/** Direct claims have no envelope yet: use authenticated request state only. */
export async function requestProducerColumns(db: Database): Promise<{
  producingKeyId: string | null;
  agentId: string | null;
}> {
  if (!pairedAgentFlagState('consumers').enabled) return { producingKeyId: null, agentId: null };
  const producingKeyId = currentProducingKeyId();
  const principal = await resolveKeyAgent(db, producingKeyId);
  // A fire-and-forget claim may have crossed the request's completion during the read.
  if (currentProducingKeyId() !== producingKeyId) return { producingKeyId: null, agentId: null };
  return { producingKeyId, agentId: principal.kind === 'agent' ? principal.agentId : null };
}
