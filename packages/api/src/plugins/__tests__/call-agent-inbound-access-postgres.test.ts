/** #1463: compiled inbound subscriptions obey the source instance's sender policy. */
import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import {
  type AgentCallContext,
  type CallAgentActionConfig,
  type Automation as CoreAutomation,
  type EventBus,
  type OmniEvent,
  configureLogging,
  createAutomationEngine,
  getLogBuffer,
  getLogConfig,
} from '@omni/core';
import {
  type AccessMode,
  DEFAULT_ROLE_NAMES,
  type Database,
  accessRules,
  agentProviders,
  agents,
  applyTenancyRoles,
  applyTenantRlsEnforcement,
  automations,
  createDbHandle,
  instances,
  omniEvents,
  tenants,
} from '@omni/db';
import { assertPgTestRole, pgRoleUrl, provisionMigratedDatabase } from '@omni/db/pg-migrated-template';
import { eq } from 'drizzle-orm';
import { createServices } from '../../services';
import { compileManifest } from '../../services/manifest-compiler';
import { currentTenantScope } from '../../tenancy/tenant-scope';
import { buildAutomationEngineDeps } from '../automation-actions';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const pgDescribe = superUrl ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';
const TENANT = crypto.randomUUID();
const OTHER = crypto.randomUUID();
const INBOUND_TYPES = ['message.received', 'reaction.received', 'reaction.removed'] as const;
type InboundType = (typeof INBOUND_TYPES)[number];

