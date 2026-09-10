/**
 * `AutomationService.test()` dry run (#1073): trigger match, per-condition
 * verdicts (#1030 wording — unresolved paths are visible), rendered action
 * templates, and NO side effects (no action runs, no execution log row).
 */

import { describe, expect, mock, test } from 'bun:test';
import type { EventBus } from '@omni/core';
import type { Automation, Database } from '@omni/db';
import { AutomationService } from '../automations';

const AUTOMATION_ID = '44444444-4444-4444-8444-444444444444';
const EVENT_ID = '55555555-5555-4555-8555-555555555555';

function automation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: AUTOMATION_ID,
    tenantId: null,
    name: 'gh-pr-opened',
    description: null,
    triggerEventType: 'custom.webhook.github',
    triggerConditions: [
      { field: 'action', operator: 'eq', value: 'opened' },
      { field: 'pull_request.draft', operator: 'eq', value: false },
    ],
    conditionLogic: 'and',
    actions: [
      { type: 'log', config: { level: 'info', message: 'PR {{payload.pull_request.title}} via {{event.id}}' } },
      {
        type: 'emit_event',
        config: { eventType: 'custom.pr', payloadTemplate: { title: '{{payload.pull_request.title}}' } },
      },
    ],
    debounce: null,
    enabled: true,
    priority: 0,
    transactionalEmissions: false,
    managedByAgentId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Automation;
}

function harness(row: Automation) {
  const insert = mock(() => ({ values: () => ({ returning: () => Promise.resolve([{ id: 'log' }]) }) }));
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([row]) }) }) }),
    insert,
  } as unknown as Database;
  const publish = mock(async () => ({ id: 'evt', timestamp: Date.now() }));
  const eventBus = { publish, publishGeneric: publish } as unknown as EventBus;
  return { service: new AutomationService(db, eventBus), insert, publish };
}

const journaled = {
  id: EVENT_ID,
  type: 'custom.webhook.github',
  payload: { action: 'opened', pull_request: { title: 'Add dry run', draft: false } },
  metadata: { correlationId: 'corr-1', source: 'webhook' },
  timestamp: 1_700_000_000_000,
};

describe('AutomationService.test() dry run (#1073)', () => {
  test('matching event: trigger + verdicts + rendered templates, no side effects', async () => {
    const { service, insert, publish } = harness(automation());
    const result = await service.test(AUTOMATION_ID, journaled);

    expect(result).toMatchObject({ matched: true, triggerMatched: true, conditionsMatched: true, dryRun: true });
    expect(result.eventId).toBe(EVENT_ID);
    expect(result.conditions).toEqual([
      { field: 'action', operator: 'eq', expected: 'opened', actual: 'opened', resolved: true, matched: true },
      { field: 'pull_request.draft', operator: 'eq', expected: false, actual: false, resolved: true, matched: true },
    ]);
    expect(result.actions[0]).toEqual({
      type: 'log',
      wouldExecute: true,
      config: { level: 'info', message: `PR Add dry run via ${EVENT_ID}` },
    });
    expect(result.actions[1]?.config).toEqual({ eventType: 'custom.pr', payloadTemplate: { title: 'Add dry run' } });

    expect(insert).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  test('unresolved dot path is reported as resolved=false, not a silent mismatch', async () => {
    const { service } = harness(
      automation({ triggerConditions: [{ field: 'pullRequest.draft', operator: 'eq', value: false }] }),
    );
    const result = await service.test(AUTOMATION_ID, journaled);

    expect(result.matched).toBe(false);
    expect(result.conditions[0]).toMatchObject({ field: 'pullRequest.draft', resolved: false, matched: false });
    expect(result.actions.every((a) => a.wouldExecute === false)).toBe(true);
  });

  test('conditions can reference envelope metadata, like the engine merges it', async () => {
    const { service } = harness(
      automation({ triggerConditions: [{ field: 'correlationId', operator: 'eq', value: 'corr-1' }] }),
    );
    const result = await service.test(AUTOMATION_ID, journaled);
    expect(result.conditions[0]).toMatchObject({ actual: 'corr-1', matched: true });
  });

  test('event type mismatch fails the trigger even when conditions pass', async () => {
    const { service } = harness(automation());
    const result = await service.test(AUTOMATION_ID, { ...journaled, type: 'message.received' });
    expect(result).toMatchObject({ matched: false, triggerMatched: false, conditionsMatched: true });
  });

  test('"or" logic and legacy inline event without an id', async () => {
    const { service } = harness(automation({ conditionLogic: 'or' }));
    const result = await service.test(AUTOMATION_ID, {
      type: 'custom.webhook.github',
      payload: { action: 'opened', pull_request: { draft: true } },
    });
    expect(result).toMatchObject({ matched: true, conditionLogic: 'or', eventId: null });
    expect(result.conditions.map((c) => c.matched)).toEqual([true, false]);
  });
});
