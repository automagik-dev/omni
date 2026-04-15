/**
 * Tests for template substitution
 */

import { describe, expect, test } from 'bun:test';
import {
  createTemplateContext,
  deriveFollowUpFromPayload,
  substituteTemplate,
  substituteTemplateObject,
} from '../templates';

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

  test('auto-derives followUp from chat.idle_timeout-shaped payload', () => {
    const context = createTemplateContext({
      syntheticPrompt: 'Please follow up',
      sequenceIndex: 1,
      attemptNumber: 2,
      totalAttempts: 3,
      minutesSinceLastAgentReply: 3,
      chatName: 'VIP Chat',
    });
    expect(context.followUp).toEqual({
      syntheticPrompt: 'Please follow up',
      sequenceIndex: 1,
      attemptNumber: 2,
      totalAttempts: 3,
      minutes: 3,
      chatName: 'VIP Chat',
    });
  });

  test('skips followUp derivation when mandatory fields missing', () => {
    const context = createTemplateContext({ syntheticPrompt: 'only this' });
    expect(context.followUp).toBeUndefined();
  });

  test('explicit followUp overrides payload-derived followUp', () => {
    const context = createTemplateContext(
      {
        syntheticPrompt: 'from payload',
        sequenceIndex: 0,
        minutesSinceLastAgentReply: 1,
      },
      {
        followUp: {
          syntheticPrompt: 'explicit',
          sequenceIndex: 9,
          attemptNumber: 10,
          totalAttempts: 12,
          minutes: 99,
          chatName: 'override',
        },
      },
    );
    expect(context.followUp?.syntheticPrompt).toBe('explicit');
    expect(context.followUp?.sequenceIndex).toBe(9);
    expect(context.followUp?.attemptNumber).toBe(10);
    expect(context.followUp?.totalAttempts).toBe(12);
    expect(context.followUp?.minutes).toBe(99);
    expect(context.followUp?.chatName).toBe('override');
  });
});

describe('deriveFollowUpFromPayload', () => {
  test('returns context when all mandatory fields present', () => {
    const result = deriveFollowUpFromPayload({
      syntheticPrompt: 'ping',
      sequenceIndex: 0,
      attemptNumber: 1,
      totalAttempts: 3,
      minutesSinceLastAgentReply: 5,
    });
    expect(result).toEqual({
      syntheticPrompt: 'ping',
      sequenceIndex: 0,
      attemptNumber: 1,
      totalAttempts: 3,
      minutes: 5,
      chatName: null,
    });
  });

  test('derives attemptNumber from sequenceIndex when absent (legacy payload)', () => {
    const result = deriveFollowUpFromPayload({
      syntheticPrompt: 'ping',
      sequenceIndex: 2,
      minutesSinceLastAgentReply: 5,
    });
    expect(result?.attemptNumber).toBe(3);
    expect(result?.totalAttempts).toBe(0);
  });

  test('chatName is null when not a string', () => {
    const result = deriveFollowUpFromPayload({
      syntheticPrompt: 'ping',
      sequenceIndex: 0,
      attemptNumber: 1,
      totalAttempts: 3,
      minutesSinceLastAgentReply: 5,
      chatName: 42,
    });
    expect(result?.chatName).toBeNull();
  });

  test('returns undefined when missing syntheticPrompt', () => {
    const result = deriveFollowUpFromPayload({
      sequenceIndex: 0,
      minutesSinceLastAgentReply: 5,
    });
    expect(result).toBeUndefined();
  });

  test('returns undefined when sequenceIndex is not a number', () => {
    const result = deriveFollowUpFromPayload({
      syntheticPrompt: 'ping',
      sequenceIndex: '0',
      minutesSinceLastAgentReply: 5,
    });
    expect(result).toBeUndefined();
  });
});

describe('follow-up placeholders', () => {
  const followUpContext = createTemplateContext(
    { chatId: 'c-1' },
    {
      followUp: {
        syntheticPrompt: 'Hey, still there?',
        minutes: 7,
        sequenceIndex: 2,
        attemptNumber: 3,
        totalAttempts: 3,
        chatName: 'Alice',
      },
    },
  );

  test('substitutes {{syntheticPrompt}}', () => {
    expect(substituteTemplate('Prompt: {{syntheticPrompt}}', followUpContext)).toBe('Prompt: Hey, still there?');
  });

  test('substitutes {{minutes}}', () => {
    expect(substituteTemplate('Idle {{minutes}}min', followUpContext)).toBe('Idle 7min');
  });

  test('substitutes {{sequenceIndex}}', () => {
    expect(substituteTemplate('Attempt {{sequenceIndex}}', followUpContext)).toBe('Attempt 2');
  });

  test('substitutes {{attemptNumber}} (1-based)', () => {
    expect(substituteTemplate('Attempt {{attemptNumber}} of {{totalAttempts}}', followUpContext)).toBe(
      'Attempt 3 of 3',
    );
  });

  test('substitutes {{chatName}}', () => {
    expect(substituteTemplate('Chat: {{chatName}}', followUpContext)).toBe('Chat: Alice');
  });

  test('ignores whitespace inside placeholder', () => {
    expect(substituteTemplate('{{ syntheticPrompt }} / {{ minutes }}', followUpContext)).toBe('Hey, still there? / 7');
  });

  test('empty chatName renders empty string', () => {
    const context = createTemplateContext(
      {},
      {
        followUp: {
          syntheticPrompt: 'p',
          minutes: 1,
          sequenceIndex: 0,
          attemptNumber: 1,
          totalAttempts: 3,
          chatName: null,
        },
      },
    );
    expect(substituteTemplate('Chat: {{chatName}}', context)).toBe('Chat: ');
  });

  test('missing followUp falls back to payload lookup', () => {
    // Without followUp, `{{syntheticPrompt}}` should resolve via payload fallback.
    const context = createTemplateContext({ syntheticPrompt: 'fallback!' });
    // ^ This payload triggers auto-derive, so followUp is undefined (missing
    //   sequenceIndex + minutesSinceLastAgentReply). The fallback path reads
    //   the field directly from payload.
    expect(context.followUp).toBeUndefined();
    expect(substituteTemplate('{{syntheticPrompt}}', context)).toBe('fallback!');
  });

  test('multi-placeholder render', () => {
    const template = 'Ping {{chatName}} after {{minutes}}m (#{{sequenceIndex}}): {{syntheticPrompt}}';
    expect(substituteTemplate(template, followUpContext)).toBe('Ping Alice after 7m (#2): Hey, still there?');
  });

  test('existing placeholders still work alongside followUp', () => {
    const context = createTemplateContext(
      { userName: 'Bob' },
      {
        followUp: {
          syntheticPrompt: 'nudge',
          minutes: 3,
          sequenceIndex: 0,
          attemptNumber: 1,
          totalAttempts: 3,
          chatName: 'c',
        },
      },
    );
    expect(substituteTemplate('{{payload.userName}}: {{syntheticPrompt}}', context)).toBe('Bob: nudge');
  });
});
