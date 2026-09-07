/**
 * Harness channel E2E round trip (issue #953).
 *
 * Full HTTP path over the real routes and the real plugin, with a SCRIPTED
 * RESPONDER standing in for the agent dispatcher: it reacts to every
 * message.received the plugin emits by calling plugin.sendMessage() exactly
 * as the dispatcher would — buttons on the scheduling turn, a handoff-tagged
 * confirmation after the tap.
 *
 *   POST say → message.received → responder sends buttons → captured verbatim
 *   GET  transcript → structured assertions on buttons + metadata
 *   POST tap → the tapped option comes back as usable inbound → confirmation
 *   GET  transcript → the whole conversation, ordered, with handoff metadata
 *
 * Mirrors a2a-integration.test.ts: focused Hono app, real plugin, mock
 * EventBus, mocked auth/services context.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { HarnessChannelPlugin } from '@omni/channel-harness';
import type { HarnessInboundEntry, HarnessOutboundEntry, HarnessTranscript } from '@omni/channel-harness';
import type { OutgoingMessage, PluginContext } from '@omni/channel-sdk';
import { NotFoundError } from '@omni/core';
import { Hono } from 'hono';
import { errorHandler } from '../middleware/error';
import { harnessRoutes } from '../routes/v2/channel-harness';
import type { ApiKeyData, AppVariables } from '../types';

const HARNESS_INSTANCE = 'inst-harness-1';
const OTHER_INSTANCE = 'inst-baileys-1';
const CHAT = 'case-42';

const AUTH_HEADERS = { 'Content-Type': 'application/json', 'x-api-key': 'test-key' };

// ─── Mock plugin context ──────────────────────────────────────

interface PublishedEvent {
  type: string;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

function createMockEventBus() {
  const calls: PublishedEvent[] = [];
  const listeners: Array<(event: PublishedEvent) => Promise<void>> = [];
  return {
    calls,
    listeners,
    connect: mock(async () => {}),
    publish: mock(async (type: string, payload: Record<string, unknown>, metadata: Record<string, unknown>) => {
      const event = { type, payload, metadata };
      calls.push(event);
      for (const listener of listeners) {
        await listener(event);
      }
      return { seq: calls.length };
    }),
    publishGeneric: mock(async () => ({ seq: 1 })),
    subscribe: mock(async () => ({ unsubscribe: async () => {} })),
    subscribePattern: mock(async () => ({ unsubscribe: async () => {} })),
    subscribeMany: mock(async () => ({ unsubscribe: async () => {} })),
    subscribeAll: mock(async () => ({ unsubscribe: async () => {} })),
    unsubscribe: mock(async () => {}),
    drain: mock(async () => {}),
  };
}

function createMockContext(eventBus: ReturnType<typeof createMockEventBus>): PluginContext {
  const logger = {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    child: mock(function (this: unknown) {
      return logger;
    }),
  };
  return {
    eventBus: eventBus as unknown as PluginContext['eventBus'],
    logger: logger as unknown as PluginContext['logger'],
    storage: {
      get: mock(async () => null),
      set: mock(async () => {}),
      delete: mock(async () => true),
      has: mock(async () => false),
      keys: mock(async () => []),
    },
    config: {
      env: 'development',
      apiBaseUrl: 'http://localhost:3000',
      webhookBaseUrl: 'http://localhost:3000',
      mediaStorage: { type: 'local', basePath: '/tmp' },
    },
    db: {
      execute: mock(async () => []),
      getDrizzle: mock(() => null),
    },
  };
}

// ─── Test app: real routes + real plugin + mocked auth/services ──

function createTestApp(plugin: HarnessChannelPlugin) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.onError(errorHandler);

  app.use('*', async (c, next) => {
    if (c.req.header('x-api-key') === 'test-key') {
      // instanceIds null = access to all instances (ApiKeyService.instanceAllowed)
      c.set('apiKey', { instanceIds: null } as unknown as ApiKeyData);
    }
    c.set('services', {
      instances: {
        getById: async (id: string) => {
          if (id === HARNESS_INSTANCE) return { id, channel: 'harness' };
          if (id === OTHER_INSTANCE) return { id, channel: 'whatsapp-baileys' };
          throw new NotFoundError('Instance', id);
        },
      },
    } as unknown as AppVariables['services']);
    c.set('channelRegistry', {
      get: (channelType: string) => (channelType === 'harness' ? plugin : undefined),
    } as unknown as AppVariables['channelRegistry']);
    await next();
  });

  app.route('/api/v2/channels/harness', harnessRoutes);
  return app;
}

// ─── Scripted responder (stands in for the agent dispatcher) ──

/**
 * The "agent": every inbound turn gets a scripted reply through
 * plugin.sendMessage() — the same call the dispatcher makes.
 */
