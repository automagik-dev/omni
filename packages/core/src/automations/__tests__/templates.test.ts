/**
 * Tests for template substitution
 */

import { describe, expect, test } from 'bun:test';
import { createTemplateContext, substituteTemplate, substituteTemplateObject } from '../templates';

describe('substituteTemplate', () => {
  const baseContext = createTemplateContext({ name: 'Alice', age: 30, email: 'alice@example.com' });

  test('substitutes simple payload fields', () => {
    expect(substituteTemplate('Hello {{payload.name}}!', baseContext)).toBe('Hello Alice!');
  });

  test('substitutes multiple fields', () => {
    expect(substituteTemplate('{{payload.name}} is {{payload.age}} years old', baseContext)).toBe(
      'Alice is 30 years old',
    );
  });

  test('returns empty string for missing fields', () => {
    expect(substituteTemplate('Hello {{payload.missing}}!', baseContext)).toBe('Hello !');
  });

  test('handles nested field access', () => {
    const context = createTemplateContext({
      user: { profile: { name: 'Bob' } },
    });
    expect(substituteTemplate('Hello {{payload.user.profile.name}}!', context)).toBe('Hello Bob!');
  });

  test('handles env variables', () => {
    const context = createTemplateContext({}, { variables: {} });
    // Note: This will depend on actual env vars
    expect(substituteTemplate('Path: {{env.PATH}}', context)).toContain(':');
  });

  test('handles stored variables', () => {
    const context = createTemplateContext({ name: 'Alice' }, { variables: { response: { text: 'Hello back!' } } });
    expect(substituteTemplate('Response: {{response.text}}', context)).toBe('Response: Hello back!');
  });

  test('serializes objects as JSON', () => {
    const context = createTemplateContext({ user: { name: 'Alice' } });
    expect(substituteTemplate('User: {{payload.user}}', context)).toBe('User: {"name":"Alice"}');
  });

  test('serializes arrays as JSON', () => {
    const context = createTemplateContext({ tags: ['a', 'b', 'c'] });
    expect(substituteTemplate('Tags: {{payload.tags}}', context)).toBe('Tags: ["a","b","c"]');
  });

  test('handles debounce context - messages', () => {
    const context = createTemplateContext(
      { text: 'last message' },
      {
        debounce: {
          messages: [
            { type: 'text', text: 'first', timestamp: 1000 },
            { type: 'text', text: 'second', timestamp: 2000 },
          ],
          from: { id: '+1234567890', name: 'Alice' },
          instanceId: 'wa-001',
        },
      },
    );

    const result = substituteTemplate('Messages: {{messages}}', context);
    expect(result).toContain('first');
    expect(result).toContain('second');
  });

  test('handles debounce context - from', () => {
    const context = createTemplateContext(
      {},
      {
        debounce: {
          messages: [],
          from: { id: '+1234567890', name: 'Alice' },
          instanceId: 'wa-001',
        },
      },
    );

    expect(substituteTemplate('From: {{from.name}}', context)).toBe('From: Alice');
    expect(substituteTemplate('ID: {{from.id}}', context)).toBe('ID: +1234567890');
  });

  test('handles debounce context - instanceId', () => {
    const context = createTemplateContext(
      {},
      {
        debounce: {
          messages: [],
          from: { id: '+1234567890' },
          instanceId: 'wa-001',
        },
      },
    );

    expect(substituteTemplate('Instance: {{instanceId}}', context)).toBe('Instance: wa-001');
  });

  test('preserves text without templates', () => {
    expect(substituteTemplate('Hello World!', baseContext)).toBe('Hello World!');
  });

  test('handles empty template', () => {
    expect(substituteTemplate('', baseContext)).toBe('');
  });
});

describe('substituteTemplateObject', () => {
  test('substitutes in object values', () => {
    const context = createTemplateContext({ name: 'Alice' });
    const obj = { greeting: 'Hello {{payload.name}}!' };
    const result = substituteTemplateObject(obj, context);
    expect(result.greeting).toBe('Hello Alice!');
  });

  test('substitutes in nested objects', () => {
    const context = createTemplateContext({ name: 'Alice' });
    const obj = { user: { greeting: 'Hello {{payload.name}}!' } };
    const result = substituteTemplateObject(obj, context);
    expect(result.user).toEqual({ greeting: 'Hello Alice!' });
  });

  test('substitutes in arrays', () => {
    const context = createTemplateContext({ name: 'Alice' });
    const obj = { messages: ['Hello {{payload.name}}!', 'Goodbye {{payload.name}}!'] };
    const result = substituteTemplateObject(obj, context);
    expect(result.messages).toEqual(['Hello Alice!', 'Goodbye Alice!']);
  });

  test('preserves non-string values', () => {
    const context = createTemplateContext({ name: 'Alice' });
    const obj = { count: 5, active: true, greeting: 'Hello {{payload.name}}!' };
    const result = substituteTemplateObject(obj, context);
    expect(result).toEqual({ count: 5, active: true, greeting: 'Hello Alice!' });
  });
});

describe('createTemplateContext', () => {
  test('creates context with payload', () => {
    const context = createTemplateContext({ name: 'Alice' });
    expect(context.payload).toEqual({ name: 'Alice' });
  });

  test('creates context with variables', () => {
    const context = createTemplateContext({}, { variables: { key: 'value' } });
    expect(context.variables).toEqual({ key: 'value' });
  });

  test('creates context with debounce', () => {
    const debounce = {
      messages: [{ type: 'text', timestamp: 1000 }],
      from: { id: '123' },
      instanceId: 'wa-001',
    };
    const context = createTemplateContext({}, { debounce });
    expect(context.debounce).toEqual(debounce);
  });

  test('provides env access', () => {
    const context = createTemplateContext({});
    expect(context.env).toBeDefined();
    expect(typeof context.env.PATH).toBe('string');
  });
});
