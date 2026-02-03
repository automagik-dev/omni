/**
 * CLI Client Helper
 *
 * Creates SDK client from config and handles auth errors.
 */

import { type OmniClient, createOmniClient } from '@omni/sdk';
import { hasAuth, loadConfig } from './config.js';
import * as output from './output.js';

/** Cached client instance */
let cachedClient: OmniClient | null = null;

/**
 * Get an authenticated SDK client.
 * Exits with error if not authenticated.
 */
export function getClient(): OmniClient {
  if (cachedClient) {
    return cachedClient;
  }

  if (!hasAuth()) {
    output.error('Not authenticated. Run: omni auth login --api-key <key>', undefined, 2);
  }

  const config = loadConfig();

  // hasAuth() already verified apiKey exists, but we check again for type safety
  if (!config.apiKey) {
    output.error('API key not configured', undefined, 2);
  }

  cachedClient = createOmniClient({
    baseUrl: config.apiUrl ?? 'http://localhost:8881',
    apiKey: config.apiKey,
  });

  return cachedClient;
}

/**
 * Get an optional client (doesn't require auth).
 * Returns null if not authenticated.
 */
export function getOptionalClient(): OmniClient | null {
  if (cachedClient) {
    return cachedClient;
  }

  if (!hasAuth()) {
    return null;
  }

  const config = loadConfig();

  // hasAuth() already verified apiKey exists
  if (!config.apiKey) {
    return null;
  }

  cachedClient = createOmniClient({
    baseUrl: config.apiUrl ?? 'http://localhost:8881',
    apiKey: config.apiKey,
  });

  return cachedClient;
}

/**
 * Clear cached client (for testing or re-auth).
 */
export function clearClientCache(): void {
  cachedClient = null;
}
