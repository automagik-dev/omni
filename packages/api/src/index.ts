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
import { loadChannelPlugins, setupConnectionListener, setupMessageListener, setupQrCodeListener } from './plugins';

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
    await setupConnectionListener(eventBus);
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
    const http = await import('http');
    const server = http.createServer(
      (req: any, res: any) => {
        // Wrap Node.js request/response in Hono's interface
        const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
        const fetchRequest = new Request(`http://${req.headers.host}${req.url}`, {
          method: req.method,
          headers: req.headers,
          ...(hasBody && { body: req, duplex: 'half' } as any),
        });

        return app.fetch(fetchRequest)
          .then(async (response) => {
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
          .catch((error) => {
            console.error('Request error:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal server error' }));
          });
      }
    );

    server.listen(PORT, HOST, () => {
      // Server started
    });

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('\nShutting down gracefully...');
      server.close(() => {
        process.exit(0);
      });
    });

    process.on('SIGTERM', () => {
      console.log('\nShutting down gracefully...');
      server.close(() => {
        process.exit(0);
      });
    });
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
