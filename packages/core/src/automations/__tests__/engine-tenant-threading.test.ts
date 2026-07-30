/**
 * Automation-engine tenant threading (wish: omni-full-multitenancy, Group G5;
 * ADR-0008).
 *
 * The engine consumes NATS events and executes tenant-controlled actions
 * (send_message, call_agent, webhook, emit_event). Until this leg the trusted
 * tenant the producer stamped on the envelope stopped at the stale-idle gate —
 * the ACTION callbacks and the execution logger never saw it, so every DB read
 * and egress decision they made ran tenantless even for a tenant-world event.
 *
 * Contract probed here:
 *   1. a tenant-classified envelope threads its trusted tenant into
 *      `sendMessage` / `callAgent` / the execution logger — derived from the
 *      producer-stamped METADATA via `classifyEnvelope`, never from payload;
 *   2. a legacy envelope threads exactly `null` and behaves as before;
 *   3. a quarantine-class envelope (defence in depth — the subscription layer
 *      already refuses them) executes NO actions and logs a refusal, never a
 *      global-processing fallback;
 *   4. the debounce path CARRIES the stamp: the synthetic flush event is
 *      re-stamped from the window, so a debounced tenant automation does not
 *      silently degrade to the legacy world;
 *   5. a stamp CHANGE inside a debounce window flushes the old window first —
 *      one flush never mixes two worlds;
 *   6. the webhook action binds the trusted tenant into the egress broker's
 *      context (ADR-0009), so a bound tenant policy enforces default-deny while
 *      the legacy world stays `(unbound)` passthrough;
 *   7. the emit_event action threads the trusted tenant into the re-publish
 *      metadata, so the NEXT hop's envelope is stamped by the publisher seam
 *      (`resolvePublishTenantId` explicit-tenant precedence).
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { setEgressPolicyResolver } from '../../egress';
import type { EventBus, Subscription } from '../../events/bus';
import type { EventType, OmniEvent } from '../../events/types';
import { AutomationEngine } from '../engine';
import type { Automation } from '../types';

const TENANT_A = '11111111-1111-4111-8111-1111111111aa';
const TENANT_B = '22222222-2222-4222-8222-2222222222bb';

interface CapturedPublish {
  type: string;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown> | undefined;
}

function captureBus(): {
  bus: EventBus;
  handlers: Map<string, (event: OmniEvent) => Promise<void>>;
  published: CapturedPublish[];
} {
  const handlers = new Map<string, (event: OmniEvent) => Promise<void>>();
  const published: CapturedPublish[] = [];
  const bus = {
    publish: async () => ({ id: 'pub', timestamp: Date.now() }),
    publishGeneric: async (type: string, payload: Record<string, unknown>, metadata?: Record<string, unknown>) => {
      published.push({ type, payload, metadata });
      return { id: 'pub-generic', timestamp: Date.now() };
    },
    subscribe: async () => ({ unsubscribe: async () => {} }) as Subscription,
    subscribePattern: async (pattern: string, handler: (event: OmniEvent) => Promise<void>) => {
      handlers.set(pattern, handler);
      return { unsubscribe: async () => {} } as Subscription;
    },
    flush: async () => {},
    close: async () => {},
  } as unknown as EventBus;
  return { bus, handlers, published };
}

function automation(overrides: Partial<Automation> & { actions: Automation['actions'] }): Automation {
  return {
    id: 'auto-1',
    name: 'threading probe',
    enabled: true,
    priority: 0,
    triggerEventType: 'custom.tenant-probe',
    triggerConditions: [],
    conditionLogic: 'and',
    debounce: null,
    ...overrides,
  } as Automation;
}

function event(metadata: Record<string, unknown>, payload: Record<string, unknown> = {}): OmniEvent {
  return {
    id: `evt-${crypto.randomUUID()}`,
    type: 'custom.tenant-probe' as EventType,
    payload: {
      instanceId: 'inst-1',
      chatId: 'chat-ext-1',
      from: { id: 'person-1', name: 'P' },
      content: { type: 'text', text: 'hello' },
      ...payload,
    },
    metadata: { correlationId: 'corr-1', instanceId: 'inst-1', ...metadata },
    timestamp: Date.now(),
  } as OmniEvent;
}

interface Harness {
  engine: AutomationEngine;
  handlers: Map<string, (event: OmniEvent) => Promise<void>>;
  published: CapturedPublish[];
  sendCalls: Array<{ instanceId: string; to: string; content: string; trustedTenantId: string | null | undefined }>;
  agentCalls: Array<{ instanceId: string; trustedTenantId: string | null | undefined }>;
  logged: Array<{ status: string; error?: string | null; trustedTenantId: string | null | undefined }>;
  fire: (e: OmniEvent) => Promise<void>;
}

async function startEngine(automations: Automation[]): Promise<Harness> {
  const { bus, handlers, published } = captureBus();
  const sendCalls: Harness['sendCalls'] = [];
  const agentCalls: Harness['agentCalls'] = [];
  const logged: Harness['logged'] = [];

  const engine = new AutomationEngine({ defaultConcurrency: 2, reconcileIntervalMs: 0 });
  engine.setLogger(async (log, trustedTenantId) => {
    logged.push({ status: log.status as string, error: log.error ?? null, trustedTenantId });
  });
  await engine.start(bus, automations, {
    sendMessage: async (instanceId, to, content, trustedTenantId) => {
      sendCalls.push({ instanceId, to, content, trustedTenantId });
    },
    callAgent: async (ctx, _cfg, trustedTenantId) => {
      agentCalls.push({ instanceId: ctx.instanceId, trustedTenantId });
      return {
        parts: ['ok'],
        fullResponse: 'ok',
        metadata: { runId: 'r', sessionId: 's', status: 'completed' as const },
      };
    },
  });

  const fire = async (e: OmniEvent) => {
    const handler = handlers.get('custom.tenant-probe.>');
    if (!handler) throw new Error('engine did not subscribe to the trigger');
    await handler(e);
  };

  return { engine, handlers, published, sendCalls, agentCalls, logged, fire };
}

const SEND_ACTION = {
  type: 'send_message' as const,
  config: { instanceId: '{{payload.instanceId}}', to: '{{payload.chatId}}', contentTemplate: 'reply' },
};
const AGENT_ACTION = {
  type: 'call_agent' as const,
  config: { agentId: '' },
};

afterEach(async () => {
  setEgressPolicyResolver(null);
});

describe('automation engine threads the envelope tenant (G5, ADR-0008)', () => {
  test('tenant envelope: sendMessage, callAgent and the logger receive the trusted tenant', async () => {
    const h = await startEngine([automation({ actions: [SEND_ACTION, AGENT_ACTION] })]);
    try {
      await h.fire(event({ envelopeVersion: 1, tenantId: TENANT_A }));

      expect(h.sendCalls).toEqual([
        { instanceId: 'inst-1', to: 'chat-ext-1', content: 'reply', trustedTenantId: TENANT_A },
      ]);
      expect(h.agentCalls).toEqual([{ instanceId: 'inst-1', trustedTenantId: TENANT_A }]);
      expect(h.logged).toEqual([{ status: 'success', error: null, trustedTenantId: TENANT_A }]);
    } finally {
      await h.engine.stop();
    }
  });

  test('the tenant comes from METADATA, never from a payload claim', async () => {
    const h = await startEngine([automation({ actions: [SEND_ACTION] })]);
    try {
      // Legacy metadata + a forged payload tenant: the payload claim must not
      // reach the callbacks.
      await h.fire(event({}, { tenantId: TENANT_B }));
      expect(h.sendCalls).toEqual([
        { instanceId: 'inst-1', to: 'chat-ext-1', content: 'reply', trustedTenantId: null },
      ]);
    } finally {
      await h.engine.stop();
    }
  });

  test('legacy envelope: callbacks and logger receive exactly null', async () => {
    const h = await startEngine([automation({ actions: [SEND_ACTION] })]);
    try {
      await h.fire(event({}));
      expect(h.sendCalls).toEqual([
        { instanceId: 'inst-1', to: 'chat-ext-1', content: 'reply', trustedTenantId: null },
      ]);
      expect(h.logged).toEqual([{ status: 'success', error: null, trustedTenantId: null }]);
    } finally {
      await h.engine.stop();
    }
  });

  test('quarantine envelope: NO action executes; the refusal is logged, never processed globally', async () => {
    const h = await startEngine([automation({ actions: [SEND_ACTION, AGENT_ACTION] })]);
    try {
      // A tenant claim with no version contract — `malformed_envelope`.
      await h.fire(event({ tenantId: TENANT_A }));

      expect(h.sendCalls).toEqual([]);
      expect(h.agentCalls).toEqual([]);
      expect(h.logged.length).toBe(1);
      expect(h.logged[0]?.status).toBe('failed');
      expect(h.logged[0]?.error ?? '').toContain('quarantine');
      expect(h.logged[0]?.trustedTenantId).toBe(null);
    } finally {
      await h.engine.stop();
    }
  });

  test('debounce: the synthetic flush event carries the window stamp into the callbacks', async () => {
    const h = await startEngine([
      automation({ actions: [SEND_ACTION], debounce: { mode: 'fixed', delayMs: 5 } as Automation['debounce'] }),
    ]);
    try {
      await h.fire(event({ envelopeVersion: 1, tenantId: TENANT_A }, { content: { type: 'text', text: 'm1' } }));
      await h.fire(event({ envelopeVersion: 1, tenantId: TENANT_A }, { content: { type: 'text', text: 'm2' } }));
      await new Promise((r) => setTimeout(r, 40));

      expect(h.sendCalls.length).toBe(1); // debounced into one flush
      expect(h.sendCalls[0]?.trustedTenantId).toBe(TENANT_A);
    } finally {
      await h.engine.stop();
    }
  });

  test('debounce: a legacy window flushes with null — no stamp is invented', async () => {
    const h = await startEngine([
      automation({ actions: [SEND_ACTION], debounce: { mode: 'fixed', delayMs: 5 } as Automation['debounce'] }),
    ]);
    try {
      await h.fire(event({}));
      await new Promise((r) => setTimeout(r, 40));
      expect(h.sendCalls.length).toBe(1);
      expect(h.sendCalls[0]?.trustedTenantId).toBe(null);
    } finally {
      await h.engine.stop();
    }
  });

  test('debounce: a stamp change flushes the old window first — one flush never mixes worlds', async () => {
    const h = await startEngine([
      automation({ actions: [SEND_ACTION], debounce: { mode: 'fixed', delayMs: 25 } as Automation['debounce'] }),
    ]);
    try {
      await h.fire(event({ envelopeVersion: 1, tenantId: TENANT_A }, { content: { type: 'text', text: 'a1' } }));
      // Same conversation key, different trusted tenant (cannot happen while an
      // instance's tenant is immutable — defence in depth against a producer bug).
      await h.fire(event({ envelopeVersion: 1, tenantId: TENANT_B }, { content: { type: 'text', text: 'b1' } }));
      await new Promise((r) => setTimeout(r, 80));

      expect(h.sendCalls.length).toBe(2);
      expect(h.sendCalls[0]?.trustedTenantId).toBe(TENANT_A);
      expect(h.sendCalls[1]?.trustedTenantId).toBe(TENANT_B);
    } finally {
      await h.engine.stop();
    }
  });

  test('webhook action: the egress broker context binds the trusted tenant (legacy stays unbound)', async () => {
    const seenTenants: string[] = [];
    setEgressPolicyResolver((context) => {
      seenTenants.push(context.tenantId);
      return null; // observe-only: no policy bound, passthrough behavior
    });
    const WEBHOOK_ACTION = {
      type: 'webhook' as const,
      // Port 9 (discard) — connection refused locally; the action catches and
      // records a failure. No external network is touched.
      config: { url: 'http://127.0.0.1:9/hook', method: 'POST' as const, timeoutMs: 1000 },
    };
    const h = await startEngine([automation({ actions: [WEBHOOK_ACTION] })]);
    try {
      await h.fire(event({ envelopeVersion: 1, tenantId: TENANT_A }));
      await h.fire(event({}));
      expect(seenTenants).toEqual([TENANT_A, '(unbound)']);
    } finally {
      await h.engine.stop();
    }
  });

  test('emit_event action: the re-publish metadata carries the trusted tenant for the next hop', async () => {
    const EMIT_ACTION = {
      type: 'emit_event' as const,
      config: { eventType: 'custom.downstream' },
    };
    const h = await startEngine([automation({ actions: [EMIT_ACTION] })]);
    try {
      await h.fire(event({ envelopeVersion: 1, tenantId: TENANT_A }));
      await h.fire(event({}));

      expect(h.published.length).toBe(2);
      expect(h.published[0]?.metadata?.tenantId).toBe(TENANT_A);
      // Legacy re-publish threads NO tenant — the publisher seam decides, and
      // with nothing registered the envelope stays legacy/byte-identical.
      expect(h.published[1]?.metadata?.tenantId ?? undefined).toBeUndefined();
    } finally {
      await h.engine.stop();
    }
  });
});
