/**
 * @omni/api - HTTP API Server
 *
 * Entry point for the Omni v2 API server.
 * Uses Node.js HTTP server (required for Baileys WebSocket compatibility).
 */

import type { ChannelRegistry } from '@omni/channel-sdk';
import { type EventBus, connectEventBus } from '@omni/core';
import type { Database } from '@omni/db';
import { createDb, getDefaultDatabaseUrl } from '@omni/db';
import { type App, createApp } from './app';
import {
  InstanceMonitor,
  loadChannelPlugins,
  reconnectWithPool,
  setupConnectionListener,
  setupMessageListener,
  setupQrCodeListener,
} from './plugins';

// Configuration
const PORT = Number.parseInt(process.env.API_PORT ?? '8881', 10);
const HOST = process.env.API_HOST ?? '0.0.0.0';
const DATABASE_URL = process.env.DATABASE_URL ?? getDefaultDatabaseUrl();
const NATS_URL = process.env.NATS_URL ?? 'nats://localhost:4222';

// Global references for plugin system
let globalEventBus: EventBus | null = null;
let globalChannelRegistry: ChannelRegistry | null = null;
let globalInstanceMonitor: InstanceMonitor | null = null;

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
    console.log(`Connecting to NATS at ${NATS_URL}...`);
    const eventBus = await connectEventBus({
      url: NATS_URL,
      serviceName: 'omni-api',
    });
    globalEventBus = eventBus;
    console.log('Connected to NATS');

    // Set up event listeners
    await setupQrCodeListener(eventBus);
    await setupConnectionListener(eventBus, db);
    await setupMessageListener(eventBus);

    return eventBus;
  } catch (error) {
    console.warn('Failed to connect to NATS, running without event bus:', error);
    console.warn('Channel plugins will not be able to publish events');
    return null;
  }
}

/**
 * Load channel plugins and reconnect active instances
 */
async function initializeChannelPlugins(db: Database, eventBus: EventBus): Promise<void> {
  console.log('Loading channel plugins...');
  const result = await loadChannelPlugins({ eventBus, db });
  globalChannelRegistry = result.registry;

  if (result.loaded > 0) {
    console.log(`Loaded ${result.loaded} channel plugin(s): ${result.pluginIds.join(', ')}`);
  } else {
    console.warn('No channel plugins were loaded');
    return;
  }

  if (result.failed > 0) {
    console.warn(`${result.failed} channel plugin(s) failed to load`);
  }

  // Auto-reconnect previously active instances
  console.log('Auto-reconnecting active instances...');
  const reconnectResult = await reconnectWithPool(db, result.registry, {
    maxConcurrent: 3,
    delayBetweenMs: 500,
  });

  if (reconnectResult.attempted > 0) {
    const failedMsg = reconnectResult.failed > 0 ? ` (${reconnectResult.failed} failed)` : '';
    console.log(`Reconnected ${reconnectResult.succeeded}/${reconnectResult.attempted} instances${failedMsg}`);
  }

  // Start instance monitor
  globalInstanceMonitor = new InstanceMonitor(db, result.registry, {
    healthCheckIntervalMs: 30_000,
    maxConcurrentReconnects: 3,
    autoReconnect: true,
  });
  globalInstanceMonitor.start();
  console.log('Instance monitor started');
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
async function startServer(app: App): Promise<void> {
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
        console.error('Request error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      });
  });

  server.listen(PORT, HOST);
  setupShutdownHandlers(server);
}

/**
 * Set up graceful shutdown handlers
 */
function setupShutdownHandlers(server: { close: (cb: () => void) => void }): void {
  let isShuttingDown = false;

  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log('\nShutting down gracefully...');

    const forceExitTimer = setTimeout(() => {
      console.log('Force exiting (timeout)...');
      process.exit(1);
    }, 10000);
    forceExitTimer.unref();

    try {
      server.close(() => console.log('[Shutdown] HTTP server closed'));

      if (globalInstanceMonitor) {
        console.log('[Shutdown] Stopping instance monitor...');
        globalInstanceMonitor.stop();
      }

      if (globalChannelRegistry) {
        console.log('[Shutdown] Disconnecting all channel instances...');
        await globalChannelRegistry.destroyAll();
      }

      if (globalEventBus) {
        console.log('[Shutdown] Closing NATS connection...');
        await globalEventBus.close();
      }

      console.log('[Shutdown] Graceful shutdown complete');
      clearTimeout(forceExitTimer);
      process.exit(0);
    } catch (error) {
      console.error('[Shutdown] Error during graceful shutdown:', error);
      process.exit(1);
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

/**
 * Main entry point
 */
async function main() {
  console.log('Starting Omni API v2...');

  // Create database connection
  console.log('Connecting to database...');
  const db = createDb({ url: DATABASE_URL });

  // Connect to NATS
  const eventBus = await connectToNats(db);

  // Load channel plugins (if NATS is available)
  if (eventBus) {
    try {
      await initializeChannelPlugins(db, eventBus);
    } catch (error) {
      console.error('Failed to load channel plugins:', error);
    }
  } else {
    console.warn('Skipping channel plugin loading (no event bus)');
  }

  // Create and start server
  const app = createApp(db, eventBus, globalChannelRegistry);
  console.log(`API server listening on http://${HOST}:${PORT}`);
  console.log(`Health check: http://${HOST}:${PORT}/api/v2/health`);

  await startServer(app);
}

// Run
main().catch((error) => {
  console.error('Failed to start API server:', error);
  process.exit(1);
});

// Re-exports for library usage
export { createApp } from './app';
export type { App } from './app';
export type { AppVariables, ApiKeyData, HealthResponse, PaginatedResponse } from './types';
export { createServices, type Services } from './services';
