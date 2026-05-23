import type { Agent, AgentProvider, Instance } from '@omni/db';
import type { Services } from './index';

type AgentCard = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringOverride(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function buildDefaultSkills(capabilities: string[]): Array<Record<string, unknown>> {
  const skills: Array<Record<string, unknown>> = [
    {
      id: 'messaging',
      name: 'Messaging',
      description: 'Process and respond to text messages',
      tags: ['messaging', 'chat'],
      inputModes: ['text/plain'],
      outputModes: ['text/plain'],
    },
  ];

  if (capabilities.includes('image') || capabilities.includes('vision')) {
    skills.push({
      id: 'vision',
      name: 'Vision',
      description: 'Process and describe images',
      tags: ['vision', 'image'],
      inputModes: ['text/plain', 'image/png', 'image/jpeg', 'image/webp'],
      outputModes: ['text/plain'],
    });
  }

  if (capabilities.includes('audio') || capabilities.includes('transcription')) {
    skills.push({
      id: 'audio',
      name: 'Audio',
      description: 'Transcribe and process audio',
      tags: ['audio', 'transcription'],
      inputModes: ['audio/mpeg', 'audio/ogg', 'audio/wav'],
      outputModes: ['text/plain'],
    });
  }

  return skills;
}

function buildA2AAgentCard(params: {
  baseUrl: string;
  agent: Agent;
  instance: Instance;
}): AgentCard {
  const { baseUrl, agent, instance } = params;
  const override = isRecord(agent.agentCard) ? agent.agentCard : {};
  const capabilities = agent.capabilities ?? [];
  const endpointUrl = `${normalizeBaseUrl(baseUrl)}/a2a/${instance.id}`;

  const card: AgentCard = {
    name: stringOverride(override.name) ?? agent.name,
    description: stringOverride(override.description) ?? `Omni agent ${agent.name}`,
    version: stringOverride(override.version) ?? '1.0.0',
    supportedInterfaces: Array.isArray(override.supportedInterfaces)
      ? override.supportedInterfaces
      : [
          {
            url: endpointUrl,
            protocolBinding: 'JSONRPC',
            protocolVersion: '1.0',
          },
        ],
    capabilities: {
      streaming: true,
      pushNotifications: false,
      extendedAgentCard: false,
      ...(isRecord(override.capabilities) ? override.capabilities : {}),
    },
    defaultInputModes: stringArray(override.defaultInputModes) ?? ['text/plain'],
    defaultOutputModes: stringArray(override.defaultOutputModes) ?? ['text/plain'],
    skills: Array.isArray(override.skills) ? override.skills : buildDefaultSkills(capabilities),
    securitySchemes: {
      bearerAuth: {
        httpAuthSecurityScheme: {
          scheme: 'Bearer',
          bearerFormat: 'Omni API key',
          description: 'Use an Omni API key as a bearer token.',
        },
      },
      apiKeyHeader: {
        apiKeySecurityScheme: {
          location: 'header',
          name: 'x-api-key',
          description: 'Legacy Omni API key header.',
        },
      },
      ...(isRecord(override.securitySchemes) ? override.securitySchemes : {}),
    },
    securityRequirements: [{ schemes: { bearerAuth: { list: [] } } }, { schemes: { apiKeyHeader: { list: [] } } }],
  };

  const providerOverride = isRecord(override.provider) ? override.provider : undefined;
  if (providerOverride) card.provider = providerOverride;

  const metadataOverride = isRecord(override.metadata) ? override.metadata : undefined;
  if (metadataOverride) card.metadata = metadataOverride;

  const iconUrl = stringOverride(override.iconUrl);
  if (iconUrl) card.iconUrl = iconUrl;

  const documentationUrl = stringOverride(override.documentationUrl);
  if (documentationUrl) card.documentationUrl = documentationUrl;

  return card;
}

export async function listA2ADiscoverableAgents(params: {
  services: Services;
  baseUrl: string;
  includeUnconfigured?: boolean;
}): Promise<Array<Record<string, unknown>>> {
  const { services, baseUrl, includeUnconfigured = false } = params;
  const [agents, instances, providers] = await Promise.all([
    services.agents.list({ isActive: true, limit: 200 }),
    services.instances.list({ channel: ['a2a'], status: ['active'], limit: 200 }),
    services.providers.list({ active: true }),
  ]);

  const instanceByAgent = new Map<string, Instance>();
  for (const instance of instances.items) {
    if (instance.agentId && !instanceByAgent.has(instance.agentId)) {
      instanceByAgent.set(instance.agentId, instance);
    }
  }

  const providerById = new Map(providers.map((provider) => [provider.id, provider]));

  const result: Array<Record<string, unknown>> = [];

  for (const agent of agents) {
    const instance = instanceByAgent.get(agent.id) ?? null;
    const provider = agent.agentProviderId ? providerById.get(agent.agentProviderId) : null;
    if (!instance && !includeUnconfigured) continue;

    result.push({
      agentId: agent.id,
      name: agent.name,
      description: stringOverride(agent.agentCard?.description) ?? null,
      provider: agent.provider,
      providerSchema: provider?.schema ?? null,
      model: agent.model,
      capabilities: agent.capabilities,
      configured: Boolean(instance),
      instanceId: instance?.id ?? null,
      endpointUrl: instance ? `${normalizeBaseUrl(baseUrl)}/a2a/${instance.id}` : null,
      parameters: {
        agentType: agent.agentType,
        providerId: agent.agentProviderId,
        metadata: agent.metadata ?? {},
        agentCard: agent.agentCard ?? {},
      },
      card: instance ? buildA2AAgentCard({ baseUrl, agent, instance }) : null,
    });
  }

  return result;
}

export async function resolveA2AAgentCard(params: {
  services: Services;
  baseUrl: string;
  agentId?: string | null;
  instanceId?: string | null;
}): Promise<{ card: AgentCard; agent: Agent; instance: Instance; provider?: AgentProvider | null } | null> {
  const { services, baseUrl, agentId, instanceId } = params;
  let instance: Instance | null = null;
  let agent: Agent | null = null;

  if (instanceId) {
    instance = await services.instances.getById(instanceId);
    if (!instance || instance.channel !== 'a2a' || !instance.agentId) return null;
    agent = await services.agents.getById(instance.agentId);
  } else if (agentId) {
    agent = await services.agents.getById(agentId);
    const instances = await services.instances.list({ channel: ['a2a'], status: ['active'], limit: 200 });
    instance = instances.items.find((item) => item.agentId === agentId) ?? null;
    if (!instance) return null;
  } else {
    const instances = await services.instances.list({ channel: ['a2a'], status: ['active'], limit: 2 });
    if (instances.items.length !== 1) return null;
    instance = instances.items[0] ?? null;
    if (!instance?.agentId) return null;
    agent = await services.agents.getById(instance.agentId);
  }

  if (!agent || !instance || !agent.isActive || !instance.isActive) return null;

  const provider = agent.agentProviderId
    ? await services.providers.getById(agent.agentProviderId).catch(() => null)
    : null;
  return {
    card: buildA2AAgentCard({ baseUrl, agent, instance }),
    agent,
    instance,
    provider,
  };
}
