/**
 * Envelope forwarding in webhook / call_agent actions (#960).
 *
 * The khal/brain push-ingress contract: outbound webhook deliveries carry
 * `X-Omni-Event-Id` + `X-Omni-Delivery-Id` (redelivery-stable) headers, and —
 * when no bodyTemplate is set — the FULL OmniEvent envelope as the body, so a
 * receiver can dedupe on ids Omni minted instead of hashing bodies.
 *
 * Requests go to a local Bun.serve receiver on 127.0.0.1 (brokeredFetch with
 * no bound egress policy is a passthrough to fetch) — no external network.
 */

import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { type ActionDependencies, type AgentCallContext, executeAction, executeActions } from '../actions';
import { type TemplateContext, createTemplateContext, substituteTemplate } from '../templates';
import type { AutomationAction } from '../types';

interface CapturedRequest {
  headers: Record<string, string>;
  body: string;
  method: string;
}

let server: ReturnType<typeof Bun.serve>;
let captured: CapturedRequest[] = [];
let receiverUrl: string;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(req) {
      captured.push({
        headers: Object.fromEntries(req.headers.entries()),
        body: await req.text(),
        method: req.method,
      });
      return Response.json({ ok: true });
    },
  });
  receiverUrl = `http://127.0.0.1:${server.port}/hook`;
});

afterAll(() => {
  server.stop(true);
});

const deps: ActionDependencies = { eventBus: null };

const TRIGGER_EVENT = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  type: 'custom.webhook.brain',
  timestamp: 1_757_000_000_000,
  metadata: { correlationId: 'cccccccc-0000-4000-8000-000000000009', source: 'webhook' },
};

function envelopeContext(): TemplateContext {
  return createTemplateContext(
    { hello: 'world', n: 42 },
    { event: TRIGGER_EVENT, automation: { id: 'auto-brain-push' } },
  );
}

function webhookAction(config: Record<string, unknown> = {}): AutomationAction {
  return {
    type: 'webhook',
    config: { url: receiverUrl, method: 'POST', waitForResponse: true, ...config },
  } as AutomationAction;
}

describe('webhook action envelope forwarding (#960)', () => {
  test('delivery carries X-Omni-Event-Id, X-Omni-Delivery-Id, and the full envelope body', async () => {
    captured = [];
    const results = await executeActions([webhookAction()], envelopeContext(), deps);

    expect(results[0]?.status).toBe('success');
    expect(captured).toHaveLength(1);
    const req = captured[0];
    if (!req) throw new Error('no request captured');

    expect(req.headers['x-omni-event-id']).toBe(TRIGGER_EVENT.id);
    expect(req.headers['x-omni-delivery-id']).toBe(`${TRIGGER_EVENT.id}:auto-brain-push:0`);

    const body = JSON.parse(req.body);
    expect(body).toEqual({
      id: TRIGGER_EVENT.id,
      type: TRIGGER_EVENT.type,
      payload: { hello: 'world', n: 42 },
      metadata: TRIGGER_EVENT.metadata,
      timestamp: TRIGGER_EVENT.timestamp,
    });
  });

  test('retrying the same delivery produces the SAME X-Omni-Delivery-Id', async () => {
    captured = [];
    const context = envelopeContext();
    const action = webhookAction();
    await executeActions([action], context, deps);
    await executeActions([action], context, deps);

    expect(captured).toHaveLength(2);
    expect(captured[0]?.headers['x-omni-delivery-id']).toBe(captured[1]?.headers['x-omni-delivery-id']);
  });

  test('delivery id varies by action index within one automation', async () => {
    captured = [];
    await executeActions([webhookAction(), webhookAction()], envelopeContext(), deps);

    expect(captured[0]?.headers['x-omni-delivery-id']).toBe(`${TRIGGER_EVENT.id}:auto-brain-push:0`);
    expect(captured[1]?.headers['x-omni-delivery-id']).toBe(`${TRIGGER_EVENT.id}:auto-brain-push:1`);
  });

  test('bodyTemplate output is byte-identical to the rendered template (contract preserved)', async () => {
    captured = [];
    const bodyTemplate = '{"text":"{{payload.hello}}","evt":"{{event.id}}"}';
    const context = envelopeContext();
    await executeActions([webhookAction({ bodyTemplate })], context, deps);

    expect(captured[0]?.body).toBe(substituteTemplate(bodyTemplate, context));
    expect(captured[0]?.body).toBe(`{"text":"world","evt":"${TRIGGER_EVENT.id}"}`);
  });

  test('includeEnvelope: false restores the bare-payload default body (headers stay)', async () => {
    captured = [];
    await executeActions([webhookAction({ includeEnvelope: false })], envelopeContext(), deps);

    expect(JSON.parse(captured[0]?.body ?? '')).toEqual({ hello: 'world', n: 42 });
    expect(captured[0]?.headers['x-omni-event-id']).toBe(TRIGGER_EVENT.id);
  });

  test('envelope-less invocation (manual execute) sends bare payload and no X-Omni headers — byte-identical legacy behavior', async () => {
    captured = [];
    const context = createTemplateContext({ hello: 'world', n: 42 });
    await executeActions([webhookAction()], context, deps);

    expect(JSON.parse(captured[0]?.body ?? '')).toEqual({ hello: 'world', n: 42 });
    expect(captured[0]?.headers['x-omni-event-id']).toBeUndefined();
    expect(captured[0]?.headers['x-omni-delivery-id']).toBeUndefined();
  });

  test('operator-configured headers override the auto-stamped envelope headers', async () => {
    captured = [];
    await executeActions(
      [webhookAction({ headers: { 'X-Omni-Event-Id': 'operator-override' } })],
      envelopeContext(),
      deps,
    );

    expect(captured[0]?.headers['x-omni-event-id']).toBe('operator-override');
  });

  test('direct executeAction defaults actionIndex to 0', async () => {
    captured = [];
    await executeAction(webhookAction(), envelopeContext(), deps);
    expect(captured[0]?.headers['x-omni-delivery-id']).toBe(`${TRIGGER_EVENT.id}:auto-brain-push:0`);
  });
});

