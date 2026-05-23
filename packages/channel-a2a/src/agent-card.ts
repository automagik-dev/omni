/**
 * A2A Agent Card Builder
 *
 * Constructs the A2A Agent Card JSON from instance/agent metadata.
 * The v1 card is served at /.well-known/agent-card.json?instanceId={id}.
 */

import type { A2AAgentCard, A2ASkill } from './types';

/** Safely extract a string override value from an unknown field. */
function strOverride(val: unknown): string | undefined {
  return typeof val === 'string' ? val : undefined;
}

/** Safely extract object-shaped overrides. */
function objectOverride(val: unknown): Record<string, unknown> | undefined {
  return val !== null && typeof val === 'object' && !Array.isArray(val) ? (val as Record<string, unknown>) : undefined;
}

function stringArrayOverride(val: unknown): string[] | undefined {
  return Array.isArray(val) && val.every((item) => typeof item === 'string') ? val : undefined;
}

/** Build default A2ASkill list from capability strings. */
function buildDefaultSkills(capabilities: string[]): A2ASkill[] {
  const skills: A2ASkill[] = [
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

/**
 * Build an A2A Agent Card for a given Omni instance/agent.
 */
export function buildAgentCard(params: {
  instanceId: string;
  instanceName: string;
  agentName: string;
  agentId?: string;
  provider?: string;
  model?: string | null;
  capabilities: string[];
  /** Stored override fields from agents.agentCard (optional) */
  agentCardOverride?: Record<string, unknown> | null;
  /** Non-sensitive agent metadata to include in authenticated cards. */
  metadata?: Record<string, unknown> | null;
  baseUrl: string;
  extended?: boolean;
}): A2AAgentCard {
  const { instanceId, instanceName, agentName, capabilities, agentCardOverride, baseUrl } = params;

  const baseCard = normalizeBaseUrl(baseUrl);
  const agentUrl = `${baseCard}/a2a/${instanceId}`;
  const skills = buildDefaultSkills(capabilities);

  const overrideSkills = Array.isArray(agentCardOverride?.skills)
    ? (agentCardOverride.skills as A2ASkill[])
    : undefined;
  const overrideInterfaces = Array.isArray(agentCardOverride?.supportedInterfaces)
    ? (agentCardOverride.supportedInterfaces as A2AAgentCard['supportedInterfaces'])
    : undefined;
  const defaultInputModes = stringArrayOverride(agentCardOverride?.defaultInputModes) ?? ['text/plain'];
  const defaultOutputModes = stringArrayOverride(agentCardOverride?.defaultOutputModes) ?? ['text/plain'];

  const card: A2AAgentCard = {
    name: strOverride(agentCardOverride?.name) ?? agentName ?? instanceName,
    description: strOverride(agentCardOverride?.description) ?? `Omni agent ${agentName} on instance ${instanceName}`,
    version: strOverride(agentCardOverride?.version) ?? '1.0.0',
    supportedInterfaces: overrideInterfaces ?? [
      {
        url: agentUrl,
        protocolBinding: 'JSONRPC',
        protocolVersion: '1.0',
      },
    ],
    capabilities: {
      streaming: true,
      pushNotifications: false,
      extendedAgentCard: false,
      ...(objectOverride(agentCardOverride?.capabilities) ?? {}),
    },
    defaultInputModes,
    defaultOutputModes,
    skills: overrideSkills ?? skills,
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
      ...(objectOverride(agentCardOverride?.securitySchemes) ?? {}),
    },
    securityRequirements: [{ schemes: { bearerAuth: { list: [] } } }, { schemes: { apiKeyHeader: { list: [] } } }],
  };

  const providerOverride = objectOverride(agentCardOverride?.provider);
  if (providerOverride) {
    card.provider = providerOverride as A2AAgentCard['provider'];
  }

  const iconUrl = strOverride(agentCardOverride?.iconUrl);
  if (iconUrl) card.iconUrl = iconUrl;

  const documentationUrl = strOverride(agentCardOverride?.documentationUrl);
  if (documentationUrl) card.documentationUrl = documentationUrl;

  return card;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}
