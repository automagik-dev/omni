import { describe, expect, it } from 'bun:test';
import type { TypedOmniEvent } from '@omni/core';
import type { Database } from '@omni/db';
import { currentTenantScope, requireTenantScope } from '../../tenancy/tenant-scope';
import { clearAgentSession, runTrashEmojiCleanup } from '../session-cleaner';

function makeDbWithAgentProvider(providerId: string) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ agentProviderId: providerId }],
        }),
      }),
    }),
  } as never;
}

describe('session-cleaner canonical KHAL reset guard', () => {
  it('fails closed for Agno/KHAL resets when canonical person identity cannot be resolved', async () => {
    const services = {
      agentRunner: {
        getInstanceWithProvider: async () => ({
          id: 'inst-1',
          agentId: 'agent-1',
          channel: 'whatsapp-gupshup',
          agentSessionStrategy: 'per_chat',
        }),
      },
      providers: {
        getById: async () => ({
          id: 'provider-1',
          schema: 'agno',
          baseUrl: 'http://agno.invalid',
          apiKey: '',
          defaultTimeout: 1,
        }),
      },
      chats: {
        findByExternalIdSmart: async () => null,
      },
    } as never;

    await expect(
      clearAgentSession(services, makeDbWithAgentProvider('provider-1'), 'inst-1', '5547996094523', '5547996094523', {
        rawPayload: { headers: { 'x-khal-env': 'hml' } },
      }),
    ).rejects.toThrow('Canonical KHAL session resolution failed');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G5 worker tenant boundary (ADR-0008): the cleanup handler must run its DB
// work in the envelope's world — a tenant envelope opens a worker scope stamped
// with the trusted tenant, a legacy envelope runs unscoped on the ambient pool
// byte-identically, and a malformed envelope is refused before any work runs.
// ─────────────────────────────────────────────────────────────────────────────

const TENANT_A = '11111111-1111-4111-8111-11111111111a';

/** A Database whose `transaction` runs the callback with a no-op tx handle. */
function fakeDb(): Database {
  return {
    transaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => cb({ execute: async () => [] as unknown }),
  } as unknown as Database;
}

interface CleanupProbe {
  scopeSeen: string | null | undefined;
  getInstanceCalls: number;
  sendMessageCalls: number;
  disarmTenant: string | null | undefined;
}

/**
 * Build a services stub whose `getInstanceWithProvider` records the tenant scope
 * active while it runs, then returns an agent-less instance so `clearAgentSession`
 * throws the skippable "No agent configured" — enough to prove the FIRST cleanup
 * DB block ran in the right world without wiring a full provider.
 */
function makeProbeServices(probe: CleanupProbe) {
  return {
    agentRunner: {
      getInstanceWithProvider: async () => {
        probe.getInstanceCalls += 1;
        const scope = currentTenantScope();
        probe.scopeSeen = scope ? requireTenantScope().tenantId : null;
        // Agent-less → clearAgentSession throws a skippable error (no send).
        return { id: 'inst-1', agentId: undefined };
      },
    },
    providers: { getById: async () => ({ id: 'p', schema: 'agno' }) },
    chats: {
      findByExternalIdSmart: async () => null,
      update: async () => ({ id: 'chat-1' }),
    },
    followUpLifecycle: {
      disarm: async (input: { tenantId?: string | null }) => {
        probe.disarmTenant = input.tenantId ?? null;
      },
    },
    instances: { getById: async () => ({ id: 'inst-1', channel: 'whatsapp-gupshup' }) },
  } as never;
}

function makeEvent(metadata: Record<string, unknown>): TypedOmniEvent<'message.received'> {
  return {
    id: 'evt-1',
    type: 'message.received',
    timestamp: new Date().toISOString(),
    payload: { chatId: 'chat-ext', from: 'user-1', content: { text: '🗑️' }, rawPayload: {} },
    metadata: { instanceId: 'inst-1', ...metadata },
  } as unknown as TypedOmniEvent<'message.received'>;
}

describe('session-cleaner worker tenant boundary (G5)', () => {
  it('(a) a tenant envelope runs cleanup DB work inside a worker scope stamped with the envelope tenant', async () => {
    const probe: CleanupProbe = {
      scopeSeen: undefined,
      getInstanceCalls: 0,
      sendMessageCalls: 0,
      disarmTenant: undefined,
    };
    const services = makeProbeServices(probe);
    const event = makeEvent({ envelopeVersion: 1, tenantId: TENANT_A, correlationId: 'c1' });

    await runTrashEmojiCleanup(services, fakeDb(), event);

    expect(probe.getInstanceCalls).toBe(1);
    expect(probe.scopeSeen).toBe(TENANT_A);
  });

  it('(b) a legacy envelope runs cleanup with NO tenant scope (ambient pool)', async () => {
    const probe: CleanupProbe = {
      scopeSeen: undefined,
      getInstanceCalls: 0,
      sendMessageCalls: 0,
      disarmTenant: undefined,
    };
    const services = makeProbeServices(probe);
    const event = makeEvent({ correlationId: 'c1' }); // no envelopeVersion / tenantId

    await runTrashEmojiCleanup(services, fakeDb(), event);

    expect(probe.getInstanceCalls).toBe(1);
    expect(probe.scopeSeen).toBeNull();
  });

  it('(d) an agent-less instance does not touch the chat (nothing to resume)', async () => {
    let chatLookups = 0;
    const services = {
      ...(makeProbeServices({
        scopeSeen: undefined,
        getInstanceCalls: 0,
        sendMessageCalls: 0,
        disarmTenant: undefined,
      }) as Record<string, unknown>),
      chats: {
        findByExternalIdSmart: async () => {
          chatLookups += 1;
          return null;
        },
      },
    } as never;

    await runTrashEmojiCleanup(services, fakeDb(), makeEvent({ correlationId: 'c1' }));

    expect(chatLookups).toBe(0);
  });

  it('(c) a malformed envelope (tenant without version) is refused and performs no cleanup work', async () => {
    const probe: CleanupProbe = {
      scopeSeen: undefined,
      getInstanceCalls: 0,
      sendMessageCalls: 0,
      disarmTenant: undefined,
    };
    const services = makeProbeServices(probe);
    const event = makeEvent({ tenantId: TENANT_A }); // tenant claim, no envelopeVersion → quarantine

    await expect(runTrashEmojiCleanup(services, fakeDb(), event)).rejects.toThrow();

    expect(probe.getInstanceCalls).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Providers that cannot reset sessions (webhook): the trash emoji still lifts a
// handoff pause, because `agentPaused` is Omni's own chat state. Before the fix
// the "not supported" error was skipped silently BEFORE the resume, so a paused
// webhook chat stayed paused and every inbound was dropped.
// ─────────────────────────────────────────────────────────────────────────────

interface WebhookProbe {
  updates: Array<Record<string, unknown>>;
  disarmCalls: number;
  sendCalls: number;
}

/** A legacy-world Database whose agent lookups resolve to a webhook provider. */
function webhookAgentDb(): Database {
  const row = {
    id: 'agent-w',
    name: 'webhook agent',
    agentProviderId: 'provider-webhook-resume',
    agentType: null,
    metadata: null,
    configPath: null,
  };
  return {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [row] }) }) }),
  } as unknown as Database;
}

function makeWebhookServices(probe: WebhookProbe, settings: Record<string, unknown>) {
  return {
    agentRunner: {
      getInstanceWithProvider: async () => ({
        id: 'inst-w',
        agentId: 'agent-w',
        channel: 'whatsapp-business',
        agentSessionStrategy: 'per_chat',
      }),
    },
    providers: {
      getById: async () => ({
        id: 'provider-webhook-resume',
        schema: 'webhook',
        baseUrl: 'http://webhook.invalid/hook',
        apiKey: '',
        defaultTimeout: 1,
      }),
    },
    chats: {
      findByExternalIdSmart: async () => ({ id: 'chat-w', settings }),
      update: async (_id: string, data: { settings: Record<string, unknown> }) => {
        probe.updates.push(data.settings);
        return { id: 'chat-w' };
      },
    },
    followUpLifecycle: {
      disarm: async () => {
        probe.disarmCalls += 1;
      },
    },
    instances: {
      getById: async () => {
        probe.sendCalls += 1;
        return { id: 'inst-w', channel: 'whatsapp-business' };
      },
    },
  } as never;
}

function makeWebhookEvent(): TypedOmniEvent<'message.received'> {
  return {
    id: 'evt-w',
    type: 'message.received',
    timestamp: new Date().toISOString(),
    payload: { chatId: 'chat-ext-w', from: 'user-w', content: { text: '🗑️' }, rawPayload: {} },
    metadata: { instanceId: 'inst-w', personId: 'person-w', correlationId: 'c-w' },
  } as unknown as TypedOmniEvent<'message.received'>;
}

describe('session-cleaner on providers that cannot reset sessions', () => {
  it('resumes a paused agent and keeps the other chat settings', async () => {
    const probe: WebhookProbe = { updates: [], disarmCalls: 0, sendCalls: 0 };
    const services = makeWebhookServices(probe, { agentPaused: true, muted: true });

    await runTrashEmojiCleanup(services, webhookAgentDb(), makeWebhookEvent());

    expect(probe.disarmCalls).toBe(1);
    expect(probe.updates).toHaveLength(1);
    expect(probe.updates[0]).toMatchObject({ agentPaused: false, muted: true });
    expect(typeof probe.updates[0]?.agentResumedAt).toBe('string');
    // Still a silent skip for the session itself: no confirmation nor error message.
    expect(probe.sendCalls).toBe(0);
  });

  it('disarms follow-ups but writes nothing when the agent is not paused', async () => {
    const probe: WebhookProbe = { updates: [], disarmCalls: 0, sendCalls: 0 };
    const services = makeWebhookServices(probe, { muted: true });

    await runTrashEmojiCleanup(services, webhookAgentDb(), makeWebhookEvent());

    expect(probe.disarmCalls).toBe(1);
    expect(probe.updates).toHaveLength(0);
    expect(probe.sendCalls).toBe(0);
  });
});