describe('call_agent envelope context (#960)', () => {
  test('the agent call context carries the triggering event envelope', async () => {
    const callAgent = mock(async (_context: AgentCallContext) => ({
      parts: ['ok'],
      fullResponse: 'ok',
      metadata: { runId: 'r1', sessionId: 's1', status: 'completed' as const },
    }));
    const context = createTemplateContext(
      {
        chatId: 'chat-1',
        from: { id: 'user-1', name: 'U' },
        content: { type: 'text', text: 'hi' },
        instanceId: 'inst-1',
      },
      { event: TRIGGER_EVENT, automation: { id: 'auto-brain-push' } },
    );

    const action: AutomationAction = { type: 'call_agent', config: { agentId: 'agent-1' } };
    const results = await executeActions([action], context, { eventBus: null, callAgent });

    expect(results[0]?.status).toBe('success');
    const agentContext = callAgent.mock.calls[0]?.[0];
    expect(agentContext?.event).toEqual({
      id: TRIGGER_EVENT.id,
      type: TRIGGER_EVENT.type,
      correlationId: TRIGGER_EVENT.metadata.correlationId,
    });
  });

  test('envelope-less call_agent context has no event field (legacy behavior)', async () => {
    const callAgent = mock(async (_context: AgentCallContext) => ({
      parts: ['ok'],
      fullResponse: 'ok',
      metadata: { runId: 'r1', sessionId: 's1', status: 'completed' as const },
    }));
    const context = createTemplateContext({
      chatId: 'chat-1',
      from: { id: 'user-1' },
      content: { type: 'text', text: 'hi' },
      instanceId: 'inst-1',
    });

    await executeActions([{ type: 'call_agent', config: { agentId: 'agent-1' } }], context, {
      eventBus: null,
      callAgent,
    });

    const agentContext = callAgent.mock.calls[0]?.[0];
    expect(agentContext?.event).toBeUndefined();
  });
});

describe('template envelope placeholders (#960)', () => {
  test('{{event.id}}, {{event.type}}, {{event.metadata.correlationId}} resolve from the threaded envelope', () => {
    const context = envelopeContext();
    expect(substituteTemplate('{{event.id}}|{{event.type}}|{{event.metadata.correlationId}}', context)).toBe(
      `${TRIGGER_EVENT.id}|${TRIGGER_EVENT.type}|${TRIGGER_EVENT.metadata.correlationId}`,
    );
  });

  test('{{event.*}} renders empty when no envelope is threaded', () => {
    const context = createTemplateContext({ hello: 'world' });
    expect(substituteTemplate('[{{event.id}}]', context)).toBe('[]');
  });
});
