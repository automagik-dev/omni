/**
 * SDK providers.listAgents/listTeams/listWorkflows agno 2.5+ id migration.
 *
 * Regression for #515 — the SDK's `AgnoAgent` / `AgnoTeam` / `AgnoWorkflow`
 * interfaces previously declared only legacy `agent_id` / `team_id` /
 * `workflow_id`, which are undefined on agno 2.5+ (where the API returns
 * `id` instead). The interfaces now declare `id` as authoritative and keep
 * the legacy fields as deprecated optionals for pre-2.5 deployments.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createOmniClient } from '../index';

function createMockFetch() {
  const mockImpl = mock((_input: string | URL | Request, _init?: RequestInit) => Promise.resolve(new Response()));
  const mockFetch = Object.assign((input: string | URL | Request, init?: RequestInit) => mockImpl(input, init), {
    preconnect: () => {},
  }) as typeof fetch;
  return { mockFetch, mockImpl };
}

describe('SDK providers — agno 2.5+ id migration (#515)', () => {
  let originalFetch: typeof globalThis.fetch;
  let mockImpl: ReturnType<typeof createMockFetch>['mockImpl'];

  const client = createOmniClient({
    baseUrl: 'http://localhost:8882',
    apiKey: 'test-key',
  });

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    const mocks = createMockFetch();
    mockImpl = mocks.mockImpl;
    globalThis.fetch = mocks.mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('listAgents exposes agno 2.5+ id on returned entries', async () => {
    mockImpl.mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [{ id: 'a1', name: 'Agent One' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const agents = await client.providers.listAgents('prov-1');
    expect(agents).toHaveLength(1);
    expect(agents[0]?.id).toBe('a1');
  });

  test('listAgents still carries pre-2.5 agent_id for backward compat', async () => {
    mockImpl.mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [{ agent_id: 'legacy-a1', name: 'Legacy Agent' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const agents = await client.providers.listAgents('prov-1');
    expect(agents).toHaveLength(1);
    // id is authoritative; consumers should read it via `?? agent_id` fallback
    expect(agents[0]?.id ?? agents[0]?.agent_id).toBe('legacy-a1');
  });

  test('listTeams exposes agno 2.5+ id on returned entries', async () => {
    mockImpl.mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [{ id: 't1', name: 'Team One', mode: 'coordinate' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const teams = await client.providers.listTeams('prov-1');
    expect(teams).toHaveLength(1);
    expect(teams[0]?.id).toBe('t1');
  });

  test('listTeams still carries pre-2.5 team_id for backward compat', async () => {
    mockImpl.mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [{ team_id: 'legacy-t1', name: 'Legacy Team' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const teams = await client.providers.listTeams('prov-1');
    expect(teams[0]?.id ?? teams[0]?.team_id).toBe('legacy-t1');
  });

  test('listWorkflows exposes agno 2.5+ id on returned entries', async () => {
    mockImpl.mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [{ id: 'w1', name: 'Workflow One' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const workflows = await client.providers.listWorkflows('prov-1');
    expect(workflows).toHaveLength(1);
    expect(workflows[0]?.id).toBe('w1');
  });

  test('listWorkflows still carries pre-2.5 workflow_id for backward compat', async () => {
    mockImpl.mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [{ workflow_id: 'legacy-w1', name: 'Legacy Workflow' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const workflows = await client.providers.listWorkflows('prov-1');
    expect(workflows[0]?.id ?? workflows[0]?.workflow_id).toBe('legacy-w1');
  });
});
