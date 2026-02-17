/**
 * Tests for Depth-Aware Tool Policy
 *
 * Validates that tools are correctly filtered based on agent nesting depth.
 */

import { describe, expect, test } from 'bun:test';
import { type DepthAwareToolConfig, filterToolsByDepth } from '../services/agent-runner';

const ALL_TOOLS = ['callAgent', 'sendMessage', 'searchWeb', 'readFile', 'writeFile'];

describe('filterToolsByDepth', () => {
  describe('when disabled (default)', () => {
    const config: DepthAwareToolConfig = { enabled: false };

    test('returns all tools at depth 0', () => {
      const result = filterToolsByDepth(ALL_TOOLS, 0, config);
      expect(result).toEqual(ALL_TOOLS);
    });

    test('returns all tools at depth 2 (max-1)', () => {
      const result = filterToolsByDepth(ALL_TOOLS, 2, config);
      expect(result).toEqual(ALL_TOOLS);
    });

    test('returns all tools at depth 3 (max)', () => {
      const result = filterToolsByDepth(ALL_TOOLS, 3, config);
      expect(result).toEqual(ALL_TOOLS);
    });

    test('returns all tools at any depth', () => {
      const result = filterToolsByDepth(ALL_TOOLS, 100, config);
      expect(result).toEqual(ALL_TOOLS);
    });
  });

  describe('when enabled with default limits (maxSpawnDepth: 3)', () => {
    const config: DepthAwareToolConfig = { enabled: true };

    test('all tools available at depth 0', () => {
      const result = filterToolsByDepth(ALL_TOOLS, 0, config);
      expect(result).toEqual(ALL_TOOLS);
    });

    test('all tools available at depth 1 (below threshold)', () => {
      const result = filterToolsByDepth(ALL_TOOLS, 1, config);
      expect(result).toEqual(ALL_TOOLS);
    });

    test('callAgent stripped at depth 2 (maxSpawnDepth - 1)', () => {
      const result = filterToolsByDepth(ALL_TOOLS, 2, config);
      expect(result).not.toContain('callAgent');
      expect(result).toContain('sendMessage');
      expect(result).toContain('searchWeb');
      expect(result).toContain('readFile');
      expect(result).toContain('writeFile');
    });

    test('callAgent stripped at depth 3 (at limit)', () => {
      const result = filterToolsByDepth(ALL_TOOLS, 3, config);
      expect(result).not.toContain('callAgent');
      expect(result).toEqual(['sendMessage', 'searchWeb', 'readFile', 'writeFile']);
    });

    test('callAgent stripped at depth > limit', () => {
      const result = filterToolsByDepth(ALL_TOOLS, 10, config);
      expect(result).not.toContain('callAgent');
    });

    test('other tools unaffected at all depths', () => {
      const nonAgentTools = ['sendMessage', 'searchWeb', 'readFile'];
      for (const depth of [0, 1, 2, 3, 10]) {
        const result = filterToolsByDepth(nonAgentTools, depth, config);
        expect(result).toEqual(nonAgentTools);
      }
    });
  });

  describe('when enabled with custom limits', () => {
    test('maxSpawnDepth: 5 strips callAgent at depth 4', () => {
      const config: DepthAwareToolConfig = {
        enabled: true,
        spawnLimits: { maxSpawnDepth: 5 },
      };
      // threshold = 5 - 1 = 4
      expect(filterToolsByDepth(ALL_TOOLS, 3, config)).toEqual(ALL_TOOLS);
      expect(filterToolsByDepth(ALL_TOOLS, 4, config)).not.toContain('callAgent');
    });

    test('maxSpawnDepth: 1 strips callAgent at depth 0', () => {
      const config: DepthAwareToolConfig = {
        enabled: true,
        spawnLimits: { maxSpawnDepth: 1 },
      };
      // threshold = 1 - 1 = 0
      expect(filterToolsByDepth(ALL_TOOLS, 0, config)).not.toContain('callAgent');
    });

    test('maxChildrenPerAgent does not affect tool filtering', () => {
      const config: DepthAwareToolConfig = {
        enabled: true,
        spawnLimits: { maxChildrenPerAgent: 1 },
      };
      // Only maxSpawnDepth matters for tool filtering (default: 3, threshold: 2)
      expect(filterToolsByDepth(ALL_TOOLS, 1, config)).toEqual(ALL_TOOLS);
      expect(filterToolsByDepth(ALL_TOOLS, 2, config)).not.toContain('callAgent');
    });
  });

  describe('edge cases', () => {
    test('empty tools list', () => {
      const config: DepthAwareToolConfig = { enabled: true };
      expect(filterToolsByDepth([], 5, config)).toEqual([]);
    });

    test('tools list without callAgent', () => {
      const config: DepthAwareToolConfig = { enabled: true };
      const tools = ['sendMessage', 'readFile'];
      expect(filterToolsByDepth(tools, 5, config)).toEqual(tools);
    });

    test('only callAgent in tools list', () => {
      const config: DepthAwareToolConfig = { enabled: true };
      expect(filterToolsByDepth(['callAgent'], 2, config)).toEqual([]);
      expect(filterToolsByDepth(['callAgent'], 1, config)).toEqual(['callAgent']);
    });
  });
});
