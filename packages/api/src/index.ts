// Sentry must be initialised before all other imports for auto-instrumentation
import './instrument';

// OpenTelemetry SDK — backend-neutral tracing. No-op when
// OTEL_EXPORTER_OTLP_ENDPOINT is unset. Imported here (right after Sentry)
// so HTTP auto-instrumentation can monkey-patch http/https globals before
// any application code uses them. See ./tracing.ts.
import './tracing';

/**
 * @omni/api - HTTP API Server
 *
 * Entry point for the Omni v2 API server. Connects to a peer-supervised
 * pgserve (PostgreSQL 17) running under pm2 / systemd / launchd. The API
 * never spawns pgserve in-process — that's what the `pgserve install`
 * one-shot is for. See the `pgserve-singleton-no-proxy` wish for the
 * consumer-only model (matches genie's pattern).
 *
 * Connection target is read from `DATABASE_URL`, set by the omni CLI
 * (`packages/cli/src/runtime-env.ts:buildRuntimeEnv`). UDS-first / TCP
 * fallback is resolved at env-build time.
 */

import { type ChannelRegistry, isVoiceCapable } from '@omni/channel-sdk';
import {
  type EventBus,
  configureLogging,
  connectEventBus,
  createLogger,
  enableDefaultMetrics,
  setEnvelopeTenantResolver,
} from '@omni/core';
import type { Database, DbEnforcementMode, EnforcedBootIdentities } from '@omni/db';
import {
  API_CRITICAL_COLUMNS,
  applyMigrations,
  assertEnforcedRuntimeIdentity,
  closeDb,
  createDb,
  createDbHandle,
  formatDriftReport,
  getDefaultDatabaseUrl,
  instances,
  resolveEnforcedBootIdentities,
  resolveEnforcementMode,
  scrubDdlCredential,
  verifyCriticalColumns,
} from '@omni/db';
import * as Sentry from '@sentry/bun';
import { sql } from 'drizzle-orm';

// Configure logging at startup
configureLogging({
  level: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') ?? 'info',
  format: (process.env.LOG_FORMAT as 'auto' | 'pretty' | 'json') ?? 'auto',
});

// Create module-specific loggers
const log = createLogger('api:startup');
const natsLog = createLogger('api:nats');
const pluginLog = createLogger('api:plugins');
const shutdownLog = createLogger('api:shutdown');
import packageJson from '../package.json';
import { type App, createApp } from './app';
import { markPluginsDegraded } from './plugin-state';
import {
  InstanceMonitor,
  loadChannelPlugins,
  reconnectWithPool,
  setupAgentResponder,
  setupChatUnreadListener,
  setupConnectionListener,
  setupContactNamesListener,
  setupEventPersistence,
  setupFollowUpHooks,
  setupHistoryPushTracker,
  setupLidMappingListener,
  setupMediaProcessor,
  setupMessageListener,
  setupMessagePersistence,
  setupQrCodeListener,
  setupSessionCleaner,
  setupSyncWorker,
} from './plugins';
import { buildAutomationEngineDeps } from './plugins/automation-actions';
import { setupScheduler, stopScheduler } from './scheduler';
import { closeAgentHeartbeat, initAgentHeartbeat } from './services/agent-heartbeat';
import { ApiKeyService } from './services/api-keys';
import { closeTurnEvents, getTurnEventsConnection, initTurnEvents } from './services/turn-events';
import { TurnMonitor } from './services/turn-monitor';
import { resolveAuthPlaneConnection } from './tenancy/auth-plane-connection';
import { warnOnMixedTenancyState } from './tenancy/enforcement-posture';
import { installInstanceOwnerResolver } from './tenancy/instance-owner-registry';
import { currentTenantScope } from './tenancy/tenant-scope';
import { startStreamRevocationSweeper } from './tenancy/tenant-stream-subscriptions';
import { printStartupBanner } from './utils/startup-banner';
import { resolveInstanceTenantId } from './ws/voice-instance-ownership';

// Configuration
const PORT = Number.parseInt(process.env.API_PORT ?? '8882', 10);
const HOST = process.env.API_HOST ?? '0.0.0.0';
const NATS_URL = process.env.NATS_URL ?? 'nats://localhost:4222';

import { VoiceStreamRegistry, authorizeVoiceApiKey, parseVoiceStreamParams, transcodeAudioFrame } from './ws/voice';
import type { VoiceStreamClient } from './ws/voice';
import { type VoiceUpgradeDeps, authorizeVoiceUpgrade } from './ws/voice-upgrade-authorization';

// Voice stream WebSocket registry (global singleton)
const voiceStreamRegistry = new VoiceStreamRegistry();

