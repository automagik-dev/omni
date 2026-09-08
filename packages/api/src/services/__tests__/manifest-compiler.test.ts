/**
 * Manifest compiler — pure compilation + diff logic (RFC #925 G4b, #986).
 *
 * Covers the manifest → desired-set translation (one managed automation per
 * `accepts` entry, filter → eq/AND conditions, call_agent action to the
 * declaring agent), the deterministic naming scheme reconciliation keys on,
 * and the desired-vs-existing diff (create/update/delete + strict no-op for
 * an unchanged manifest). The database-backed reconciliation path is proven
 * in `manifest-compiler-postgres.test.ts`.
 */

import { describe, expect, test } from 'bun:test';
import type { AgentEventManifest } from '@omni/core';
import type { Automation } from '@omni/db';
import {
  type DesiredCompiledAutomation,
  compileManifest,
  compiledAutomationName,
  diffCompiledAutomations,
  filterToConditions,
  stableStringify,
} from '../manifest-compiler';

const AGENT = { id: '11111111-1111-4111-8111-111111111111', name: 'reviewer' };

const manifest: AgentEventManifest = {
  accepts: [
    { event: 'custom.clickup.task.status_changed', filter: { list_id: '901300373349' } },
    { event: 'message.received' },
  ],
  publishes: [{ event: 'custom.review.parecer.ready' }],
};

/** Materialize a desired row as if it had been inserted and read back. */
function asExistingRow(desired: DesiredCompiledAutomation, id: string = crypto.randomUUID()): Automation {
  return {
    id,
    tenantId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...desired,
  } as Automation;
}

describe('filterToConditions', () => {
  test('translates each filter key into a dot-path eq condition, sorted', () => {
    expect(filterToConditions({ 'task.status': 'done', list_id: '901' })).toEqual([
      { field: 'list_id', operator: 'eq', value: '901' },
      { field: 'task.status', operator: 'eq', value: 'done' },
    ]);
  });

  test('non-string values are preserved verbatim', () => {
    expect(filterToConditions({ count: 3, flag: true })).toEqual([
      { field: 'count', operator: 'eq', value: 3 },
      { field: 'flag', operator: 'eq', value: true },
    ]);
  });

  test('absent or empty filter compiles to null (unconditional trigger)', () => {
    expect(filterToConditions(undefined)).toBeNull();
    expect(filterToConditions({})).toBeNull();
  });
});

describe('compiledAutomationName', () => {
  test('is deterministic for the same declaration', () => {
    const entry = { event: 'custom.a.b', filter: { x: 1, y: 2 } };
    expect(compiledAutomationName(AGENT.id, entry)).toBe(compiledAutomationName(AGENT.id, entry));
  });

  test('is insensitive to filter key order (canonical hash input)', () => {
    expect(compiledAutomationName(AGENT.id, { event: 'custom.a.b', filter: { x: 1, y: 2 } })).toBe(
      compiledAutomationName(AGENT.id, { event: 'custom.a.b', filter: { y: 2, x: 1 } }),
    );
  });

  test('distinguishes same event with different filters', () => {
    const a = compiledAutomationName(AGENT.id, { event: 'custom.a.b', filter: { x: 1 } });
    const b = compiledAutomationName(AGENT.id, { event: 'custom.a.b', filter: { x: 2 } });
    const c = compiledAutomationName(AGENT.id, { event: 'custom.a.b' });
    expect(new Set([a, b, c]).size).toBe(3);
  });

  test('embeds agent id and event, and always fits varchar(255)', () => {
    const name = compiledAutomationName(AGENT.id, { event: 'custom.clickup.task.status_changed' });
    expect(name.startsWith(`manifest:${AGENT.id}:custom.clickup.task.status_changed#`)).toBe(true);

    const longEvent = `custom.${'x'.repeat(300)}.done`;
    const longName = compiledAutomationName(AGENT.id, { event: longEvent });
    expect(longName.length).toBeLessThanOrEqual(255);
  });
});

