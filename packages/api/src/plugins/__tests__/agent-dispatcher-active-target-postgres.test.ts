/** #1464: admit the effective, still-active target at execution time, across channels. */
import { afterAll, afterEach, beforeAll, describe, expect, mock, spyOn, test } from 'bun:test';
import type { AgentTrigger, EventBus, NatsGenieProvider } from '@omni/core';
import { configureLogging, getLogBuffer, getLogConfig } from '@omni/core';
import {
  DEFAULT_ROLE_NAMES,
  type Database,
  agentProviders,
  agentRoutes,
  agents,
  applyTenancyRoles,
  applyTenantRlsEnforcement,
  chats,
  createDbHandle,
  instances,
  processedEvents,
  tenants,
} from '@omni/db';
import { assertPgTestRole, pgRoleUrl, provisionMigratedDatabase } from '@omni/db/pg-migrated-template';
import { eq } from 'drizzle-orm';
import { AgentService } from '../../services/agents';
import { ApiKeyService } from '../../services/api-keys';
import { InstanceService } from '../../services/instances';
import { RouteResolver } from '../../services/route-resolver';
import { currentTenantScope } from '../../tenancy/tenant-scope';
import { __test__ as dispatcher, setupAgentDispatcher } from '../agent-dispatcher';
import { buildAutomationEngineDeps } from '../automation-actions';
import * as loader from '../loader';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const pgDescribe = superUrl ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';
const TENANT = crypto.randomUUID();
const OTHER_TENANT = crypto.randomUUID();
const EXTERNAL_CHAT = 'customer';
type Mode = 'round-trip' | 'fire-and-forget' | 'turn-based' | 'stream' | 'legacy';

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

