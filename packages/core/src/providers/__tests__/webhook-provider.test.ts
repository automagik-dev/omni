/**
 * Webhook payload identity — issue #1408.
 *
 * The legacy fallback POST must answer the same inbound message the native
 * `WebhookAgentProvider` already sent: the same `executionContext.source.messageId`
 * (the platform wamid) and a stable `event.id` instead of a fresh random UUID,
 * so a receiver that deduplicates on the source message collapses the pair into
 * one inference. Callers with no inbound message identity keep the previous
 * payload exactly, with no invented `executionContext`.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ProviderOriginIdentity, ProviderRequest, WebhookPayload } from '../types';
import { WebhookAgentClient, webhookProviderConfig } from '../webhook-provider';

const WEBHOOK_URL = 'https://hook.example/agent';
const WAMID = 'wamid.HBgMNTUxMTk5OTk5OTk5FQIAEhgg';

let before: typeof fetch;
let posted: WebhookPayload[];

beforeEach(() => {
  posted = [];
  before = globalThis.fetch;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    posted.push(JSON.parse(String(init?.body)) as WebhookPayload);
    return Response.json({ reply: 'ok' });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = before;
});

/** The webhook config an `agent_providers` row of schema `webhook` produces. */
const config = () =>
  webhookProviderConfig({
    baseUrl: WEBHOOK_URL,
    apiKey: null,
    defaultTimeout: 30,
    schemaConfig: { mode: 'round-trip', retries: 0 },
  });

/** A message-shaped agent-runner request, as the legacy fallback builds it. */
function request(origin?: ProviderOriginIdentity): ProviderRequest {
  return {
    message: 'hello',
    agentId: 'agent-1',
    agentType: 'agent',
    sessionId: 'session-1',
    userId: 'person-uuid',
    platform: {
      id: '5511999999999',
      channel: 'whatsapp-baileys',
      instanceId: 'inst-1',
      instanceName: 'Harness',
    },
    sender: { displayName: 'Ana' },
    chat: { type: 'dm', id: '5511999999999' },
    ...(origin ? { origin } : {}),
  };
}

describe('WebhookAgentClient — inbound message identity (#1408)', () => {
  test('a request with an origin sends the same wamid and the originating event id', async () => {
    const client = new WebhookAgentClient(config());
    const origin: ProviderOriginIdentity = {
      messageId: WAMID,
      eventId: 'evt-inbound-1',
      traceId: 'trc-dispatch-1',
    };

    await client.run(request(origin));

    const payload = posted[0] as WebhookPayload;
    expect(payload.executionContext?.source.messageId).toBe(WAMID);
    expect(payload.executionContext?.source.channel).toBe('whatsapp-baileys');
    expect(payload.executionContext?.source.instanceId).toBe('inst-1');
    expect(payload.executionContext?.source.chatId).toBe('5511999999999');
    // The stable event id is the inbound event's, not a fresh random UUID.
    expect(payload.event.id).toBe('evt-inbound-1');
    expect(payload.traceId).toBe('trc-dispatch-1');
    expect(payload.executionContext?.trace.id).toBe('trc-dispatch-1');
    // Native-parity identity fields, rebuilt from the request.
    expect(payload.executionContext?.identity).toEqual({
      userId: 'person-uuid',
      personId: 'person-uuid',
      platformUserId: '5511999999999',
      displayName: 'Ana',
    });
  });

  test('the event id stays stable across runs of the same inbound message', async () => {
    const client = new WebhookAgentClient(config());
    const origin: ProviderOriginIdentity = { messageId: WAMID, eventId: 'evt-inbound-1' };

    await client.run(request(origin));
    await client.run(request(origin));

    const [first, second] = posted as [WebhookPayload, WebhookPayload];
    expect(first.event.id).toBe('evt-inbound-1');
    expect(second.event.id).toBe('evt-inbound-1');
    expect(first.executionContext?.source.messageId).toBe(second.executionContext?.source.messageId);
  });

  test('a message id without an event id is still a stable event id', async () => {
    const client = new WebhookAgentClient(config());

    const result = await client.run(request({ messageId: WAMID }));

    const payload = posted[0] as WebhookPayload;
    expect(payload.event.id).toBe(WAMID);
    expect(payload.executionContext?.source.messageId).toBe(WAMID);
    // No dispatch trace was supplied, so the run's own id is the only trace id
    // there is — a trace id is never fabricated from the message id.
    expect(payload.traceId).toBe(result.runId);
  });

  test('a request with no origin invents no identity and keeps the previous payload', async () => {
    const client = new WebhookAgentClient(config());

    const result = await client.run(request());

    const payload = posted[0] as WebhookPayload;
    expect(payload.executionContext).toBeUndefined();
    // The run's own id was and remains the only id a caller without an inbound
    // message has; nothing is fabricated.
    expect(payload.event.id).toBe(result.runId);
    expect(payload.traceId).toBe(result.runId);
    expect(payload.event.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('a chatless run with no origin stays exactly as before', async () => {
    const client = new WebhookAgentClient(config());

    const result = await client.run({ message: 'test 1', agentId: 'agent-1', userId: 'user-1' });

    const payload = posted[0] as WebhookPayload;
    expect(payload.executionContext).toBeUndefined();
    expect(payload.event.id).toBe(result.runId);
    expect(payload.traceId).toBe(result.runId);
    expect(payload.chat.id).toBe('');
    expect(payload.instance.id).toBe('');
  });

  test('an origin without a platform channel still keeps the stable event id', async () => {
    const client = new WebhookAgentClient(config());

    await client.run({
      message: 'hello',
      agentId: 'agent-1',
      userId: 'user-1',
      origin: { messageId: WAMID, eventId: 'evt-inbound-1' },
    });

    const payload = posted[0] as WebhookPayload;
    // No source channel to report truthfully, so no executionContext is claimed...
    expect(payload.executionContext).toBeUndefined();
    // ...but the event identity is still the inbound message's.
    expect(payload.event.id).toBe('evt-inbound-1');
  });
});
