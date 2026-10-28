/**
 * `connector.call` execution and the provider-agnostic trigger gate.
 *
 * The core renders templates and delegates to the API callback, which resolves
 * the connector under the tenant, re-parses the rendered input against the
 * manifest and performs the provider call. No test here touches a provider.
 */

import { describe, expect, test } from 'bun:test';
import { mock } from 'bun:test';
import {
  ACTION_TYPES,
  type ConnectorCallRequest,
  type EventBus,
  type OmniEvent,
  type SubscribeOptions,
  type Subscription,
  connectorTargetMatches,
  createAutomationEngine,
  createTemplateContext,
  executeAction,
} from '@omni/core';
import type { Automation } from '@omni/core';

const AUTOMATION_A = '55555555-5555-5555-5555-555555555555';
const AUTOMATION_B = '66666666-6666-6666-6666-666666666666';

describe('connector.call action', () => {
  test('renders templates and delegates one action call', async () => {
    const requests: ConnectorCallRequest[] = [];
    const context = createTemplateContext({ task_id: 'task-123', status: 'done' });
    const result = await executeAction(
      {
        type: 'connector.call',
        config: {
          connectorId: 'connector-1',
          action: 'add_comment',
          input: { taskId: '{{payload.task_id}}', comment: 'Finished: {{payload.status}}' },
          timeoutMs: 5_000,
        },
      },
      context,
      {
        eventBus: null,
        async callConnector(request) {
          requests.push(request);
          return { id: 'comment-1' };
        },
      },
    );

    expect(result.status).toBe('success');
    expect(result.action).toBe('connector.call');
    expect(requests).toEqual([
      {
        connectorId: 'connector-1',
        action: 'add_comment',
        input: { taskId: 'task-123', comment: 'Finished: done' },
        timeoutMs: 5_000,
      },
    ]);
  });

  test('stores the result under responseAs for later actions', async () => {
    const context = createTemplateContext({ task_id: 'task-1' });
    const result = await executeAction(
      {
        type: 'connector.call',
        config: {
          connectorId: 'connector-1',
          action: 'list_tasks',
          input: { listId: 'list-1' },
          responseAs: 'tasks',
        },
      },
      context,
      {
        eventBus: null,
        async callConnector() {
          return { tasks: [{ id: 't1' }] };
        },
      },
    );

    expect(result.status).toBe('success');
    expect(context.variables.tasks).toEqual({ tasks: [{ id: 't1' }] });
  });

  test('fails visibly when the API callback is absent or the action key is a template', async () => {
    const context = createTemplateContext({});
    const missing = await executeAction(
      { type: 'connector.call', config: { connectorId: 'c', action: 'add_comment', input: {} } },
      context,
      { eventBus: null },
    );
    expect(missing.status).toBe('failed');
    expect(missing.error).toContain('callConnector dependency not provided');

    const templateAction = await executeAction(
      { type: 'connector.call', config: { connectorId: 'c', action: '{{payload.action}}', input: {} } },
      context,
      {
        eventBus: null,
        async callConnector() {
          return null;
        },
      },
    );
    expect(templateAction.status).toBe('failed');
    expect(templateAction.error).toContain('must be a literal manifest action key');
  });

  test('a provider error becomes a failed action with the redacted message', async () => {
    const context = createTemplateContext({});
    const result = await executeAction(
      { type: 'connector.call', config: { connectorId: 'c', action: 'add_comment', input: {} } },
      context,
      {
        eventBus: null,
        async callConnector() {
          throw new Error('ClickUp API error (401): [redacted]');
        },
      },
    );
    expect(result.status).toBe('failed');
    expect(result.error).toContain('ClickUp API error (401)');
  });
});

describe('connector trigger gate', () => {
  test('a connector delivery runs only the automation named by targetAutomationId', () => {
    const event = { type: 'connector.event' as const, payload: { targetAutomationId: AUTOMATION_A } };
    expect(connectorTargetMatches(AUTOMATION_A, event)).toBe(true);
    expect(connectorTargetMatches(AUTOMATION_B, event)).toBe(false);
  });

  test('non-connector events and connector events without a target are not narrowed', () => {
    expect(connectorTargetMatches(AUTOMATION_B, { type: 'message.received', payload: {} })).toBe(true);
    expect(connectorTargetMatches(AUTOMATION_A, { type: 'connector.event', payload: {} })).toBe(true);
  });

  test('there is exactly one connector action type and it names no vendor', () => {
    expect(ACTION_TYPES.filter((type) => type.includes('connector'))).toEqual(['connector.call']);
  });
});

function connectorAutomation(id: string): Automation {
  return {
    id,
    name: id,
    enabled: true,
    priority: 0,
    triggerEventType: 'connector.event',
    triggerConditions: [],
    conditionLogic: 'and',
    actions: [
      {
        type: 'connector.call',
        config: { connectorId: 'connector-1', action: 'add_comment', input: { taskId: '{{payload.task_id}}' } },
      },
    ],
    debounce: { mode: 'none' },
  } as unknown as Automation;
}

function connectorEvent(targetAutomationId: string): OmniEvent {
  return {
    id: 'evt-connector-1',
    type: 'connector.event',
    payload: { targetAutomationId, task_id: 'task-1' },
    metadata: { correlationId: 'corr-1', source: 'connector' },
    timestamp: Date.now(),
  } as unknown as OmniEvent;
}

describe('automation engine connector trigger', () => {
  test('a connector.event runs only the automation named by the delivery', async () => {
    const handlers: Array<(event: OmniEvent) => Promise<void>> = [];
    const subscription: Subscription = { id: 'sub', pattern: 'connector.event.>', unsubscribe: async () => {} };
    const bus = {
      connect: mock(async () => {}),
      publish: mock(async () => ({ id: '', sequence: 0, stream: '' })),
      publishGeneric: mock(async () => ({ id: '', sequence: 0, stream: '' })),
      subscribe: mock(async () => subscription),
      subscribePattern: mock(
        async (_pattern: string, h: (event: OmniEvent) => Promise<void>, _options?: SubscribeOptions) => {
          handlers.push(h);
          return subscription;
        },
      ),
      subscribeMany: mock(async () => subscription),
      subscribeAll: mock(async () => subscription),
      close: mock(async () => {}),
      isConnected: mock(() => true),
    } as unknown as EventBus;

    const engine = createAutomationEngine({ defaultConcurrency: 5 });
    const calls: ConnectorCallRequest[] = [];
    await engine.start(bus, [connectorAutomation(AUTOMATION_A), connectorAutomation(AUTOMATION_B)], {
      async callConnector(request) {
        calls.push(request);
        return { id: 'comment-1' };
      },
    });

    const deliver = handlers[0];
    if (!deliver) throw new Error('engine never subscribed');
    await deliver(connectorEvent(AUTOMATION_A));

    expect(calls).toHaveLength(1);
    expect(calls[0]?.connectorId).toBe('connector-1');
    await engine.stop();
  });
});
