/**
 * ClickUp automation action adapter (#1413).
 *
 * Proves the engine-deps `clickupAction` callback:
 *   - resolves the instance through `services.instances.getById` (one short
 *     tenant work block) and refuses a non-clickup instance;
 *   - resolves the plugin through the existing `resolvePlugin` seam and calls
 *     its structural `execute`;
 *   - returns the plugin's normalized result, and surfaces a thrown ClickUp
 *     error's own text as the action failure (never a generic message).
 *
 * The core side of the action is exercised too, so template rendering and the
 * operation-specific validation are part of this contract.
 */

import { describe, expect, test } from 'bun:test';
import type { ChannelPlugin } from '@omni/channel-sdk';
import { type ClickUpActionConfig, createTemplateContext, executeAction } from '@omni/core';
import type { Database } from '@omni/db';
import type { Services } from '../../services';
import { buildAutomationEngineDeps } from '../automation-actions';

interface ExecutedAction {
  instanceId: string;
  request: Record<string, unknown>;
}

interface Harness {
  deps: ReturnType<typeof buildAutomationEngineDeps>;
  executed: ExecutedAction[];
  instanceLookups: string[];
  pluginLookups: string[];
}

function harness(options: { channel?: string; throwError?: Error } = {}): Harness {
  const executed: ExecutedAction[] = [];
  const instanceLookups: string[] = [];
  const pluginLookups: string[] = [];

  const instance = { id: 'clickup-inst', channel: options.channel ?? 'clickup', tenantId: null };
  const plugin = {
    id: 'clickup',
    async execute(instanceId: string, request: Record<string, unknown>) {
      executed.push({ instanceId, request });
      if (options.throwError) throw options.throwError;
      return { id: 'task-1', name: String(request.name ?? ''), listId: '999' };
    },
  };

  const services = {
    instances: {
      getById: async (id: string) => {
        instanceLookups.push(id);
        return instance;
      },
    },
  } as unknown as Services;

  const deps = buildAutomationEngineDeps(services, {} as Database, {
    resolvePlugin: async (id: string) => {
      pluginLookups.push(id);
      return (id === 'clickup' ? plugin : undefined) as unknown as ChannelPlugin | undefined;
    },
  });

  return { deps, executed, instanceLookups, pluginLookups };
}

function run(
  deps: ReturnType<typeof buildAutomationEngineDeps>,
  config: ClickUpActionConfig,
  payload: Record<string, unknown>,
) {
  return executeAction({ type: 'clickup', config }, createTemplateContext(payload), { eventBus: null, ...deps }, null);
}

describe('automation-actions — clickup (#1413)', () => {
  test('renders templates, resolves the instance and plugin, and returns the plugin result', async () => {
    const h = harness();

    const result = await run(
      h.deps,
      {
        instanceId: '{{payload.instanceId}}',
        operation: 'create_task',
        listId: '999',
        name: 'Task for {{payload.name}}',
        description: 'Escalated by {{payload.name}}',
      },
      { instanceId: 'clickup-inst', name: 'Acme' },
    );

    expect(h.instanceLookups).toEqual(['clickup-inst']);
    expect(h.pluginLookups).toEqual(['clickup']);
    expect(h.executed).toHaveLength(1);
    expect(h.executed[0]?.instanceId).toBe('clickup-inst');
    expect(h.executed[0]?.request).toEqual({
      operation: 'create_task',
      listId: '999',
      name: 'Task for Acme',
      description: 'Escalated by Acme',
    });

    expect(result.action).toBe('clickup');
    expect(result.status).toBe('success');
    expect(result.result).toEqual({ id: 'task-1', name: 'Task for Acme', listId: '999' });
  });

  test('a thrown ClickUp error text is the action failure, not a generic message', async () => {
    const message = 'ClickUp API error (500) from POST /list/999/task: Internal server error (APP_500)';
    const h = harness({ throwError: new Error(message) });

    const result = await run(h.deps, { instanceId: 'clickup-inst', operation: 'create_task', name: 'Boom' }, {});

    expect(result.status).toBe('failed');
    expect(result.error).toBe(message);
  });

  test('refuses an instance that is not a clickup instance', async () => {
    const h = harness({ channel: 'slack' });

    const result = await run(h.deps, { instanceId: 'clickup-inst', operation: 'list_tasks' }, {});

    expect(result.status).toBe('failed');
    expect(result.error).toContain('is a slack instance');
    expect(result.error).toContain('clickup actions need a clickup instance');
    expect(h.executed).toEqual([]);
    expect(h.pluginLookups).toEqual([]);
  });

  test('validates operation-specific fields before calling the callback', async () => {
    const h = harness();

    const missingTask = await run(
      h.deps,
      { instanceId: 'clickup-inst', operation: 'update_status', status: 'done' },
      {},
    );
    expect(missingTask.status).toBe('failed');
    expect(missingTask.error).toContain('needs a taskId');

    const missingComment = await run(
      h.deps,
      { instanceId: 'clickup-inst', operation: 'add_comment', taskId: 't1' },
      {},
    );
    expect(missingComment.status).toBe('failed');
    expect(missingComment.error).toContain('needs a comment');

    const missingName = await run(h.deps, { instanceId: 'clickup-inst', operation: 'create_task' }, {});
    expect(missingName.status).toBe('failed');
    expect(missingName.error).toContain('needs a non-empty name');

    expect(h.executed).toEqual([]);
  });

  test('list_tasks needs no operation-specific fields and passes through', async () => {
    const h = harness();

    const result = await run(h.deps, { instanceId: 'clickup-inst', operation: 'list_tasks' }, {});

    expect(result.status).toBe('success');
    expect(h.executed[0]?.request).toEqual({ operation: 'list_tasks' });
  });
});
