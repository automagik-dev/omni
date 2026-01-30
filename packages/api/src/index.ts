/**
 * @omni/api - HTTP API Server
 *
 * Entry point for the Omni v2 API server.
 */

import { createDb, getDefaultDatabaseUrl } from '@omni/db';
import { createApp } from './app';

// Configuration
const PORT = Number.parseInt(process.env.API_PORT ?? '8881', 10);
const HOST = process.env.API_HOST ?? '0.0.0.0';
const DATABASE_URL = process.env.DATABASE_URL ?? getDefaultDatabaseUrl();

async function main() {
  console.log('Starting Omni API v2...');

  // Create database connection
  console.log('Connecting to database...');
  const db = createDb({ url: DATABASE_URL });

  // Create event bus (null for now, will be implemented with NATS)
  const eventBus = null;

  // Create app
  const app = createApp(db, eventBus);

  // Start server
  console.log(`API server listening on http://${HOST}:${PORT}`);
  console.log(`Health check: http://${HOST}:${PORT}/api/v2/health`);

  Bun.serve({
    port: PORT,
    hostname: HOST,
    fetch: app.fetch,
    idleTimeout: 120,
  });
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
