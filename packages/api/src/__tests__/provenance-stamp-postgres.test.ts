/** Provenance acceptance on the gate's disposable PostgreSQL target, using its runtime role. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { BaseChannelPlugin, ChannelRegistry, DEFAULT_CAPABILITIES } from '@omni/channel-sdk';
import { ConnectorRegistry } from '@omni/connector-sdk';
import {
  type ConnectorEventPublisher,
  type CoreEventType,
  type EventBus,
  type GenericEventHandler,
  type OmniEvent,
  type TypedOmniEvent,
  createOmniEvent,
  setEnvelopeProducerResolver,
  setTenantSecretMasterKey,
} from '@omni/core';
import {
  DEFAULT_ROLE_NAMES,
  type Database,
  agents,
  apiKeys,
  applyTenancyRoles,
  automations,
  connectorEventSubscriptions,
  connectors,
  createDbHandle,
  instances,
  omniEvents,
  tenants,
} from '@omni/db';
import {
  assertPgTestRole,
  connectorIngressFunctionStatements,
  connectorIngressRoleStatements,
  contextFunctionStatements,
  pgRoleUrl,
  provisionMigratedDatabase,
} from '@omni/db/pg-migrated-template';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { createApp } from '../app';
import { currentProducingKeyId, runOutsideProducerScope, runWithProducingKey } from '../lib/producer-scope';
import { setupEventPersistence } from '../plugins/event-persistence';
import { ApiKeyService, type CreateApiKeyResult } from '../services/api-keys';
import { AutomationService } from '../services/automations';
import { ConnectorService } from '../services/connectors';
import { WebhookService } from '../services/webhooks';
import { pairedAgentFlagState } from '../tenancy/feature-flag';
import { sealCredentialField } from '../tenancy/sealed-credentials';
import { HOOK_SECRET, TYPED_EVENT, eventsOnlyConnector, signHook } from './fixtures/events-only-connector';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';
const postgresDescribe = superUrl ? describe : describe.skip;

function onTimer<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      void fn().then(resolve, reject);
    }, 0);
  });
}

class TimerChannel extends BaseChannelPlugin {
  readonly id = 'whatsapp-baileys';
  readonly name = 'Timer channel';
  readonly version = '1.0.0';
  readonly capabilities = DEFAULT_CAPABILITIES;
  constructor(private readonly onConnect: () => Promise<void>) {
    super();
  }
  async connect(): Promise<void> {
    await this.onConnect();
  }
  async disconnect(): Promise<void> {}
  async sendMessage(): Promise<never> {
    throw new Error('Unused send');
  }
}

function isTypedEvent<T extends CoreEventType>(event: OmniEvent, type: T): event is TypedOmniEvent<T> {
  return event.type === type;
}

/** Real production envelopes, asynchronous journal handlers, no external transport. */
function provenanceBus() {
  const journal: OmniEvent[] = [];
  const handlers: { pattern: string; handler: GenericEventHandler }[] = [];
  let pending: Promise<unknown>[] = [];
  const publish: EventBus['publishGeneric'] = async (type, payload, metadata) => {
    const event = { ...createOmniEvent(type, payload, metadata, 'provenance-test'), payload };
    journal.push(event);
    for (const entry of handlers) {
      if (
        entry.pattern === event.type ||
        (entry.pattern.endsWith('.>') && event.type.startsWith(entry.pattern.slice(0, -1)))
      )
        pending.push(runOutsideProducerScope(() => Promise.resolve().then(() => entry.handler(event))));
    }
    return { id: event.id, sequence: journal.length, stream: 'memory' };
  };
  const subscribe: EventBus['subscribePattern'] = async (pattern, handler) => {
    handlers.push({ pattern, handler });
    return { id: randomUUID(), pattern, unsubscribe: async () => {} };
  };
  const bus: EventBus & ConnectorEventPublisher = {
    connect: async () => {},
    close: async () => {},
    isConnected: () => true,
    publish: async (type, payload, metadata) => publish(type, z.record(z.unknown()).parse(payload), metadata),
    publishGeneric: publish,
    publishConnector: publish,
    subscribePattern: subscribe,
    subscribe: async (type, handler) =>
      subscribe(type, async (event) => {
        if (isTypedEvent(event, type)) await handler(event);
      }),
    subscribeAll: async (handler) => subscribe('>', handler),
    subscribeMany: async () => {
      throw new Error('Unused subscription');
    },
  };
  return Object.assign(bus, {
    journal,
    idle: async () => {
      while (pending.length) {
        const batch = pending;
        pending = [];
        await Promise.all(batch);
      }
    },
  });
}

