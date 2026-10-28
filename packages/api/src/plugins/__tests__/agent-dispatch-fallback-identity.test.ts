/**
 * Webhook fallback preserves message identity — issue #1408.
 *
 * When a `webhook` agent provider's native dispatch throws, the dispatcher falls
 * back to the legacy agent runner, which POSTs the same URL again. That second
 * POST must answer the *same* inbound message: the same
 * `executionContext.source.messageId` (the platform wamid) and the same stable
 * `event.id` as the native attempt, so a receiver that deduplicates on the
 * source message collapses the pair into one inference instead of running (and
 * replying) twice.
 *
 * This test forces the native failure through the real dispatcher/agent-runner
 * code and inspects the two HTTP bodies it produces.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { WebhookPayload } from '@omni/core';
import type { Database } from '@omni/db';

// The dispatcher resolves channel plugins through the loader; a stub keeps this
// test on the webhook path only (same pattern as agent-dispatcher.test.ts).
mock.module('../loader', () => ({
  getPlugin: mock(async () => ({
    sendMessage: mock(async () => undefined),
    sendTyping: mock(async () => undefined),
  })),
}));

import type { Services } from '../../services';
import { AgentRunnerService } from '../../services/agent-runner';
import { __test__ } from '../agent-dispatcher';
import type { BufferedMessage } from '../message-debouncer';

const WEBHOOK_URL = 'https://hook.example/agent';
const WAMID = 'wamid.HBgMNTUxMTk5OTk5OTk5FQIAEhgg';
const INBOUND_EVENT_ID = 'evt-inbound-1';
const TRACE_ID = 'trc-dispatch-1';

let before: typeof fetch;
let posted: WebhookPayload[];
/** Per-POST behaviour: 'fail' throws before answering (the native attempt), 'ok' answers. */
let behaviours: Array<'fail' | 'ok'>;

beforeEach(() => {
  posted = [];
  behaviours = [];
  before = globalThis.fetch;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    posted.push(JSON.parse(String(init?.body)) as WebhookPayload);
    if (behaviours.shift() === 'fail') {
      // A transport failure, not a 5xx: `postWebhookWithRetry` rethrows it, which
      // is exactly the path that triggers the legacy fallback (#1408).
      throw new TypeError('fetch failed');
    }
    return Response.json({ reply: 'ok' });
  }) as typeof fetch;
  __test__.resetProviderCaches();
});

afterEach(() => {
  globalThis.fetch = before;
  __test__.resetProviderCaches();
});

