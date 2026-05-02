// Sentry must be initialised before all other imports for auto-instrumentation
import './instrument';

/**
 * @omni/api - HTTP API Server
 *
 * Entry point for the Omni v2 API server.
 * Uses Bun.serve with embedded pgserve (PostgreSQL 17) for zero-dependency PostgreSQL.
 */

import { type ChannelRegistry, isVoiceCapable } from '@omni/channel-sdk';
import { type EventBus, configureLogging, connectEventBus, createLogger, enableDefaultMetrics } from '@omni/core';
import type { Database } from '@omni/db';
import {
  API_CRITICAL_COLUMNS,
  agents,
  applyMigrations,
  closeDb,
  createDb,
  formatDriftReport,
  instances,
  verifyCriticalColumns,
} from '@omni/db';
import * as Sentry from '@sentry/bun';
import { eq, sql } from 'drizzle-orm';
import { resolvePgserveConfig, startEmbeddedPgserve, stopEmbeddedPgserve } from './pgserve';

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
import { getPlugin } from './plugins/loader';
import { setupScheduler, stopScheduler } from './scheduler';
import { ApiKeyService } from './services/api-keys';
import { closeTurnEvents, initTurnEvents } from './services/turn-events';
import { TurnMonitor } from './services/turn-monitor';
import { printStartupBanner } from './utils/startup-banner';

// Configuration
const PORT = Number.parseInt(process.env.API_PORT ?? '8882', 10);
const HOST = process.env.API_HOST ?? '0.0.0.0';
const NATS_URL = process.env.NATS_URL ?? 'nats://localhost:4222';

import { VoiceStreamRegistry, parseVoiceStreamParams, transcodeAudioFrame } from './ws/voice';
import type { VoiceStreamClient } from './ws/voice';

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

  // Auto-reconnect previously active instances
  pluginLog.info('Auto-reconnecting active instances');
  const reconnectResult = await reconnectWithPool(db, result.registry, {
    maxConcurrent: 3,
    delayBetweenMs: 500,
  });

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

        // Validate API key against the database
        if (globalDbRef) {
          try {
            const apiKeyService = new ApiKeyService(globalDbRef);
            await apiKeyService.validate(params.apiKey);
          } catch {
            ws.close(4004, 'Invalid API key');
            return;
          }
        }

        // Validate session exists via VoiceCapable interface
        const voicePlugin = globalChannelRegistry
          ?.getAll()
          .find((p) => isVoiceCapable(p) && p.voiceSession(params.sessionId));
        if (!voicePlugin) {
          ws.close(4004, `Voice session ${params.sessionId} not found`);
          return;
        }

        const client: VoiceStreamClient = {
          params,
          send: (data) => {
            try {
              ws.send(data as string | ArrayBuffer | Uint8Array);
            } catch {
              // Client slow or disconnected
            }
          },
        };
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
        voiceStreamRegistry.remove(ws);
      },
    },
  });
}

// Database reference for WS auth (set during startup)
let globalDbRef: Database | null = null;

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

      if (globalDispatcherCleanup) {
        shutdownLog.info('Stopping agent dispatcher');
        await globalDispatcherCleanup();
      }

      if (globalTurnMonitor) {
        shutdownLog.info('Stopping turn monitor');
        globalTurnMonitor.stop();
      }

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

      // Drain DB connection pool before stopping embedded pgserve
      shutdownLog.info('Closing database connections');
      await closeDb();

      // Stop embedded pgserve last (after all DB consumers are done)
      await stopEmbeddedPgserve();

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve chat UUID → channel-native external_id for a call_agent invocation.
 *
 * Symmetric with the send_message action (above) which already auto-resolves
 * UUIDs for the same reason: system-initiated events (chat.idle_timeout) emit
 * payload.chatId as the internal chats.id UUID, but the seller dispatch path
 * carries the external_id (e.g. WA phone). Without resolution, the agent
 * runner's computeSessionId produces session_ids that diverge from sessions
 * created by the seller path.
 *
 * Also resolves senderId — extractAgentCallContext falls back senderId=chatId
 * when payload.from/senderId are absent (follow-up events).
 *
 * On missing chat row, logs a warning and falls through with the raw UUID so
 * the call still runs (avoids hard-failing the automation action).
 */
