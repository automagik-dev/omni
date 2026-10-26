/**
 * `call_agent` reaches webhook providers (#1262).
 *
 * The automation action runs agents through `AgentRunnerService`, which built
 * every client with `createProviderClient` — and that refuses `webhook` by
 * design. A webhook row now gets a `WebhookAgentClient`, configured the way the
 * dispatcher configures its `WebhookAgentProvider`: the same payload, the
 * reply's parts back as the run's text, and no key required.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { WebhookPayload } from '@omni/core';
import type { Database, Instance } from '@omni/db';
import { AgentRunnerService } from '../agent-runner';

interface Received {
  payload: WebhookPayload;
  authorization: string | null;
}

const received: Received[] = [];
let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      received.push({
        payload: (await request.json()) as WebhookPayload,
        authorization: request.headers.get('authorization'),
      });
      return Response.json({ parts: ['Still there?', 'Your order is ready.'] });
    },
  });
});

afterAll(() => {
  server.stop(true);
});

/** A one-row `agent_providers` stand-in: a webhook provider at the test server. */
function webhookDb(apiKey: string | null): Database {
  const row = {
    id: 'provider-hook',
    name: 'hook',
    schema: 'webhook',
    baseUrl: `http://127.0.0.1:${server.port}/agent`,
    apiKey,
    defaultTimeout: 30,
    isActive: true,
    schemaConfig: { mode: 'round-trip', retries: 0 },
  };
  const db: Record<string, unknown> = {
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(db),
    execute: async () => undefined,
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [row] }) }) }),
  };
  return db as unknown as Database;
}

describe('agent-runner — webhook providers (#1262)', () => {
  test('a chatless call_agent posts the webhook payload and returns its reply', async () => {
    received.length = 0;
    const service = new AgentRunnerService(webhookDb(null));
    const result = await service.runChatless({
      agentProviderId: 'provider-hook',
      agentInternalId: 'follow-up-agent',
      tenantId: null,
      sessionKey: 'automation:auto-1:corr-1',
      messages: ['test 1'],
    });

    expect(result.parts).toEqual(['Still there?\n\nYour order is ready.']);
    expect(received).toHaveLength(1);
    const { payload, authorization } = received[0] as Received;
    expect(authorization).toBeNull();
    expect(payload.event.type).toBe('automation.call_agent');
    expect(payload.content.text).toBe('test 1');
    expect(payload.traceId).toBe(payload.event.id);
    expect(payload.chat.id).toBe('');
  });

  test("a chat's call_agent carries the instance, chat and sender, and the provider's key", async () => {
    received.length = 0;
    const service = new AgentRunnerService(webhookDb('hook-secret'));
    const instance = {
      id: 'inst-1',
      name: 'Harness',
      channel: 'harness',
      agentProviderId: 'provider-hook',
      agentInternalId: 'follow-up-agent',
      agentPrefixSenderName: false,
      enableAutoSplit: true,
      tenantId: null,
    } as unknown as Instance;
    const result = await service.run({
      instance,
      chatId: 'chat-1',
      senderId: 'user-1',
      senderName: 'Ana',
      personId: 'person-1',
      messages: ['test 2'],
    } as Parameters<AgentRunnerService['run']>[0]);

    expect(result.parts).toEqual(['Still there?', 'Your order is ready.']);
    const { payload, authorization } = received[0] as Received;
    expect(authorization).toBe('Bearer hook-secret');
    expect(payload.instance).toEqual({ id: 'inst-1', channelType: 'harness', name: 'Harness' });
    expect(payload.chat).toEqual({ id: 'chat-1' });
    expect(payload.sender).toEqual({ id: 'user-1', name: 'Ana', personId: 'person-1' });
  });
});