// Exported for voice session integration
export { voiceStreamRegistry };

// Global references for plugin system
let globalEventBus: EventBus | null = null;
let globalChannelRegistry: ChannelRegistry | null = null;
let globalInstanceMonitor: InstanceMonitor | null = null;
let globalDispatcherCleanup: (() => Promise<void>) | null = null;
let globalTurnMonitor: TurnMonitor | null = null;

/**
 * Get the global channel registry
 */
export function getChannelRegistry(): ChannelRegistry | null {
  return globalChannelRegistry;
}

/**
 * Get the global event bus
 */
export function getEventBus(): EventBus | null {
  return globalEventBus;
}

/**
 * Get the global instance monitor
 */
export function getInstanceMonitor(): InstanceMonitor | null {
  return globalInstanceMonitor;
}

/**
 * Connect to NATS event bus and set up listeners
 */
async function connectToNats(db: Database): Promise<EventBus | null> {
  try {
    natsLog.info('Connecting to NATS', { url: NATS_URL });
    const eventBus = await connectEventBus({
      url: NATS_URL,
      serviceName: 'omni-api',
    });
    globalEventBus = eventBus;
    natsLog.info('Connected to NATS');

    // Versioned tenant-aware envelope (G5, ADR-0008): stamp the request's tenant
    // onto every request-originated publish, so consumers can validate it. Reads
    // the per-request tenant scope; returns null off-scope (workers, flag-off),
    // where nothing is stamped and publishes stay legacy/byte-identical. A worker
    // republish must pass an explicit `metadata.tenantId` — this resolver never
    // lends an ambient tenant across the request→worker boundary.
    setEnvelopeTenantResolver(() => currentTenantScope()?.tenantId ?? null);

    // ...and the PRODUCER-side derivation for publishes that have no request at
    // all — every channel-plugin emit (`message.received`, `instance.connected`,
    // `reaction.*`). Those name an instanceId, and `instances` is the ownership
    // root, so the tenant comes from the instance's PERSISTED row via the
    // ownership registry the instance-loading paths populate. Without this the
    // dominant traffic path stamps nothing and every consumer G5 converted stays
    // on its legacy branch. Flag-off the registry is empty (NULL tenants teach
    // it nothing), so publishes remain byte-identical.
    installInstanceOwnerResolver();

    // Set up event listeners
    await setupQrCodeListener(eventBus);
    await setupConnectionListener(eventBus, db);
    await setupLidMappingListener(eventBus, db);
    await setupContactNamesListener(eventBus, db);
    await setupChatUnreadListener(eventBus, db);
    await setupMessageListener(eventBus);
    await setupEventPersistence(eventBus, db);

    return eventBus;
  } catch (error) {
    natsLog.warn('Failed to connect to NATS, running without event bus', { error: String(error) });
    natsLog.warn('Channel plugins will not be able to publish events');
    return null;
  }
}

/**
 * Load channel plugins and reconnect active instances
 */
