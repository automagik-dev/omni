/**
 * Tests for omni#443 auto-set reply filter logic.
 *
 * When an agent is assigned to an instance and no reply filter is configured,
 * the API auto-populates `agentReplyFilter = { mode: 'all', conditions: { onDm: true } }`
 * to prevent silent message drops.
 */

import { describe, expect, test } from 'bun:test';
import { DEFAULT_AGENT_REPLY_FILTER, shouldApplyDefaultReplyFilter } from '../routes/v2/instances';

describe('omni#443 auto-set agentReplyFilter', () => {
  test('default filter shape matches issue spec (mode=all, onDm=true)', () => {
    expect(DEFAULT_AGENT_REPLY_FILTER).toEqual({
      mode: 'all',
      conditions: { onDm: true },
    });
  });

  describe('create (no prior instance state)', () => {
    test('applies default when agent is assigned and no filter provided', () => {
      expect(
        shouldApplyDefaultReplyFilter({
          newAgentId: 'agent-uuid',
          currentAgentId: null,
          explicitReplyFilter: undefined,
          currentReplyFilter: null,
          agentIdTouched: true,
        }),
      ).toBe(true);
    });

    test('does NOT apply when no agent is assigned', () => {
      expect(
        shouldApplyDefaultReplyFilter({
          newAgentId: null,
          currentAgentId: null,
          explicitReplyFilter: undefined,
          currentReplyFilter: null,
          agentIdTouched: true,
        }),
      ).toBe(false);
    });

    test('does NOT apply when user provides explicit filter', () => {
      expect(
        shouldApplyDefaultReplyFilter({
          newAgentId: 'agent-uuid',
          currentAgentId: null,
          explicitReplyFilter: { mode: 'filtered', conditions: { onMention: true } },
          currentReplyFilter: null,
          agentIdTouched: true,
        }),
      ).toBe(false);
    });

    test('respects explicit null filter (user clearing)', () => {
      expect(
        shouldApplyDefaultReplyFilter({
          newAgentId: 'agent-uuid',
          currentAgentId: null,
          explicitReplyFilter: null,
          currentReplyFilter: null,
          agentIdTouched: true,
        }),
      ).toBe(false);
    });
  });

  describe('update (existing instance)', () => {
    test('applies default when agent is newly assigned and instance has no filter', () => {
      expect(
        shouldApplyDefaultReplyFilter({
          newAgentId: 'new-agent-uuid',
          currentAgentId: null,
          explicitReplyFilter: undefined,
          currentReplyFilter: null,
          agentIdTouched: true,
        }),
      ).toBe(true);
    });

    test('does NOT apply when instance already has a reply filter', () => {
      expect(
        shouldApplyDefaultReplyFilter({
          newAgentId: 'agent-uuid',
          currentAgentId: null,
          explicitReplyFilter: undefined,
          currentReplyFilter: { mode: 'filtered', conditions: { onDm: true } },
          agentIdTouched: true,
        }),
      ).toBe(false);
    });

    test('does NOT apply when reassigning agent and filter already exists', () => {
      expect(
        shouldApplyDefaultReplyFilter({
          newAgentId: 'new-agent-uuid',
          currentAgentId: 'old-agent-uuid',
          explicitReplyFilter: undefined,
          currentReplyFilter: { mode: 'all', conditions: {} },
          agentIdTouched: true,
        }),
      ).toBe(false);
    });

    test('does NOT apply when unsetting the agent (agentId: null)', () => {
      expect(
        shouldApplyDefaultReplyFilter({
          newAgentId: null,
          currentAgentId: 'old-agent-uuid',
          explicitReplyFilter: undefined,
          currentReplyFilter: null,
          agentIdTouched: true,
        }),
      ).toBe(false);
    });

    test('does NOT apply when request does not touch agentId', () => {
      // PATCH that only updates name / other fields — must not auto-populate
      // even if the instance has agentId set but no filter. The trigger is
      // "user is assigning an agent", not "instance currently has an agent".
      expect(
        shouldApplyDefaultReplyFilter({
          newAgentId: undefined,
          currentAgentId: 'existing-agent-uuid',
          explicitReplyFilter: undefined,
          currentReplyFilter: null,
          agentIdTouched: false,
        }),
      ).toBe(false);
    });

    test('respects explicit filter even during agent reassignment', () => {
      expect(
        shouldApplyDefaultReplyFilter({
          newAgentId: 'new-agent-uuid',
          currentAgentId: null,
          explicitReplyFilter: { mode: 'filtered', conditions: { onMention: true } },
          currentReplyFilter: null,
          agentIdTouched: true,
        }),
      ).toBe(false);
    });

    test('respects explicit null filter (clear) during agent assignment', () => {
      expect(
        shouldApplyDefaultReplyFilter({
          newAgentId: 'new-agent-uuid',
          currentAgentId: null,
          explicitReplyFilter: null,
          currentReplyFilter: null,
          agentIdTouched: true,
        }),
      ).toBe(false);
    });
  });
});