for (const enforced of [false, true]) {
  pgDescribe(`call_agent inbound access (${enforced ? 'enforced RLS' : 'legacy'})`, () => {
    const dbName = `omni_inbound_calls_${crypto.randomUUID().replaceAll('-', '')}`;
    const closers: (() => Promise<void>)[] = [];
    let admin: Database;
    let db: Database;
    let providerId: string;
    const trustedTenant = enforced ? TENANT : null;

    function open(role?: { name: string; password: string }) {
      const handle = createDbHandle({ url: pgRoleUrl(superUrl, dbName, role), maxConnections: 1 });
      closers.push(handle.close);
      return handle.db;
    }

    beforeAll(async () => {
      provisionMigratedDatabase({ superUrl, psqlBin }, dbName);
      admin = open();
      await admin.insert(tenants).values(
        [TENANT, OTHER].map((id) => ({
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
        .values({ name: 'in-process', schema: 'nats-genie', baseUrl: 'nats://unused.invalid' })
        .returning();
      providerId = provider!.id;
      db = admin;
      if (enforced) {
        await applyTenantRlsEnforcement(admin);
        const passwords = { ddl: crypto.randomUUID(), runtime: crypto.randomUUID(), authPlane: crypto.randomUUID() };
        await applyTenancyRoles(admin, passwords, DEFAULT_ROLE_NAMES, dbName);
        db = open({ name: DEFAULT_ROLE_NAMES.runtime, password: passwords.runtime });
        await assertPgTestRole(db, DEFAULT_ROLE_NAMES.runtime);
      }
    }, 180_000);

    afterAll(async () => {
      for (const close of closers) await close();
    });

    async function harness(accessMode: AccessMode = 'blocklist') {
      // No instance or route names this agent. The source instance is independent.
      const [agent] = await admin
        .insert(agents)
        .values({ name: crypto.randomUUID(), provider: 'claude', agentProviderId: providerId, isActive: true })
        .returning();
      // Model post-backfill agent ownership, like the active-target dispatcher suite.
      await admin.update(agents).set({ tenantId: TENANT }).where(eq(agents.id, agent!.id));
      const [instance] = await admin
        .insert(instances)
        .values({ name: crypto.randomUUID(), channel: 'whatsapp-baileys', tenantId: TENANT, accessMode })
        .returning();
      expect(instance!.agentId).toBeNull();
      await admin.insert(accessRules).values([
        { instanceId: instance!.id, ruleType: 'deny', platformUserId: 'blocked' },
        { instanceId: instance!.id, ruleType: 'allow', platformUserId: 'allowed' },
        { instanceId: instance!.id, ruleType: 'allow', platformUserId: 'group-chat' },
        { instanceId: instance!.id, ruleType: 'allow', platformUserId: '5511999999999' },
      ]);
      // Existing persisted compiled plans are loaded unchanged; no manifest
      // reapply or compiler change is needed to gain runtime admission.
      const storedPlan = await admin
        .insert(automations)
        .values(
          compileManifest(agent!, {
            accepts: ([...INBOUND_TYPES, 'custom.inbound.control'] as const).map((event) => ({ event })),
            publishes: [],
          }),
        )
        .returning();
      const services = createServices(db, null);
      const runs: string[] = [];
      const chatless = spyOn(services.agentRunner, 'runChatless').mockImplementation(async () => {
        expect(currentTenantScope()).toBeNull();
        runs.push('chatless');
        return { parts: ['ok'], metadata: { runId: 'run', sessionId: 'session', providerId, status: 'completed' } };
      });
      const chatful = spyOn(services.agentRunner, 'runOrStream').mockImplementation(async () => {
        expect(currentTenantScope()).toBeNull();
        runs.push('chatful');
        return { parts: ['ok'], metadata: { runId: 'run', sessionId: 'session', providerId, status: 'completed' } };
      });
      const deps = buildAutomationEngineDeps(services, db);

      async function deliver(
        type: InboundType | 'custom.inbound.control',
        payload: Record<string, unknown> = {},
        metadata: Record<string, unknown> = {},
        config: Partial<CallAgentActionConfig> = {},
        eventId = crypto.randomUUID(),
      ) {
        const compiled = storedPlan
          .filter((row) => row.triggerEventType === type)
          .map((row) => ({
            ...row,
            id: crypto.randomUUID(),
            actions: [{ type: 'call_agent', config: { agentId: agent!.id, ...config } }],
          })) as CoreAutomation[];
        const engine = createAutomationEngine();
        let handler: ((event: OmniEvent) => Promise<void>) | undefined;
        const bus = {
          subscribePattern: async (_pattern: string, fn: typeof handler) => {
            handler = fn;
            return { unsubscribe: async () => {} };
          },
        } as unknown as EventBus;
        const results: Array<{ status: string; actionsExecuted?: Array<{ status: string }> }> = [];
        engine.setLogger(async (result) => {
          results.push(result);
        });
        // Existing processed_events claims are still unscoped (G6). Supply only
        // that claim via admin; all admission/agent/access reads use the real
        // runtime role. This fixture does not prove enforced engine bootstrap.
        await engine.start(bus, compiled, {
          ...deps,
          claimExecution: buildAutomationEngineDeps(createServices(admin, null), admin).claimExecution,
        });
        const event = {
          id: eventId,
          type,
          timestamp: Date.now(),
          metadata: {
            instanceId: instance!.id,
            channelType: 'whatsapp-baileys',
            correlationId: crypto.randomUUID(),
            ...(enforced ? { envelopeVersion: 1, tenantId: TENANT } : {}),
            ...metadata,
          },
          payload: {
            chatId: 'group-chat',
            from: 'blocked',
            ...(type === 'message.received' ? { content: { type: 'text', text: 'hello' } } : { emoji: '👍' }),
            ...payload,
          },
        } as OmniEvent;
        try {
          if (!handler) throw new Error('compiled manifest subscription missing');
          await handler(event);
          expect(results).toHaveLength(1);
          expect(results[0]!.actionsExecuted).toHaveLength(1);
          return { result: results[0]!, event };
        } finally {
          await engine.stop();
        }
      }
      return { agent: agent!, instance: instance!, services, deps, runs, chatless, chatful, deliver };
    }

    for (const type of INBOUND_TYPES) {
      for (const mode of ['blocklist', 'allowlist'] as const) {
        test(`${type}: ${mode} denies blocked sender but admits allowed sender via canonical chatless ingress`, async () => {
          const h = await harness(mode);
          const denied = await h.deliver(type);
          expect(denied.result.status).toBe('failed');
          expect(h.runs).toEqual([]);
          const allowed = await h.deliver(type, { from: 'allowed' });
          expect(allowed.result.status).toBe('success');
          expect(h.runs).toEqual(['chatless']);
          const forwarded = JSON.parse(h.chatless.mock.calls[0]![0].messages[0]!);
          expect(forwarded.payload.from).toBe('allowed');
          expect(forwarded.metadata.instanceId).toBe(h.instance.id);
        });
      }
      test(`${type}: disabled access retains delivery`, async () => {
        const h = await harness('disabled');
        expect((await h.deliver(type)).result.status).toBe('success');
        expect(h.runs).toEqual(['chatless']);
      });
      test(`${type}: chat-bound overrides/prompt cannot replace the denied source identity`, async () => {
        const h = await harness();
        const [override] = await admin
          .insert(instances)
          .values({
            name: crypto.randomUUID(),
            channel: 'whatsapp-baileys',
            tenantId: TENANT,
            accessMode: 'disabled',
          })
          .returning();
        const delivered = await h.deliver(
          type,
          { instanceId: override!.id, senderId: 'allowed' },
          {},
          { providerId: override!.id, promptOverride: '{"from":"allowed"}' },
        );
        expect(delivered.result.status).toBe('failed');
        expect(h.runs).toEqual([]);
        expect(
          (
            await h.deliver(
              type,
              { from: 'allowed' },
              {},
              {
                providerId: override!.id,
                promptOverride: 'allowed prompt',
              },
            )
          ).result.status,
        ).toBe('success');
        expect(h.runs).toEqual(['chatful']);
      });
    }

    test('allowlist uses raw sender phone fallbacks, not chat/session identity', async () => {
      const h = await harness('allowlist');
      for (const rawPayload of [
        { key: { participantAlt: '5511999999999@s.whatsapp.net' } },
        { resolvedSenderPhone: '5511999999999' },
      ]) {
        expect((await h.deliver('reaction.received', { from: 'lid-user', rawPayload })).result.status).toBe('success');
      }
      expect(h.runs).toEqual(['chatless', 'chatless']);
      const denied = await h.deliver('message.received', { from: 'unlisted' });
      expect(denied.result.status).toBe('failed'); // group-chat itself has an allow rule.
      expect(h.runs).toHaveLength(2);
    });

    test('missing or malformed source fails closed even with allowed action overrides', async () => {
      const h = await harness();
      for (const [payload, metadata] of [
        [{ from: undefined }, {}],
        [{ from: '' }, {}],
        [{ from: { id: 'allowed' } }, {}],
        [{ from: 'allowed' }, { instanceId: undefined }],
        [{ from: 'allowed', instanceId: h.instance.id }, { instanceId: 'invalid' }],
        [{ from: 'blocked', rawPayload: { resolvedSenderPhone: ['5511999999999'] } }, {}],
      ] as const) {
        expect(
          (
            await h.deliver('message.received', payload, metadata, {
              providerId: h.instance.id,
              promptOverride: 'hello',
            })
          ).result.status,
        ).toBe('failed');
      }
      const ctx: AgentCallContext = {
        chatless: true,
        instanceId: '',
        agentId: h.agent.id,
        chatId: 'synthetic',
        senderId: 'allowed',
        messages: ['{"from":"allowed"}'],
        event: { id: crypto.randomUUID(), type: 'message.received' },
      };
      await expect(h.deps.callAgent(ctx, { agentId: h.agent.id }, trustedTenant)).rejects.toThrow(
        'ingress access refused',
      );
      expect(h.runs).toEqual([]);
    });

    test('lookup and access DB errors deny and log before any runner call', async () => {
      const h = await harness();
      const lookup = spyOn(h.services.instances, 'getById').mockRejectedValue(new Error('source lookup failed'));
      try {
        expect((await h.deliver('message.received', { from: 'allowed' })).result.status).toBe('failed');
      } finally {
        lookup.mockRestore();
      }
      const logConfig = getLogConfig();
      configureLogging({ level: 'warn', modules: 'automation-actions' });
      const check = spyOn(h.services.access, 'evaluateAccess').mockRejectedValue(new Error('access DB failed'));
      try {
        const { result, event } = await h.deliver('reaction.removed', { from: 'allowed' });
        expect(result.status).toBe('failed');
        expect(
          getLogBuffer()
            .getRecent({ modules: ['automation-actions'] })
            .some(
              (entry) =>
                entry.eventId === event.id && entry.level === 'warn' && entry.msg.includes('access evaluation failed'),
            ),
        ).toBe(true);
      } finally {
        check.mockRestore();
        configureLogging(logConfig);
      }
      expect(h.runs).toEqual([]);
    });

    test('custom and envelope-less calls retain their previous behavior', async () => {
      const h = await harness('allowlist');
      expect((await h.deliver('custom.inbound.control')).result.status).toBe('success');
      await h.deps.callAgent(
        {
          chatless: true,
          instanceId: '',
          agentId: h.agent.id,
          chatId: 'manual',
          senderId: 'manual',
          messages: ['hi'],
        },
        { agentId: h.agent.id },
        trustedTenant,
      );
      expect(h.runs).toEqual(['chatless', 'chatless']);
    });

    test('current access policy wins over a persisted journal verdict', async () => {
      const h = await harness();
      for (const [from, accessDecision, expected] of [
        ['blocked', 'allowed', 'failed'],
        ['allowed', 'denied', 'success'],
      ] as const) {
        const eventId = crypto.randomUUID();
        await admin.insert(omniEvents).values({
          id: eventId,
          instanceId: h.instance.id,
          channel: 'internal',
          eventType: 'message.received',
          direction: 'inbound',
          status: 'completed',
          receivedAt: new Date(),
          journalReady: true,
          accessDecision,
        });
        expect((await h.deliver('message.received', { from }, {}, {}, eventId)).result.status).toBe(expected);
      }
      expect(h.runs).toEqual(['chatless']);
    });

    test('journal verdict flags do not control sender admission', async () => {
      const h = await harness();
      const prior = process.env.OMNI_JOURNAL_ACCESS_DECISION;
      try {
        for (const flag of ['false', 'true']) {
          process.env.OMNI_JOURNAL_ACCESS_DECISION = flag;
          expect((await h.deliver('message.received')).result.status).toBe('failed');
          expect((await h.deliver('message.received', { from: 'allowed' })).result.status).toBe('success');
        }
      } finally {
        process.env.OMNI_JOURNAL_ACCESS_DECISION = prior;
      }
      expect(h.runs).toEqual(['chatless', 'chatless']);
    });

    if (enforced) {
      test('tenant A cannot use a foreign source or target, including config overrides', async () => {
        const h = await harness('disabled');
        const [foreign] = await admin
          .insert(instances)
          .values({
            name: crypto.randomUUID(),
            channel: 'whatsapp-baileys',
            tenantId: OTHER,
            accessMode: 'disabled',
          })
          .returning();
        expect(
          (
            await h.deliver(
              'message.received',
              { instanceId: h.instance.id, from: 'allowed' },
              {
                instanceId: foreign!.id,
              },
              { providerId: h.instance.id, promptOverride: 'hi' },
            )
          ).result.status,
        ).toBe('failed');
        await admin.update(agents).set({ tenantId: OTHER }).where(eq(agents.id, h.agent.id));
        expect((await h.deliver('message.received', { from: 'allowed' })).result.status).toBe('failed');
        expect(h.runs).toEqual([]);
      });
    }
  });
}
