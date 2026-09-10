import { describe, expect, it } from 'bun:test';
import { AgentUsageSchema, agentUsageFromResult } from './agent-usage';

const base = { providerId: 'prov-1', runId: 'run-1' };

describe('agentUsageFromResult (#1064)', () => {
  it('maps provider cost fields onto the journal stamp', () => {
    const usage = agentUsageFromResult({
      ...base,
      cost: { inputTokens: 120, outputTokens: 30, costUsd: 0.0042, model: 'claude-sonnet-5' },
    });
    expect(usage).toEqual({
      providerId: 'prov-1',
      runId: 'run-1',
      tokensIn: 120,
      tokensOut: 30,
      costUsd: 0.0042,
      model: 'claude-sonnet-5',
    });
    expect(AgentUsageSchema.safeParse(usage).success).toBe(true);
  });

  it('keeps partial surfaces (tokens without cost, cost without model)', () => {
    expect(agentUsageFromResult({ ...base, cost: { inputTokens: 5, outputTokens: 7 } })).toEqual({
      ...base,
      tokensIn: 5,
      tokensOut: 7,
    });
    expect(agentUsageFromResult({ ...base, cost: { costUsd: 0.01 } })).toEqual({ ...base, costUsd: 0.01 });
  });

  it('stamps nothing when the provider exposed no usage', () => {
    expect(agentUsageFromResult(base)).toBeNull();
    expect(agentUsageFromResult({ ...base, cost: {} })).toBeNull();
  });

  it('rejects malformed usage instead of journaling garbage', () => {
    expect(agentUsageFromResult({ ...base, cost: { costUsd: -1 } })).toBeNull();
    expect(agentUsageFromResult({ ...base, cost: { inputTokens: 1.5 } })).toBeNull();
  });
});
