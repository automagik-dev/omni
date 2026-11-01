/** Ownership proof shared by startup repair and instance assignment. */
import type { ApiKey } from '@omni/db';
import { agentKeyName } from './agent-key-name';

export type AgentKeyOwner = { agentId: string | null; tenantId: string | null };
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
  return (
    key.instanceIds.length > 0 &&
    key.instanceIds.every((id) => {
      const owner = owners.get(id);
      return owner?.agentId === binding.agentId && owner.tenantId === binding.tenantId;
    })
  );
}
