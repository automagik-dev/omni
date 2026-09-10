/**
 * `omni automations create|update` body builders (#1077).
 *
 * Multi-action create via repeatable --action/--action-config, full update
 * (trigger/conditions/actions) via flags or --file, and the `get` output
 * round-tripping through --file. Network paths are covered by the API route
 * tests; here we check exactly what the CLI puts on the wire.
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { __testables } from '../automations';

const { buildActions, buildDefinition, buildCreateBody, readDefinitionFile } = __testables;

function tmpJson(value: unknown): string {
  const path = join(mkdtempSync(join(tmpdir(), 'omni-automations-')), 'a.json');
  writeFileSync(path, JSON.stringify(value));
  return path;
}

describe('buildActions', () => {
  test('pairs the i-th --action-config with the i-th --action, in order', () => {
    const actions = buildActions({
      action: ['call_agent', 'send_message'],
      actionConfig: ['{"agentId":"support"}', '{"contentTemplate":"{{agentResponse}}"}'],
    });
    expect(actions).toEqual([
      { type: 'call_agent', config: { agentId: 'support' } },
      { type: 'send_message', config: { contentTemplate: '{{agentResponse}}' } },
    ]);
  });

  test('single --action without config keeps the legacy shape', () => {
    expect(buildActions({ action: ['log'] })).toEqual([{ type: 'log', config: {} }]);
  });

  test('call_agent shortcuts apply to the first call_agent action only', () => {
    const actions = buildActions({
      action: ['log', 'call_agent', 'call_agent'],
      actionConfig: ['{}', '{}', '{"agentId":"second"}'],
      agentId: 'first',
      responseAs: 'reply',
    });
    expect(actions?.[1]).toEqual({ type: 'call_agent', config: { agentId: 'first', responseAs: 'reply' } });
    expect(actions?.[2]).toEqual({ type: 'call_agent', config: { agentId: 'second' } });
  });

  test('returns undefined when no --action is given', () => {
    expect(buildActions({})).toBeUndefined();
  });

  test('rejects call_agent without an agent id', () => {
    expect(() => buildActions({ action: ['call_agent'] })).toThrow('requires --agent-id');
  });

  test('rejects more configs than actions and orphan configs', () => {
    expect(() => buildActions({ action: ['log'], actionConfig: ['{}', '{}'] })).toThrow('2 --action-config for 1');
    expect(() => buildActions({ actionConfig: ['{}'] })).toThrow('requires a matching --action');
  });

  test('names the offending --action-config on invalid JSON', () => {
    expect(() => buildActions({ action: ['log', 'log'], actionConfig: ['{}', '{oops'] })).toThrow(
      'Invalid JSON for --action-config #2',
    );
  });
});

describe('buildDefinition (update)', () => {
  test('only includes the fields that were given', () => {
    expect(buildDefinition({ name: 'n' })).toEqual({ name: 'n' });
    expect(buildDefinition({ transactionalEmissions: false })).toEqual({ transactionalEmissions: false });
    expect(buildDefinition({})).toEqual({});
  });

  test('carries trigger, conditions, logic and actions', () => {
    expect(
      buildDefinition({
        trigger: 'message.received',
        condition: '[{"field":"payload.x","operator":"eq","value":1}]',
        conditionLogic: 'or',
        action: ['log'],
        actionConfig: ['{"level":"info","message":"hi"}'],
      }),
    ).toEqual({
      triggerEventType: 'message.received',
      triggerConditions: [{ field: 'payload.x', operator: 'eq', value: 1 }],
      conditionLogic: 'or',
      actions: [{ type: 'log', config: { level: 'info', message: 'hi' } }],
    });
  });

  test('rejects a bad --condition-logic', () => {
    expect(() => buildDefinition({ conditionLogic: 'xor' })).toThrow('--condition-logic');
  });

  test('flags override --file fields', () => {
    const file = tmpJson({ name: 'from-file', priority: 1, actions: [{ type: 'log', config: {} }] });
    expect(buildDefinition({ file, name: 'from-flag' })).toEqual({
      name: 'from-flag',
      priority: 1,
      actions: [{ type: 'log', config: {} }],
    });
  });
});

describe('readDefinitionFile', () => {
  test('drops server-owned fields and nulls so `get` output round-trips', () => {
    const file = tmpJson({
      id: 'abc',
      name: 'x',
      description: null,
      triggerEventType: 'e',
      triggerConditions: null,
      actions: [{ type: 'log', config: {} }],
      managedByAgentId: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    expect(readDefinitionFile(file)).toEqual({
      name: 'x',
      triggerEventType: 'e',
      actions: [{ type: 'log', config: {} }],
    });
  });

  test('errors on unreadable file, invalid JSON and non-object', () => {
    expect(() => readDefinitionFile('/nonexistent/a.json')).toThrow("Cannot read --file '/nonexistent/a.json'");
    const bad = join(mkdtempSync(join(tmpdir(), 'omni-automations-')), 'bad.json');
    writeFileSync(bad, '{nope');
    expect(() => readDefinitionFile(bad)).toThrow('Invalid JSON for --file');
    expect(() => readDefinitionFile(tmpJson([1]))).toThrow('must contain a JSON object');
  });
});

describe('buildCreateBody', () => {
  test('legacy single-action flags produce the same body as before', () => {
    expect(
      buildCreateBody({ name: 'n', trigger: 't', action: ['call_agent'], agentId: 'a', disabled: true, priority: 2 }),
    ).toEqual({
      name: 'n',
      triggerEventType: 't',
      actions: [{ type: 'call_agent', config: { agentId: 'a' } }],
      priority: 2,
      enabled: false,
    });
  });

  test('accepts a full definition from --file alone', () => {
    const file = tmpJson({ name: 'n', triggerEventType: 't', actions: [{ type: 'log', config: {} }] });
    expect(buildCreateBody({ file }).actions).toHaveLength(1);
  });

  test('enforces name, trigger and at least one action', () => {
    expect(() => buildCreateBody({ trigger: 't', action: ['log'] })).toThrow('--name is required');
    expect(() => buildCreateBody({ name: 'n', action: ['log'] })).toThrow('--trigger is required');
    expect(() => buildCreateBody({ name: 'n', trigger: 't' })).toThrow('At least one --action');
    expect(() => buildCreateBody({ name: 'n', trigger: 't', file: tmpJson({ actions: [] }) })).toThrow(
      'At least one --action',
    );
  });
});
