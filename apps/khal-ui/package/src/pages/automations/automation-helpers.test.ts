import { describe, expect, test } from 'bun:test';
import {
  AUTOMATION_ACTIONS_TEMPLATE,
  buildAutomationBody,
  logStatusVariant,
  sampleEvent,
  validateAutomationBody,
} from './automation-helpers';

describe('validateAutomationBody', () => {
  test('accepts a minimal log automation', () => {
    const out = validateAutomationBody({
      name: 'test',
      triggerEventType: 'message.received',
      actions: AUTOMATION_ACTIONS_TEMPLATE,
    });
    expect(out.ok).toBe(true);
    expect(out.errors).toEqual([]);
  });

  test('rejects an empty actions array (min 1)', () => {
    const out = validateAutomationBody({ name: 'x', triggerEventType: 'e', actions: [] });
    expect(out.ok).toBe(false);
    expect(out.errors.some((e) => e.includes('actions'))).toBe(true);
  });

  test('rejects an unknown action type via the discriminated union', () => {
    const out = validateAutomationBody({
      name: 'x',
      triggerEventType: 'e',
      actions: [{ type: 'nuke', config: {} }],
    });
    expect(out.ok).toBe(false);
  });

  test('rejects a call_agent action missing agentId', () => {
    const out = validateAutomationBody({
      name: 'x',
      triggerEventType: 'e',
      actions: [{ type: 'call_agent', config: {} }],
    });
    expect(out.ok).toBe(false);
  });

  test('accepts a valid call_agent + condition + debounce', () => {
    const out = validateAutomationBody({
      name: 'x',
      triggerEventType: 'chat.idle_timeout',
      triggerConditions: [{ field: 'payload.x', operator: 'eq', value: 1 }],
      conditionLogic: 'and',
      actions: [{ type: 'call_agent', config: { agentId: 'a1' } }],
      debounce: { mode: 'fixed', delayMs: 500 },
    });
    expect(out.ok).toBe(true);
  });
});

describe('buildAutomationBody', () => {
  test('drops empty scalars and attaches provided parts', () => {
    const body = buildAutomationBody({
      scalars: { name: 'a', description: '', priority: 0 },
      actions: [{ type: 'log', config: { level: 'info', message: 'hi' } }],
      triggerConditions: undefined,
      debounce: { mode: 'none' },
    });
    expect(body.name).toBe('a');
    expect('description' in body).toBe(false);
    expect(body.actions).toBeDefined();
    expect('triggerConditions' in body).toBe(false);
    expect(body.debounce).toEqual({ mode: 'none' });
  });
});

describe('sampleEvent', () => {
  test('uses the trigger type, falling back to message.received', () => {
    expect(sampleEvent('chat.idle_timeout').type).toBe('chat.idle_timeout');
    expect(sampleEvent('').type).toBe('message.received');
  });
});

describe('logStatusVariant', () => {
  test('maps statuses', () => {
    expect(logStatusVariant('success')).toBe('green');
    expect(logStatusVariant('failed')).toBe('amber');
    expect(logStatusVariant('skipped')).toBe('gray');
    expect(logStatusVariant('other')).toBe('gray');
    expect(logStatusVariant(undefined)).toBe('gray');
  });
});