async function initializeChannelPlugins(db: Database, eventBus: EventBus): Promise<void> {
  pluginLog.info('Loading channel plugins');
  const result = await loadChannelPlugins({ eventBus, db });
  globalChannelRegistry = result.registry;

  // Wire voice stream registry to voice-capable plugins for WS audio forwarding
  for (const plugin of result.registry.getAll()) {
    if (isVoiceCapable(plugin) && 'voiceStreamSink' in plugin) {
      Object.assign(plugin, { voiceStreamSink: voiceStreamRegistry });
      pluginLog.info('Voice stream registry wired to plugin', { pluginId: plugin.id });
    }
  }

  if (result.loaded > 0) {
    pluginLog.info('Channel plugins loaded', { count: result.loaded, plugins: result.pluginIds });
  } else {
    pluginLog.warn('No channel plugins were loaded');
    return;
  }

  if (result.failed > 0) {
    pluginLog.warn('Some channel plugins failed to load', { failed: result.failed });
  }

  // Smoke-test harness for the WhatsApp Flows data-exchange path: register the
  // reference resolver as the given instance's default. Env-gated — set
  // META_FLOWS_DEMO_INSTANCE=<instanceId> in dev only; without it nothing is
  // registered and unresolved flows degrade to an in-screen error message.
  const flowsDemoInstance = process.env.META_FLOWS_DEMO_INSTANCE;
  if (flowsDemoInstance) {
    const waCloud = result.registry.get('whatsapp-cloud');
    if (waCloud && 'flowResolvers' in waCloud) {
      const { createDemoFlowResolver } = await import('@omni/channel-whatsapp-business');
      (waCloud as import('@omni/channel-whatsapp-business').WhatsAppCloudPlugin).flowResolvers.registerInstanceDefault(
        flowsDemoInstance,
        createDemoFlowResolver(),
      );
      pluginLog.info('WhatsApp Flows demo resolver registered', { instanceId: flowsDemoInstance });
    }
  }

  // Auto-reconnect previously active instances.
  //
  // G5 (ADR-0008/ADR-0003): the startup reconnect is a whole-table `instances`
  // sweep, so it needs the auth-plane identity to ENUMERATE tenants. This runs
  // BEFORE `createApp`, so `services.authPlane` does not exist yet — resolve a
  // handle for exactly this sweep and close it immediately after. In legacy mode
  // (and under enforcement without `OMNI_DB_AUTH_PLANE_URL`) this IS the runtime
  // handle and `close()` is a no-op, so nothing new is opened; the fan-out itself
  // is flag-gated and stays a single ambient scan when multitenancy is off.
  pluginLog.info('Auto-reconnecting active instances');
  const bootAuthPlane = resolveAuthPlaneConnection(db);
  let reconnectResult: Awaited<ReturnType<typeof reconnectWithPool>>;
  try {
    reconnectResult = await reconnectWithPool(db, result.registry, {
      maxConcurrent: 3,
      delayBetweenMs: 500,
      authPlaneDb: bootAuthPlane.db,
    });
  } finally {
    await bootAuthPlane.close();
  }

  if (reconnectResult.attempted > 0) {
    pluginLog.info('Instance reconnection complete', {
      succeeded: reconnectResult.succeeded,
      attempted: reconnectResult.attempted,
      failed: reconnectResult.failed,
    });
  }

  // Start instance monitor
  globalInstanceMonitor = new InstanceMonitor(db, result.registry, {
    healthCheckIntervalMs: 30_000,
    maxConcurrentReconnects: 3,
    autoReconnect: true,
  });
  globalInstanceMonitor.start();
  pluginLog.info('Instance monitor started');
}

/**
 * Start the HTTP server using Bun.serve with WebSocket support.
 *
 * Voice stream WebSocket: ws://host/api/v2/voice/stream/{sessionId}?api_key=<key>&format=opus|pcm
 * Auth is validated on upgrade. Binary frames carry tagged audio per user.
 */