function installScriptedResponder(eventBus: ReturnType<typeof createMockEventBus>, plugin: HarnessChannelPlugin) {
  eventBus.listeners.push(async (event) => {
    if (event.type !== 'message.received') return;
    const instanceId = event.metadata.instanceId as string;
    const chatId = event.payload.chatId as string;
    const text = (event.payload.content as { text?: string }).text ?? '';

    let reply: OutgoingMessage;
    if (text.includes('cardiologista')) {
      reply = {
        to: chatId,
        content: {
          type: 'text',
          text: 'Encontrei estes profissionais:',
          buttons: [
            { text: 'Rogerio', data: 'prof-1' },
            { text: 'Aneli', data: 'prof-2' },
          ],
        },
        metadata: { partIndex: 0, partCount: 1 },
      };
    } else if (text === 'Aneli') {
      reply = {
        to: chatId,
        content: { type: 'text', text: 'Agendado com Aneli.' },
        metadata: { isHandoff: true, handoffQueue: 'SKILL_WPP_TECNICA_GENESYS', handoffReason: 'agenda-confirmada' },
      };
    } else {
      reply = { to: chatId, content: { type: 'text', text: `eco: ${text}` } };
    }
    await plugin.sendMessage(instanceId, reply);
  });
}

// ─── Helpers ──────────────────────────────────────────────────

