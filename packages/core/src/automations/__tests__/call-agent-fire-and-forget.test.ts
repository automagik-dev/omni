/**
 * call_agent `waitForResponse` (#1176): default awaits the run; false returns
 * the runId on dispatch and publishes `system.agent.run_completed` on settle.
 */

import { describe, expect, mock, test } from 'bun:test';
import type { EventBus } from '../../events/bus';
import type { AgentRunResult } from '../actions';
import { executeAction } from '../actions';
import type { TemplateContext } from '../templates';

const context: TemplateContext = {
  payload: { instanceId: 'inst-1', chatId: 'chat-1', from: 'user-1', content: { text: 'hi' } },
  variables: {},
  env: {},
};

function deferredAgent() {
  let resolve!: (r: AgentRunResult) => void;
  const run = new Promise<AgentRunResult>((r) => {
    resolve = r;
  });
  return { callAgent: mock(() => run), resolve };
}

const done: AgentRunResult = {
  parts: ['ok'],
  fullResponse: 'ok',
  metadata: { runId: 'p1', sessionId: 's1', status: 'completed' },
};

describe('call_agent waitForResponse (#1176)', () => {
  test('default awaits the run and returns its response', async () => {
    const { callAgent, resolve } = deferredAgent();
    let settled = false;
    const pending = executeAction({ type: 'call_agent', config: { agentId: 'a1' } }, context, {
      eventBus: null,
      callAgent,
    }).then((r) => {
      settled = true;
      return r;
    });
    await Bun.sleep(5);
    expect(settled).toBe(false);
    resolve(done);
    const result = await pending;
    expect(result.status).toBe('success');
    expect((result.result as { response: string }).response).toBe('ok');
  });

  test('false returns the runId immediately and later publishes run_completed', async () => {
    const { callAgent, resolve } = deferredAgent();
    const publishGeneric = mock(async () => ({ id: 'e', sequence: 1 }));
    const eventBus = { publishGeneric } as unknown as EventBus;
    const result = await executeAction(
      { type: 'call_agent', config: { agentId: 'a1', waitForResponse: false } },
      context,
      { eventBus, callAgent },
      null,
      0,
      { parentEventId: 'evt-1', automationId: 'auto-1' },
    );
    expect(result.status).toBe('success');
    const { runId } = result.result as { runId: string };
    expect(runId).toBeString();
    expect(publishGeneric).not.toHaveBeenCalled();

    resolve(done);
    await Bun.sleep(0);
    expect(publishGeneric).toHaveBeenCalledWith('system.agent.run_completed', {
      automationId: 'auto-1',
      executionId: 'evt-1',
      runId,
      status: 'completed',
      providerRunId: 'p1',
      response: 'ok',
      error: undefined,
    });
  });
});
