/**
 * Server registry
 *
 * The dashboard can talk to more than one Omni API. Every known server lives in
 * a localStorage-backed registry (`omni-servers`) and a pointer (`omni-active-server`)
 * selects the one the SDK client currently resolves from.
 *
 * This module is the ONLY place allowed to read the legacy `omni-api-key` item:
 * the first read of the registry lazily migrates it into a `default` entry.
 *
 * Every read and write is validated with Zod. A corrupt payload degrades to an
 * empty registry (no active server -> the app redirects to /login) instead of
 * throwing somewhere deep in a render.
 */

import { z } from 'zod';

export const SERVERS_STORAGE_KEY = 'omni-servers';
export const ACTIVE_SERVER_STORAGE_KEY = 'omni-active-server';
/** Legacy single-server key. Read once during migration, then removed. */
const LEGACY_API_KEY_STORAGE_KEY = 'omni-api-key';

export const DEFAULT_SERVER_ID = 'default';
const DEFAULT_SERVER_NAME = 'Default';

/**
 * A registered server.
 *
 * `baseUrl: null` is the same-origin sentinel: the URL is resolved at call time
 * from `VITE_API_URL` / `window.location.origin` so the entry keeps working when
 * the dashboard is served from a different host or port. Only explicitly added
 * servers store an absolute URL.
 */
export const ServerEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  baseUrl: z.string().url().nullable(),
  apiKey: z.string().nullable(),
});

export type ServerEntry = z.infer<typeof ServerEntrySchema>;

export const ServerRegistrySchema = z.array(ServerEntrySchema);

export type ServerRegistry = z.infer<typeof ServerRegistrySchema>;

/**
 * localStorage is absent outside the browser (SSR, unit tests). Callers get a
 * null store and the registry behaves as if it were empty.
 */
function getStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve the effective base URL for an entry.
 *
 * The same-origin sentinel is resolved lazily, on every call, so a migrated
 * entry survives a host or port change.
 */
export function resolveBaseUrl(entry: ServerEntry | null): string {
  if (entry?.baseUrl) {
    return entry.baseUrl;
  }
  return import.meta.env.VITE_API_URL || globalThis.window?.location.origin || '';
}

/**
 * Registry-local id. `crypto.randomUUID` is undefined outside secure contexts,
 * which is exactly where these dashboards run (plain-http remote IPs), so fall
 * back to a time-and-random string. These ids key local storage entries only —
 * they are not security tokens and need no cryptographic strength.
 */
