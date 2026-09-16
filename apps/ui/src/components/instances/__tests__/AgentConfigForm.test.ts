/// <reference types="bun" />
import { describe, expect, mock, test } from 'bun:test';
import { saveAgentConfig } from '@/components/instances/AgentConfigForm';
import type { Instance } from '@omni/sdk';

const instance = {
  id: 'inst-1',
  agentId: 'agent-1',
  agentProviderId: 'prov-old',
  agentTimeout: 600,
  agentStreamMode: false,
} as Instance;

describe('saveAgentConfig (#1214)', () => {
  test('provider change goes through agents.update; instance payload has only schema fields', async () => {
    const updateAgent = mock(async () => ({}));
    const updateInstance = mock(async () => ({}));
    await saveAgentConfig(
      instance,
      { providerId: 'prov-new', agentTimeout: 30, streamMode: true },
      updateAgent,
      updateInstance,
    );

    expect(updateAgent).toHaveBeenCalledWith({ id: 'agent-1', data: { agentProviderId: 'prov-new' } });
    expect(updateInstance).toHaveBeenCalledWith({ id: 'inst-1', data: { agentTimeout: 30, agentStreamMode: true } });
  });

  test('no agents.update when provider is unchanged or instance has no agent', async () => {
    const updateAgent = mock(async () => ({}));
    const updateInstance = mock(async () => ({}));
    await saveAgentConfig(
      instance,
      { providerId: 'prov-old', agentTimeout: 600, streamMode: false },
      updateAgent,
      updateInstance,
    );
    await saveAgentConfig(
      { ...instance, agentId: null } as Instance,
      { providerId: 'x', agentTimeout: 600, streamMode: false },
      updateAgent,
      updateInstance,
    );
    expect(updateAgent).not.toHaveBeenCalled();
    for (const [args] of updateInstance.mock.calls as unknown as [{ data: Record<string, unknown> }][]) {
      expect(Object.keys(args.data).sort()).toEqual(['agentStreamMode', 'agentTimeout']);
    }
  });
});
