/**
 * /instances/:id/whatsapp-flows — WhatsApp Flows REST surface.
 *
 * Management routes (list/publish/preview) hit Graph API through
 * `MetaWhatsAppClient`, so those tests stub `globalThis.fetch`. The send route
 * dispatches through the channel plugin (`content.type='flow'` +
 * `metadata.flow`), so it is asserted against a mocked channelRegistry.
 */

import { afterEach, describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { AppVariables } from '../../../types';
import { whatsappFlowsRoutes } from '../whatsapp-flows';

const INSTANCE_ID = '11111111-1111-4111-8111-111111111111';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

type MountOptions = {
  channel?: string;
  metaAccessToken?: string | null;
  sendMessage?: ReturnType<typeof mock>;
};

function mountFlowsRoutes(options: MountOptions = {}): {
  app: Hono<{ Variables: AppVariables }>;
  sendMessage: ReturnType<typeof mock>;
} {
  const sendMessage =
    options.sendMessage ??
    mock(async (_instanceId: string, _message: unknown) => ({
      success: true,
      messageId: 'wamid.SENT-FLOW',
      timestamp: 123,
    }));

  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('services', {
      instances: {
        getById: mock(async (id: string) => ({
          id,
          channel: options.channel ?? 'whatsapp-cloud',
          metaAccessToken: options.metaAccessToken === undefined ? 'META-TOKEN' : options.metaAccessToken,
          metaPhoneNumberId: 'PHONE-1',
          metaWabaId: 'WABA-1',
          metaApiVersion: 'v25.0',
        })),
      },
    } as never);
    c.set('channelRegistry', {
      get: mock(() => ({ sendMessage })),
    } as never);
    c.set('apiKey', {
      id: 'test',
      name: 'test',
      scopes: ['*'],
      instanceIds: null,
      expiresAt: null,
    } as never);
    await next();
  });
  app.route('/', whatsappFlowsRoutes);
  return { app, sendMessage };
}

/** Stub globalThis.fetch, capturing requests and replying with canned JSON. */
function stubGraphFetch(body: unknown): { calls: Array<{ url: string; method: string; body?: unknown }> } {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { calls };
}

describe('GET /instances/:id/whatsapp-flows', () => {
  test('lists flows from Meta mapped to { id, name, status, categories }', async () => {
    const { app } = mountFlowsRoutes();
    const { calls } = stubGraphFetch({
      data: [
        {
          id: 'FLOW-1',
          name: 'Lead capture',
          status: 'PUBLISHED',
          categories: ['LEAD_GENERATION'],
          validation_errors: [],
        },
        { id: 'FLOW-2', name: 'Survey draft', status: 'DRAFT', categories: ['SURVEY', 'OTHER'] },
      ],
    });

    const res = await app.request(`/instances/${INSTANCE_ID}/whatsapp-flows`);

    expect(res.status).toBe(200);
    const json = (await res.json()) as { items: unknown[]; meta: { count: number } };
    expect(json.items).toEqual([
      { id: 'FLOW-1', name: 'Lead capture', status: 'PUBLISHED', categories: ['LEAD_GENERATION'] },
      { id: 'FLOW-2', name: 'Survey draft', status: 'DRAFT', categories: ['SURVEY', 'OTHER'] },
    ]);
    expect(json.meta.count).toBe(2);
    expect(calls[0]?.url).toContain('/WABA-1/flows');
  });

  test('400s when the instance is not whatsapp-cloud', async () => {
    const { app } = mountFlowsRoutes({ channel: 'whatsapp' });

    const res = await app.request(`/instances/${INSTANCE_ID}/whatsapp-flows`);

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('WRONG_CHANNEL');
  });

  test('400s when the instance has no Meta credentials', async () => {
    const { app } = mountFlowsRoutes({ metaAccessToken: null });

    const res = await app.request(`/instances/${INSTANCE_ID}/whatsapp-flows`);

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('NOT_CONFIGURED');
  });
});

describe('POST /instances/:id/whatsapp-flows', () => {
  test('creates a flow on Meta and returns its id', async () => {
    const { app } = mountFlowsRoutes();
    const { calls } = stubGraphFetch({ id: 'FLOW-NEW' });

    const res = await app.request(`/instances/${INSTANCE_ID}/whatsapp-flows`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Onboarding', categories: ['SIGN_UP'], publish: false }),
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ data: { id: 'FLOW-NEW' } });
    expect(calls[0]?.url).toContain('/WABA-1/flows');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.body).toEqual({ name: 'Onboarding', categories: ['SIGN_UP'], publish: false });
  });

  test('rejects an invalid category with 400', async () => {
    const { app } = mountFlowsRoutes();
    const { calls } = stubGraphFetch({ id: 'FLOW-NEW' });

    const res = await app.request(`/instances/${INSTANCE_ID}/whatsapp-flows`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Onboarding', categories: ['NOT_A_CATEGORY'] }),
    });

    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe('POST /instances/:id/whatsapp-flows/:flowId/publish', () => {
  test('calls through to Meta publish', async () => {
    const { app } = mountFlowsRoutes();
    const { calls } = stubGraphFetch({ success: true });

    const res = await app.request(`/instances/${INSTANCE_ID}/whatsapp-flows/FLOW-1/publish`, { method: 'POST' });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, flowId: 'FLOW-1' });
    expect(calls[0]?.url).toContain('/FLOW-1/publish');
    expect(calls[0]?.method).toBe('POST');
  });
});

