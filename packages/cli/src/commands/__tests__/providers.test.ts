/**
 * `omni providers {agents,teams,workflows} list` row mapping.
 *
 * Regression for #515 — the CLI previously read legacy `agent_id` /
 * `team_id` / `workflow_id` fields, which are undefined on agno 2.5+
 * (where the API returns `id` instead). Mapping must accept both shapes.
 */

import { describe, expect, test } from 'bun:test';
import type { AgnoAgent, AgnoTeam, AgnoWorkflow } from '@omni/sdk';
import { __testables } from '../providers';

const { mapAgnoAgentRow, mapAgnoTeamRow, mapAgnoWorkflowRow } = __testables;

describe('mapAgnoAgentRow', () => {
  test('reads agno 2.5+ id', () => {
    const agent: AgnoAgent = { id: 'a1', name: 'Agent 1', model: { name: 'gpt-4' } };
    expect(mapAgnoAgentRow(agent).id).toBe('a1');
  });

  test('falls back to legacy agent_id when id is missing', () => {
    const agent = { agent_id: 'legacy-a1', name: 'Agent Legacy' } as unknown as AgnoAgent;
    expect(mapAgnoAgentRow(agent).id).toBe('legacy-a1');
  });

  test('prefers id over legacy agent_id when both present', () => {
    const agent = { id: 'new', agent_id: 'old', name: 'Agent' } as AgnoAgent;
    expect(mapAgnoAgentRow(agent).id).toBe('new');
  });
});

describe('mapAgnoTeamRow', () => {
  test('reads agno 2.5+ id', () => {
    const team: AgnoTeam = { id: 't1', name: 'Team 1', mode: 'coordinate' };
    expect(mapAgnoTeamRow(team).id).toBe('t1');
  });

  test('falls back to legacy team_id when id is missing', () => {
    const team = { team_id: 'legacy-t1', name: 'Team Legacy' } as unknown as AgnoTeam;
    expect(mapAgnoTeamRow(team).id).toBe('legacy-t1');
  });
});

describe('mapAgnoWorkflowRow', () => {
  test('reads agno 2.5+ id', () => {
    const wf: AgnoWorkflow = { id: 'w1', name: 'Workflow 1' };
    expect(mapAgnoWorkflowRow(wf).id).toBe('w1');
  });

  test('falls back to legacy workflow_id when id is missing', () => {
    const wf = { workflow_id: 'legacy-w1', name: 'Workflow Legacy' } as unknown as AgnoWorkflow;
    expect(mapAgnoWorkflowRow(wf).id).toBe('legacy-w1');
  });
});
