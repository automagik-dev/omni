/**
 * Regression for #1030 — trigger conditions on NESTED payload paths
 * (`pull_request.merged`) must resolve through the real engine path
 * (bus → handleEvent → executeAutomation), and a non-match must record WHY
 * in the execution log instead of a silent `conditionsMatched: false`.
 */

import { describe, expect, test } from 'bun:test';
import { InMemoryEventBus } from '../../events/__tests__/memory-bus';
import type { EventType, GenericEventPayload } from '../../events/types';
import { createAutomationEngine } from '../engine';
import type { Automation, NewAutomationLog } from '../types';

const TRIGGER = 'custom.repro.pr';

function automation(): Automation {
  return {
    id: 'auto-1030',
    name: 'announce merged PRs',
    enabled: true,
    priority: 0,
    triggerEventType: TRIGGER,
    triggerConditions: [
      { field: 'action', operator: 'eq', value: 'closed' },
      { field: 'pull_request.merged', operator: 'eq', value: true },
    ],
    conditionLogic: 'and',
    actions: [{ type: 'log', config: { level: 'info', message: 'matched' } }],
    debounce: { mode: 'none' },
  } as unknown as Automation;
}

async function run(payload: Record<string, unknown>): Promise<NewAutomationLog[]> {
  const bus = new InMemoryEventBus();
  const engine = createAutomationEngine({ reconcileIntervalMs: 0 });
  const logs: NewAutomationLog[] = [];
  engine.setLogger(async (log) => {
    logs.push(log);
  });
  await engine.start(bus, [automation()]);
  await bus.publishGeneric(TRIGGER as EventType, payload as GenericEventPayload, { source: 'manual-trigger' });
  await bus.idle();
  await engine.stop();
  return logs;
}

describe('nested payload paths in trigger conditions (#1030)', () => {
  test('action == closed && pull_request.merged == true matches and executes', async () => {
    const logs = await run({ type: TRIGGER, action: 'closed', pull_request: { merged: true, number: 1 } });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.status).toBe('success');
    expect(logs[0]?.conditionsMatched).toBe(true);
  });

  test('a non-match records which condition failed and that the field was unresolved', async () => {
    const logs = await run({ type: TRIGGER, action: 'closed', pull_request: { number: 1 } });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.status).toBe('skipped');
    expect(logs[0]?.error).toBe('conditions_not_matched: pull_request.merged eq true (condition_field_unresolved)');
  });
});
