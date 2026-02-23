/**
 * A2A Agent Card Builder
 *
 * Constructs the A2A Agent Card JSON from instance/agent metadata.
 * The agent card is served at /.well-known/agent.json?instanceId={id}.
 */

import type { A2AAgentCard, A2ASkill } from './types';

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

  // Build default skills from capabilities
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

  const card: A2AAgentCard = {
    name: (agentCardOverride?.name as string | undefined) ?? agentName ?? instanceName,
    description:
      (agentCardOverride?.description as string | undefined) ?? `Omni agent ${agentName} on instance ${instanceName}`,
    url: agentUrl,
    version: (agentCardOverride?.version as string | undefined) ?? '1.0.0',
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: false,
      ...((agentCardOverride?.capabilities as object | undefined) ?? {}),
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: (agentCardOverride?.skills as A2ASkill[] | undefined) ?? skills,
  };

  if (agentCardOverride?.iconUrl) {
    card.iconUrl = agentCardOverride.iconUrl as string;
  }
  if (agentCardOverride?.documentationUrl) {
    card.documentationUrl = agentCardOverride.documentationUrl as string;
  }

  return card;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}
