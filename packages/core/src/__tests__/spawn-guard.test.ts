/**
 * Tests for Agent Spawn Guard
 *
 * Validates depth limiting, breadth limiting, context tracking,
 * and integration with the action execution pipeline.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import {
  type AgentContext,
  ChildrenTracker,
  DEFAULT_SPAWN_LIMITS,
  type SpawnLimits,
  checkSpawnAllowed,
  createRootAgentContext,
  recordCompletion,
  recordSpawn,
  resolveSpawnLimits,
} from '../agents/spawn-guard';

describe('ChildrenTracker', () => {
  let tracker: ChildrenTracker;

  beforeEach(() => {
    tracker = new ChildrenTracker();
  });

  test('returns 0 for unknown agent', () => {
    expect(tracker.getCount('inst-1', 'unknown')).toBe(0);
  });

  test('increments children count', () => {
    tracker.increment('inst-1', 'agent-1');
    expect(tracker.getCount('inst-1', 'agent-1')).toBe(1);
    tracker.increment('inst-1', 'agent-1');
    expect(tracker.getCount('inst-1', 'agent-1')).toBe(2);
  });

  test('decrements children count', () => {
    tracker.increment('inst-1', 'agent-1');
    tracker.increment('inst-1', 'agent-1');
    tracker.decrement('inst-1', 'agent-1');
    expect(tracker.getCount('inst-1', 'agent-1')).toBe(1);
  });

  test('does not go below 0', () => {
    tracker.decrement('inst-1', 'agent-1');
    expect(tracker.getCount('inst-1', 'agent-1')).toBe(0);
  });

  test('cleans up zero entries', () => {
    tracker.increment('inst-1', 'agent-1');
    tracker.decrement('inst-1', 'agent-1');
    expect(tracker.getCount('inst-1', 'agent-1')).toBe(0);
  });

  test('tracks multiple agents independently', () => {
    tracker.increment('inst-1', 'agent-1');
    tracker.increment('inst-1', 'agent-1');
    tracker.increment('inst-1', 'agent-2');
    expect(tracker.getCount('inst-1', 'agent-1')).toBe(2);
    expect(tracker.getCount('inst-1', 'agent-2')).toBe(1);
  });

  test('isolates agents across different instances', () => {
    tracker.increment('inst-1', 'shared-agent');
    tracker.increment('inst-1', 'shared-agent');
    tracker.increment('inst-1', 'shared-agent');
    // inst-2 should be unaffected by inst-1's count
    expect(tracker.getCount('inst-2', 'shared-agent')).toBe(0);
  });

  test('clear resets all tracking', () => {
    tracker.increment('inst-1', 'agent-1');
    tracker.increment('inst-2', 'agent-2');
    tracker.clear();
    expect(tracker.getCount('inst-1', 'agent-1')).toBe(0);
    expect(tracker.getCount('inst-2', 'agent-2')).toBe(0);
  });
});

describe('checkSpawnAllowed', () => {
  let tracker: ChildrenTracker;
  const defaultLimits = DEFAULT_SPAWN_LIMITS;

  beforeEach(() => {
    tracker = new ChildrenTracker();
  });

  test('allows spawn at depth 0 (becomes depth 1)', () => {
    const context: AgentContext = {
      agentDepth: 0,
      agentId: 'root-agent',
      instanceId: 'inst-1',
    };
    const decision = checkSpawnAllowed(context, defaultLimits, tracker);
    expect(decision.allowed).toBe(true);
  });

  test('allows spawn at depth 2 (becomes depth 3, at limit)', () => {
    const context: AgentContext = {
      agentDepth: 2,
      agentId: 'mid-agent',
      instanceId: 'inst-1',
    };
    const decision = checkSpawnAllowed(context, defaultLimits, tracker);
    expect(decision.allowed).toBe(true);
  });

  test('rejects spawn at depth 3 (exceeds default limit of 3)', () => {
    const context: AgentContext = {
      agentDepth: 3,
      agentId: 'deep-agent',
      instanceId: 'inst-1',
    };
    const decision = checkSpawnAllowed(context, defaultLimits, tracker);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toContain('max depth 3 exceeded');
      expect(decision.reason).toContain('current depth: 3');
    }
  });

  test('rejects spawn at depth 4 (well beyond limit)', () => {
    const context: AgentContext = {
      agentDepth: 4,
      agentId: 'very-deep-agent',
      instanceId: 'inst-1',
    };
    const decision = checkSpawnAllowed(context, defaultLimits, tracker);
    expect(decision.allowed).toBe(false);
  });

  test('rejects 6th child when 5 active (default breadth limit)', () => {
    const context: AgentContext = {
      agentDepth: 0,
      agentId: 'parent-agent',
      instanceId: 'inst-1',
    };
    // Simulate 5 active children for this instance
    for (let i = 0; i < 5; i++) {
      tracker.increment('inst-1', 'parent-agent');
    }

    const decision = checkSpawnAllowed(context, defaultLimits, tracker);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toContain('max children 5 exceeded');
      expect(decision.reason).toContain('current children: 5');
    }
  });

  test('allows spawn after child completes (frees slot)', () => {
    const context: AgentContext = {
      agentDepth: 0,
      agentId: 'parent-agent',
      instanceId: 'inst-1',
    };
    // Fill to max
    for (let i = 0; i < 5; i++) {
      tracker.increment('inst-1', 'parent-agent');
    }
    // One child completes
    tracker.decrement('inst-1', 'parent-agent');

    const decision = checkSpawnAllowed(context, defaultLimits, tracker);
    expect(decision.allowed).toBe(true);
  });

  test('does not cross-pollute breadth counts across instances', () => {
    const contextInst1: AgentContext = { agentDepth: 0, agentId: 'shared-agent', instanceId: 'inst-1' };
    const contextInst2: AgentContext = { agentDepth: 0, agentId: 'shared-agent', instanceId: 'inst-2' };
    const customLimits: SpawnLimits = { maxSpawnDepth: 3, maxChildrenPerAgent: 2 };

    // Fill inst-1 to max
    tracker.increment('inst-1', 'shared-agent');
    tracker.increment('inst-1', 'shared-agent');

    // inst-1 should be blocked
    expect(checkSpawnAllowed(contextInst1, customLimits, tracker).allowed).toBe(false);
    // inst-2 should still be allowed
    expect(checkSpawnAllowed(contextInst2, customLimits, tracker).allowed).toBe(true);
  });

  test('custom maxSpawnDepth: 5 allows deeper chains', () => {
    const customLimits: SpawnLimits = { maxSpawnDepth: 5, maxChildrenPerAgent: 5 };
    const context: AgentContext = {
      agentDepth: 4,
      agentId: 'deep-agent',
      instanceId: 'inst-1',
    };
    const decision = checkSpawnAllowed(context, customLimits, tracker);
    expect(decision.allowed).toBe(true);
  });

  test('custom maxSpawnDepth: 5 rejects at depth 5', () => {
    const customLimits: SpawnLimits = { maxSpawnDepth: 5, maxChildrenPerAgent: 5 };
    const context: AgentContext = {
      agentDepth: 5,
      agentId: 'too-deep-agent',
      instanceId: 'inst-1',
    };
    const decision = checkSpawnAllowed(context, customLimits, tracker);
    expect(decision.allowed).toBe(false);
  });

  test('custom maxChildrenPerAgent: 2', () => {
    const customLimits: SpawnLimits = { maxSpawnDepth: 3, maxChildrenPerAgent: 2 };
    const context: AgentContext = {
      agentDepth: 0,
      agentId: 'parent',
      instanceId: 'inst-1',
    };
    tracker.increment('inst-1', 'parent');
    tracker.increment('inst-1', 'parent');

    const decision = checkSpawnAllowed(context, customLimits, tracker);
    expect(decision.allowed).toBe(false);
  });

  test('depth check runs before breadth check', () => {
    // Both limits exceeded — depth error reported
    const context: AgentContext = {
      agentDepth: 3,
      agentId: 'agent',
      instanceId: 'inst-1',
    };
    for (let i = 0; i < 5; i++) {
      tracker.increment('inst-1', 'agent');
    }

    const decision = checkSpawnAllowed(context, defaultLimits, tracker);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toContain('max depth');
    }
  });
});

describe('recordSpawn', () => {
  let tracker: ChildrenTracker;

  beforeEach(() => {
    tracker = new ChildrenTracker();
  });

  test('increments parent children and returns child context', () => {
    const parent: AgentContext = {
      agentDepth: 0,
      agentId: 'parent',
      instanceId: 'inst-1',
    };

    const child = recordSpawn(parent, 'child-1', tracker);

    expect(child.agentDepth).toBe(1);
    expect(child.agentId).toBe('child-1');
    expect(child.parentAgentId).toBe('parent');
    expect(child.instanceId).toBe('inst-1');
    expect(tracker.getCount('inst-1', 'parent')).toBe(1);
  });

  test('depth increments correctly through chain', () => {
    const root: AgentContext = {
      agentDepth: 0,
      agentId: 'root',
      instanceId: 'inst-1',
    };

    const level1 = recordSpawn(root, 'level1', tracker);
    expect(level1.agentDepth).toBe(1);

    const level2 = recordSpawn(level1, 'level2', tracker);
    expect(level2.agentDepth).toBe(2);

    const level3 = recordSpawn(level2, 'level3', tracker);
    expect(level3.agentDepth).toBe(3);
  });
});

describe('recordCompletion', () => {
  let tracker: ChildrenTracker;

  beforeEach(() => {
    tracker = new ChildrenTracker();
  });

  test('decrements parent children count', () => {
    const parent: AgentContext = {
      agentDepth: 0,
      agentId: 'parent',
      instanceId: 'inst-1',
    };
    const child = recordSpawn(parent, 'child-1', tracker);
    expect(tracker.getCount('inst-1', 'parent')).toBe(1);

    recordCompletion(child, tracker);
    expect(tracker.getCount('inst-1', 'parent')).toBe(0);
  });

  test('no-op for root agent (no parent)', () => {
    const root: AgentContext = {
      agentDepth: 0,
      agentId: 'root',
      instanceId: 'inst-1',
    };
    // Should not throw
    recordCompletion(root, tracker);
    expect(tracker.getCount('inst-1', 'root')).toBe(0);
  });
});

describe('createRootAgentContext', () => {
  test('creates context at depth 0 with no parent', () => {
    const ctx = createRootAgentContext('agent-1', 'inst-1');
    expect(ctx.agentDepth).toBe(0);
    expect(ctx.agentId).toBe('agent-1');
    expect(ctx.instanceId).toBe('inst-1');
    expect(ctx.parentAgentId).toBeUndefined();
  });
});

describe('resolveSpawnLimits', () => {
  test('returns defaults when no config provided', () => {
    const limits = resolveSpawnLimits();
    expect(limits.maxSpawnDepth).toBe(3);
    expect(limits.maxChildrenPerAgent).toBe(5);
  });

  test('returns defaults when empty config', () => {
    const limits = resolveSpawnLimits({});
    expect(limits.maxSpawnDepth).toBe(3);
    expect(limits.maxChildrenPerAgent).toBe(5);
  });

  test('overrides maxSpawnDepth', () => {
    const limits = resolveSpawnLimits({ maxSpawnDepth: 10 });
    expect(limits.maxSpawnDepth).toBe(10);
    expect(limits.maxChildrenPerAgent).toBe(5);
  });

  test('overrides maxChildrenPerAgent', () => {
    const limits = resolveSpawnLimits({ maxChildrenPerAgent: 2 });
    expect(limits.maxSpawnDepth).toBe(3);
    expect(limits.maxChildrenPerAgent).toBe(2);
  });

  test('overrides both', () => {
    const limits = resolveSpawnLimits({ maxSpawnDepth: 7, maxChildrenPerAgent: 10 });
    expect(limits.maxSpawnDepth).toBe(7);
    expect(limits.maxChildrenPerAgent).toBe(10);
  });
});

describe('full spawn lifecycle', () => {
  let tracker: ChildrenTracker;

  beforeEach(() => {
    tracker = new ChildrenTracker();
  });

  test('spawn chain: root -> level1 -> level2 -> level3 (rejected at 3)', () => {
    const limits = DEFAULT_SPAWN_LIMITS; // maxSpawnDepth: 3

    // Root at depth 0
    const root = createRootAgentContext('root', 'inst-1');

    // Spawn level 1 (depth 0 -> 1)
    let decision = checkSpawnAllowed(root, limits, tracker);
    expect(decision.allowed).toBe(true);
    const level1 = recordSpawn(root, 'level1', tracker);
    expect(level1.agentDepth).toBe(1);

    // Spawn level 2 (depth 1 -> 2)
    decision = checkSpawnAllowed(level1, limits, tracker);
    expect(decision.allowed).toBe(true);
    const level2 = recordSpawn(level1, 'level2', tracker);
    expect(level2.agentDepth).toBe(2);

    // Spawn level 3 (depth 2 -> 3, at limit)
    decision = checkSpawnAllowed(level2, limits, tracker);
    expect(decision.allowed).toBe(true);
    const level3 = recordSpawn(level2, 'level3', tracker);
    expect(level3.agentDepth).toBe(3);

    // Try to spawn level 4 (depth 3 -> 4, REJECTED)
    decision = checkSpawnAllowed(level3, limits, tracker);
    expect(decision.allowed).toBe(false);
  });

  test('breadth: spawn 5 children, fail on 6th, complete one, succeed again', () => {
    const limits = DEFAULT_SPAWN_LIMITS; // maxChildrenPerAgent: 5
    const parent = createRootAgentContext('parent', 'inst-1');

    // Spawn 5 children
    const children: AgentContext[] = [];
    for (let i = 0; i < 5; i++) {
      const decision = checkSpawnAllowed(parent, limits, tracker);
      expect(decision.allowed).toBe(true);
      children.push(recordSpawn(parent, `child-${i}`, tracker));
    }

    // 6th child rejected
    const rejection = checkSpawnAllowed(parent, limits, tracker);
    expect(rejection.allowed).toBe(false);

    // Complete one child
    const firstChild = children[0];
    if (firstChild) recordCompletion(firstChild, tracker);

    // Now 6th child allowed
    const allowed = checkSpawnAllowed(parent, limits, tracker);
    expect(allowed.allowed).toBe(true);
  });
});