describe('stableStringify', () => {
  test('sorts object keys recursively and drops undefined values', () => {
    expect(stableStringify({ b: 1, a: { d: undefined, c: [2, { f: 3, e: 4 }] } })).toBe(
      '{"a":{"c":[2,{"e":4,"f":3}]},"b":1}',
    );
  });
});

describe('compileManifest', () => {
  test('produces one managed call_agent automation per accepts entry', () => {
    const desired = compileManifest(AGENT, manifest);

    expect(desired).toHaveLength(2);
    const [filtered, unfiltered] = desired;

    expect(filtered?.triggerEventType).toBe('custom.clickup.task.status_changed');
    expect(filtered?.triggerConditions).toEqual([{ field: 'list_id', operator: 'eq', value: '901300373349' }]);
    expect(filtered?.conditionLogic).toBe('and');
    expect(filtered?.actions).toEqual([{ type: 'call_agent', config: { agentId: AGENT.id } }]);
    expect(filtered?.managedByAgentId).toBe(AGENT.id);
    expect(filtered?.enabled).toBe(true);
    expect(filtered?.priority).toBe(0);
    expect(filtered?.debounce).toBeNull();

    expect(unfiltered?.triggerEventType).toBe('message.received');
    expect(unfiltered?.triggerConditions).toBeNull();
  });

  test('publishes entries do not compile (routing is accepts-only)', () => {
    const desired = compileManifest(AGENT, { accepts: [], publishes: [{ event: 'custom.review.parecer.ready' }] });
    expect(desired).toEqual([]);
  });

  test('duplicate declarations collapse to one row', () => {
    const desired = compileManifest(AGENT, {
      accepts: [
        { event: 'message.received', filter: { chatId: 'c1' } },
        { event: 'message.received', filter: { chatId: 'c1' } },
      ],
      publishes: [],
    });
    expect(desired).toHaveLength(1);
  });

  test('a null manifest compiles to the empty set', () => {
    expect(compileManifest(AGENT, null)).toEqual([]);
  });
});

describe('diffCompiledAutomations', () => {
  test('an unchanged manifest is a strict no-op (idempotent recompile)', () => {
    const desired = compileManifest(AGENT, manifest);
    const existing = desired.map((row) => asExistingRow(row));

    const diff = diffCompiledAutomations(compileManifest(AGENT, manifest), existing);

    expect(diff.toCreate).toEqual([]);
    expect(diff.toUpdate).toEqual([]);
    expect(diff.toDelete).toEqual([]);
  });

  test('normalizes DB null conditionLogic against the compiled "and"', () => {
    const desired = compileManifest(AGENT, manifest);
    const existing = desired.map((row) => ({ ...asExistingRow(row), conditionLogic: null }) as Automation);

    const diff = diffCompiledAutomations(desired, existing);
    expect(diff.toUpdate).toEqual([]);
  });

  test('creates missing, deletes undeclared', () => {
    const desired = compileManifest(AGENT, manifest);
    const stale = asExistingRow(
      compileManifest(AGENT, { accepts: [{ event: 'chat.archived' }], publishes: [] })[0] as DesiredCompiledAutomation,
      'stale-id',
    );

    const diff = diffCompiledAutomations(desired, [stale]);

    expect(diff.toCreate.map((row) => row.triggerEventType).sort()).toEqual([
      'custom.clickup.task.status_changed',
      'message.received',
    ]);
    expect(diff.toDelete).toEqual([{ id: 'stale-id', name: stale.name }]);
    expect(diff.toUpdate).toEqual([]);
  });

  test('converges rows that drifted out-of-band', () => {
    const desired = compileManifest(AGENT, manifest);
    const drifted = desired.map((row, index) =>
      index === 0
        ? ({ ...asExistingRow(row, 'drifted-id'), enabled: false, actions: [] } as Automation)
        : asExistingRow(row),
    );

    const diff = diffCompiledAutomations(desired, drifted);

    expect(diff.toCreate).toEqual([]);
    expect(diff.toDelete).toEqual([]);
    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]?.id).toBe('drifted-id');
    expect(diff.toUpdate[0]?.desired.enabled).toBe(true);
  });
});