describe('GET /instances/:id/whatsapp-flows/:flowId/preview', () => {
  test('maps the Meta preview payload to { previewUrl, expiresAt }', async () => {
    const { app } = mountFlowsRoutes();
    stubGraphFetch({
      preview: { preview_url: 'https://business.facebook.com/wa/flows/preview/1', expires_at: '2026-08-30T00:00:00Z' },
    });

    const res = await app.request(`/instances/${INSTANCE_ID}/whatsapp-flows/FLOW-1/preview`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      previewUrl: 'https://business.facebook.com/wa/flows/preview/1',
      expiresAt: '2026-08-30T00:00:00Z',
    });
  });

  test('404s when Meta returns no preview', async () => {
    const { app } = mountFlowsRoutes();
    stubGraphFetch({ id: 'FLOW-1' });

    const res = await app.request(`/instances/${INSTANCE_ID}/whatsapp-flows/FLOW-1/preview`);

    expect(res.status).toBe(404);
  });
});

describe('POST /instances/:id/whatsapp-flows/send', () => {
  async function postSend(app: Hono<{ Variables: AppVariables }>, body: Record<string, unknown>) {
    return app.request(`/instances/${INSTANCE_ID}/whatsapp-flows/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  test('dispatches through the plugin with metadata.flow and returns the flowToken', async () => {
    const { app, sendMessage } = mountFlowsRoutes();

    const res = await postSend(app, {
      to: '5511999998888',
      flowId: 'FLOW-1',
      cta: 'Start',
      bodyText: 'Fill in the flow',
      screen: 'WELCOME',
    });

    expect(res.status).toBe(201);
    const json = (await res.json()) as { messageId: string; flowToken: string };
    expect(json.messageId).toBe('wamid.SENT-FLOW');
    expect(json.flowToken).toMatch(/^[0-9a-f-]{36}$/);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [instanceId, message] = sendMessage.mock.calls[0] as [
      string,
      { to: string; content: { type: string; text?: string }; metadata?: { flow?: Record<string, unknown> } },
    ];
    expect(instanceId).toBe(INSTANCE_ID);
    expect(message.to).toBe('5511999998888');
    expect(message.content).toEqual({ type: 'flow', text: 'Fill in the flow' });
    expect(message.metadata?.flow).toEqual({
      flowId: 'FLOW-1',
      cta: 'Start',
      bodyText: 'Fill in the flow',
      screen: 'WELCOME',
      flowToken: json.flowToken,
    });
  });

  test('honors a caller-provided flowToken', async () => {
    const { app, sendMessage } = mountFlowsRoutes();

    const res = await postSend(app, {
      to: '5511999998888',
      flowName: 'lead_capture',
      cta: 'Go',
      bodyText: 'Body',
      flowToken: 'my-correlation-token',
    });

    expect(res.status).toBe(201);
    const json = (await res.json()) as { flowToken: string };
    expect(json.flowToken).toBe('my-correlation-token');
    const [, message] = sendMessage.mock.calls[0] as [string, { metadata?: { flow?: { flowToken?: string } } }];
    expect(message.metadata?.flow?.flowToken).toBe('my-correlation-token');
  });

  test('rejects a body with both flowId and flowName', async () => {
    const { app, sendMessage } = mountFlowsRoutes();

    const res = await postSend(app, {
      to: '5511999998888',
      flowId: 'FLOW-1',
      flowName: 'lead_capture',
      cta: 'Go',
      bodyText: 'Body',
    });

    expect(res.status).toBe(400);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test('rejects a body missing to/cta/bodyText', async () => {
    const { app, sendMessage } = mountFlowsRoutes();

    const res = await postSend(app, { flowId: 'FLOW-1' });

    expect(res.status).toBe(400);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test('surfaces a plugin send failure as 500', async () => {
    const sendMessage = mock(async () => ({
      success: false,
      error: 'outside 24h window',
      errorCode: 'OMNI_OUTSIDE_24H_WINDOW',
      timestamp: 123,
    }));
    const { app } = mountFlowsRoutes({ sendMessage });

    const res = await postSend(app, {
      to: '5511999998888',
      flowId: 'FLOW-1',
      cta: 'Go',
      bodyText: 'Body',
    });

    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe('OMNI_OUTSIDE_24H_WINDOW');
    expect(json.error.message).toBe('outside 24h window');
  });
});