async function readTranscript(app: Hono<{ Variables: AppVariables }>, chatId: string): Promise<HarnessTranscript> {
  const res = await app.request(`/api/v2/channels/harness/${HARNESS_INSTANCE}/transcript?chatId=${chatId}`, {
    headers: AUTH_HEADERS,
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: HarnessTranscript };
  return body.data;
}

function outbound(entry: HarnessTranscript['entries'][number]): HarnessOutboundEntry {
  expect(entry.direction).toBe('outbound');
  return entry as HarnessOutboundEntry;
}

// ─── Tests ────────────────────────────────────────────────────

describe('harness channel E2E (issue #953)', () => {
  let plugin: HarnessChannelPlugin;
  let eventBus: ReturnType<typeof createMockEventBus>;
  let app: Hono<{ Variables: AppVariables }>;

  beforeEach(async () => {
    plugin = new HarnessChannelPlugin();
    eventBus = createMockEventBus();
    await plugin.initialize(createMockContext(eventBus));
    installScriptedResponder(eventBus, plugin);
    app = createTestApp(plugin);
  });

  test('say → dispatch capture → transcript → tap round trip', async () => {
    // 1. Drive the opening turn.
    const sayRes = await app.request(`/api/v2/channels/harness/${HARNESS_INSTANCE}/say`, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ chatId: CHAT, text: 'quero marcar cardiologista' }),
    });
    expect(sayRes.status).toBe(201);
    const sayBody = (await sayRes.json()) as { data: HarnessInboundEntry };
    expect(sayBody.data.seq).toBe(1);

    // 2. The scripted responder answered through sendMessage — read the capture.
    const afterSay = await readTranscript(app, CHAT);
    expect(afterSay.entries.map((e) => e.direction)).toEqual(['inbound', 'outbound']);
    const buttonsTurn = outbound(afterSay.entries[1] as HarnessTranscript['entries'][number]);
    // Structured assertion instead of log grep — the issue's headline example.
    expect(buttonsTurn.message.content.buttons?.map((b) => b.text)).toEqual(['Rogerio', 'Aneli']);
    expect(buttonsTurn.message.metadata?.partCount).toBe(1);
    expect(buttonsTurn.violations).toEqual([]);
    expect(buttonsTurn.result.success).toBe(true);

    // 3. Tap option 2 — the interaction with no automated coverage before this.
    const tapRes = await app.request(`/api/v2/channels/harness/${HARNESS_INSTANCE}/tap`, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ chatId: CHAT, option: 2 }),
    });
    expect(tapRes.status).toBe(201);
    const tapBody = (await tapRes.json()) as { data: HarnessInboundEntry };
    expect(tapBody.data.content.text).toBe('Aneli');
    expect(tapBody.data.tap).toEqual({ sourceSeq: 2, optionIndex: 2, optionId: 'prof-2', optionText: 'Aneli' });

    // The tap reached the "agent" as a usable inbound…
    const received = eventBus.calls.filter((c) => c.type === 'message.received');
    expect(received).toHaveLength(2);
    expect((received[1]?.payload.content as { text: string }).text).toBe('Aneli');
    expect((received[1]?.payload.rawPayload as { kind: string }).kind).toBe('tap');

    // 4. …and the full conversation is one ordered transcript, handoff metadata included.
    const finalTranscript = await readTranscript(app, CHAT);
    expect(finalTranscript.entries.map((e) => e.direction)).toEqual(['inbound', 'outbound', 'inbound', 'outbound']);
    const confirmation = outbound(finalTranscript.entries[3] as HarnessTranscript['entries'][number]);
    expect(confirmation.message.content.text).toBe('Agendado com Aneli.');
    expect(confirmation.message.metadata?.handoffQueue).toBe('SKILL_WPP_TECNICA_GENESYS');
    expect(confirmation.message.metadata?.isHandoff).toBe(true);
  });

  test('parallel chats stay isolated on one instance', async () => {
    for (const chatId of ['case-a', 'case-b']) {
      const res = await app.request(`/api/v2/channels/harness/${HARNESS_INSTANCE}/say`, {
        method: 'POST',
        headers: AUTH_HEADERS,
        body: JSON.stringify({ chatId, text: `oi de ${chatId}` }),
      });
      expect(res.status).toBe(201);
    }
    const a = await readTranscript(app, 'case-a');
    const b = await readTranscript(app, 'case-b');
    expect(a.entries).toHaveLength(2);
    expect(b.entries).toHaveLength(2);
    expect(outbound(a.entries[1] as HarnessTranscript['entries'][number]).message.content.text).toBe(
      'eco: oi de case-a',
    );
    expect(outbound(b.entries[1] as HarnessTranscript['entries'][number]).message.content.text).toBe(
      'eco: oi de case-b',
    );
  });

  test('capability profile refusal is captured with violations and surfaced in the transcript', async () => {
    // A platform that renders no lists — the 10-clinics case from #953.
    await plugin.connect(HARNESS_INSTANCE, {
      instanceId: HARNESS_INSTANCE,
      credentials: {},
      options: { harnessProfile: { canSendList: false } },
    });
    await plugin.sendMessage(HARNESS_INSTANCE, {
      to: CHAT,
      content: {
        type: 'text',
        text: 'Escolha a clínica:',
        buttons: Array.from({ length: 10 }, (_, i) => ({ text: `Clínica ${i + 1}` })),
      },
    });

    const transcript = await readTranscript(app, CHAT);
    expect(transcript.profile.canSendList).toBe(false);
    const refused = outbound(transcript.entries[0] as HarnessTranscript['entries'][number]);
    expect(refused.violations).toEqual(['list_not_supported']);
    expect(refused.result.success).toBe(false);
    // Verbatim even when refused — CI sees exactly what would have vanished.
    expect(refused.message.content.buttons).toHaveLength(10);
    expect(eventBus.calls.some((c) => c.type === 'message.failed')).toBe(true);

    // A refused component never rendered, so it cannot be tapped.
    const tapRes = await app.request(`/api/v2/channels/harness/${HARNESS_INSTANCE}/tap`, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ chatId: CHAT, option: 1 }),
    });
    expect(tapRes.status).toBe(404);
  });

  test('reset clears one chat', async () => {
    await app.request(`/api/v2/channels/harness/${HARNESS_INSTANCE}/say`, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ chatId: CHAT, text: 'oi' }),
    });
    const del = await app.request(`/api/v2/channels/harness/${HARNESS_INSTANCE}/transcript?chatId=${CHAT}`, {
      method: 'DELETE',
      headers: AUTH_HEADERS,
    });
    expect(del.status).toBe(200);
    expect((await readTranscript(app, CHAT)).entries).toHaveLength(0);
  });

  test('routes are auth-required and harness-only', async () => {
    // No API key → 401 (unlike the public channel webhooks).
    const unauthed = await app.request(`/api/v2/channels/harness/${HARNESS_INSTANCE}/say`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: CHAT, text: 'oi' }),
    });
    expect(unauthed.status).toBe(401);

    // A non-harness instance is refused.
    const wrongChannel = await app.request(`/api/v2/channels/harness/${OTHER_INSTANCE}/say`, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ chatId: CHAT, text: 'oi' }),
    });
    expect(wrongChannel.status).toBe(400);

    // Unknown body fields fail validation (strict schema).
    const badBody = await app.request(`/api/v2/channels/harness/${HARNESS_INSTANCE}/say`, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ chatId: CHAT, text: 'oi', chatid: 'typo' }),
    });
    expect(badBody.status).toBe(400);
  });
});
