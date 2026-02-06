/**
 * SDK Client singleton for UI
 *
 * Creates and manages the Omni SDK client instance.
 */

import { type OmniClient, createOmniClient } from '@omni/sdk';

let client: OmniClient | null = null;

const API_KEY_STORAGE_KEY = 'omni-api-key';

/**
 * Get the API key from storage
 */
export function getApiKey(): string | null {
  return localStorage.getItem(API_KEY_STORAGE_KEY);
}

/**
 * Set the API key in storage
 */
export function setApiKey(apiKey: string): void {
  localStorage.setItem(API_KEY_STORAGE_KEY, apiKey);
  client = null; // Reset client to recreate with new key
}

/**
 * Clear the API key and reset the client
 */
export function clearApiKey(): void {
  localStorage.removeItem(API_KEY_STORAGE_KEY);
  client = null;
}

/**
 * Check if the user is authenticated (has an API key)
 */
export function isAuthenticated(): boolean {
  return !!getApiKey();
}

/**
 * Get or create the Omni SDK client
 *
 * @throws Error if not authenticated
 */
export function getClient(): OmniClient {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('Not authenticated');
  }

  if (!client) {
    // In dev, Vite proxies /api to the API server (localhost:5173/api -> localhost:8882/api)
    // In prod, the API serves the UI and /api/v2 is on the same origin
    // SDK appends /api/v2 to baseUrl, so baseUrl should be origin only (empty for same-origin)
    // Using window.location.origin as fallback since SDK requires non-empty baseUrl
    const baseUrl = import.meta.env.VITE_API_URL || window.location.origin;

    client = createOmniClient({
      baseUrl,
      apiKey,
    });
  }

  return client;
}

/**
 * Get the client or null if not authenticated
 */
export function getClientOrNull(): OmniClient | null {
  try {
    return getClient();
  } catch {
    return null;
  }
}

/**
 * Make an authenticated API fetch call.
 * Used for endpoints not yet in the auto-generated SDK.
 */
export async function apiFetch(path: string, options?: RequestInit): Promise<Response> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('Not authenticated');
  }

  const baseUrl = import.meta.env.VITE_API_URL || window.location.origin;
  const url = `${baseUrl}/api/v2${path}`;

  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      ...options?.headers,
    },
  });
}
