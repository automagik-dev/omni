/**
 * SDK Client singleton for UI
 *
 * Creates and manages the Omni SDK client instance for the *active* server in
 * the registry (see `@/lib/servers`). The singleton is keyed by the active
 * entry, so switching servers can never serve a cached client pointed at the
 * previous host or holding the previous key.
 */

import { type OmniClient, createOmniClient } from '@omni/sdk';
import {
  type ServerEntry,
  clearActiveApiKey,
  getActiveServer,
  listServers,
  resolveBaseUrl,
  setActiveApiKey,
  setActiveServerId,
} from './servers';

let client: OmniClient | null = null;
let clientSignature: string | null = null;

/** Identity of the connection a cached client was built for. */
function signatureOf(entry: ServerEntry, baseUrl: string): string {
  return `${entry.id}\u0000${baseUrl}\u0000${entry.apiKey ?? ''}`;
}

/**
 * Drop the cached client. The next `getClient()` rebuilds it from the active
 * registry entry.
 */
export function resetClient(): void {
  client = null;
  clientSignature = null;
}

/**
 * Get the API key of the active server
 */
export function getApiKey(): string | null {
  return getActiveServer()?.apiKey ?? null;
}

/**
 * Store the API key on the active server (creating the default entry if the
 * registry is still empty)
 */
export function setApiKey(apiKey: string): void {
  setActiveApiKey(apiKey);
  resetClient();
}

/**
 * Clear the API key of the active server and reset the client.
 * The server entry itself is retained.
 */
export function clearApiKey(): void {
  clearActiveApiKey();
  resetClient();
}

/**
 * Check if the user is authenticated (the active server has an API key)
 */
export function isAuthenticated(): boolean {
  return !!getApiKey();
}

/**
 * Base URL of the active server.
 *
 * For migrated / same-origin entries this resolves lazily:
 * in dev, Vite proxies /api to the API server; in prod the API serves the UI on
 * the same origin. The SDK appends /api/v2, so this is an origin only.
 */
export function getBaseUrl(): string {
  return resolveBaseUrl(getActiveServer());
}

/**
 * Switch the dashboard to another registered server.
 *
 * Resets the SDK singleton and clears the query cache so no data from the
 * previous server survives the switch — the same cache discipline as logout in
 * `useAuth`. `queryClient` is REQUIRED: an optional cache wipe is a cache wipe
 * that eventually gets forgotten at a call site, and the failure mode (one
 * server's chats rendered under another server's key) is silent.
 *
 * Unknown ids are a no-op: pointing the registry at an id it does not contain
 * would leave `getActiveServerId()` dangling, so a stale switcher entry or a
 * concurrent removal cannot desync the pointer from the registry.
 *
 * @returns `true` when the active server changed, `false` for an unknown id.
 */
export function switchServer(id: string, queryClient: { clear: () => void }): boolean {
  if (!listServers().some((server) => server.id === id)) {
    return false;
  }

  setActiveServerId(id);
  resetClient();
  queryClient.clear();
  return true;
}

/**
 * Get or create the Omni SDK client for the active server
 *
 * @throws Error if not authenticated
 */
export function getClient(): OmniClient {
  const entry = getActiveServer();
  if (!entry?.apiKey) {
    throw new Error('Not authenticated');
  }

  const baseUrl = resolveBaseUrl(entry);
  const signature = signatureOf(entry, baseUrl);

  if (!client || clientSignature !== signature) {
    client = createOmniClient({
      baseUrl,
      apiKey: entry.apiKey,
    });
    clientSignature = signature;
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
 * Make an authenticated API fetch call against the active server.
 * Used for endpoints not yet in the auto-generated SDK.
 */
export async function apiFetch(path: string, options?: RequestInit): Promise<Response> {
  const entry = getActiveServer();
  if (!entry?.apiKey) {
    throw new Error('Not authenticated');
  }

  const url = `${resolveBaseUrl(entry)}/api/v2${path}`;

  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': entry.apiKey,
      ...options?.headers,
    },
  });
}
