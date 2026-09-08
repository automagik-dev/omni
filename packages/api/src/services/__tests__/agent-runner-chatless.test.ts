/**
 * Chatless agent runs (#1010, RFC #925 G4 runtime half).
 *
 * `runChatless` dispatches an agent with only its provider coordinates and an
 * event-scoped session key — no instance, no chat, no sender. Pinned here:
 *
 *   - the provider request carries the session key verbatim as BOTH
 *     `sessionId` and `userId` (HTTP providers scope conversations by it;
 *     the claude-code client ignores non-UUID session ids and starts fresh);
 *   - NO platform/chat/sender blocks are sent — there is no channel identity;
 *   - the session store is never touched: no agent_sessions read or write
 *     (chatless runs have no instances-row FK to persist under);
 *   - the response is returned un-split and un-prefixed (no implicit reply).
 */

import { describe, expect, test } from 'bun:test';
import type { IAgentClient, ProviderRequest, ProviderResponse } from '@omni/core';
import type { Database } from '@omni/db';
import { AgentRunnerService } from '../agent-runner';

/** A db stand-in that records every touch — chatless runs must make none. */
function untouchableDb(touches: string[]): Database {
  const record =
    (op: string) =>
    (..._args: unknown[]) => {
      touches.push(op);
      throw new Error(`chatless run must not touch the db (${op})`);
    };
  return {
    select: record('select'),
    insert: record('insert'),
    update: record('update'),
    delete: record('delete'),
    transaction: record('transaction'),
    execute: record('execute'),
  } as unknown as Database;
}

function fakeClient(requests: ProviderRequest[], schema: string, service: AgentRunnerService): void {
  const client: IAgentClient = {
    run: async (request: ProviderRequest): Promise<ProviderResponse> => {
      requests.push(request);
      return {
        content: 'acted on the event\n\nvia my own tools',
        runId: 'run-1',
        sessionId: request.sessionId ?? 'fresh',
        status: 'completed',
      };
    },
    stream: (): AsyncGenerator<never> => {
      throw new Error('chatless runs are sync-only');
    },
  } as unknown as IAgentClient;
  (service as unknown as { getClient: () => Promise<{ client: IAgentClient; schema: string }> }).getClient =
    async () => ({ client, schema });
}

describe('agent-runner — runChatless (#1010)', () => {
  test('dispatches with the session key as sessionId/userId and no chat identity', async () => {
    const touches: string[] = [];
    const requests: ProviderRequest[] = [];
    const service = new AgentRunnerService(untouchableDb(touches));
    fakeClient(requests, 'agno', service);

    const result = await service.runChatless({
      agentProviderId: 'prov-1',
      agentInternalId: 'triage-agent',
      agentType: 'agent',
      tenantId: null,
      sessionKey: 'automation:auto-1:corr-1',
      messages: ['{"type":"custom.github.push"}'],
      timeoutSeconds: 120,
    });

    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request?.message).toBe('{"type":"custom.github.push"}');
    expect(request?.agentId).toBe('triage-agent');
    expect(request?.agentType).toBe('agent');
    expect(request?.stream).toBe(false);
    expect(request?.sessionId).toBe('automation:auto-1:corr-1');
    expect(request?.userId).toBe('automation:auto-1:corr-1');
    expect(request?.timeoutMs).toBe(120000);
    // No channel identity is fabricated for a chatless run.
    expect(request?.platform).toBeUndefined();
    expect(request?.chat).toBeUndefined();
    expect(request?.sender).toBeUndefined();
    expect(request?.mcpUrlParams).toBeUndefined();

    // No implicit reply and no auto-split: the full response comes back whole.
    expect(result.parts).toEqual(['acted on the event\n\nvia my own tools']);
    expect(result.metadata.status).toBe('completed');
    expect(result.metadata.sessionId).toBe('automation:auto-1:corr-1');

    // The session store (agent_sessions) was never touched.
    expect(touches).toEqual([]);
  });

  test('claude-code schema: same request, still no session-store mapping', async () => {
    // The claude-code CLIENT only resumes UUID session ids, so the non-UUID
    // chatless key means a fresh provider session each run — and runChatless
    // must not attempt the key→UUID store mapping (no instances-row FK).
    const touches: string[] = [];
    const requests: ProviderRequest[] = [];
    const service = new AgentRunnerService(untouchableDb(touches));
    fakeClient(requests, 'claude-code', service);

    await service.runChatless({
      agentProviderId: 'prov-cc',
      agentInternalId: 'claude-code',
      sessionKey: 'automation:auto-2:corr-9',
      messages: ['envelope'],
    });

    expect(requests[0]?.sessionId).toBe('automation:auto-2:corr-9');
    expect(touches).toEqual([]);
  });

  test('defaults: agentType agent, 600s timeout, messages joined with the run separator', async () => {
    const requests: ProviderRequest[] = [];
    const service = new AgentRunnerService(untouchableDb([]));
    fakeClient(requests, 'agno', service);

    await service.runChatless({
      agentProviderId: 'prov-1',
      agentInternalId: 'triage-agent',
      sessionKey: 'automation:manual:x',
      messages: ['one', 'two'],
    });

    expect(requests[0]?.agentType).toBe('agent');
    expect(requests[0]?.timeoutMs).toBe(600000);
    expect(requests[0]?.message).toBe('one\n---\ntwo');
  });
});