async function resolveCallAgentChatIds(
  services: ReturnType<typeof createApp>['services'],
  ctx: { chatId: string; senderId: string; instanceId: string },
): Promise<{ chatId: string; senderId: string }> {
  if (!UUID_RE.test(ctx.chatId)) {
    return { chatId: ctx.chatId, senderId: ctx.senderId };
  }
  try {
    const chat = await services.chats.getById(ctx.chatId, { includeHidden: true });
    return {
      chatId: chat.externalId,
      senderId: ctx.senderId === ctx.chatId ? chat.externalId : ctx.senderId,
    };
  } catch {
    log.warn('call_agent: chat UUID not resolvable, using raw value (session may diverge)', {
      chatId: ctx.chatId,
      instanceId: ctx.instanceId,
    });
    return { chatId: ctx.chatId, senderId: ctx.senderId };
  }
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

  // Automation engine (subscribes to NATS events and evaluates rules)
  try {
    await services.automations.startEngine({
      sendMessage: async (instanceId, to, content) => {
        const instance = await services.instances.getById(instanceId);
        if (!instance) throw new Error(`Instance not found: ${instanceId}`);
        const plugin = await getPlugin(instance.channel);
        if (!plugin) throw new Error(`No plugin for channel: ${instance.channel}`);
        // Resolve internal chat UUID → channel-native external_id (e.g. WA JID).
        // Automation payloads carry chat UUIDs; plugins expect channel JIDs.
        let recipient = to;
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(to)) {
          try {
            const chat = await services.chats.getById(to, { includeHidden: true });
            recipient = chat.externalId;
          } catch {
            throw new Error(`Chat not found for UUID: ${to}`);
          }
        }
        await plugin.sendMessage(instanceId, { to: recipient, content: { type: 'text', text: content } });
      },
      callAgent: async (ctx, cfg) => {
        const instance = await services.instances.getById(ctx.instanceId);
        if (!instance) throw new Error(`Instance not found: ${ctx.instanceId}`);

        // System-initiated events (chat.idle_timeout) emit payload.chatId as
        // the internal chats.id UUID; the seller dispatch path carries the
        // channel-native external_id. Resolve UUID → external_id so the
        // computed session_id matches sessions created by the seller path.
        const { chatId: resolvedChatId, senderId: resolvedSenderId } = await resolveCallAgentChatIds(services, ctx);

        const agentFkId = ctx.agentId ?? instance.agentId;
        if (!agentFkId) throw new Error(`No agent configured for instance ${instance.id}`);

        const [agentRow] = await db
          .select({
            name: agents.name,
            agentProviderId: agents.agentProviderId,
            agentType: agents.agentType,
            metadata: agents.metadata,
            configPath: agents.configPath,
          })
          .from(agents)
          .where(eq(agents.id, agentFkId))
          .limit(1);
        if (!agentRow) throw new Error(`Agent not found: ${agentFkId}`);

        const typeMap: Record<string, 'agent' | 'team' | 'workflow'> = {
          assistant: 'agent',
          tool: 'agent',
          workflow: 'workflow',
          team: 'team',
        };
        const providerAgentId =
          ((agentRow.metadata as Record<string, unknown> | null)?.providerAgentId as string | undefined) ??
          agentRow.configPath ??
          agentRow.name;

        const runInstance = {
          ...instance,
          agentProviderId: agentRow.agentProviderId ?? null,
          agentType: cfg.agentType ?? typeMap[agentRow.agentType] ?? 'agent',
          agentInternalId: providerAgentId,
          agentSessionStrategy: cfg.sessionStrategy ?? instance.agentSessionStrategy,
          agentPrefixSenderName: cfg.prefixSenderName ?? instance.agentPrefixSenderName,
          agentTimeout: cfg.timeoutMs ? Math.ceil(cfg.timeoutMs / 1000) : instance.agentTimeout,
        };

        // Honor instance.agentStreamMode — sync mode waits for the full agent run
        // before sending anything (11-14s on some providers); stream mode returns
        // progressively. See issue #410.
        const result = await services.agentRunner.runOrStream({
          instance: runInstance,
          chatId: resolvedChatId,
          senderId: resolvedSenderId,
          senderName: ctx.senderName,
          chatType: 'dm',
          messages: ctx.messages,
        });
        return {
          parts: result.parts,
          fullResponse: result.parts.join('\n'),
          metadata: {
            runId: result.metadata.runId,
            sessionId: result.metadata.sessionId,
            status: result.metadata.status,
          },
        };
      },
      // Consumer-side stale-event gate — see engine.handleEvent comment.
      // Skips chat.idle_timeout events whose row has been disarmed since the
      // sweeper published the event, or whose chat is in active close-contact
      // state. Fail-open on errors so a flaky DB doesn't drop legitimate
      // events.
      staleIdleTimeoutGate: async (chatId, instanceId, eventSequenceIndex) => {
        return services.followUpLifecycle.evaluateIdleTimeoutFreshness(chatId, instanceId, eventSequenceIndex);
      },
    });
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
    await setupFollowUpHooks(eventBus, services);
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

  // Turn monitor (polls for stale turns, emits nudge/timeout events)
  try {
    globalTurnMonitor = new TurnMonitor({
      turnService: services.turns,
      instanceService: services.instances,
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
 * Main entry point
 */
async function main() {
  log.info('Starting Omni API v2');

  // Enable default Node.js metrics (CPU, memory, event loop)
  enableDefaultMetrics();

  // Start embedded pgserve (before DB connection)
  const pgserveConfig = resolvePgserveConfig();
  const databaseUrl = await startEmbeddedPgserve(pgserveConfig);

  // Create database connection
  log.info('Connecting to database');
  const db = createDb({ url: databaseUrl });
  globalDbRef = db;

  // Register early shutdown handler so SIGINT/SIGTERM during startup still cleans up
  const earlyShutdown = async () => {
    log.info('Shutdown during startup — cleaning up');
    try {
      await closeDb();
      await stopEmbeddedPgserve();
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
    await stopEmbeddedPgserve();
    throw error;
  }

  // Apply pending migrations (idempotent — already-applied are skipped)
  // applyMigrations() throws if Drizzle silently skipped any migration files
  log.info('Running database migrations');
  const migrationStart = Date.now();
  const MIGRATION_TIMEOUT_MS = 60_000;
  try {
    await Promise.race([
      applyMigrations(db, new URL('../../db/drizzle', import.meta.url).pathname),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Database migrations timed out (60s)')), MIGRATION_TIMEOUT_MS),
      ),
    ]);
  } catch (error) {
    await closeDb();
    await stopEmbeddedPgserve();
    throw error;
  }
  log.info('Database migrations complete', { durationMs: Date.now() - migrationStart });

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
      await stopEmbeddedPgserve();
      process.exit(1);
    }
  } catch (error) {
    log.error('Schema drift check failed', { error: String(error) });
    await closeDb();
    await stopEmbeddedPgserve();
    process.exit(1);
  }

  // Content-aware boot banner — surfaces the #412 "fresh empty data dir" symptom
  // immediately after migrations. A zero count on a deploy that used to have
  // instances is a red flag: the API is talking to the wrong pgserve data dir.
  try {
    const [countRow] = await db.select({ count: sql<number>`count(*)::int` }).from(instances);
    const rowCount = countRow?.count ?? 0;
    log.info('Post-migration content snapshot', { DB_ROW_COUNT_INSTANCES: rowCount });
    if (rowCount === 0 && pgserveConfig.requireExisting) {
      log.error(
        'PGSERVE_REQUIRE_EXISTING=true but instances table is empty after boot — verify PGSERVE_DATA points at the correct cluster (see #412).',
      );
    }
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
