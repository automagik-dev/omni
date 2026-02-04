/**
 * Tests for condition evaluator
 */

import { describe, expect, test } from 'bun:test';
import { evaluateCondition, evaluateConditions, getNestedValue } from '../conditions';
import type { AutomationCondition } from '../types';

describe('getNestedValue', () => {
  test('gets top-level value', () => {
    expect(getNestedValue({ name: 'Alice' }, 'name')).toBe('Alice');
  });

  test('gets nested value', () => {
    expect(getNestedValue({ user: { name: 'Alice' } }, 'user.name')).toBe('Alice');
  });

  test('gets deeply nested value', () => {
    const obj = { a: { b: { c: { d: 'deep' } } } };
    expect(getNestedValue(obj, 'a.b.c.d')).toBe('deep');
  });

  test('returns undefined for missing path', () => {
    expect(getNestedValue({ name: 'Alice' }, 'email')).toBeUndefined();
  });

  test('returns undefined for invalid intermediate path', () => {
    expect(getNestedValue({ name: 'Alice' }, 'user.name')).toBeUndefined();
  });

  test('handles array indexing', () => {
    expect(getNestedValue({ items: ['a', 'b', 'c'] }, 'items.0')).toBe('a');
    expect(getNestedValue({ items: ['a', 'b', 'c'] }, 'items.1')).toBe('b');
  });

  test('handles null input', () => {
    expect(getNestedValue(null, 'name')).toBeUndefined();
  });

  test('handles undefined input', () => {
    expect(getNestedValue(undefined, 'name')).toBeUndefined();
  });

  test('handles empty path', () => {
    expect(getNestedValue({ name: 'Alice' }, '')).toBeUndefined();
  });
});