function startBunServer(app: App) {
  return Bun.serve<{ params: ReturnType<typeof parseVoiceStreamParams> }>({
    port: PORT,
    hostname: HOST,
    fetch(req, server) {
      const url = new URL(req.url);

      // Voice stream WebSocket upgrade
      if (url.pathname.startsWith('/api/v2/voice/stream/')) {
        const params = parseVoiceStreamParams(url);
        if (!params?.apiKey) {
          return new Response('API key required (api_key query parameter)', { status: 401 });
        }

        // Validate API key synchronously by attempting upgrade — auth check happens in open()
        // Bun.serve.upgrade() must be called in fetch; async auth validated in open handler
        const upgraded = server.upgrade(req, { data: { params } });
        if (!upgraded) {
          return new Response('WebSocket upgrade failed', { status: 500 });
        }
        return undefined as unknown as Response;
      }

      // All other requests handled by Hono
      return app.fetch(req, server);
    },
    websocket: {
      async open(ws) {
        const params = ws.data.params;
        if (!params) {
          ws.close(4001, 'Invalid parameters');
          return;
        }

        // Validate API key against the database. The refusal logic lives in
        // authorizeVoiceApiKey: an invalid key makes ApiKeyService.validate
        // RESOLVE NULL rather than throw, so the result must be inspected — and
        // an absent db ref must refuse rather than skip the check entirely.
        const db = globalDbRef;
        const authorized = await authorizeVoiceApiKey(
          db ? (key: string) => new ApiKeyService(db).validate(key) : null,
          params.apiKey,
        );
        if (!authorized) {
          ws.close(4004, 'Invalid API key');
          return;
        }

        // G5 deliverable (e): tenant-authorized upgrade. Flag-off this is the
        // pre-G5 "does the session exist" decision, byte-identical and with no
        // tenancy lookup; flag-on the connection's tenant is derived from the
        // CREDENTIAL and the session's instance must be owned by it.
        const decision = await authorizeVoiceUpgrade(
          { apiKey: params.apiKey, sessionId: params.sessionId },
          voiceUpgradeDeps(),
        );
        if (!decision.ok) {
          if (decision.reason === 'session_not_found') {
            ws.close(4004, `Voice session ${params.sessionId} not found`);
          } else if (decision.reason === 'unauthenticated') {
            ws.close(4004, 'Invalid API key');
          } else {
            // Cross-tenant / unowned: refuse WITHOUT disclosing whether the
            // session exists — the refusal must not become an existence oracle.
            ws.close(4004, `Voice session ${params.sessionId} not found`);
          }
          return;
        }

        const client: VoiceStreamClient = {
          params,
          tenantId: decision.tenantId,
          revocationEpoch: decision.revocationEpoch,
          send: (data) => {
            try {
              ws.send(data as string | ArrayBuffer | Uint8Array);
            } catch {
              // Client slow or disconnected
            }
          },
          close: (reason) => {
            try {
              ws.close(4003, reason);
            } catch {
              // Already gone
            }
          },
        };
        // Bind the session to its trusted owner so the audio fan-out is narrowed
        // to this tenant even if another tenant holds a session with the same id.
        if (decision.tenantId) voiceStreamRegistry.bindSession(params.sessionId, decision.tenantId);
        voiceStreamRegistry.add(ws, client);
        ws.send(JSON.stringify({ type: 'session_ready', sessionId: params.sessionId }));
      },
      message(ws, message) {
        const client = voiceStreamRegistry.get(ws);
        if (!client) return;

        // Text = JSON control message
        if (typeof message === 'string') {
          try {
            const msg = JSON.parse(message) as { type: string };
            if (msg.type === 'speaking') {
              // Toggle bot speaking — handled at session level
            }
          } catch {
            // Invalid JSON — ignore
          }
          return;
        }

        // Binary = audio for bot to speak — find session via VoiceCapable
        const vPlugin = globalChannelRegistry
          ?.getAll()
          .find((p) => isVoiceCapable(p) && p.voiceSession(client.params.sessionId));
        if (vPlugin && isVoiceCapable(vPlugin)) {
          const session = vPlugin.voiceSession(client.params.sessionId);
          try {
            const opusFrame = transcodeAudioFrame(message as ArrayBuffer | Uint8Array, client.params.format, 'opus');
            session?.sendAudio(Buffer.from(opusFrame));
          } catch (error) {
            try {
              ws.send(JSON.stringify({ type: 'error', message: String(error) }));
            } catch {
              // Client disconnected while receiving the error
            }
          }
        }
      },
      close(ws) {
        const sessionId = voiceStreamRegistry.get(ws)?.params.sessionId;
        voiceStreamRegistry.remove(ws);
        // Drop the session→tenant binding only once the session itself is gone,
        // so a reconnecting client is still narrowed to its own tenant.
        if (sessionId) {
          const stillLive = globalChannelRegistry?.getAll().some((p) => isVoiceCapable(p) && p.voiceSession(sessionId));
          if (!stillLive) voiceStreamRegistry.unbindSession(sessionId);
        }
      },
    },
  });
}

// Database reference for WS auth (set during startup)
let globalDbRef: Database | null = null;

/**
 * Services reference for WS tenant authorization (set during startup).
 *
 * G5 deliverable (e): the voice upgrade lives in `Bun.serve`'s raw `fetch`,
 * before Hono, so it cannot reach the tenancy middleware's context. It resolves
 * the connection's tenant itself, through the SAME auth plane the HTTP edge uses
 * (`services.authBootstrap`) and the same ownership root (`instances`).
 */
let globalServicesRef: ReturnType<typeof createApp>['services'] | null = null;

/** The revocation sweeper for live voice sockets; stopped on shutdown. */
let globalStreamSweeper: { stop: () => void } | null = null;

/**
 * The tenancy derivations the voice upgrade needs, all trusted — the credential
 * index for the tenant, the live plugin session for the instance, and the
 * `instances` ownership root (read inside the credential tenant's own scope, so
 * RLS decides visibility) for the resource owner.
 */
function voiceUpgradeDeps(): VoiceUpgradeDeps {
  return {
    resolveCredentialTenant: async (apiKey) => {
      const services = globalServicesRef;
      if (!services) return null;
      const result = await services.authBootstrap.lookupBySecret(apiKey, `voice-ws-${crypto.randomUUID()}`);
      if (!result.ok || result.context.credentialClass !== 'tenant') return null;
      return { tenantId: result.context.tenantId, revocationEpoch: result.context.revocationEpoch };
    },
    resolveSessionInstanceId: (sessionId) => {
      const plugin = globalChannelRegistry?.getAll().find((p) => isVoiceCapable(p) && p.voiceSession(sessionId));
      if (!plugin || !isVoiceCapable(plugin)) return null;
      return plugin.voiceSession(sessionId)?.instanceId ?? null;
    },
    resolveInstanceTenantId: async (instanceId, tenantId) => {
      const db = globalDbRef;
      if (!db) return null;
      return resolveInstanceTenantId(db, instanceId, tenantId);
    },
  };
}

