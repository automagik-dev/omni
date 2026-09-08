/**
 * MsTeamsPlugin unit tests
 *
 * Runs every path against a FAKED CloudAdapter (injected through the
 * protected `createAdapter` seam) — no Bot Framework traffic ever leaves the
 * process. Covers:
 *   - connect: Zod credential boundary (valid, invalid) + instance.connected
 *   - handleWebhook: routing (404/400), JWT rejection (401), dedupe,
 *     sanitizer rejection, ConversationReference capture and
 *     message.received emission with timings
 *   - sendMessage: reference-found and reference-missing paths, Connector
 *     failure, text-only guard, not-connected guard
 *   - disconnect: full state cleanup + instance.disconnected
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { PluginContext } from '@omni/channel-sdk';
import type { Activity, CloudAdapter, ConversationReference, TurnContext } from 'botbuilder';
import { MsTeamsPlugin } from '../plugin';
import type { MsTeamsConfig } from '../types';
import { MsTeamsApiError, MsTeamsErrorCode } from '../utils/errors';

// ─── Mock context (channel-harness precedent) ────────────────

function createMockLogger() {
  const logger = {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    child: mock(function (this: unknown) {
      return logger;
    }),
  };
  return logger;
}

function createMockEventBus() {
  const calls: Array<{ type: string; payload: Record<string, unknown>; metadata: Record<string, unknown> }> = [];
  return {
    calls,
    connect: mock(async () => {}),
    publish: mock(async (type: string, payload: Record<string, unknown>, metadata: Record<string, unknown>) => {
      calls.push({ type, payload, metadata });
      return { seq: 1 };
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

function createMockContext(eventBus = createMockEventBus()): PluginContext {
  return {
    eventBus: eventBus as unknown as PluginContext['eventBus'],
    logger: createMockLogger() as unknown as PluginContext['logger'],
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

// ─── Fake CloudAdapter ────────────────────────────────────────

class FakeCloudAdapter {
  onTurnError: ((context: TurnContext, error: Error) => Promise<void>) | undefined;
  rejectAuth = false;
  failSend = false;
  sentActivities: Array<Partial<Activity>> = [];
  continueCalls: Array<{ appId: string; reference: Partial<ConversationReference> }> = [];

  async processActivityDirect(
    _authorization: string,
    activity: Activity,
    logic: (context: TurnContext) => Promise<void>,
  ): Promise<void> {
    if (this.rejectAuth) {
      throw new Error('Unauthorized Access. Request is not authorized');
    }
    await logic({ activity } as unknown as TurnContext);
  }

  async continueConversationAsync(
    botAppId: string,
    reference: Partial<ConversationReference>,
    logic: (context: TurnContext) => Promise<void>,
  ): Promise<void> {
    this.continueCalls.push({ appId: botAppId, reference });
    if (this.failSend) {
      throw new Error('Connector rejected the activity');
    }
    const context = {
      sendActivity: async (activity: Partial<Activity>) => {
        this.sentActivities.push(activity);
        return { id: 'sent-1' };
      },
    } as unknown as TurnContext;
    await logic(context);
  }
}

class TestMsTeamsPlugin extends MsTeamsPlugin {
  adapters: FakeCloudAdapter[] = [];
  credentialBags: MsTeamsConfig[] = [];

  protected override createAdapter(credentials: MsTeamsConfig): CloudAdapter {
    const adapter = new FakeCloudAdapter();
    this.adapters.push(adapter);
    this.credentialBags.push(credentials);
    return adapter as unknown as CloudAdapter;
  }
}

// ─── Fixtures ─────────────────────────────────────────────────

const INSTANCE = 'msteams-inst-1';
const APP_ID = 'app-123';

function connectConfig(overrides: Record<string, unknown> = {}) {
  return {
    instanceId: INSTANCE,
    credentials: {},
    options: {
      msteamsAppId: APP_ID,
      msteamsAppPassword: 's3cret',
      msteamsTenantId: 'tenant-1',
      ...overrides,
    },
  };
}

function inboundActivity(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'message',
    id: 'act-1',
    text: 'hello world',
    timestamp: '2026-09-08T12:00:00.000Z',
    channelId: 'msteams',
    serviceUrl: 'https://smba.trafficmanager.net/amer/',
    from: { id: 'user-1', name: 'Ada Lovelace' },
    recipient: { id: 'bot-1', name: 'Omni Bot' },
    conversation: { id: 'conv-1' },
    ...overrides,
  };
}

function webhookRequest(body: unknown, instanceId = INSTANCE): Request {
  return new Request(`http://localhost:3000/api/v2/channels/msteams/${instanceId}/webhook`, {
    method: 'POST',
    headers: { authorization: 'Bearer jwt-from-botframework', 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('MsTeamsPlugin', () => {
  let plugin: TestMsTeamsPlugin;
  let eventBus: ReturnType<typeof createMockEventBus>;

  const eventsOfType = (type: string) => eventBus.calls.filter((c) => c.type === type);

  beforeEach(async () => {
    plugin = new TestMsTeamsPlugin();
    eventBus = createMockEventBus();
    await plugin.initialize(createMockContext(eventBus));
  });

  // ─── connect ────────────────────────────────────────────────

  describe('connect', () => {
    it('builds the adapter from Zod-validated credentials and emits instance.connected', async () => {
      await plugin.connect(INSTANCE, connectConfig());

      expect(plugin.adapters).toHaveLength(1);
      expect(plugin.credentialBags[0]).toEqual({
        appId: APP_ID,
        appPassword: 's3cret',
        appType: 'MultiTenant',
        tenantId: 'tenant-1',
        allowAnonymous: false,
      });

      const connected = eventsOfType('instance.connected');
      expect(connected).toHaveLength(1);
      expect(connected[0]?.payload.ownerIdentifier).toBe(APP_ID);
    });

    it('accepts the plain (non-prefixed) credential keys for direct SDK use', async () => {
      await plugin.connect(INSTANCE, {
        instanceId: INSTANCE,
        credentials: { appId: APP_ID, appPassword: 's3cret', appType: 'SingleTenant', tenantId: 'tenant-1' },
        options: {},
      });

      expect(plugin.credentialBags[0]?.appType).toBe('SingleTenant');
    });

    it('rejects a credential bag without appPassword at the Zod boundary', async () => {
      const attempt = plugin.connect(INSTANCE, {
        instanceId: INSTANCE,
        credentials: {},
        options: { msteamsAppId: APP_ID },
      });

      await expect(attempt).rejects.toBeInstanceOf(MsTeamsApiError);
      await expect(attempt).rejects.toMatchObject({ channelCode: MsTeamsErrorCode.INVALID_CONFIG });
      expect(plugin.adapters).toHaveLength(0);
      expect(eventsOfType('instance.connected')).toHaveLength(0);
    });

    it('allows empty credentials only behind the explicit allowAnonymous local-dev flag', async () => {
      await plugin.connect(INSTANCE, {
        instanceId: INSTANCE,
        credentials: {},
        options: { msteamsAllowAnonymous: true },
      });

      expect(plugin.adapters).toHaveLength(1);
      expect(plugin.credentialBags[0]?.allowAnonymous).toBe(true);
      const connected = eventsOfType('instance.connected');
      expect(connected[0]?.payload.ownerIdentifier).toBe('anonymous-local');
    });

    it('is a no-op warn when the instance is already connected', async () => {
      await plugin.connect(INSTANCE, connectConfig());
      await plugin.connect(INSTANCE, connectConfig());
      expect(plugin.adapters).toHaveLength(1);
    });
  });

  // ─── handleWebhook ──────────────────────────────────────────

  describe('handleWebhook', () => {
    beforeEach(async () => {
      await plugin.connect(INSTANCE, connectConfig());
    });

    it('404s for an unknown instance', async () => {
      const res = await plugin.handleWebhook(webhookRequest(inboundActivity(), 'unknown-instance'));
      expect(res.status).toBe(404);
    });

    it('400s on invalid JSON', async () => {
      const res = await plugin.handleWebhook(webhookRequest('{not json'));
      expect(res.status).toBe(400);
    });

    it('400s on a body that is not an activity', async () => {
      const res = await plugin.handleWebhook(webhookRequest({ hello: 'world' }));
      expect(res.status).toBe(400);
      expect(eventsOfType('message.received')).toHaveLength(0);
    });

    it('401s when the adapter rejects the Bot Framework JWT, emitting nothing', async () => {
      plugin.adapters[0]!.rejectAuth = true;
      const res = await plugin.handleWebhook(webhookRequest(inboundActivity()));
      expect(res.status).toBe(401);
      expect(eventsOfType('message.received')).toHaveLength(0);
    });

    it('emits message.received with the captured conversation, sender and timings', async () => {
      const res = await plugin.handleWebhook(webhookRequest(inboundActivity()));
      expect(res.status).toBe(200);

      const received = eventsOfType('message.received');
      expect(received).toHaveLength(1);
      const { payload, metadata } = received[0]!;
      expect(payload.externalId).toBe('act-1');
      expect(payload.chatId).toBe('conv-1');
      expect(payload.from).toBe('user-1');
      expect(payload.senderName).toBe('Ada Lovelace');
      expect((payload.content as { text?: string }).text).toBe('hello world');
      expect(metadata.channelType).toBe('msteams');
      // Journey timing: T0 (platform timestamp) + T1 (plugin receipt) ride the metadata.
      const timings = metadata.timings as Record<string, number>;
      expect(timings.platformReceivedAt).toBe(Date.parse('2026-09-08T12:00:00.000Z'));
      expect(typeof timings.pluginReceivedAt).toBe('number');
    });

    it('drops a duplicate delivery of the same activity id', async () => {
      await plugin.handleWebhook(webhookRequest(inboundActivity()));
      const res = await plugin.handleWebhook(webhookRequest(inboundActivity()));
      expect(res.status).toBe(200);
      expect(eventsOfType('message.received')).toHaveLength(1);
    });

    it('rejects inbound text carrying null bytes via the SDK sanitizer', async () => {
      const res = await plugin.handleWebhook(webhookRequest(inboundActivity({ id: 'act-nul', text: 'bad\u0000text' })));
      expect(res.status).toBe(200);
      expect(eventsOfType('message.received')).toHaveLength(0);
    });

    it('captures the ConversationReference from non-message activities without emitting', async () => {
      const res = await plugin.handleWebhook(
        webhookRequest(inboundActivity({ type: 'conversationUpdate', id: 'act-cu', text: undefined })),
      );
      expect(res.status).toBe(200);
      expect(eventsOfType('message.received')).toHaveLength(0);

      // The reference is usable: a send to that conversation now succeeds.
      const result = await plugin.sendMessage(INSTANCE, { to: 'conv-1', content: { type: 'text', text: 'hi' } });
      expect(result.success).toBe(true);
    });
  });

  // ─── sendMessage ────────────────────────────────────────────

  describe('sendMessage', () => {
    it('fails non-retryably (and emits message.failed) when the instance is not connected', async () => {
      const result = await plugin.sendMessage(INSTANCE, { to: 'conv-1', content: { type: 'text', text: 'hi' } });
      expect(result.success).toBe(false);
      expect(result.retryable).toBe(false);
      const failed = eventsOfType('message.failed');
      expect(failed).toHaveLength(1);
      expect(failed[0]?.payload.errorCode).toBe(MsTeamsErrorCode.NOT_CONNECTED);
    });

    describe('when connected', () => {
      beforeEach(async () => {
        await plugin.connect(INSTANCE, connectConfig());
      });

      it('fails non-retryably when no ConversationReference is stored', async () => {
        const result = await plugin.sendMessage(INSTANCE, { to: 'conv-unseen', content: { type: 'text', text: 'hi' } });
        expect(result.success).toBe(false);
        expect(result.retryable).toBe(false);
        const failed = eventsOfType('message.failed');
        expect(failed).toHaveLength(1);
        expect(failed[0]?.payload.errorCode).toBe(MsTeamsErrorCode.NO_CONVERSATION_REFERENCE);
        expect(plugin.adapters[0]!.continueCalls).toHaveLength(0);
      });

      it('rejects non-text content without calling the Connector (text-only scaffold)', async () => {
        const result = await plugin.sendMessage(INSTANCE, {
          to: 'conv-1',
          content: { type: 'image', mediaUrl: 'https://example.com/x.png' },
        });
        expect(result.success).toBe(false);
        expect(result.retryable).toBe(false);
        expect(eventsOfType('message.failed')).toHaveLength(0);
        expect(plugin.adapters[0]!.continueCalls).toHaveLength(0);
      });

      describe('with a captured ConversationReference', () => {
        beforeEach(async () => {
          await plugin.handleWebhook(webhookRequest(inboundActivity()));
        });

        it('continues the stored conversation and emits message.sent', async () => {
          const result = await plugin.sendMessage(INSTANCE, {
            to: 'conv-1',
            content: { type: 'text', text: 'reply!' },
          });

          expect(result.success).toBe(true);
          expect(result.messageId).toBe('sent-1');

          const adapter = plugin.adapters[0]!;
          expect(adapter.continueCalls).toHaveLength(1);
          expect(adapter.continueCalls[0]?.appId).toBe(APP_ID);
          expect(adapter.continueCalls[0]?.reference.conversation?.id).toBe('conv-1');
          expect(adapter.sentActivities).toEqual([{ type: 'message', text: 'reply!' }]);

          const sent = eventsOfType('message.sent');
          expect(sent).toHaveLength(1);
          expect(sent[0]?.payload.externalId).toBe('sent-1');
          expect(sent[0]?.payload.chatId).toBe('conv-1');
        });

        it('fails retryably (and emits message.failed) when the Connector rejects the send', async () => {
          plugin.adapters[0]!.failSend = true;
          const result = await plugin.sendMessage(INSTANCE, { to: 'conv-1', content: { type: 'text', text: 'hi' } });

          expect(result.success).toBe(false);
          expect(result.retryable).toBe(true);
          expect(result.errorCode).toBe(MsTeamsErrorCode.SEND_FAILED);
          const failed = eventsOfType('message.failed');
          expect(failed).toHaveLength(1);
          expect(failed[0]?.payload.retryable).toBe(true);
          expect(eventsOfType('message.sent')).toHaveLength(0);
        });
      });
    });
  });

  // ─── disconnect ─────────────────────────────────────────────

  describe('disconnect', () => {
    it('clears all instance state and emits instance.disconnected', async () => {
      await plugin.connect(INSTANCE, connectConfig());
      await plugin.handleWebhook(webhookRequest(inboundActivity()));

      await plugin.disconnect(INSTANCE);

      expect(eventsOfType('instance.disconnected')).toHaveLength(1);

      // Webhook no longer routes to the instance…
      const res = await plugin.handleWebhook(webhookRequest(inboundActivity({ id: 'act-2' })));
      expect(res.status).toBe(404);

      // …and sends fail as not-connected (the captured reference is gone too).
      const result = await plugin.sendMessage(INSTANCE, { to: 'conv-1', content: { type: 'text', text: 'hi' } });
      expect(result.success).toBe(false);
      const failed = eventsOfType('message.failed');
      expect(failed[failed.length - 1]?.payload.errorCode).toBe(MsTeamsErrorCode.NOT_CONNECTED);
    });

    it('is a silent no-op for an unknown instance', async () => {
      await plugin.disconnect('never-connected');
      expect(eventsOfType('instance.disconnected')).toHaveLength(0);
    });
  });
});