describe('evaluateCondition', () => {
  describe('eq operator', () => {
    test('matches equal strings', () => {
      const condition: AutomationCondition = { field: 'type', operator: 'eq', value: 'text' };
      expect(evaluateCondition(condition, { type: 'text' })).toBe(true);
    });

    test('does not match different strings', () => {
      const condition: AutomationCondition = { field: 'type', operator: 'eq', value: 'text' };
      expect(evaluateCondition(condition, { type: 'image' })).toBe(false);
    });

    test('matches equal numbers', () => {
      const condition: AutomationCondition = { field: 'count', operator: 'eq', value: 5 };
      expect(evaluateCondition(condition, { count: 5 })).toBe(true);
    });
  });

  describe('neq operator', () => {
    test('matches different values', () => {
      const condition: AutomationCondition = { field: 'type', operator: 'neq', value: 'text' };
      expect(evaluateCondition(condition, { type: 'image' })).toBe(true);
    });

    test('does not match equal values', () => {
      const condition: AutomationCondition = { field: 'type', operator: 'neq', value: 'text' };
      expect(evaluateCondition(condition, { type: 'text' })).toBe(false);
    });
  });

  describe('gt operator', () => {
    test('matches when greater', () => {
      const condition: AutomationCondition = { field: 'count', operator: 'gt', value: 5 };
      expect(evaluateCondition(condition, { count: 10 })).toBe(true);
    });

    test('does not match when equal', () => {
      const condition: AutomationCondition = { field: 'count', operator: 'gt', value: 5 };
      expect(evaluateCondition(condition, { count: 5 })).toBe(false);
    });

    test('does not match when less', () => {
      const condition: AutomationCondition = { field: 'count', operator: 'gt', value: 5 };
      expect(evaluateCondition(condition, { count: 3 })).toBe(false);
    });

    test('returns false for non-numeric values', () => {
      const condition: AutomationCondition = { field: 'name', operator: 'gt', value: 5 };
      expect(evaluateCondition(condition, { name: 'Alice' })).toBe(false);
    });
  });

  describe('lt operator', () => {
    test('matches when less', () => {
      const condition: AutomationCondition = { field: 'count', operator: 'lt', value: 5 };
      expect(evaluateCondition(condition, { count: 3 })).toBe(true);
    });

    test('does not match when greater', () => {
      const condition: AutomationCondition = { field: 'count', operator: 'lt', value: 5 };
      expect(evaluateCondition(condition, { count: 10 })).toBe(false);
    });
  });

  describe('gte operator', () => {
    test('matches when equal', () => {
      const condition: AutomationCondition = { field: 'count', operator: 'gte', value: 5 };
      expect(evaluateCondition(condition, { count: 5 })).toBe(true);
    });

    test('matches when greater', () => {
      const condition: AutomationCondition = { field: 'count', operator: 'gte', value: 5 };
      expect(evaluateCondition(condition, { count: 10 })).toBe(true);
    });
  });

  describe('lte operator', () => {
    test('matches when equal', () => {
      const condition: AutomationCondition = { field: 'count', operator: 'lte', value: 5 };
      expect(evaluateCondition(condition, { count: 5 })).toBe(true);
    });

    test('matches when less', () => {
      const condition: AutomationCondition = { field: 'count', operator: 'lte', value: 5 };
      expect(evaluateCondition(condition, { count: 3 })).toBe(true);
    });
  });

  describe('contains operator', () => {
    test('matches string containing substring', () => {
      const condition: AutomationCondition = { field: 'message', operator: 'contains', value: 'hello' };
      expect(evaluateCondition(condition, { message: 'hello world' })).toBe(true);
    });

    test('does not match string without substring', () => {
      const condition: AutomationCondition = { field: 'message', operator: 'contains', value: 'goodbye' };
      expect(evaluateCondition(condition, { message: 'hello world' })).toBe(false);
    });

    test('matches array containing value', () => {
      const condition: AutomationCondition = { field: 'tags', operator: 'contains', value: 'vip' };
      expect(evaluateCondition(condition, { tags: ['customer', 'vip', 'active'] })).toBe(true);
    });

    test('does not match array without value', () => {
      const condition: AutomationCondition = { field: 'tags', operator: 'contains', value: 'admin' };
      expect(evaluateCondition(condition, { tags: ['customer', 'vip'] })).toBe(false);
    });
  });

  describe('not_contains operator', () => {
    test('matches string not containing substring', () => {
      const condition: AutomationCondition = { field: 'message', operator: 'not_contains', value: 'goodbye' };
      expect(evaluateCondition(condition, { message: 'hello world' })).toBe(true);
    });

    test('does not match string containing substring', () => {
      const condition: AutomationCondition = { field: 'message', operator: 'not_contains', value: 'hello' };
      expect(evaluateCondition(condition, { message: 'hello world' })).toBe(false);
    });
  });

  describe('exists operator', () => {
    test('matches when field exists', () => {
      const condition: AutomationCondition = { field: 'name', operator: 'exists' };
      expect(evaluateCondition(condition, { name: 'Alice' })).toBe(true);
    });

    test('matches when field exists with falsy value', () => {
      const condition: AutomationCondition = { field: 'count', operator: 'exists' };
      expect(evaluateCondition(condition, { count: 0 })).toBe(true);
    });

    test('does not match when field is undefined', () => {
      const condition: AutomationCondition = { field: 'email', operator: 'exists' };
      expect(evaluateCondition(condition, { name: 'Alice' })).toBe(false);
    });

    test('does not match when field is null', () => {
      const condition: AutomationCondition = { field: 'email', operator: 'exists' };
      expect(evaluateCondition(condition, { email: null })).toBe(false);
    });
  });

  describe('not_exists operator', () => {
    test('matches when field is undefined', () => {
      const condition: AutomationCondition = { field: 'email', operator: 'not_exists' };
      expect(evaluateCondition(condition, { name: 'Alice' })).toBe(true);
    });

    test('matches when field is null', () => {
      const condition: AutomationCondition = { field: 'email', operator: 'not_exists' };
      expect(evaluateCondition(condition, { email: null })).toBe(true);
    });

    test('does not match when field exists', () => {
      const condition: AutomationCondition = { field: 'name', operator: 'not_exists' };
      expect(evaluateCondition(condition, { name: 'Alice' })).toBe(false);
    });
  });

  describe('regex operator', () => {
    test('matches valid regex pattern', () => {
      const condition: AutomationCondition = { field: 'email', operator: 'regex', value: '^[a-z]+@example\\.com$' };
      expect(evaluateCondition(condition, { email: 'alice@example.com' })).toBe(true);
    });

    test('does not match invalid pattern', () => {
      const condition: AutomationCondition = { field: 'email', operator: 'regex', value: '^[0-9]+$' };
      expect(evaluateCondition(condition, { email: 'alice@example.com' })).toBe(false);
    });

    test('returns false for invalid regex', () => {
      const condition: AutomationCondition = { field: 'name', operator: 'regex', value: '[invalid(' };
      expect(evaluateCondition(condition, { name: 'Alice' })).toBe(false);
    });

    describe('ReDoS protection', () => {
      test('rejects regex with nested quantifiers (a+)+', () => {
        const condition: AutomationCondition = { field: 'text', operator: 'regex', value: '(a+)+$' };
        expect(evaluateCondition(condition, { text: 'aaaaaaaaa' })).toBe(false);
      });

      test('rejects regex with nested quantifiers (a*)*', () => {
        const condition: AutomationCondition = { field: 'text', operator: 'regex', value: '(a*)*b' };
        expect(evaluateCondition(condition, { text: 'aaaaaab' })).toBe(false);
      });

      test('rejects regex pattern exceeding max length', () => {
        const longPattern = 'a'.repeat(600);
        const condition: AutomationCondition = { field: 'text', operator: 'regex', value: longPattern };
        expect(evaluateCondition(condition, { text: 'a' })).toBe(false);
      });

      test('truncates input string exceeding max length', () => {
        const longInput = 'test'.repeat(5000); // 20000 chars
        const condition: AutomationCondition = { field: 'text', operator: 'regex', value: '^test' };
        // Should still match because we truncate, not reject
        expect(evaluateCondition(condition, { text: longInput })).toBe(true);
      });

      test('allows safe regex patterns', () => {
        const condition: AutomationCondition = {
          field: 'email',
          operator: 'regex',
          value: '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$',
        };
        expect(evaluateCondition(condition, { email: 'test@example.com' })).toBe(true);
      });
    });
  });

  describe('nested field access', () => {
    test('evaluates condition on nested field', () => {
      const condition: AutomationCondition = { field: 'payload.content.type', operator: 'eq', value: 'text' };
      expect(evaluateCondition(condition, { payload: { content: { type: 'text' } } })).toBe(true);
    });
  });
});