/**
 * Set up graceful shutdown handlers
 */
function setupShutdownHandlers(server: ReturnType<typeof Bun.serve>, earlyShutdown?: () => Promise<void>): void {
  if (earlyShutdown) {
    process.removeListener('SIGINT', earlyShutdown);
    process.removeListener('SIGTERM', earlyShutdown);
  }

  let isShuttingDown = false;

  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    shutdownLog.info('Shutting down gracefully');

    const forceExitTimer = setTimeout(() => {
      shutdownLog.warn('Force exiting (timeout)');
      process.exit(1);
    }, 15000);
    forceExitTimer.unref();

    try {
      // Stop scheduler first
      shutdownLog.info('Stopping scheduler');
      stopScheduler();

      shutdownLog.info('Stopping HTTP server');
      server.stop();

      if (globalStreamSweeper) {
        shutdownLog.info('Stopping stream revocation sweeper');
        globalStreamSweeper.stop();
        globalStreamSweeper = null;
      }

      if (globalDispatcherCleanup) {
        shutdownLog.info('Stopping agent dispatcher');
        await globalDispatcherCleanup();
      }

      if (globalTurnMonitor) {
        shutdownLog.info('Stopping turn monitor');
        globalTurnMonitor.stop();
      }

      shutdownLog.info('Stopping agent heartbeat consumer');
      await closeAgentHeartbeat();

      shutdownLog.info('Closing turn events NATS');
      await closeTurnEvents();

      if (globalInstanceMonitor) {
        shutdownLog.info('Stopping instance monitor');
        globalInstanceMonitor.stop();
      }

      if (globalChannelRegistry) {
        shutdownLog.info('Disconnecting all channel instances');
        await globalChannelRegistry.destroyAll();
      }

      if (globalEventBus) {
        shutdownLog.info('Closing NATS connection');
        await globalEventBus.close();
      }

      // Drain DB connection pool. pgserve is peer-supervised — omni-api
      // does not own its lifecycle and must not stop it on shutdown
      // (other consumers — genie, dev tools — share the same socket).
      shutdownLog.info('Closing database connections');
      await closeDb();

      // Flush pending Sentry events before exit
      await Sentry.close(5000);

      shutdownLog.info('Graceful shutdown complete');
      clearTimeout(forceExitTimer);
      process.exit(0);
    } catch (error) {
      shutdownLog.error('Error during graceful shutdown', { error: String(error) });
      process.exit(1);
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

/**
 * Setup event bus related services (plugins, persistence, workers)
 * Extracted to reduce main() complexity
 */
async function setupEventBusServices(
  eventBus: EventBus | null,
  services: ReturnType<typeof createApp>['services'],
  db: Database,
): Promise<void> {
  if (!eventBus) {
    log.warn('Skipping event bus services (no event bus)');
    return;
  }

  // Message persistence
  try {
    await setupMessagePersistence(eventBus, services);
  } catch (error) {
    log.error('Failed to set up message persistence', { error: String(error) });
  }

  // Media processor (transcription, description, extraction)
  try {
    await setupMediaProcessor(eventBus, db, services);
  } catch (error) {
    log.error('Failed to set up media processor', { error: String(error) });
  }

  // Agent dispatcher (AI agent responses — multi-event, multi-provider)
  try {
    globalDispatcherCleanup = await setupAgentResponder(eventBus, services, db);
  } catch (error) {
    log.error('Failed to set up agent dispatcher', { error: String(error) });
  }

  // Automation engine (subscribes to NATS events and evaluates rules).
  // The action callbacks live in `plugins/automation-actions.ts` — a worker
  // surface (G5, ADR-0008): the engine threads each consumed envelope's
  // trusted tenant into them, and their DB blocks scope themselves with
  // `runTenantWorkDb` (legacy envelopes run ambient, byte-identically).
  try {
    await services.automations.startEngine(buildAutomationEngineDeps(services, db));
  } catch (error) {
    log.error('Failed to start automation engine', { error: String(error) });
  }

  // Session cleaner (clears agent sessions on trash emoji)
  try {
    await setupSessionCleaner(eventBus, services, db);
  } catch (error) {
    log.error('Failed to set up session cleaner', { error: String(error) });
  }

  // Follow-up lifecycle hooks (arm on outbound agent msg, disarm on reply/handoff/archive)
  try {
    await setupFollowUpHooks(eventBus, services, db);
  } catch (error) {
    log.error('Failed to set up follow-up hooks', { error: String(error) });
  }

  // Sync worker
  if (globalChannelRegistry) {
    try {
      await setupSyncWorker(eventBus, services, globalChannelRegistry, db);
    } catch (error) {
      log.error('Failed to set up sync worker', { error: String(error) });
    }
  }

  // History-push tracker (creates sync jobs on connect, tracks Baileys push progress)
  try {
    await setupHistoryPushTracker(eventBus, services);
  } catch (error) {
    log.error('Failed to set up history-push tracker', { error: String(error) });
  }

  // Turn events NATS connection (for turn-based agent lifecycle signaling)
  try {
    await initTurnEvents(NATS_URL);
  } catch (error) {
    log.error('Failed to initialize turn events', { error: String(error) });
  }

  // Agent heartbeat consumer — resets turns.lastActivityAt on inbound
  // `omni.agent.heartbeat.*` events so the 120s nudge stays suppressed
  // for actively-working Claude Code sessions. See wish
  // automagik-dev/genie:omni-activity-heartbeat.
  try {
    const turnEventsConn = getTurnEventsConnection();
    if (turnEventsConn) {
      // G5 (ADR-0008): `db` opts this consumer into the tenant world — the
      // activity write then runs in the scope derived from the heartbeat's
      // instance ownership. Flag-off no instance carries a tenant, so every
      // heartbeat classifies legacy and the call is byte-identical.
      initAgentHeartbeat({ natsConnection: turnEventsConn, turnService: services.turns, db: services.db });
    } else {
      log.warn('Skipping agent heartbeat consumer: no NATS connection');
    }
  } catch (error) {
    log.error('Failed to initialize agent heartbeat consumer', { error: String(error) });
  }

  // Turn monitor (polls for stale turns, emits nudge/timeout events)
  try {
    globalTurnMonitor = new TurnMonitor({
      turnService: services.turns,
      instanceService: services.instances,
      // G5 (ADR-0008): the pools the per-tenant worker scopes need. Wiring them
      // does NOT change flag-off behaviour — `runForEachActiveTenantRow` runs
      // the single ambient pass, and the auth-plane enumeration is gated on the
      // multitenancy flag.
      db: services.db,
      authPlaneDb: services.authPlane.db,
    });
    globalTurnMonitor.start();
    log.info('Turn monitor started');
  } catch (error) {
    log.error('Failed to start turn monitor', { error: String(error) });
  }
}

/**
 * Wait for database to become responsive.
 * Retries SELECT 1 up to maxAttempts times, 1 second apart.
 */
async function waitForDatabaseReady(db: Database, maxAttempts = 30): Promise<void> {
  log.info('Waiting for database readiness');
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await db.execute(sql`SELECT 1`);
      log.info('Database ready', { attempt });
      return;
    } catch {
      if (attempt === maxAttempts) {
        throw new Error(`Database not ready after ${maxAttempts} attempts`);
      }
      log.warn('Database not ready, retrying...', { attempt });
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
}

/**
 * Run migrate-on-boot, under the DDL identity when enforcement is active
 * (wish: omni-full-multitenancy, G3; ADR-0004).
 *
 * In LEGACY mode this is exactly the pre-G3 call: the serving connection runs
 * the migrator, as it always has.
 *
 * In ENFORCED mode the serving role holds no CREATE and owns nothing, so it
 * could not run migrations even if asked. A dedicated DDL connection does the
 * work and is closed before this function returns — which is what "migration
 * credentials are unavailable to the application process after boot" means in
 * practice.
 */
async function runStartupMigrations(db: Database, enforced: EnforcedBootIdentities | null): Promise<void> {
  const MIGRATION_TIMEOUT_MS = 60_000;
  const ddlHandle = enforced ? createDbHandle({ url: enforced.ddlUrl, maxConnections: 2 }) : null;
  try {
    await Promise.race([
      applyMigrations(ddlHandle?.db ?? db, new URL('../../db/drizzle', import.meta.url).pathname),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Database migrations timed out (60s)')), MIGRATION_TIMEOUT_MS),
      ),
    ]);
  } finally {
    await ddlHandle?.close().catch(() => undefined);
    // The connection is shut AND the credential is gone from the environment
    // (G3 review carry-forward L3). Only on the enforced path: legacy mode has
    // no DDL identity and nothing is removed.
    if (enforced && scrubDdlCredential()) {
      log.info('DDL credential scrubbed from process environment');
    }
  }
}

/**
 * Refuse to serve traffic on an identity that could bypass RLS, own a tenant
 * table, or create schema objects — and refuse when enforcement is not actually
 * installed (wish: omni-full-multitenancy, G3; ADR-0004).
 *
 * A legacy boot returns immediately: this is the whole of G3's startup
 * footprint on an existing deployment.
 */
async function verifyEnforcedRuntimeIdentity(db: Database, mode: DbEnforcementMode): Promise<void> {
  if (mode !== 'enforced') return;
  try {
    const identity = await assertEnforcedRuntimeIdentity(db);
    log.info('Enforced runtime identity verified', {
      currentUser: identity.currentUser,
      forcedTables: identity.enforcement.forced.length,
    });
  } catch (error) {
    log.error('Enforcement-mode startup refused', { error: String(error) });
    await closeDb();
    throw error;
  }
}

/**
 * Main entry point
 */
async function main() {
  log.info('Starting Omni API v2');

  // Enable default Node.js metrics (CPU, memory, event loop)
  enableDefaultMetrics();

  // Resolve DATABASE_URL — set by the omni CLI's `buildRuntimeEnv`
  // (UDS-first / TCP fallback per pgserve-singleton-no-proxy G1). The
  // legacy embedded-pgserve boot path was removed in this wish; pgserve
  // is supervised by pm2 / systemd / launchd via `pgserve install` and
  // omni-api connects as a peer, never spawning the postmaster itself.
  if (process.env.PGSERVE_EMBEDDED === 'true') {
    log.warn(
      'PGSERVE_EMBEDDED=true is set but embedded mode was removed in pgserve-singleton-no-proxy. ' +
        'Run `omni doctor --fix` (or `pgserve install` directly) to migrate to consumer-only pgserve. ' +
        'omni-api will continue using DATABASE_URL.',
    );
  }
  // Enforcement mode (wish: omni-full-multitenancy, G3; ADR-0004).
  //
  // `legacy` is the DEFAULT and takes exactly the path it always has:
  // DATABASE_URL, one connection, migrate on it, serve on it. `enforced`
  // requires the three-identity split — migrations run under the DDL identity
  // on a connection that is closed before the server listens, and the serving
  // connection is a non-owning NOBYPASSRLS role that is verified, not assumed.
  // There is no superuser fallback on the enforced path: it never consults the
  // legacy resolver at all.
  const enforcementMode = resolveEnforcementMode();

  // Multitenancy on, DB enforcement off: credentials that claim a tenant
  // boundary the database does not enforce. It is the documented migration
  // path, so it boots — but never silently. See tenancy/enforcement-posture.ts.
  warnOnMixedTenancyState(enforcementMode, (message) => log.warn(message));

  const enforcedIdentities = enforcementMode === 'enforced' ? resolveEnforcedBootIdentities() : null;
  const databaseUrl = enforcedIdentities ? enforcedIdentities.runtimeUrl : getDefaultDatabaseUrl();

  // Create database connection.
  //
  // The log line is byte-identical to the pre-G3 legacy line (G3 review finding
  // L1): a legacy boot must not gain even an observability field, because
  // "contract-identical legacy behavior" includes what a log scraper sees. The
  // `enforcementMode` field is emitted only on the enforced path, where it is
  // new behavior anyway.
  if (enforcementMode === 'enforced') {
    log.info('Connecting to database', { enforcementMode });
  } else {
    log.info('Connecting to database');
  }
  const db = createDb({ url: databaseUrl });
  globalDbRef = db;

  // Register early shutdown handler so SIGINT/SIGTERM during startup still cleans up
  const earlyShutdown = async () => {
    log.info('Shutdown during startup — cleaning up');
    try {
      await closeDb();
    } catch (err) {
      log.error('Cleanup failed during early shutdown', { error: String(err) });
    } finally {
      process.exit(1);
    }
  };
  process.once('SIGINT', earlyShutdown);
  process.once('SIGTERM', earlyShutdown);

  // Wait for database to accept connections before running migrations
  try {
    await waitForDatabaseReady(db);
  } catch (error) {
    await closeDb();
    throw error;
  }

  // Apply pending migrations (idempotent — already-applied are skipped)
  // applyMigrations() throws if Drizzle silently skipped any migration files
  log.info('Running database migrations');
  const migrationStart = Date.now();
  try {
    await runStartupMigrations(db, enforcedIdentities);
  } catch (error) {
    await closeDb();
    throw error;
  }
  log.info('Database migrations complete', { durationMs: Date.now() - migrationStart });

  await verifyEnforcedRuntimeIdentity(db, enforcementMode);

  // Issue #407: migration 0018_supreme_puma was marked applied on a production
  // DB whose columns had never actually been renamed, so every /instances/*
  // query 500'd on "column gupshup_callback_url does not exist". Verify the
  // columns Drizzle depends on actually exist; if not, fail startup with a
  // clear, actionable error rather than serving traffic in a broken state.
  try {
    const driftReport = await verifyCriticalColumns(db, API_CRITICAL_COLUMNS);
    if (!driftReport.ok) {
      log.error(formatDriftReport(driftReport), { drift: driftReport.drift });
      await closeDb();
      process.exit(1);
    }
  } catch (error) {
    log.error('Schema drift check failed', { error: String(error) });
    await closeDb();
    process.exit(1);
  }

  // Content-aware boot banner — surfaces the #412 "fresh empty data dir" symptom
  // immediately after migrations. A zero count on a deploy that used to have
  // instances is a red flag: the API is talking to the wrong pgserve data dir.
  // Pre-singleton, this also gated on the embedded `requireExisting` flag; with
  // pgserve consumer-only (this wish), the canonical postmaster owns its data
  // dir and PGSERVE_REQUIRE_EXISTING is no longer read by omni-api.
  try {
    const [countRow] = await db.select({ count: sql<number>`count(*)::int` }).from(instances);
    const rowCount = countRow?.count ?? 0;
    log.info('Post-migration content snapshot', { DB_ROW_COUNT_INSTANCES: rowCount });
  } catch (error) {
    log.warn('Failed to read instances row count (non-fatal)', { error: String(error) });
  }

  // Connect to NATS
  const eventBus = await connectToNats(db);

  // Load channel plugins (if NATS is available)
  if (eventBus) {
    try {
      await initializeChannelPlugins(db, eventBus);
    } catch (error) {
      const reason = String(error);
      pluginLog.error('Failed to load channel plugins', { error: reason });
      // Issue #408: a plugin init failure previously left the API running
      // in a silently broken state where /health returned healthy. Flip the
      // degraded flag so operators can detect it.
      markPluginsDegraded(reason);
    }
  } else {
    pluginLog.warn('Skipping channel plugin loading (no event bus)');
  }

  // Create app and get services
  const { app, services } = createApp(db, eventBus, globalChannelRegistry);
  globalServicesRef = services;

  // G5 (ADR-0008): opt the instance monitor into the tenant fan-out now that the
  // long-lived auth-plane connection exists. Its first health check is a full
  // 30-second interval away, so this always lands before any tick. Flag-off this
  // changes nothing — `runForEachActiveTenantRow` still runs one ambient pass.
  globalInstanceMonitor?.setAuthPlane(services.authPlane.db);

  // G5 deliverable (e): terminate a revoked tenant's live voice sockets inside
  // the RELEASE_SLOS ceiling. Flag-off this starts no timer at all.
  globalStreamSweeper = startStreamRevocationSweeper(services.authPlane.db, voiceStreamRegistry.streamRegistry);

  // Seed default settings
  try {
    await services.settings.seedDefaults();
  } catch (error) {
    log.error('Failed to seed default settings', { error: String(error) });
  }

  // Initialize primary API key
  log.info('Initializing API key');
  let apiKeyInfo: { displayKey: string; isNew: boolean; isFromEnv: boolean } | undefined;
  try {
    const keyResult = await services.apiKeys.initializePrimaryKey();
    apiKeyInfo = {
      displayKey: keyResult.displayKey,
      isNew: keyResult.isNew,
      isFromEnv: keyResult.isFromEnv,
    };
    if (keyResult.isNew) {
      log.info('Generated new primary API key');
    } else if (keyResult.isFromEnv) {
      log.info('Using primary API key from environment');
    } else {
      log.info('Using existing primary API key');
    }
  } catch (error) {
    log.error('Failed to initialize primary API key', { error: String(error) });
  }

  // Set up event bus related services (persistence, agent responder, sync worker)
  await setupEventBusServices(eventBus, services, db);

  // Setup scheduler with services and channel registry (for unread count refresh)
  log.info('Starting scheduler');
  setupScheduler(services, globalChannelRegistry);

  // Start HTTP server
  const server = startBunServer(app);

  // Print startup banner
  printStartupBanner({
    version: packageJson.version,
    host: HOST,
    port: PORT,
    docsPath: '/api/v2/docs',
    healthPath: '/api/v2/health',
    metricsPath: '/api/v2/metrics',
    apiKey: apiKeyInfo,
  });
  setupShutdownHandlers(server, earlyShutdown);
}

// Run
main().catch((error) => {
  log.error('Failed to start API server', { error: String(error) });
  process.exit(1);
});

// Re-exports for library usage
export { createApp } from './app';
export type { App } from './app';
export type { AppVariables, ApiKeyData, HealthResponse, PaginatedResponse } from './types';
export { createServices, type Services } from './services';
