/**
 * @omni/api - HTTP API Server
 *
 * Entry point for the Omni v2 API server.
 * Uses Node.js HTTP server (required for Baileys WebSocket compatibility).
 */

import type { ChannelRegistry } from '@omni/channel-sdk';
import { type EventBus, configureLogging, connectEventBus, createLogger, enableDefaultMetrics } from '@omni/core';
import type { Database } from '@omni/db';
import { createDb, getDefaultDatabaseUrl } from '@omni/db';

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
const httpLog = createLogger('api:http');
import packageJson from '../package.json';
import { type App, createApp } from './app';
import {
  InstanceMonitor,
  loadChannelPlugins,
  reconnectWithPool,
  setupAgentResponder,
  setupConnectionListener,
  setupEventPersistence,
  setupLidMappingListener,
  setupMediaProcessor,
  setupMessageListener,
  setupMessagePersistence,
  setupQrCodeListener,
  setupSessionCleaner,
  setupSyncWorker,
} from './plugins';
import { setupScheduler, stopScheduler } from './scheduler';
import { printStartupBanner } from './utils/startup-banner';

// Configuration
const PORT = Number.parseInt(process.env.API_PORT ?? '8882', 10);
const HOST = process.env.API_HOST ?? '0.0.0.0';
const DATABASE_URL = process.env.DATABASE_URL ?? getDefaultDatabaseUrl();
const NATS_URL = process.env.NATS_URL ?? 'nats://localhost:4222';

// Global references for plugin system
let globalEventBus: EventBus | null = null;
let globalChannelRegistry: ChannelRegistry | null = null;
let globalInstanceMonitor: InstanceMonitor | null = null;
let globalDispatcherCleanup: (() => void) | null = null;

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
 * Convert Node.js request headers to a plain object
 */
function convertNodeHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      result[key] = value;
    } else if (Array.isArray(value)) {
      result[key] = value.join(', ');
    }
  }
  return result;
}

/**
 * Start the HTTP server
 */
async function startServer(app: App): Promise<{ close: (cb: () => void) => void }> {
  const http = await import('node:http');

  const server = http.createServer((req, res) => {
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const headers = convertNodeHeaders(req.headers as Record<string, string | string[] | undefined>);

    const fetchRequest = new Request(`http://${req.headers.host}${req.url}`, {
      method: req.method,
      headers,
      ...(hasBody && ({ body: req, duplex: 'half' } as unknown as { body: ReadableStream })),
    });

    Promise.resolve(app.fetch(fetchRequest))
      .then(async (response: Response) => {
        res.writeHead(response.status, {
          ...Object.fromEntries(response.headers),
          'Content-Type': response.headers.get('Content-Type') || 'application/json',
        });
        res.end(response.body ? await response.text() : undefined);
      })
      .catch((error: Error) => {
        httpLog.error('Request error', { error: error.message, stack: error.stack });
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      });
  });

  server.listen(PORT, HOST);
  return server;
}

/**
 * Set up graceful shutdown handlers
 */
function setupShutdownHandlers(server: { close: (cb: () => void) => void }): void {
  let isShuttingDown = false;

  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    shutdownLog.info('Shutting down gracefully');

    const forceExitTimer = setTimeout(() => {
      shutdownLog.warn('Force exiting (timeout)');
      process.exit(1);
    }, 10000);
    forceExitTimer.unref();

    try {
      // Stop scheduler first
      shutdownLog.info('Stopping scheduler');
      stopScheduler();

      server.close(() => shutdownLog.info('HTTP server closed'));

      if (globalDispatcherCleanup) {
        shutdownLog.info('Stopping agent dispatcher');
        globalDispatcherCleanup();
      }

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
    globalDispatcherCleanup = await setupAgentResponder(eventBus, services);
  } catch (error) {
    log.error('Failed to set up agent dispatcher', { error: String(error) });
  }

  // Session cleaner (clears agent sessions on trash emoji)
  try {
    await setupSessionCleaner(eventBus, services);
  } catch (error) {
    log.error('Failed to set up session cleaner', { error: String(error) });
  }

  // Sync worker
  if (globalChannelRegistry) {
    try {
      await setupSyncWorker(eventBus, services, globalChannelRegistry, db);
    } catch (error) {
      log.error('Failed to set up sync worker', { error: String(error) });
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

  // Create database connection
  log.info('Connecting to database');
  const db = createDb({ url: DATABASE_URL });

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

  // Setup scheduler with services
  log.info('Starting scheduler');
  setupScheduler(services);

  // Start HTTP server
  const server = await startServer(app);

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
  setupShutdownHandlers(server);
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