describe('evaluateConditions', () => {
  test('returns true for empty conditions', () => {
    expect(evaluateConditions([], { name: 'Alice' })).toBe(true);
  });

  test('returns true for null conditions', () => {
    expect(evaluateConditions(null, { name: 'Alice' })).toBe(true);
  });

  test('returns true for undefined conditions', () => {
    expect(evaluateConditions(undefined, { name: 'Alice' })).toBe(true);
  });

  test('returns true when all conditions match', () => {
    const conditions: AutomationCondition[] = [
      { field: 'type', operator: 'eq', value: 'text' },
      { field: 'sender', operator: 'exists' },
    ];
    expect(evaluateConditions(conditions, { type: 'text', sender: 'Alice' })).toBe(true);
  });

  test('returns false when any condition fails', () => {
    const conditions: AutomationCondition[] = [
      { field: 'type', operator: 'eq', value: 'text' },
      { field: 'sender', operator: 'eq', value: 'Bob' },
    ];
    expect(evaluateConditions(conditions, { type: 'text', sender: 'Alice' })).toBe(false);
  });

  describe('OR logic', () => {
    test('returns true when any condition matches with or logic', () => {
      const conditions: AutomationCondition[] = [
        { field: 'text', operator: 'contains', value: 'help' },
        { field: 'text', operator: 'contains', value: 'support' },
        { field: 'text', operator: 'contains', value: 'urgent' },
      ];
      expect(evaluateConditions(conditions, { text: 'I need support please' }, 'or')).toBe(true);
    });

    test('returns true when first condition matches with or logic', () => {
      const conditions: AutomationCondition[] = [
        { field: 'type', operator: 'eq', value: 'text' },
        { field: 'type', operator: 'eq', value: 'image' },
      ];
      expect(evaluateConditions(conditions, { type: 'text' }, 'or')).toBe(true);
    });

    test('returns true when last condition matches with or logic', () => {
      const conditions: AutomationCondition[] = [
        { field: 'type', operator: 'eq', value: 'image' },
        { field: 'type', operator: 'eq', value: 'text' },
      ];
      expect(evaluateConditions(conditions, { type: 'text' }, 'or')).toBe(true);
    });

    test('returns false when no conditions match with or logic', () => {
      const conditions: AutomationCondition[] = [
        { field: 'text', operator: 'contains', value: 'help' },
        { field: 'text', operator: 'contains', value: 'support' },
      ];
      expect(evaluateConditions(conditions, { text: 'Hello world' }, 'or')).toBe(false);
    });

    test('returns true for empty conditions with or logic', () => {
      expect(evaluateConditions([], { name: 'Alice' }, 'or')).toBe(true);
    });

    test('returns true for null conditions with or logic', () => {
      expect(evaluateConditions(null, { name: 'Alice' }, 'or')).toBe(true);
    });

    test('defaults to and logic when not specified', () => {
      const conditions: AutomationCondition[] = [
        { field: 'a', operator: 'eq', value: 1 },
        { field: 'b', operator: 'eq', value: 2 },
      ];
      // Only a matches, should fail with AND (default)
      expect(evaluateConditions(conditions, { a: 1, b: 3 })).toBe(false);
      // With OR, should pass since a matches
      expect(evaluateConditions(conditions, { a: 1, b: 3 }, 'or')).toBe(true);
    });
  });
});
