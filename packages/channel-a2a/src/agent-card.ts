/**
 * A2A Agent Card Builder
 *
 * Constructs the A2A Agent Card JSON from instance/agent metadata.
 * The agent card is served at /.well-known/agent.json?instanceId={id}.
 */

import type { A2AAgentCard, A2ASkill } from './types';

/** Safely extract a string override value from an unknown field. */
function strOverride(val: unknown): string | undefined {
  return typeof val === 'string' ? val : undefined;
}

/** Safely extract object-shaped capabilities override. */
function capabilitiesOverride(val: unknown): object | undefined {
  return val !== null && typeof val === 'object' && !Array.isArray(val) ? (val as object) : undefined;
}

/** Build default A2ASkill list from capability strings. */
function buildDefaultSkills(capabilities: string[]): A2ASkill[] {
  const skills: A2ASkill[] = [
    {
      id: 'messaging',
      name: 'Messaging',
      description: 'Process and respond to text messages',
      tags: ['messaging', 'chat'],
      inputModes: ['text'],
      outputModes: ['text'],
    },
  ];

  if (capabilities.includes('image') || capabilities.includes('vision')) {
    skills.push({
      id: 'vision',
      name: 'Vision',
      description: 'Process and describe images',
      tags: ['vision', 'image'],
      inputModes: ['text', 'image'],
      outputModes: ['text'],
    });
  }

  if (capabilities.includes('audio') || capabilities.includes('transcription')) {
    skills.push({
      id: 'audio',
      name: 'Audio',
      description: 'Transcribe and process audio',
      tags: ['audio', 'transcription'],
      inputModes: ['audio'],
      outputModes: ['text'],
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
  capabilities: string[];
  /** Stored override fields from agents.agentCard (optional) */
  agentCardOverride?: Record<string, unknown> | null;
  baseUrl: string;
}): A2AAgentCard {
  const { instanceId, instanceName, agentName, capabilities, agentCardOverride, baseUrl } = params;

  const baseCard = normalizeBaseUrl(baseUrl);
  const agentUrl = `${baseCard}/a2a/${instanceId}`;
  const skills = buildDefaultSkills(capabilities);

  const overrideSkills = Array.isArray(agentCardOverride?.skills)
    ? (agentCardOverride.skills as A2ASkill[])
    : undefined;

  const card: A2AAgentCard = {
    name: strOverride(agentCardOverride?.name) ?? agentName ?? instanceName,
    description: strOverride(agentCardOverride?.description) ?? `Omni agent ${agentName} on instance ${instanceName}`,
    url: agentUrl,
    version: strOverride(agentCardOverride?.version) ?? '1.0.0',
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: false,
      ...(capabilitiesOverride(agentCardOverride?.capabilities) ?? {}),
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: overrideSkills ?? skills,
  };

  const iconUrl = strOverride(agentCardOverride?.iconUrl);
  if (iconUrl) card.iconUrl = iconUrl;

  const documentationUrl = strOverride(agentCardOverride?.documentationUrl);
  if (documentationUrl) card.documentationUrl = documentationUrl;

  return card;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}