for (const enforced of [false, true]) {
  pgDescribe(`active effective dispatch target (${enforced ? 'enforced RLS' : 'legacy'})`, () => {
    const dbName = `omni_active_dispatch_${crypto.randomUUID().replaceAll('-', '')}`;
    const closers: (() => Promise<void>)[] = [];
    let admin: Database;
    let db: Database;
    let providerId: string;
    let stop: (() => Promise<void>) | undefined;
    let pluginSpy: ReturnType<typeof spyOn> | undefined;
    const trustedTenantId = enforced ? TENANT : undefined;
    const tenantId = enforced ? TENANT : null;

    const open = (role?: { name: string; password: string }) => {
      const handle = createDbHandle({ url: pgRoleUrl(superUrl, dbName, role), maxConnections: 2 });
      closers.push(handle.close);
      return handle.db;
    };

    beforeAll(async () => {
      provisionMigratedDatabase({ superUrl, psqlBin }, dbName);
      admin = open();
      await admin.insert(tenants).values(
        [TENANT, OTHER_TENANT].map((id) => ({
          id,
          slug: id,
          displayName: id,
          maxKeyTtlSeconds: 86400,
          maxKeyRateLimit: 100,
          maxKeyBudget: 100,
        })),
      );
      const [provider] = await admin
        .insert(agentProviders)
        .values({
          name: 'in-process',
          schema: 'nats-genie',
          baseUrl: 'nats://unused.invalid',
          schemaConfig: { agentName: 'in-process' },
        })
        .returning();
      providerId = provider!.id;
      if (!enforced) {
        db = admin;
        return;
      }
      await applyTenantRlsEnforcement(admin);
      const passwords = { ddl: crypto.randomUUID(), runtime: crypto.randomUUID(), authPlane: crypto.randomUUID() };
      await applyTenancyRoles(admin, passwords, DEFAULT_ROLE_NAMES, dbName);
      db = open({ name: DEFAULT_ROLE_NAMES.runtime, password: passwords.runtime });
      await assertPgTestRole(db, DEFAULT_ROLE_NAMES.runtime);
    }, 180_000);

    afterEach(async () => {
      await stop?.();
      stop = undefined;
      pluginSpy?.mockRestore();
      dispatcher.resetNatsGenieProviderClass();
      dispatcher.resetProviderCaches();
    });
    afterAll(async () => {
      for (const close of closers) await close();
      const result = Bun.spawnSync({
        cmd: [
          psqlBin,
          '-X',
          '--no-psqlrc',
          '--set',
          'ON_ERROR_STOP=1',
          '--dbname',
          superUrl,
          '-c',
          `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`,
        ],
        stdout: 'pipe',
        stderr: 'pipe',
      });
      if (result.exitCode) throw new Error(result.stderr.toString());
    });

    async function agent(isActive = true, owner = tenantId) {
      const [row] = await admin
        .insert(agents)
        .values({
          name: `agent-${crypto.randomUUID()}`,
          provider: 'claude',
          agentProviderId: providerId,
          isActive,
        })
        .returning();
      // Model the post-backfill stored ownership; never take a payload tenant.
      await admin.update(agents).set({ tenantId: owner }).where(eq(agents.id, row!.id));
      return row!;
    }

    async function harness(
      mode: Mode = 'round-trip',
      options: { routed?: boolean; inactiveDefault?: boolean; inactiveTarget?: boolean } = {},
    ) {
      const target = await agent(!options.inactiveTarget);
      const defaultAgent = options.routed ? await agent(!options.inactiveDefault) : target;
      const [instance] = await admin
        .insert(instances)
        .values({
          name: crypto.randomUUID(),
          channel: 'whatsapp-baileys',
          tenantId,
          agentId: defaultAgent.id,
          messageDebounceMode: 'fixed',
          messageDebounceMinMs: 60_000,
          messageDebounceMaxMs: 60_000,
          agentStreamMode: mode === 'stream',
          groupHistorySize: 0,
          allowFirstParty: true,
          triggerEvents: ['message.received', 'reaction.received', 'reaction.removed'],
          triggerReactions: ['👍'],
          agentReplyFilter: {
            mode: 'all',
            conditions: { onDm: true, onMention: true, onReply: true, onNameMatch: false },
          },
          reactionAck: 'off',
          agentAckMessage: 'ack',
        })
        .returning();
      const [chat] = await admin
        .insert(chats)
        .values({
          instanceId: instance!.id,
          externalId: EXTERNAL_CHAT,
          channel: 'whatsapp-baileys',
          chatType: 'dm',
        })
        .returning();
      if (options.routed)
        await admin.insert(agentRoutes).values({
          instanceId: instance!.id,
          agentId: target.id,
          chatId: chat!.id,
          scope: 'chat',
        });
      const runs = mock(async () => ({
        parts: [],
        metadata: { runId: 'run', sessionId: 'session', status: 'completed' },
      }));
      const trigger = mock(async (_trigger: AgentTrigger) => ({
        parts: [],
        metadata: { runId: 'run', providerId, durationMs: 0 },
      }));
      const stream = mock(() => {});
      class Provider {
        readonly mode = mode === 'stream' ? 'round-trip' : mode;
        readonly schema = 'nats-genie';
        constructor(
          readonly id: string,
          readonly name: string,
        ) {}
        canHandle() {
          expect(currentTenantScope()).toBeNull();
          return true;
        }
        trigger = trigger;
        async *triggerStream() {
          expect(currentTenantScope()).toBeNull();
          stream();
          yield { phase: 'final' as const, text: '' };
        }
        async startReplySubscription() {}
        async dispose() {}
      }
      dispatcher.NatsGenieProviderClass = Provider as unknown as typeof NatsGenieProvider;
      const customer = mock(async () => ({ id: 'sent' }));
      const typing = mock(async () => {});
      pluginSpy = spyOn(loader, 'getPlugin').mockResolvedValue({
        sendMessage: customer,
        sendTyping: typing,
        capabilities: { canStreamResponse: true },
        createStreamSender: () => ({ abort: async () => {} }),
      } as never);
      const keys = new ApiKeyService(admin);
      const key = await keys.create({
        name: tenantId ? `agent:${tenantId}:${target.name}` : `agent:${target.name}`,
        instanceIds: [instance!.id],
        scopes: ['messages:send'],
        createdBy: 'system:auto-provision',
      });
      const turns = mock(async (_options: { agentId: string; apiKeyId: string }) => ({ id: 'turn' }));
      const instanceService = new InstanceService(db, null);
      const services = {
        db,
        instances: instanceService,
        apiKeys: keys,
        turns: { open: turns },
        routeResolver: new RouteResolver(db),
        agentRunner: {
          getInstanceWithProvider: (id: string) => instanceService.getById(id),
          getSenderName: async () => 'Customer',
          run: runs,
          runOrStream: runs,
          runChatless: runs,
        },
        access: { checkAccess: async () => ({ allowed: true }) },
        providers: {
          getById: async () => ({
            id: providerId,
            name: 'in-process',
            schema: mode === 'legacy' ? 'genie' : 'nats-genie',
            isActive: true,
            schemaConfig: { agentName: 'in-process' },
          }),
        },
        chats: { findByExternalIdSmart: async () => chat, getById: async () => chat },
        messages: { getByExternalId: async () => null },
        persons: { getById: async () => null },
      } as unknown as Parameters<typeof setupAgentDispatcher>[1];
      const handlers = new Map<string, (event: unknown) => Promise<void>>();
      const bus = {
        subscribe: async (type: string, fn: (event: unknown) => Promise<void>) => {
          handlers.set(type, fn);
        },
        publish: mock(async () => ({})),
      } as unknown as EventBus;
      // Isolate the pre-existing unscoped idempotency claim from this admission
      // regression. All target reads/transactions use the real runtime role;
      // only processed_events claims are forwarded to the fixture admin.
      const dispatchDb = new Proxy(db, {
        get(target, prop) {
          if (prop === 'insert')
            return (table: Parameters<Database['insert']>[0]) =>
              table === processedEvents ? admin.insert(table) : target.insert(table);
          const value = Reflect.get(target, prop);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      stop = await setupAgentDispatcher(bus, services, dispatchDb);
      const event = (type = 'message.received') => ({
        id: crypto.randomUUID(),
        type,
        timestamp: Date.now(),
        payload: {
          externalId: crypto.randomUUID(),
          messageId: crypto.randomUUID(),
          chatId: EXTERNAL_CHAT,
          from: 'customer',
          emoji: '👍',
          content: { type: 'text', text: 'hello' },
          rawPayload: {},
        },
        metadata: {
          instanceId: instance!.id,
          channelType: 'whatsapp-baileys',
          personId: crypto.randomUUID(),
          correlationId: crypto.randomUUID(),
          ...(trustedTenantId ? { envelopeVersion: 1, tenantId: trustedTenantId } : {}),
        },
      });
      const fire = async (type = 'message.received') => {
        await handlers.get(type)!(event(type));
      };
      const flush = () => dispatcher.flushBufferedMessages();
      const quiet = () => {
        expect(trigger).not.toHaveBeenCalled();
        expect(stream).not.toHaveBeenCalled();
        expect(runs).not.toHaveBeenCalled();
        expect(turns).not.toHaveBeenCalled();
        expect(customer).not.toHaveBeenCalled();
        expect(typing).not.toHaveBeenCalled();
        expect(bus.publish).not.toHaveBeenCalled();
      };
      const resetEffects = () => {
        trigger.mockClear();
        stream.mockClear();
        runs.mockClear();
        turns.mockClear();
        customer.mockClear();
        typing.mockClear();
      };
      return {
        resetEffects,
        target,
        defaultAgent,
        instance: instance!,
        services,
        fire,
        flush,
        quiet,
        trigger,
        stream,
        runs,
        turns,
        key,
      };
    }

    for (const mode of ['round-trip', 'fire-and-forget', 'turn-based', 'stream', 'legacy'] as const) {
      for (const routed of [false, true]) {
        test(`${mode}: inactive ${routed ? 'routed' : 'default'} target is quietly skipped`, async () => {
          const h = await harness(mode, { routed, inactiveTarget: true });
          await h.fire();
          await h.flush();
          h.quiet();
          await h.fire('reaction.received');
          await h.fire('reaction.removed');
          h.quiet();
        });
      }
    }

    for (const mode of ['round-trip', 'fire-and-forget', 'stream', 'legacy'] as const) {
      test(`${mode}: an active target executes outside any tenant transaction`, async () => {
        const h = await harness(mode);
        await h.fire();
        await h.flush();
        expect(mode === 'stream' ? h.stream : mode === 'legacy' ? h.runs : h.trigger).toHaveBeenCalledTimes(1);
      });
    }

    test('an inactive-target skip is logged without customer feedback', async () => {
      const previous = getLogConfig();
      const captured: string[] = [];
      const unsubscribe = getLogBuffer().subscribe((entry) => captured.push(JSON.stringify(entry)));
      try {
        configureLogging({ level: 'info', modules: 'agent-dispatcher' });
        const h = await harness('turn-based', { inactiveTarget: true });
        await h.fire();
        await h.flush();
        h.quiet();
        expect(
          captured.some(
            (entry) =>
              entry.includes('Skipping agent dispatch') &&
              entry.includes(h.target.id) &&
              entry.includes('agent inactive'),
          ),
        ).toBe(true);
      } finally {
        unsubscribe();
        configureLogging(previous);
      }
    });

    test('an active route over an inactive nonnull default opens a turn with the routed UUID and key', async () => {
      const h = await harness('turn-based', { routed: true, inactiveDefault: true });
      await h.fire();
      await h.flush();
      expect(h.trigger).toHaveBeenCalledTimes(1);
      expect(h.turns.mock.calls[0]?.[0]).toMatchObject({ agentId: h.target.id, apiKeyId: h.key.key.id });
      expect(h.runs).not.toHaveBeenCalled();
    });

    test('deletion while buffered skips at flush, even with a warm shared provider', async () => {
      const h = await harness();
      await h.fire();
      await h.flush();
      expect(h.trigger).toHaveBeenCalledTimes(1);
      h.resetEffects();
      await h.fire();
      await admin.update(agents).set({ isActive: false }).where(eq(agents.id, h.target.id));
      // Captured coordinates are still active-looking; admission must reload the agent.
      await h.flush();
      h.quiet();
      const sibling = await agent();
      await admin.update(instances).set({ agentId: sibling.id }).where(eq(instances.id, h.instance.id));
      await h.fire();
      await h.flush();
      expect(h.trigger).toHaveBeenCalledTimes(1);
    });

    test('active added and removed reactions reach the provider', async () => {
      const h = await harness();
      await h.fire('reaction.received');
      expect(h.trigger).toHaveBeenCalledTimes(1);
      await h.fire('reaction.removed');
      expect(h.trigger).toHaveBeenCalledTimes(2);
    });

    test('deletion while waiting for the limiter causes no customer or provider side effects', async () => {
      const h = await harness('stream', { routed: true });
      await h.fire();
      const entered = deferred();
      const release = deferred();
      const held = dispatcher.agentDispatchLimiter.run(
        { instanceId: h.instance.id, chatId: EXTERNAL_CHAT },
        async () => {
          entered.resolve();
          await release.promise;
        },
      );
      await entered.promise;
      const flush = h.flush();
      try {
        // flush enters the actual limiter synchronously after the debounce gates.
        for (let i = 0; dispatcher.agentDispatchLimiter.getSnapshot(h.instance.id).queueDepth === 0; i++) {
          if (i > 200) throw new Error('dispatch did not enter limiter queue');
          await Bun.sleep(5);
        }
        await admin.update(agents).set({ isActive: false }).where(eq(agents.id, h.target.id));
      } finally {
        release.resolve();
        await held;
        await flush;
      }
      h.quiet();
    });

    test('a new rename uses the current name/key even with buffered coordinates', async () => {
      const h = await harness('turn-based', { routed: true });
      await h.fire();
      const name = `renamed-${crypto.randomUUID()}`;
      await new AgentService(admin, null).update(h.target.id, { name });
      const currentKey = await new ApiKeyService(admin).findAgentKeyByName(
        tenantId ? `agent:${tenantId}:${name}` : `agent:${name}`,
      );
      expect(currentKey?.id).toBeTruthy();
      await h.flush();
      expect(h.trigger).toHaveBeenCalledTimes(1);
      expect(h.turns.mock.calls[0]?.[0].agentId).toBe(h.target.id);
      expect(h.turns.mock.calls[0]?.[0].apiKeyId).toBe(currentKey?.id);
    });

    for (const chatless of [false, true]) {
      test(`manual/queued call_agent refuses a now-inactive target (${chatless ? 'chatless' : 'with chat'})`, async () => {
        const h = await harness();
        const deps = buildAutomationEngineDeps(h.services, db);
        const ctx = {
          instanceId: h.instance.id,
          agentId: h.target.id,
          chatId: EXTERNAL_CHAT,
          senderId: 'customer',
          messages: ['queued action'],
          chatless,
        };
        await admin.update(agents).set({ isActive: false }).where(eq(agents.id, h.target.id));
        await expect(deps.callAgent(ctx, { agentId: h.target.id }, trustedTenantId)).rejects.toThrow(
          'Agent is inactive',
        );
        h.quiet();
      });
    }

    if (enforced)
      test('a foreign routed target resolves to skipped rather than falling back to default', async () => {
        const h = await harness('turn-based', { routed: true });
        const resolution = await dispatcher.resolveEffectiveInstance(
          h.services,
          db,
          h.instance,
          crypto.randomUUID(),
          undefined,
          OTHER_TENANT,
        );
        expect(resolution.status).toBe('skipped');
        h.quiet();
      });

    test('route-only/null-default message admission stays unchanged', async () => {
      const h = await harness('turn-based', { routed: true });
      await admin.update(instances).set({ agentId: null }).where(eq(instances.id, h.instance.id));
      await h.fire();
      await h.flush();
      h.quiet();
    });
  });
}