postgresDescribe('trusted journal provenance (real PostgreSQL)', () => {
  const database = `omni_provenance_${randomUUID().replaceAll('-', '')}`;
  const closers: (() => Promise<void>)[] = [];
  const bus = provenanceBus();
  const agentA = randomUUID();
  const agentB = randomUUID();
  const inactiveAgent = randomUUID();
  const instanceA = randomUUID();
  const inactiveInstance = randomUUID();
  const connectorId = randomUUID();
  const legacyId = randomUUID();
  const typedId = randomUUID();
  const ingressTenant = randomUUID();
  const targetId = randomUUID();
  const originalFlag = process.env.OMNI_PAIRED_AGENT_CONSUMERS;
  const originalTenancy = process.env.OMNI_MULTITENANCY_ENABLED;
  let db: Database;
  let agentKey: CreateApiKeyResult;
  let plainKey: CreateApiKeyResult;
  let unresolvedKey: CreateApiKeyResult;
  let app: ReturnType<typeof createApp>['app'];
  let requestHooks: WebhookService;
  let hooks: WebhookService;
  let connectorService: ConnectorService;
  let sourceId: string;

  function open(role?: { name: string; password: string }) {
    const handle = createDbHandle({ url: pgRoleUrl(superUrl, database, role), maxConnections: 4 });
    closers.push(handle.close);
    return handle.db;
  }
  beforeAll(async () => {
    Reflect.deleteProperty(process.env, 'OMNI_MULTITENANCY_ENABLED');
    setTenantSecretMasterKey(Buffer.alloc(32, 0x51));
    provisionMigratedDatabase({ superUrl, psqlBin }, database);
    const owner = open();
    await owner.insert(tenants).values({
      id: ingressTenant,
      slug: ingressTenant,
      displayName: 'Provenance ingress',
      maxKeyTtlSeconds: 86400,
      maxKeyRateLimit: 1000,
      maxKeyBudget: 1000,
    });
    await owner.insert(automations).values({
      id: targetId,
      name: 'provenance-target',
      triggerEventType: 'connector.event',
      actions: [],
      tenantId: ingressTenant,
    });
    await owner.insert(agents).values([
      { id: agentA, name: 'producer-a', provider: 'claude' },
      { id: agentB, name: 'producer-b', provider: 'claude' },
      { id: inactiveAgent, name: 'inactive-producer', provider: 'claude', isActive: false },
    ]);
    await owner.insert(instances).values([
      { id: instanceA, name: 'producer-a', channel: 'whatsapp-baileys', agentId: agentA },
      { id: inactiveInstance, name: 'inactive-producer', channel: 'whatsapp-baileys', agentId: inactiveAgent },
    ]);
    const keys = new ApiKeyService(owner);
    agentKey = await keys.create({
      name: 'agent:producer-a',
      scopes: ['events:write', 'instances:write'],
      instanceIds: [instanceA],
      createdBy: 'system:auto-provision',
    });
    plainKey = await keys.create({ name: 'ordinary-producer', scopes: ['events:write'] });
    unresolvedKey = await keys.create({
      name: 'agent:inactive-producer',
      scopes: ['events:write'],
      instanceIds: [inactiveInstance],
      createdBy: 'system:auto-provision',
    });
    await owner.insert(connectors).values({
      id: connectorId,
      name: 'provenance-hook',
      provider: 'gitlab',
      status: 'connected',
      credentials: sealCredentialField(ingressTenant, '{}'),
      hookSecret: sealCredentialField(ingressTenant, HOOK_SECRET),
      tenantId: ingressTenant,
    });
    await owner.insert(connectorEventSubscriptions).values([
      {
        id: legacyId,
        connectorId,
        providerEventKey: 'merge_request.merged',
        ingress: 'subscription',
        verificationSecret: sealCredentialField(ingressTenant, HOOK_SECRET),
        targetAutomationId: targetId,
        tenantId: ingressTenant,
      },
      { id: typedId, connectorId, providerEventKey: TYPED_EVENT, ingress: 'connector', tenantId: ingressTenant },
    ]);
    const passwords = { ddl: randomUUID(), runtime: randomUUID(), authPlane: randomUUID() };
    // Role grants require the context/ingress functions even before RLS enforcement.
    for (const statement of [
      ...connectorIngressRoleStatements(),
      ...contextFunctionStatements(),
      ...connectorIngressFunctionStatements(),
    ])
      await owner.execute(sql.raw(statement));
    await applyTenancyRoles(owner, passwords, DEFAULT_ROLE_NAMES, database);
    db = open({ name: DEFAULT_ROLE_NAMES.runtime, password: passwords.runtime });
    await assertPgTestRole(db, DEFAULT_ROLE_NAMES.runtime);
    setEnvelopeProducerResolver(() => (pairedAgentFlagState('consumers').enabled ? currentProducingKeyId() : null));
    await setupEventPersistence(bus, db);
    const registry = new ConnectorRegistry();
    registry.register(eventsOnlyConnector);
    connectorService = new ConnectorService(db, bus, registry);
    hooks = new WebhookService(db, bus);
    const source = await hooks.create({ name: 'provenance-source' });
    sourceId = source.id;
    const application = createApp(db, bus, null, null);
    app = application.app;
    requestHooks = application.services.webhooks;
  }, 180_000);

  beforeEach(() => {
    process.env.OMNI_PAIRED_AGENT_CONSUMERS = 'true';
    Reflect.deleteProperty(process.env, 'OMNI_MULTITENANCY_ENABLED');
  });
  afterEach(async () => {
    await bus.idle();
  });
  afterAll(async () => {
    setEnvelopeProducerResolver(null);
    setTenantSecretMasterKey(null);
    for (const [key, value] of [
      ['OMNI_PAIRED_AGENT_CONSUMERS', originalFlag],
      ['OMNI_MULTITENANCY_ENABLED', originalTenancy],
    ]) {
      if (key && value === undefined) Reflect.deleteProperty(process.env, key);
      else if (key) process.env[key] = value;
    }
    await bus.close();
    for (const close of closers) await close();
    const result = Bun.spawnSync([
      psqlBin,
      '-X',
      '--no-psqlrc',
      '--set',
      'ON_ERROR_STOP=1',
      '--dbname',
      superUrl,
      '-c',
      `DROP DATABASE IF EXISTS "${database}" WITH (FORCE);`,
    ]);
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  });

  async function row(id: string) {
    await bus.idle();
    const [event] = await db.select().from(omniEvents).where(eq(omniEvents.id, id));
    if (!event) throw new Error(`Missing journal row ${id}`);
    return event;
  }
  async function trigger(key: CreateApiKeyResult, keyed: boolean) {
    const response = await app.request('/api/v2/events/trigger', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key.plainTextKey },
      body: JSON.stringify({
        eventType: 'custom.provenance.proof',
        payload: { agentId: agentB, producingKeyId: plainKey.key.id },
        agentId: agentB,
        producingKeyId: plainKey.key.id,
        ...(keyed ? { idempotencyKey: randomUUID() } : {}),
      }),
    });
    expect(response.status).toBe(201);
    const result = z.object({ eventId: z.string().uuid() }).parse(await response.json());
    return row(result.eventId);
  }

  for (const keyed of [false, true]) {
    test(`authenticated ${keyed ? 'keyed' : 'unkeyed'} trigger stamps the proven agent and ignores spoofed body provenance`, async () => {
      const event = await trigger(agentKey, keyed);
      expect(event.producingKeyId).toBe(agentKey.key.id);
      expect(event.agentId).toBe(agentA);
      expect(event.sourceKind).toBeNull();
      expect(event.sourceId).toBeNull();
      expect(bus.journal.find((published) => published.id === event.id)?.metadata.producingKeyId).toBe(agentKey.key.id);
    });
    test(`ordinary and unresolved inactive-agent keys stamp only the key on ${keyed ? 'keyed' : 'unkeyed'} trigger`, async () => {
      for (const key of [plainKey, unresolvedKey]) {
        const event = await trigger(key, keyed);
        expect(event.producingKeyId).toBe(key.key.id);
        expect(event.agentId).toBeNull();
      }
    });
  }

  test('a keyed trigger proves its principal once and the detached consumer retains the claimed stamp', async () => {
    const reads = spyOn(db, 'select');
    try {
      const event = await trigger(agentKey, true);
      expect(event.agentId).toBe(agentA);
      const principalReads = reads.mock.calls.filter(([fields]) => fields?.createdBy === apiKeys.createdBy);
      expect(principalReads).toHaveLength(1);
    } finally {
      reads.mockRestore();
    }
  });

  async function deliveries() {
    const raw = JSON.stringify({ id: randomUUID() });
    const legacy = await connectorService.receive(legacyId, raw, signHook(raw));
    const typed = await connectorService.receiveForConnector(connectorId, raw, signHook(raw));
    expect(legacy.status).toBe(202);
    expect(typed.status).toBe(202);
    const webhook = await hooks.receive('provenance-source', { id: randomUUID() }, {});
    const legacyEvent = z.object({ eventId: z.string() }).parse(legacy.body);
    const typedEvent = z.object({ eventId: z.string() }).parse(typed.body);
    return [await row(legacyEvent.eventId), await row(typedEvent.eventId), await row(webhook.eventId)];
  }
  test('legacy subscription, typed connector and webhook claims stamp distinct trusted source ids', async () => {
    const events = await deliveries();
    expect(events.map((event) => [event.sourceKind, event.sourceId])).toEqual([
      ['connector_subscription', legacyId],
      ['connector', connectorId],
      ['webhook_source', sourceId],
    ]);
    for (const event of events) {
      expect(event.producingKeyId).toBeNull();
      expect(event.agentId).toBeNull();
    }
  });

  test('direct ingress claim mechanism retains both key and proven agent inside a producer scope', async () => {
    const events = await runWithProducingKey(agentKey.key.id, deliveries);
    for (const event of events) {
      expect(event.producingKeyId).toBe(agentKey.key.id);
      expect(event.agentId).toBe(agentA);
    }
  });

  async function channelEvent() {
    const result = await bus.publish(
      'message.received',
      {
        externalId: randomUUID(),
        chatId: 'provenance-chat',
        from: 'sender',
        content: { type: 'text', text: 'proof' },
      },
      { instanceId: instanceA, channelType: 'whatsapp-baileys', producingKeyId: agentKey.key.id, agentId: agentB },
    );
    return row(result.id);
  }
  test('channel ingress without a request has no producing key or agent despite spoofed publish metadata', async () => {
    const event = await channelEvent();
    expect(event.producingKeyId).toBeNull();
    expect(event.agentId).toBeNull();
  });

  test('a real timer started by an authenticated request journals NULL provenance after the response', async () => {
    let release = () => {};
    const responseEnded = new Promise<void>((resolve) => {
      release = resolve;
    });
    let late: Promise<Awaited<ReturnType<typeof channelEvent>>> | undefined;
    const original = requestHooks.trigger.bind(requestHooks);
    const triggerSpy = spyOn(requestHooks, 'trigger').mockImplementation(async (...args) => {
      late = onTimer(async () => {
        await responseEnded;
        return channelEvent();
      });
      return original(...args);
    });
    try {
      await trigger(agentKey, false);
      release();
      const event = await late;
      expect(event?.producingKeyId).toBeNull();
      expect(event?.agentId).toBeNull();
    } finally {
      release();
      triggerSpy.mockRestore();
      await late;
    }
  });

  for (const operation of ['connect', 'restart']) {
    test(`instance ${operation} starts real channel timers outside the still-active request producer scope`, async () => {
      let observed: Awaited<ReturnType<typeof channelEvent>> | undefined;
      const registry = new ChannelRegistry();
      registry.register(
        new TimerChannel(async () => {
          observed = await onTimer(channelEvent);
        }),
      );
      const instanceApp = createApp(db, bus, registry, null).app;
      const response = await instanceApp.request(`/api/v2/instances/${instanceA}/${operation}`, {
        method: 'POST',
        headers: { 'x-api-key': agentKey.plainTextKey, 'content-type': 'application/json' },
        body: '{}',
      });
      expect(response.status).toBe(200);
      expect(observed?.producingKeyId).toBeNull();
      expect(observed?.agentId).toBeNull();
    });
  }

  test('reloadEngine starts a real subscription timer whose automation action has NULL producer provenance', async () => {
    const service = new AutomationService(db, bus);
    const triggerType = 'custom.provenance.timer';
    const outputType = 'custom.provenance.timer_action';
    const original = bus.subscribePattern.bind(bus);
    let fired = false;
    await service.startEngine();
    const subscriptionSpy = spyOn(bus, 'subscribePattern').mockImplementation(async (pattern, handler, options) => {
      const subscription = await original(pattern, handler, options);
      if (pattern === `${triggerType}.>`)
        await onTimer(async () => {
          fired = true;
          await handler({ ...createOmniEvent(triggerType, {}, undefined, 'timer-trigger'), payload: {} });
        });
      return subscription;
    });
    let automationId: string | undefined;
    try {
      await runWithProducingKey(agentKey.key.id, async () => {
        const created = await service.create({
          name: 'timer-producer',
          triggerEventType: triggerType,
          actions: [{ type: 'emit_event', config: { eventType: outputType, payloadTemplate: { proof: 'timer' } } }],
        });
        automationId = created.id;
      });
      await bus.idle();
      expect(fired).toBe(true);
      const emitted = bus.journal.find((event) => event.type === outputType);
      expect(emitted).toBeDefined();
      if (!emitted) throw new Error('Automation did not publish');
      const event = await row(emitted.id);
      expect(event.producingKeyId).toBeNull();
      expect(event.agentId).toBeNull();
    } finally {
      subscriptionSpy.mockRestore();
      await service.stopEngine();
      if (automationId) await db.delete(automations).where(eq(automations.id, automationId));
    }
  });

  for (const mode of ['flag unset', 'flag and multitenancy both true']) {
    test(`${mode}: every new column stays NULL and published envelopes have no producingKeyId`, async () => {
      if (mode === 'flag unset') Reflect.deleteProperty(process.env, 'OMNI_PAIRED_AGENT_CONSUMERS');
      else process.env.OMNI_MULTITENANCY_ENABLED = 'true';
      const start = bus.journal.length;
      const emitted = await runWithProducingKey(agentKey.key.id, async () => {
        const a = await hooks.trigger('custom.provenance.off', { agentId: agentB });
        const b = await hooks.trigger('custom.provenance.off', {}, { idempotencyKey: randomUUID() });
        return [await row(a.eventId), await row(b.eventId), ...(await deliveries())];
      });
      emitted.push(await channelEvent());
      for (const event of emitted) {
        expect([event.producingKeyId, event.sourceKind, event.sourceId, event.agentId]).toEqual([
          null,
          null,
          null,
          null,
        ]);
      }
      for (const event of bus.journal.slice(start)) expect(event.metadata).not.toHaveProperty('producingKeyId');
    });
  }
});
