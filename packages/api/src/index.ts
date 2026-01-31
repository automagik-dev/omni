/**
 * @omni/api - HTTP API Server
 *
 * Entry point for the Omni v2 API server.
 * Supports both Bun and Node.js runtimes.
 */

import type { ChannelRegistry } from '@omni/channel-sdk';
import { type EventBus, connectEventBus } from '@omni/core';
import { createDb, getDefaultDatabaseUrl } from '@omni/db';
import { createApp } from './app';
import {
  InstanceMonitor,
  loadChannelPlugins,
  reconnectWithPool,
  setupConnectionListener,
  setupMessageListener,
  setupQrCodeListener,
} from './plugins';

// Runtime detection
const isBun = typeof Bun !== 'undefined';

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

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Main bootstrap function, complexity is inherent
async function main() {
  console.log('Starting Omni API v2...');

  // Create database connection
  console.log('Connecting to database...');
  const db = createDb({ url: DATABASE_URL });

  // Connect to NATS event bus
  let eventBus: EventBus | null = null;
  try {
    console.log(`Connecting to NATS at ${NATS_URL}...`);
    eventBus = await connectEventBus({
      url: NATS_URL,
      serviceName: 'omni-api',
    });
    globalEventBus = eventBus;
    console.log('Connected to NATS');

    // Set up QR code, connection, and message listeners
    await setupQrCodeListener(eventBus);
    await setupConnectionListener(eventBus, db);
    await setupMessageListener(eventBus);
  } catch (error) {
    console.warn('Failed to connect to NATS, running without event bus:', error);
    console.warn('Channel plugins will not be able to publish events');
  }

  // Load channel plugins
  if (eventBus) {
    try {
      console.log('Loading channel plugins...');
      const result = await loadChannelPlugins({
        eventBus,
        db,
      });
      globalChannelRegistry = result.registry;

      if (result.loaded > 0) {
        console.log(`Loaded ${result.loaded} channel plugin(s): ${result.pluginIds.join(', ')}`);
      } else {
        console.warn('No channel plugins were loaded');
      }

      if (result.failed > 0) {
        console.warn(`${result.failed} channel plugin(s) failed to load`);
      }

      // Auto-reconnect previously active instances with connection pooling
      if (result.loaded > 0) {
        console.log('Auto-reconnecting active instances...');
        const reconnectResult = await reconnectWithPool(db, result.registry, {
          maxConcurrent: 3,
          delayBetweenMs: 500,
        });
        if (reconnectResult.attempted > 0) {
          console.log(
            `Reconnected ${reconnectResult.succeeded}/${reconnectResult.attempted} instances${reconnectResult.failed > 0 ? ` (${reconnectResult.failed} failed)` : ''}`,
          );
        }

        // Start instance monitor for health checks and auto-reconnection
        globalInstanceMonitor = new InstanceMonitor(db, result.registry, {
          healthCheckIntervalMs: 30_000, // Check every 30 seconds
          maxConcurrentReconnects: 3,
          autoReconnect: true,
        });
        globalInstanceMonitor.start();
        console.log('Instance monitor started');
      }
    } catch (error) {
      console.error('Failed to load channel plugins:', error);
    }
  } else {
    console.warn('Skipping channel plugin loading (no event bus)');
  }

  // Create app
  const app = createApp(db, eventBus, globalChannelRegistry);

  // Start server
  console.log(`API server listening on http://${HOST}:${PORT}`);
  console.log(`Health check: http://${HOST}:${PORT}/api/v2/health`);

  if (isBun) {
    // Use Bun's native server
    Bun.serve({
      port: PORT,
      hostname: HOST,
      fetch: app.fetch,
      idleTimeout: 120,
    });
  } else {
    // Use Node.js HTTP server
    const http = await import('node:http');
    const server = http.createServer((req, res) => {
      // Wrap Node.js request/response in Hono's interface
      const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') {
          headers[key] = value;
        } else if (Array.isArray(value)) {
          headers[key] = value.join(', ');
        }
      }
      const fetchRequest = new Request(`http://${req.headers.host}${req.url}`, {
        method: req.method,
        headers,
        ...(hasBody && ({ body: req, duplex: 'half' } as unknown as { body: ReadableStream })),
      });

      return Promise.resolve(app.fetch(fetchRequest))
        .then(async (response: Response) => {
          res.writeHead(response.status, {
            ...Object.fromEntries(response.headers),
            'Content-Type': response.headers.get('Content-Type') || 'application/json',
          });
          if (response.body) {
            res.end(await response.text());
          } else {
            res.end();
          }
        })
        .catch((error: Error) => {
          console.error('Request error:', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
        });
    });

    server.listen(PORT, HOST, () => {
      // Server started
    });

    // Handle graceful shutdown
    let isShuttingDown = false;
    const shutdown = async () => {
      if (isShuttingDown) return;
      isShuttingDown = true;

      console.log('\nShutting down gracefully...');

      // Force exit after 10 seconds if graceful shutdown fails
      const forceExitTimer = setTimeout(() => {
        console.log('Force exiting (timeout)...');
        process.exit(1);
      }, 10000);
      forceExitTimer.unref();

      try {
        // 1. Stop accepting new connections
        server.close(() => {
          console.log('[Shutdown] HTTP server closed');
        });

        // 2. Stop instance monitor (prevents reconnection attempts during shutdown)
        if (globalInstanceMonitor) {
          console.log('[Shutdown] Stopping instance monitor...');
          globalInstanceMonitor.stop();
          console.log('[Shutdown] Instance monitor stopped');
        }

        // 3. Disconnect all WhatsApp instances and destroy plugins
        if (globalChannelRegistry) {
          console.log('[Shutdown] Disconnecting all channel instances...');
          await globalChannelRegistry.destroyAll();
          console.log('[Shutdown] All channel plugins destroyed');
        }

        // 4. Close NATS event bus (drains subscriptions)
        if (globalEventBus) {
          console.log('[Shutdown] Closing NATS connection...');
          await globalEventBus.close();
          console.log('[Shutdown] NATS connection closed');
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
