import { describe, expect, test } from 'bun:test';
import type { AgentRouteRow, AgentRow } from '../../api/ext';
import { explainRouteDecision, pickWinningRoute } from './routing-helpers';

const route = (over: Partial<AgentRouteRow>): AgentRouteRow => ({
  id: 'r1',
  instanceId: 'i1',
  scope: 'chat',
  agentId: 'a1',
  isActive: true,
  priority: 0,
  ...over,
});

const agent = (over: Partial<AgentRow>): AgentRow => ({
  id: 'a1',
  name: 'felipe',
  provider: 'custom',
  agentType: 'assistant',
  isActive: true,
  ...over,
});

describe('pickWinningRoute', () => {
  test('returns the highest-priority active route', () => {
    const r = pickWinningRoute([
      route({ id: 'lo', priority: 1 }),
      route({ id: 'hi', priority: 9 }),
      route({ id: 'off', priority: 99, isActive: false }),
    ]);
    expect(r?.id).toBe('hi');
  });
  test('honours an explicit selection', () => {
    const r = pickWinningRoute([route({ id: 'lo', priority: 1 }), route({ id: 'hi', priority: 9 })], 'lo');
    expect(r?.id).toBe('lo');
  });
  test('returns null when nothing is active', () => {
    expect(pickWinningRoute([route({ isActive: false })])).toBeNull();
  });
});

describe('explainRouteDecision', () => {
  test('happy path dispatches to the bound agent', () => {
    const d = explainRouteDecision({
      instanceName: 'felipe-wa',
      routes: [route({})],
      access: { allowed: true, mode: 'disabled' },
      agent: agent({}),
      providerHealth: { healthy: true, latency: 12 },
    });
    expect(d.winningRoute?.id).toBe('r1');
    expect(d.verdict).toContain('dispatch to agent "felipe"');
    expect(d.steps.find((s) => s.label === 'Access check')?.outcome).toBe('pass');
    expect(d.steps.find((s) => s.label === 'Provider health')?.outcome).toBe('pass');
  });

  test('access denied blocks before an agent', () => {
    const d = explainRouteDecision({
      instanceName: 'x',
      routes: [route({})],
      access: { allowed: false, reason: 'blocklisted' },
      agent: agent({}),
      providerHealth: { healthy: true },
    });
    expect(d.verdict).toContain('BLOCKED');
    expect(d.steps[0]?.outcome).toBe('fail');
  });

  test('inactive agent is a fail', () => {
    const d = explainRouteDecision({
      instanceName: 'x',
      routes: [route({})],
      access: { allowed: true },
      agent: agent({ isActive: false }),
      providerHealth: { healthy: true },
    });
    expect(d.verdict).toContain('BLOCKED');
    expect(d.steps.find((s) => s.label === 'Agent active')?.outcome).toBe('fail');
  });

  test('unhealthy provider warns but still dispatches', () => {
    const d = explainRouteDecision({
      instanceName: 'x',
      routes: [route({})],
      access: { allowed: true },
      agent: agent({}),
      providerHealth: { healthy: false, error: 'protocol must be http' },
    });
    expect(d.verdict).toContain('provider currently unhealthy');
    expect(d.steps.find((s) => s.label === 'Provider health')?.outcome).toBe('warn');
  });

  test('no active routes falls back to instance default', () => {
    const d = explainRouteDecision({
      instanceName: 'x',
      routes: [],
      access: { allowed: true },
      agent: null,
      providerHealth: null,
    });
    expect(d.winningRoute).toBeNull();
    expect(d.verdict).toContain('fall back to the instance default');
  });
});