/** A one-row `agent_providers` stand-in: a webhook provider at WEBHOOK_URL. */
function stubDb(): Database {
  const row = {
    id: 'prov-1',
    name: 'hook',
    schema: 'webhook',
    baseUrl: WEBHOOK_URL,
    apiKey: null,
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

function makeServices(db: Database): Services {
  return {
    db,
    providers: { getById: async () => ({ ...providerRow(), isActive: true }) },
    persons: {
      getIdentityByPlatformId: async () => undefined,
      getById: async () => undefined,
    },
    chats: { findByExternalIdSmart: async () => null },
    messages: { list: async () => ({ items: [] }) },
    agentRunner: new AgentRunnerService(db),
  } as unknown as Services;
}

function providerRow() {
  return {
    id: 'prov-1',
    name: 'hook',
    schema: 'webhook' as const,
    baseUrl: WEBHOOK_URL,
    apiKey: null,
    defaultTimeout: 30,
    isActive: true,
    schemaConfig: { mode: 'round-trip' as const, retries: 0 },
  };
}

function instance(): Parameters<typeof __test__.dispatchToAgent>[1] {
  return {
    id: 'inst-1',
    name: 'Harness',
    channel: 'whatsapp-baileys',
    agentProviderId: 'prov-1',
    agentInternalId: 'agent-1',
    agentType: 'agent',
    agentSessionStrategy: 'per_chat',
    agentPrefixSenderName: false,
    enableAutoSplit: true,
    tenantId: null,
  } as unknown as Parameters<typeof __test__.dispatchToAgent>[1];
}

function bufferedMessage(externalId: string, eventId?: string): BufferedMessage {
  return {
    payload: {
      externalId,
      chatId: 'chat-1',
      from: '5511999999999',
      content: { type: 'text', text: 'hello' },
      rawPayload: {},
    },
    metadata: {
      instanceId: 'inst-1',
      channelType: 'whatsapp-baileys',
      traceId: TRACE_ID,
      correlationId: 'corr-1',
      ...(eventId ? { eventId } : {}),
    },
    timestamp: Date.now(),
  };
}

/** Run one message through the real dispatcher; returns once the fallback answered. */
async function dispatchOne(message: BufferedMessage): Promise<void> {
  const db = stubDb();
  await __test__.dispatchToAgent(
    makeServices(db),
    instance(),
    [message],
    'dm',
    'whatsapp-baileys',
    'chat-1',
    '5511999999999',
    'person-uuid',
    'Ana',
    TRACE_ID,
    undefined,
    undefined,
    db,
  );
}

const byText = (producer: 'native' | 'fallback'): WebhookPayload => {
  // The native POST fails after being recorded; the fallback POST answers.
  const index = producer === 'native' ? 0 : 1;
  return posted[index] as WebhookPayload;
};

describe('agent dispatcher — webhook fallback identity (#1408)', () => {
  test('a failed native dispatch falls back with the same wamid and the same stable event id', async () => {
    behaviours = ['fail', 'ok'];

    await dispatchOne(bufferedMessage(WAMID, INBOUND_EVENT_ID));

    expect(posted).toHaveLength(2);
    const native = byText('native');
    const fallback = byText('fallback');

    // The native attempt already told the receiver which message this is.
    expect(native.executionContext?.source.messageId).toBe(WAMID);
    expect(native.event.id).toBe(INBOUND_EVENT_ID);
    // Only the envelope's id is stamped — the message payload must not leak
    // into `event` (the optional envelope fields were undefined on the buffered
    // payload, so JSON drops them).
    expect(Object.keys(native.event)).toEqual(['id']);

    // The fallback answers the SAME message, not a brand-new one.
    expect(fallback.executionContext?.source.messageId).toBe(WAMID);
    expect(fallback.event.id).toBe(INBOUND_EVENT_ID);
    expect(fallback.event.id).toBe(native.event.id as string);
    // Same trace, so the pair is visibly one dispatch rather than two.
    expect(fallback.traceId).toBe(native.traceId);
    expect(fallback.traceId).toBe(TRACE_ID);
    // The legacy contract's other fields still match the native body.
    expect(fallback.instance.id).toBe(native.instance.id);
    expect(fallback.chat.id).toBe(native.chat.id);
    expect(fallback.sender.id).toBe(native.sender.id);
    expect(fallback.content.text).toBe(native.content.text);
  });

  test('the fallback event id is stable for a given inbound message across runs', async () => {
    behaviours = ['fail', 'ok', 'fail', 'ok'];

    await dispatchOne(bufferedMessage(WAMID, INBOUND_EVENT_ID));
    await dispatchOne(bufferedMessage(WAMID, INBOUND_EVENT_ID));

    const fallbacks = posted.filter((_, index) => index % 2 === 1);
    expect(fallbacks).toHaveLength(2);
    expect(fallbacks[0]?.event.id).toBe(INBOUND_EVENT_ID);
    expect(fallbacks[1]?.event.id).toBe(INBOUND_EVENT_ID);
    expect(fallbacks[0]?.executionContext?.source.messageId).toBe(WAMID);
    expect(fallbacks[1]?.executionContext?.source.messageId).toBe(WAMID);
  });

  test('a caller with no inbound message identity keeps a sane fallback and invents nothing', async () => {
    behaviours = ['fail', 'ok'];

    await dispatchOne(bufferedMessage('', undefined));

    expect(posted).toHaveLength(2);
    const fallback = byText('fallback');

    // Nothing to preserve, so no execution context is claimed...
    expect(fallback.executionContext).toBeUndefined();
    // ...and no platform message id is invented.
    expect(fallback.executionContext?.source.messageId).toBeUndefined();
    // The only id this run has is its own — the pre-#1408 contract, unchanged.
    expect(fallback.traceId).toBe(fallback.event.id as string);
    expect(fallback.event.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(fallback.chat.id).toBe('chat-1');
    expect(fallback.content.text).toContain('hello');
  });
});
