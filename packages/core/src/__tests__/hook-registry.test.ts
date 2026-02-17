/**
 * Tests for Hook Registry
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { HookRegistry } from '../hooks/registry';
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
        event: 'llm_input',
        handler: async () => {},
      });

      const hooks = registry.getHooks('inst-1', 'llm_input');
      expect(hooks).toHaveLength(1);
      expect(hooks[0].priority).toBe(50);
    });

    test('registers with custom priority', () => {
      registry.register('inst-1', {
        event: 'llm_input',
        handler: async () => {},
        priority: 10,
      });

      const hooks = registry.getHooks('inst-1', 'llm_input');
      expect(hooks[0].priority).toBe(10);
    });

    test('clamps priority to 0-100 range', () => {
      registry.register('inst-1', {
        event: 'llm_input',
        handler: async () => {},
        priority: -10,
        id: 'low',
      });

      registry.register('inst-1', {
        event: 'llm_input',
        handler: async () => {},
        priority: 200,
        id: 'high',
      });

      const hooks = registry.getHooks('inst-1', 'llm_input');
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
      expect(hooks[0].name).toBe('Model Router');
    });
  });

  describe('unregister', () => {
    test('removes a registered hook', () => {
      const hookId = registry.register('inst-1', {
        event: 'llm_input',
        handler: async () => {},
      });

      expect(registry.getHooks('inst-1', 'llm_input')).toHaveLength(1);

      const removed = registry.unregister('inst-1', hookId);
      expect(removed).toBe(true);
      expect(registry.getHooks('inst-1', 'llm_input')).toHaveLength(0);
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
      expect(registry.getHooks('inst-1', 'llm_input')).toEqual([]);
    });

    test('returns hooks sorted by priority (ascending)', () => {
      registry.register('inst-1', {
        event: 'llm_input',
        handler: async () => {},
        priority: 30,
        id: 'mid',
      });
      registry.register('inst-1', {
        event: 'llm_input',
        handler: async () => {},
        priority: 10,
        id: 'first',
      });
      registry.register('inst-1', {
        event: 'llm_input',
        handler: async () => {},
        priority: 50,
        id: 'last',
      });

      const hooks = registry.getHooks('inst-1', 'llm_input');
      expect(hooks.map((h) => h.id)).toEqual(['first', 'mid', 'last']);
    });

    test('same priority preserves registration order', () => {
      registry.register('inst-1', {
        event: 'llm_input',
        handler: async () => {},
        priority: 50,
        id: 'a',
      });
      registry.register('inst-1', {
        event: 'llm_input',
        handler: async () => {},
        priority: 50,
        id: 'b',
      });
      registry.register('inst-1', {
        event: 'llm_input',
        handler: async () => {},
        priority: 50,
        id: 'c',
      });

      const hooks = registry.getHooks('inst-1', 'llm_input');
      expect(hooks.map((h) => h.id)).toEqual(['a', 'b', 'c']);
    });

    test('isolates hooks between instances', () => {
      registry.register('inst-1', {
        event: 'llm_input',
        handler: async () => {},
        id: 'hook-a',
      });
      registry.register('inst-2', {
        event: 'llm_input',
        handler: async () => {},
        id: 'hook-b',
      });

      expect(registry.getHooks('inst-1', 'llm_input').map((h) => h.id)).toEqual(['hook-a']);
      expect(registry.getHooks('inst-2', 'llm_input').map((h) => h.id)).toEqual(['hook-b']);
    });

    test('isolates hooks between events on same instance', () => {
      registry.register('inst-1', {
        event: 'llm_input',
        handler: async () => {},
        id: 'input-hook',
      });
      registry.register('inst-1', {
        event: 'llm_output',
        handler: async () => {},
        id: 'output-hook',
      });

      expect(registry.getHooks('inst-1', 'llm_input').map((h) => h.id)).toEqual(['input-hook']);
      expect(registry.getHooks('inst-1', 'llm_output').map((h) => h.id)).toEqual(['output-hook']);
    });
  });

  describe('getHookCount', () => {
    test('returns 0 for empty registry', () => {
      expect(registry.getHookCount('inst-1')).toBe(0);
    });

    test('counts all hooks for an instance', () => {
      registry.register('inst-1', { event: 'llm_input', handler: async () => {} });
      registry.register('inst-1', { event: 'llm_output', handler: async () => {} });

      expect(registry.getHookCount('inst-1')).toBe(2);
    });

    test('counts hooks for a specific event', () => {
      registry.register('inst-1', { event: 'llm_input', handler: async () => {} });
      registry.register('inst-1', { event: 'llm_input', handler: async () => {} });
      registry.register('inst-1', { event: 'llm_output', handler: async () => {} });

      expect(registry.getHookCount('inst-1', 'llm_input')).toBe(2);
      expect(registry.getHookCount('inst-1', 'llm_output')).toBe(1);
    });
  });

  describe('clearInstance', () => {
    test('removes all hooks for an instance', () => {
      registry.register('inst-1', { event: 'llm_input', handler: async () => {} });
      registry.register('inst-1', { event: 'llm_output', handler: async () => {} });
      registry.register('inst-2', { event: 'llm_input', handler: async () => {} });

      registry.clearInstance('inst-1');

      expect(registry.getHookCount('inst-1')).toBe(0);
      expect(registry.getHookCount('inst-2')).toBe(1);
    });
  });

  describe('clearAll', () => {
    test('removes all hooks across all instances', () => {
      registry.register('inst-1', { event: 'llm_input', handler: async () => {} });
      registry.register('inst-2', { event: 'llm_output', handler: async () => {} });

      registry.clearAll();

      expect(registry.getHookCount('inst-1')).toBe(0);
      expect(registry.getHookCount('inst-2')).toBe(0);
    });
  });
});
