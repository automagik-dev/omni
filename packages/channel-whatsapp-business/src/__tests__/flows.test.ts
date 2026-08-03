/**
 * WhatsApp Flows — sender payload shape, dispatch validation, and the
 * inbound `nfm_reply` completion path.
 */

import { describe, expect, it, spyOn } from 'bun:test';
import type { Logger, PluginContext, PluginStorage } from '@omni/channel-sdk';
import type { EventBus, PublishResult, Subscription } from '@omni/core/events';
import type { MetaInboundMessage } from '@omni/core/schemas';

import { MetaWhatsAppClient } from '../client';
import { WhatsAppCloudPlugin } from '../plugin';
import { sendFlow } from '../senders/flow';
import type { MetaSendResponse } from '../types';

function makeClient(): MetaWhatsAppClient {
  return new MetaWhatsAppClient(
    {
      phoneNumberId: '123456789',
      accessToken: 'test-token',
      apiVersion: 'v25.0',
    },
    'waba-1',
  );
}

const OK_RESPONSE: MetaSendResponse = {
  messaging_product: 'whatsapp',
  messages: [{ id: 'wamid.flow123' }],
};

describe('sendFlow', () => {
  it('produces the interactive.flow payload (navigate, version 3)', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendMessage').mockResolvedValueOnce(OK_RESPONSE);

    const { flowToken } = await sendFlow(client, '+55 11 99999-8888', {
      flowId: 'flow-42',
      cta: 'Começar',
      bodyText: 'Preencha seu cadastro',
      headerText: 'Cadastro',
      footerText: 'Leva 1 minuto',
      screen: 'WELCOME',
      data: { source: 'omni' },
    });

    expect(flowToken).toBeTruthy();
    const arg = spy.mock.calls[0]?.[0] as {
      to: string;
      type: string;
      interactive: {
        type: string;
        header?: unknown;
        body: unknown;
        footer?: unknown;
        action: { name: string; parameters: Record<string, unknown> };
      };
    };
    expect(arg.to).toBe('5511999998888');
    expect(arg.type).toBe('interactive');
    expect(arg.interactive.type).toBe('flow');
    expect(arg.interactive.header).toEqual({ type: 'text', text: 'Cadastro' });
    expect(arg.interactive.body).toEqual({ text: 'Preencha seu cadastro' });
    expect(arg.interactive.footer).toEqual({ text: 'Leva 1 minuto' });
    expect(arg.interactive.action.name).toBe('flow');
    expect(arg.interactive.action.parameters).toEqual({
      flow_message_version: '3',
      flow_token: flowToken,
      flow_cta: 'Começar',
      flow_action: 'navigate',
      flow_id: 'flow-42',
      flow_action_payload: { screen: 'WELCOME', data: { source: 'omni' } },
    });
  });

  it('uses flow_name when flowName is given and mode=draft when draft', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendMessage').mockResolvedValueOnce(OK_RESPONSE);

    await sendFlow(client, '5511999998888', {
      flowName: 'onboarding',
      cta: 'Abrir',
      bodyText: 'Teste',
      draft: true,
    });

    const params = (spy.mock.calls[0]?.[0] as { interactive: { action: { parameters: Record<string, unknown> } } })
      .interactive.action.parameters;
    expect(params.flow_name).toBe('onboarding');
    expect(params.flow_id).toBeUndefined();
    expect(params.mode).toBe('draft');
    expect(params.flow_action_payload).toBeUndefined();
  });

  it('echoes a caller-provided flowToken instead of generating one', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'sendMessage').mockResolvedValueOnce(OK_RESPONSE);

    const { flowToken } = await sendFlow(client, '5511999998888', {
      flowId: 'flow-42',
      cta: 'Ir',
      bodyText: 'x',
      flowToken: 'lead-abc-123',
    });

    expect(flowToken).toBe('lead-abc-123');
    const params = (spy.mock.calls[0]?.[0] as { interactive: { action: { parameters: Record<string, unknown> } } })
      .interactive.action.parameters;
    expect(params.flow_token).toBe('lead-abc-123');
  });
});

