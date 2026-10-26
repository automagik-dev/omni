/**
 * `call_agent` reaches webhook providers (#1262).
 *
 * The automation action runs agents through `AgentRunnerService`, which built
 * every client with `createProviderClient` — and that refuses `webhook` by
 * design. A webhook row now gets a `WebhookAgentClient`, configured the way the
 * dispatcher configures its `WebhookAgentProvider`: the same payload, the
 * reply's parts back as the run's text, and no key required.
 *
 * The webhook is this test's own `fetch`, installed per test and put back
 * after: other files in the process replace `globalThis.fetch` too.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { WebhookPayload } from '@omni/core';
import type { Database, Instance } from '@omni/db';
import { AgentRunnerService } from '../agent-runner';

const WEBHOOK_URL = 'https://hook.example/agent';

interface Received {
  url: string;
  payload: WebhookPayload;
  authorization: string | null;
}

const received: Received[] = [];
let before: typeof fetch;

beforeEach(() => {
  received.length = 0;
  before = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    received.push({
      url: String(input),
      payload: JSON.parse(String(init?.body)) as WebhookPayload,
      authorization: new Headers(init?.headers).get('authorization'),
    });
    return Response.json({ parts: ['Still there?', 'Your order is ready.'] });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = before;
});

/** A one-row `agent_providers` stand-in: a webhook provider at WEBHOOK_URL. */
function webhookDb(apiKey: string | null): Database {
  const row = {
    id: 'provider-hook',
    name: 'hook',
    schema: 'webhook',
    baseUrl: WEBHOOK_URL,
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
    const { url, payload, authorization } = received[0] as Received;
    expect(url).toBe(WEBHOOK_URL);
    expect(authorization).toBeNull();
    expect(payload.event.type).toBe('automation.call_agent');
    expect(payload.content.text).toBe('test 1');
    expect(payload.traceId).toBe(payload.event.id);
    expect(payload.chat.id).toBe('');
  });

  test("a chat's call_agent carries the instance, chat and sender, and the provider's key", async () => {
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
