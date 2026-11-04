/** Ownership proof shared by startup repair, instance assignment and routes. */
import type { ApiKey } from '@omni/db';
import { agentKeyName } from './agent-key-name';

export type AgentKeyOwner = { agentId: string | null; tenantId: string | null; routedAgentIds?: readonly string[] };
export type AgentKeyBinding = { agentId: string; tenantId: string | null; name: string };

export function agentKeyBelongsToBinding(
  key: Pick<ApiKey, 'name' | 'instanceIds'>,
  binding: AgentKeyBinding,
  owners: ReadonlyMap<string, AgentKeyOwner>,
): boolean {
  if (key.instanceIds === null) return false;
  if (binding.tenantId && key.name === agentKeyName(binding.name, binding.tenantId)) return true;
  // A bare name proves nothing. Every existing grant must identify the same
  // agent and tenant; missing, unbound and empty grants cannot prove ownership.
  return agentKeyGrantsMatch(key, binding, owners);
}

/** A name identifies the agent; every grant must still have a live binding. */
export function agentKeyGrantsMatch(
  key: Pick<ApiKey, 'instanceIds'>,
  binding: AgentKeyBinding,
  owners: ReadonlyMap<string, AgentKeyOwner>,
): boolean {
  return Boolean(
    key.instanceIds?.length &&
      key.instanceIds.every((id) => {
        const owner = owners.get(id);
        return (
          owner?.tenantId === binding.tenantId &&
          (owner.agentId === binding.agentId || Boolean(owner.routedAgentIds?.includes(binding.agentId)))
        );
      }),
  );
}