function newServerId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `srv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  );
}

function writeRegistry(servers: ServerRegistry): ServerRegistry {
  const parsed = ServerRegistrySchema.parse(servers);
  getStorage()?.setItem(SERVERS_STORAGE_KEY, JSON.stringify(parsed));
  return parsed;
}

/**
 * Build the `default` entry from the legacy single-key setup. Runs once: the
 * legacy item is dropped as soon as the registry is written.
 */
function migrateLegacyKey(storage: Storage): ServerRegistry {
  const legacyKey = storage.getItem(LEGACY_API_KEY_STORAGE_KEY);
  const migrated = writeRegistry([
    {
      id: DEFAULT_SERVER_ID,
      name: DEFAULT_SERVER_NAME,
      // Same-origin sentinel: never freeze the origin at migration time.
      baseUrl: null,
      apiKey: legacyKey,
    },
  ]);
  storage.setItem(ACTIVE_SERVER_STORAGE_KEY, DEFAULT_SERVER_ID);
  storage.removeItem(LEGACY_API_KEY_STORAGE_KEY);
  return migrated;
}

/**
 * All registered servers.
 *
 * Migrates the legacy key when no registry exists yet. Returns an empty
 * registry when the stored payload is missing, unparseable, or fails schema
 * validation.
 */
export function listServers(): ServerRegistry {
  const storage = getStorage();
  if (!storage) {
    return [];
  }

  const raw = storage.getItem(SERVERS_STORAGE_KEY);
  if (raw === null) {
    return migrateLegacyKey(storage);
  }

  try {
    const result = ServerRegistrySchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}

export function getActiveServerId(): string | null {
  return getStorage()?.getItem(ACTIVE_SERVER_STORAGE_KEY) ?? null;
}

/**
 * The active server, or `null` when the registry is empty.
 *
 * Falls back to the first entry when the pointer is missing or dangling, so a
 * stale pointer never locks the dashboard out of a registry that has servers.
 * The correction is *persisted*: otherwise `getActiveServerId()` would keep
 * reporting the dangling id while `getActiveServer()` served another entry, and
 * a switcher rendering the checked item from the id would disagree with the
 * server the SDK actually talks to.
 */
export function getActiveServer(): ServerEntry | null {
  const servers = listServers();
  if (servers.length === 0) {
    return null;
  }

  const activeId = getActiveServerId();
  const active = servers.find((server) => server.id === activeId);
  if (active) {
    return active;
  }

  const fallback = servers[0] ?? null;
  if (fallback) {
    setActiveServerId(fallback.id);
  }
  return fallback;
}

export function setActiveServerId(id: string): void {
  getStorage()?.setItem(ACTIVE_SERVER_STORAGE_KEY, id);
}

export function addServer(input: { name: string; baseUrl: string; apiKey?: string | null }): ServerEntry {
  const entry = ServerEntrySchema.parse({
    id: newServerId(),
    name: input.name,
    baseUrl: input.baseUrl,
    apiKey: input.apiKey ?? null,
  });
  writeRegistry([...listServers(), entry]);
  return entry;
}

export function updateServer(id: string, patch: Partial<Omit<ServerEntry, 'id'>>): ServerEntry | null {
  const servers = listServers();
  const existing = servers.find((server) => server.id === id);
  if (!existing) {
    return null;
  }

  const updated = ServerEntrySchema.parse({ ...existing, ...patch, id });
  writeRegistry(servers.map((server) => (server.id === id ? updated : server)));
  return updated;
}

/**
 * Remove an entry from the registry.
 *
 * When the removed entry was the active one, the pointer is moved to the first
 * remaining server (or cleared when none remain). That move happens *inside*
 * storage only — unlike `switchServer`, which takes a query client precisely so
 * that no pointer change can land without the SDK singleton and the cache being
 * dropped with it.
 *
 * Callers that observe an active-pointer change here MUST therefore reset the
 * SDK client and clear the query cache themselves, or the dashboard will keep
 * serving the removed server's client and its cached data under the new
 * pointer. See `ServerSwitcher.tsx` (`resetClient()` + `queryClient.clear()`
 * right after the `removeServer` call) for the canonical handling.
 */
export function removeServer(id: string): void {
  const remaining = listServers().filter((server) => server.id !== id);
  writeRegistry(remaining);

  if (getActiveServerId() === id) {
    const next = remaining[0];
    if (next) {
      setActiveServerId(next.id);
    } else {
      getStorage()?.removeItem(ACTIVE_SERVER_STORAGE_KEY);
    }
  }
}

/** API key of the active server, if any. */
export function getActiveApiKey(): string | null {
  return getActiveServer()?.apiKey ?? null;
}

/**
 * Store a validated key on the active server.
 *
 * When the registry is empty (fresh install, or recovery from a corrupt
 * payload) the default same-origin entry is created on the spot.
 */
export function setActiveApiKey(apiKey: string): ServerEntry {
  const servers = listServers();
  const active = getActiveServer();

  if (!active) {
    const entry = ServerEntrySchema.parse({
      id: DEFAULT_SERVER_ID,
      name: DEFAULT_SERVER_NAME,
      baseUrl: null,
      apiKey,
    });
    writeRegistry([entry]);
    setActiveServerId(entry.id);
    return entry;
  }

  const updated: ServerEntry = { ...active, apiKey };
  writeRegistry(servers.map((server) => (server.id === active.id ? updated : server)));
  return updated;
}

/** Log out of the active server: the entry is kept, only its key is dropped. */
export function clearActiveApiKey(): void {
  const active = getActiveServer();
  if (!active) {
    return;
  }
  writeRegistry(listServers().map((server) => (server.id === active.id ? { ...server, apiKey: null } : server)));
}
