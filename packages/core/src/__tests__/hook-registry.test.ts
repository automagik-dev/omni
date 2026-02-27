/**
 * Tests for Hook Registry
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { HookRegistry } from '../hooks/registry';
import { MAX_HOOKS_PER_INSTANCE } from '../hooks/types';
import type { HookEvent } from '../hooks/types';

describe('HookRegistry', () => {
  let registry: HookRegistry;

  beforeEach(() => {
    registry = new HookRegistry();
  });

  describe('register', () => {
    test('registers a hook and returns an ID', () => {
      const hookId = registry.register('inst-1', {
        event: 'before_agent_start',
        handler: async () => {},
      });

      expect(hookId).toBeString();
      expect(hookId).toStartWith('hook_');
    });

    test('uses custom ID when provided', () => {
      const hookId = registry.register('inst-1', {
        event: 'before_agent_start',
        handler: async () => {},
        id: 'my-custom-hook',
      });

      expect(hookId).toBe('my-custom-hook');
    });

    test('registers with default priority 50', () => {
      registry.register('inst-1', {
        event: 'before_agent_start',
        handler: async () => {},
      });

      const hooks = registry.getHooks('inst-1', 'before_agent_start');
      expect(hooks).toHaveLength(1);
      expect(hooks[0]?.priority).toBe(50);
    });

    test('registers with custom priority', () => {
      registry.register('inst-1', {
        event: 'before_agent_start',
        handler: async () => {},
        priority: 10,
      });

      const hooks = registry.getHooks('inst-1', 'before_agent_start');
      expect(hooks[0]?.priority).toBe(10);
    });

    test('clamps priority to 0-100 range', () => {
      registry.register('inst-1', {
        event: 'before_agent_start',
        handler: async () => {},
        priority: -10,
        id: 'low',
      });

      registry.register('inst-1', {
        event: 'before_agent_start',
        handler: async () => {},
        priority: 200,
        id: 'high',
      });

      const hooks = registry.getHooks('inst-1', 'before_agent_start');
      const low = hooks.find((h) => h.id === 'low');
      const high = hooks.find((h) => h.id === 'high');

      expect(low?.priority).toBe(0);
      expect(high?.priority).toBe(100);
    });

    test('throws on invalid event type', () => {
      expect(() => {
        registry.register('inst-1', {
          event: 'invalid_event' as HookEvent,
          handler: async () => {},
        });
      }).toThrow('Invalid hook event');
    });

    test('stores optional name', () => {
      registry.register('inst-1', {
        event: 'before_agent_start',
        handler: async () => {},
        name: 'Model Router',
      });

      const hooks = registry.getHooks('inst-1', 'before_agent_start');
      expect(hooks[0]?.name).toBe('Model Router');
    });

    test('throws when MAX_HOOKS_PER_INSTANCE is exceeded', () => {
      // Register up to the limit
      for (let i = 0; i < MAX_HOOKS_PER_INSTANCE; i++) {
        registry.register('inst-cap', {
          event: i % 2 === 0 ? 'before_agent_start' : 'before_message_write',
          handler: async () => {},
          id: `hook-${i}`,
        });
      }

      expect(registry.getHookCount('inst-cap')).toBe(MAX_HOOKS_PER_INSTANCE);

      // One more should throw
      expect(() => {
        registry.register('inst-cap', {
          event: 'before_agent_start',
          handler: async () => {},
        });
      }).toThrow(`Hook registration limit exceeded for instance inst-cap (max: ${MAX_HOOKS_PER_INSTANCE})`);
    });

    test('hook cap is per-instance (other instances unaffected)', () => {
      // Fill inst-1 to the cap
      for (let i = 0; i < MAX_HOOKS_PER_INSTANCE; i++) {
        registry.register('inst-full', {
          event: 'before_agent_start',
          handler: async () => {},
          id: `hook-${i}`,
        });
      }

      // inst-other should still accept hooks
      expect(() => {
        registry.register('inst-other', {
          event: 'before_agent_start',
          handler: async () => {},
        });
      }).not.toThrow();
    });
  });

  describe('unregister', () => {
    test('removes a registered hook', () => {
      const hookId = registry.register('inst-1', {
        event: 'before_agent_start',
        handler: async () => {},
      });

      expect(registry.getHooks('inst-1', 'before_agent_start')).toHaveLength(1);

      const removed = registry.unregister('inst-1', hookId);
      expect(removed).toBe(true);
      expect(registry.getHooks('inst-1', 'before_agent_start')).toHaveLength(0);
    });

    test('returns false for unknown hook ID', () => {
      expect(registry.unregister('inst-1', 'nonexistent')).toBe(false);
    });

    test('returns false for unknown instance', () => {
      expect(registry.unregister('nonexistent', 'hook-1')).toBe(false);
    });
  });

  describe('getHooks', () => {
    test('returns empty array for instance with no hooks', () => {
      expect(registry.getHooks('inst-1', 'before_agent_start')).toEqual([]);
    });

    test('returns hooks sorted by priority (ascending)', () => {
      registry.register('inst-1', {
        event: 'before_agent_start',
        handler: async () => {},
        priority: 30,
        id: 'mid',
      });
      registry.register('inst-1', {
        event: 'before_agent_start',
        handler: async () => {},
        priority: 10,
        id: 'first',
      });
      registry.register('inst-1', {
        event: 'before_agent_start',
        handler: async () => {},
        priority: 50,
        id: 'last',
      });

      const hooks = registry.getHooks('inst-1', 'before_agent_start');
      expect(hooks.map((h) => h.id)).toEqual(['first', 'mid', 'last']);
    });

    test('same priority preserves registration order', () => {
      registry.register('inst-1', {
        event: 'before_agent_start',
        handler: async () => {},
        priority: 50,
        id: 'a',
      });
      registry.register('inst-1', {
        event: 'before_agent_start',
        handler: async () => {},
        priority: 50,
        id: 'b',
      });
      registry.register('inst-1', {
        event: 'before_agent_start',
        handler: async () => {},
        priority: 50,
        id: 'c',
      });

      const hooks = registry.getHooks('inst-1', 'before_agent_start');
      expect(hooks.map((h) => h.id)).toEqual(['a', 'b', 'c']);
    });

    test('isolates hooks between instances', () => {
      registry.register('inst-1', {
        event: 'before_agent_start',
        handler: async () => {},
        id: 'hook-a',
      });
      registry.register('inst-2', {
        event: 'before_agent_start',
        handler: async () => {},
        id: 'hook-b',
      });

      expect(registry.getHooks('inst-1', 'before_agent_start').map((h) => h.id)).toEqual(['hook-a']);
      expect(registry.getHooks('inst-2', 'before_agent_start').map((h) => h.id)).toEqual(['hook-b']);
    });

    test('isolates hooks between events on same instance', () => {
      registry.register('inst-1', {
        event: 'before_agent_start',
        handler: async () => {},
        id: 'start-hook',
      });
      registry.register('inst-1', {
        event: 'before_message_write',
        handler: async () => {},
        id: 'write-hook',
      });

      expect(registry.getHooks('inst-1', 'before_agent_start').map((h) => h.id)).toEqual(['start-hook']);
      expect(registry.getHooks('inst-1', 'before_message_write').map((h) => h.id)).toEqual(['write-hook']);
    });
  });

  describe('getHookCount', () => {
    test('returns 0 for empty registry', () => {
      expect(registry.getHookCount('inst-1')).toBe(0);
    });

    test('counts all hooks for an instance', () => {
      registry.register('inst-1', { event: 'before_agent_start', handler: async () => {} });
      registry.register('inst-1', { event: 'before_message_write', handler: async () => {} });

      expect(registry.getHookCount('inst-1')).toBe(2);
    });

    test('counts hooks for a specific event', () => {
      registry.register('inst-1', { event: 'before_agent_start', handler: async () => {} });
      registry.register('inst-1', { event: 'before_agent_start', handler: async () => {} });
      registry.register('inst-1', { event: 'before_message_write', handler: async () => {} });

      expect(registry.getHookCount('inst-1', 'before_agent_start')).toBe(2);
      expect(registry.getHookCount('inst-1', 'before_message_write')).toBe(1);
    });
  });

  describe('clearInstance', () => {
    test('removes all hooks for an instance', () => {
      registry.register('inst-1', { event: 'before_agent_start', handler: async () => {} });
      registry.register('inst-1', { event: 'before_message_write', handler: async () => {} });
      registry.register('inst-2', { event: 'before_agent_start', handler: async () => {} });

      registry.clearInstance('inst-1');

      expect(registry.getHookCount('inst-1')).toBe(0);
      expect(registry.getHookCount('inst-2')).toBe(1);
    });
  });

  describe('clearAll', () => {
    test('removes all hooks across all instances', () => {
      registry.register('inst-1', { event: 'before_agent_start', handler: async () => {} });
      registry.register('inst-2', { event: 'before_message_write', handler: async () => {} });

      registry.clearAll();

      expect(registry.getHookCount('inst-1')).toBe(0);
      expect(registry.getHookCount('inst-2')).toBe(0);
    });
  });
});
