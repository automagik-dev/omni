import { describe, expect, test } from 'bun:test';
import {
  agentCapabilities,
  agentCreateSchema,
  agentTypeLabel,
  buildAgentBody,
  providerBadgeVariant,
} from './agent-helpers';

describe('providerBadgeVariant', () => {
  test('maps known providers to stable colours', () => {
    expect(providerBadgeVariant('claude')).toBe('amber');
    expect(providerBadgeVariant('agno')).toBe('green');
    expect(providerBadgeVariant('openai')).toBe('blue');
    expect(providerBadgeVariant('gemini')).toBe('blue');
  });
  test('falls back to gray for custom/unknown', () => {
    expect(providerBadgeVariant('custom')).toBe('gray');
    expect(providerBadgeVariant(null)).toBe('gray');
    expect(providerBadgeVariant(undefined)).toBe('gray');
  });
});

describe('agentTypeLabel', () => {
  test('labels the four roles', () => {
    expect(agentTypeLabel('assistant')).toBe('Assistant');
    expect(agentTypeLabel('workflow')).toBe('Workflow');
    expect(agentTypeLabel('team')).toBe('Team');
    expect(agentTypeLabel('tool')).toBe('Tool');
  });
  test('echoes unknown values', () => {
    expect(agentTypeLabel('mystery')).toBe('mystery');
    expect(agentTypeLabel(undefined)).toBe('unknown');
  });
});

describe('agentCreateSchema', () => {
  test('accepts a minimal valid agent', () => {
    const parsed = agentCreateSchema.safeParse({ name: 'x', provider: 'custom' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.agentType).toBe('assistant');
      expect(parsed.data.isActive).toBe(true);
      expect(parsed.data.isInternal).toBe(false);
    }
  });
  test('rejects an unknown provider', () => {
    expect(agentCreateSchema.safeParse({ name: 'x', provider: 'skynet' }).success).toBe(false);
  });
  test('rejects an empty name', () => {
    expect(agentCreateSchema.safeParse({ name: '', provider: 'custom' }).success).toBe(false);
  });
});

describe('buildAgentBody', () => {
  test('drops empty scalars and attaches parsed JSON blobs', () => {
    const body = buildAgentBody(
      { name: 'a', provider: 'custom', model: '', configPath: undefined },
      { key: 'v' },
      { skills: [{ id: 's1' }] },
    );
    expect(body).toEqual({
      name: 'a',
      provider: 'custom',
      metadata: { key: 'v' },
      agentCard: { skills: [{ id: 's1' }] },
    });
    expect('model' in body).toBe(false);
    expect('configPath' in body).toBe(false);
  });
  test('omits JSON blobs left undefined', () => {
    const body = buildAgentBody({ name: 'a' }, undefined, undefined);
    expect(body).toEqual({ name: 'a' });
  });
});

describe('agentCapabilities', () => {
  test('returns a clean string array', () => {
    expect(agentCapabilities({ capabilities: ['a', 'b'] })).toEqual(['a', 'b']);
  });
  test('tolerates missing/partial rows', () => {
    expect(agentCapabilities(null)).toEqual([]);
    expect(agentCapabilities({ capabilities: undefined })).toEqual([]);
  });
});