describe('flows management client methods', () => {
  it('createFlow posts name/categories/flow_json to the WABA', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'post').mockResolvedValueOnce({ id: 'flow-1' });

    await client.createFlow({ name: 'survey', categories: ['SURVEY'], flowJson: '{"version":"7.2"}', publish: true });

    expect(spy).toHaveBeenCalledWith('/waba-1/flows', {
      name: 'survey',
      categories: ['SURVEY'],
      flow_json: '{"version":"7.2"}',
      publish: true,
    });
  });

  it('listFlows reads GET /{waba}/flows', async () => {
    const client = makeClient();
    const spy = spyOn(client, 'get').mockResolvedValueOnce({ data: [] });

    await client.listFlows();

    expect(spy).toHaveBeenCalledWith('/waba-1/flows');
  });

  it('flow operations without a wabaId throw INVALID_REQUEST', async () => {
    const client = new MetaWhatsAppClient({ phoneNumberId: '1', accessToken: 't' });

    await expect(client.listFlows()).rejects.toThrow('wabaId is required');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Inbound nfm_reply through the REAL plugin (extraction + rawPayload)
// ─────────────────────────────────────────────────────────────────────────

class MockLogger implements Logger {
  debug() {}
  info() {}
  warn() {}
  error() {}
  child(): Logger {
    return this;
  }
}

class MockStorage implements PluginStorage {
  private readonly data = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | null> {
    return (this.data.get(key) as T) ?? null;
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value);
  }
  async delete(key: string): Promise<boolean> {
    return this.data.delete(key);
  }
  async has(key: string): Promise<boolean> {
    return this.data.has(key);
  }
  async keys(): Promise<string[]> {
    return Array.from(this.data.keys());
  }
}

class MockEventBus implements EventBus {
  published: Array<{ type: string; payload: unknown }> = [];
  async connect(): Promise<void> {}
  async publish(type: string, payload: unknown): Promise<PublishResult> {
    this.published.push({ type, payload });
    return { id: 'test-id', sequence: 1, stream: 'test-stream' };
  }
  async publishGeneric(type: string, payload: unknown): Promise<PublishResult> {
    return this.publish(type, payload);
  }
  async subscribe(): Promise<Subscription> {
    return { id: 's1', pattern: '*', unsubscribe: async () => {} };
  }
  async subscribePattern(): Promise<Subscription> {
    return { id: 's2', pattern: '*', unsubscribe: async () => {} };
  }
  async subscribeMany(): Promise<Subscription> {
    return { id: 's3', pattern: '*', unsubscribe: async () => {} };
  }
  async subscribeAll(): Promise<Subscription> {
    return { id: 's4', pattern: '*', unsubscribe: async () => {} };
  }
  async close(): Promise<void> {}
  isConnected(): boolean {
    return true;
  }
}

function createContext(eventBus: MockEventBus): PluginContext {
  return {
    eventBus,
    storage: new MockStorage(),
    logger: new MockLogger(),
    config: {
      env: 'development',
      apiBaseUrl: 'http://localhost:3000',
      webhookBaseUrl: 'http://localhost:3000/webhooks',
      mediaStorage: { type: 'local', basePath: '/tmp/media' },
    },
    db: { execute: async () => [], getDrizzle: () => null },
  };
}

describe('inbound nfm_reply (real plugin)', () => {
  it('emits message.received with the flow body as text and response_json in rawPayload', async () => {
    const instanceId = '00000000-0000-4000-8000-000000000042';
    const plugin = new WhatsAppCloudPlugin();
    const eventBus = new MockEventBus();
    await plugin.initialize(createContext(eventBus));
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: '999' }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    await plugin.connect(instanceId, {
      instanceId,
      credentials: { metaAccessToken: 'EAAtest', metaPhoneNumberId: '999', metaWabaId: 'waba-1' },
    });
    fetchSpy.mockRestore();

    const responseJson = JSON.stringify({ flow_token: 'lead-abc', nome: 'Alice', horario: '14h' });
    const msg = {
      from: '5511999998888',
      id: 'wamid.FLOWREPLY1',
      timestamp: '1700000001',
      type: 'interactive',
      interactive: { type: 'nfm_reply', nfm_reply: { response_json: responseJson, body: 'Sent', name: 'flow' } },
    } as MetaInboundMessage;

    const state = plugin.getInstanceState(instanceId);
    if (!state) throw new Error('not connected');
    const handled = await plugin.handleInboundMessage(instanceId, msg, undefined, state.dedupeCache);

    expect(handled).toBe(true);
    const received = eventBus.published.filter((e) => e.type === 'message.received');
    expect(received).toHaveLength(1);
    const payload = received[0]?.payload as {
      message: { content: { text: string } };
      rawPayload?: { meta?: { interactive?: { nfm_reply?: { response_json: string } } } };
    };
    const flat = JSON.stringify(received[0]?.payload);
    expect(flat).toContain('"Sent"');
    expect(flat).toContain('lead-abc');
    expect(payload).toBeTruthy();
  });
});
