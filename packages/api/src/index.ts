// Sentry must be initialised before all other imports for auto-instrumentation
import './instrument';

/**
 * @omni/api - HTTP API Server
 *
 * Entry point for the Omni v2 API server.
 * Uses Bun.serve with embedded pgserve (PostgreSQL 17) for zero-dependency PostgreSQL.
 */

import type { ChannelRegistry } from '@omni/channel-sdk';
import { type EventBus, configureLogging, connectEventBus, createLogger, enableDefaultMetrics } from '@omni/core';
import type { Database } from '@omni/db';
import { applyMigrations, closeDb, createDb } from '@omni/db';
import * as Sentry from '@sentry/bun';
import { sql } from 'drizzle-orm';
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
import { closeTurnEvents, initTurnEvents } from './services/turn-events';
import { TurnMonitor } from './services/turn-monitor';
import { printStartupBanner } from './utils/startup-banner';

// Configuration
const PORT = Number.parseInt(process.env.API_PORT ?? '8882', 10);
const HOST = process.env.API_HOST ?? '0.0.0.0';
const NATS_URL = process.env.NATS_URL ?? 'nats://localhost:4222';

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
 * Start the HTTP server using Bun.serve
 */
function startBunServer(app: App) {
  return Bun.serve({
    port: PORT,
    hostname: HOST,
    fetch: app.fetch,
  });
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
        await plugin.sendMessage(instanceId, { to, content: { type: 'text', text: content } });
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

  // Connect to NATS
  const eventBus = await connectToNats(db);

  // Load channel plugins (if NATS is available)
  if (eventBus) {
    try {
      await initializeChannelPlugins(db, eventBus);
    } catch (error) {
      pluginLog.error('Failed to load channel plugins', { error: String(error) });
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
