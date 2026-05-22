/**
 * buildAgentCard() unit tests
 */

import { describe, expect, it } from 'bun:test';
import { buildAgentCard } from '../agent-card';

const BASE = {
  instanceId: 'inst-123',
  instanceName: 'My Instance',
  agentName: 'My Agent',
  capabilities: [] as string[],
  baseUrl: 'https://omni.example.com',
};

describe('buildAgentCard', () => {
  describe('url', () => {
    it('sets supportedInterfaces[0].url to {baseUrl}/a2a/{instanceId}', () => {
      const card = buildAgentCard(BASE);
      expect(card.supportedInterfaces[0]?.url).toBe('https://omni.example.com/a2a/inst-123');
      expect(card.supportedInterfaces[0]?.protocolBinding).toBe('JSONRPC');
      expect(card.supportedInterfaces[0]?.protocolVersion).toBe('1.0');
    });

    it('strips trailing slash from baseUrl', () => {
      const card = buildAgentCard({ ...BASE, baseUrl: 'https://omni.example.com/' });
      expect(card.supportedInterfaces[0]?.url).toBe('https://omni.example.com/a2a/inst-123');
    });
  });

  describe('name', () => {
    it('uses agentName by default', () => {
      const card = buildAgentCard(BASE);
      expect(card.name).toBe('My Agent');
    });

    it('overrides name from agentCardOverride', () => {
      const card = buildAgentCard({ ...BASE, agentCardOverride: { name: 'Override Name' } });
      expect(card.name).toBe('Override Name');
    });
  });

  describe('description', () => {
    it('generates default description from agentName and instanceName', () => {
      const card = buildAgentCard(BASE);
      expect(card.description).toBe('Omni agent My Agent on instance My Instance');
    });

    it('overrides description from agentCardOverride', () => {
      const card = buildAgentCard({
        ...BASE,
        agentCardOverride: { description: 'Custom description' },
      });
      expect(card.description).toBe('Custom description');
    });
  });

  describe('version', () => {
    it('defaults to 1.0.0', () => {
      const card = buildAgentCard(BASE);
      expect(card.version).toBe('1.0.0');
    });

    it('overrides version from agentCardOverride', () => {
      const card = buildAgentCard({ ...BASE, agentCardOverride: { version: '2.3.4' } });
      expect(card.version).toBe('2.3.4');
    });
  });

  describe('capabilities', () => {
    it('sets v1 capabilities by default', () => {
      const card = buildAgentCard(BASE);
      expect(card.capabilities).toEqual({
        streaming: true,
        pushNotifications: false,
        extendedAgentCard: false,
      });
    });

    it('merges capabilities from agentCardOverride', () => {
      const card = buildAgentCard({
        ...BASE,
        agentCardOverride: { capabilities: { pushNotifications: true } },
      });
      expect(card.capabilities.pushNotifications).toBe(true);
      expect(card.capabilities.streaming).toBe(true);
    });

    it('uses A2A v1 security scheme wrappers', () => {
      const card = buildAgentCard(BASE);
      expect(card.securitySchemes?.bearerAuth).toEqual({
        httpAuthSecurityScheme: {
          scheme: 'Bearer',
          bearerFormat: 'Omni API key',
          description: 'Use an Omni API key as a bearer token.',
        },
      });
      expect(card.securityRequirements?.[0]).toEqual({ schemes: { bearerAuth: { list: [] } } });
    });
  });

  describe('skills', () => {
    it('includes default messaging skill', () => {
      const card = buildAgentCard(BASE);
      expect(card.skills).toHaveLength(1);
      expect(card.skills[0]?.id).toBe('messaging');
    });

    it('adds vision skill for "image" capability', () => {
      const card = buildAgentCard({ ...BASE, capabilities: ['image'] });
      const skillIds = card.skills.map((s) => s.id);
      expect(skillIds).toContain('vision');
    });

    it('adds vision skill for "vision" capability', () => {
      const card = buildAgentCard({ ...BASE, capabilities: ['vision'] });
      const skillIds = card.skills.map((s) => s.id);
      expect(skillIds).toContain('vision');
    });

    it('adds audio skill for "audio" capability', () => {
      const card = buildAgentCard({ ...BASE, capabilities: ['audio'] });
      const skillIds = card.skills.map((s) => s.id);
      expect(skillIds).toContain('audio');
    });

    it('adds audio skill for "transcription" capability', () => {
      const card = buildAgentCard({ ...BASE, capabilities: ['transcription'] });
      const skillIds = card.skills.map((s) => s.id);
      expect(skillIds).toContain('audio');
    });

    it('adds all skills for combined capabilities', () => {
      const card = buildAgentCard({ ...BASE, capabilities: ['image', 'audio'] });
      const skillIds = card.skills.map((s) => s.id);
      expect(skillIds).toContain('messaging');
      expect(skillIds).toContain('vision');
      expect(skillIds).toContain('audio');
    });

    it('overrides skills entirely from agentCardOverride', () => {
      const customSkills = [{ id: 'custom', name: 'Custom', description: 'Custom skill' }];
      const card = buildAgentCard({ ...BASE, agentCardOverride: { skills: customSkills } });
      expect(card.skills).toEqual(customSkills);
    });
  });

  describe('optional fields', () => {
    it('does not set iconUrl when not in override', () => {
      const card = buildAgentCard(BASE);
      expect(card.iconUrl).toBeUndefined();
    });

    it('sets iconUrl from agentCardOverride', () => {
      const card = buildAgentCard({
        ...BASE,
        agentCardOverride: { iconUrl: 'https://example.com/icon.png' },
      });
      expect(card.iconUrl).toBe('https://example.com/icon.png');
    });

    it('does not set documentationUrl when not in override', () => {
      const card = buildAgentCard(BASE);
      expect(card.documentationUrl).toBeUndefined();
    });

    it('sets documentationUrl from agentCardOverride', () => {
      const card = buildAgentCard({
        ...BASE,
        agentCardOverride: { documentationUrl: 'https://docs.example.com' },
      });
      expect(card.documentationUrl).toBe('https://docs.example.com');
    });
  });

  describe('defaultInputModes / defaultOutputModes', () => {
    it('defaults to text input and text output', () => {
      const card = buildAgentCard(BASE);
      expect(card.defaultInputModes).toEqual(['text/plain']);
      expect(card.defaultOutputModes).toEqual(['text/plain']);
    });
  });
});
