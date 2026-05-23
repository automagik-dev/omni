import { describe, expect, test } from 'bun:test';
import type { Agent, Instance } from '@omni/db';
import { resolveA2AAgentCard } from '../a2a-discovery';
import type { Services } from '../index';

function createAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-1',
    name: 'Public Agent',
    provider: 'agno',
    model: null,
    agentType: 'assistant',
    capabilities: [],
    ownerId: null,
    agentProviderId: null,
    configPath: null,
    isInternal: false,
    isActive: true,
    metadata: null,
    agentCard: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Agent;
}

function createInstance(overrides: Partial<Instance> = {}): Instance {
  return {
    id: 'instance-1',
    name: 'Public Agent',
    channel: 'a2a',
    agentId: 'agent-1',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Instance;
}

function createServices(agent: Agent, instance: Instance): Services {
  return {
    agents: {
      getById: async () => agent,
    },
    instances: {
      getById: async () => instance,
    },
    providers: {
      getById: async () => null,
    },
  } as unknown as Services;
}

describe('resolveA2AAgentCard', () => {
  test('publishes explicit agent card metadata', async () => {
    const agent = createAgent({
      agentCard: {
        name: 'Public Agent',
        metadata: {
          domain: 'support',
          brand: 'ExampleCo',
        },
      },
      metadata: {
        providerAgentId: 'internal-provider-agent',
      },
    });
    const instance = createInstance();

    const resolved = await resolveA2AAgentCard({
      services: createServices(agent, instance),
      baseUrl: 'http://localhost:8882',
      instanceId: instance.id,
    });

    expect(resolved?.card.metadata).toEqual({
      domain: 'support',
      brand: 'ExampleCo',
    });
  });

  test('does not expose internal agent metadata by default', async () => {
    const agent = createAgent({
      metadata: {
        providerAgentId: 'internal-provider-agent',
      },
    });
    const instance = createInstance();

    const resolved = await resolveA2AAgentCard({
      services: createServices(agent, instance),
      baseUrl: 'http://localhost:8882',
      instanceId: instance.id,
    });

    expect(resolved?.card.metadata).toBeUndefined();
  });
});
