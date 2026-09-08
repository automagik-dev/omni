/// <reference types="bun" />
/**
 * Server registry unit tests.
 *
 * These run under `bun test`, where neither `localStorage` nor `window` exist,
 * so both are stubbed on `globalThis` per test.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { apiFetch, getApiKey, getBaseUrl, getClient, isAuthenticated, resetClient, switchServer } from '@/lib/sdk';
import {
  ACTIVE_SERVER_STORAGE_KEY,
  DEFAULT_SERVER_ID,
  SERVERS_STORAGE_KEY,
  type ServerEntry,
  addServer,
  clearActiveApiKey,
  getActiveApiKey,
  getActiveServer,
  getActiveServerId,
  listServers,
  removeServer,
  resolveBaseUrl,
  setActiveApiKey,
  updateServer,
} from '@/lib/servers';

const LEGACY_API_KEY_STORAGE_KEY = 'omni-api-key';

class FakeStorage implements Storage {
  private data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }
}

let storage: FakeStorage;

function setOrigin(origin: string): void {
  Object.defineProperty(globalThis, 'window', {
    value: { location: { origin } },
    configurable: true,
    writable: true,
  });
}

/** `switchServer` requires a cache to clear; most tests don't assert on it. */
function noopQueryClient(): { clear: () => void } {
  return { clear: () => undefined };
}

function seedRegistry(servers: ServerEntry[], activeId?: string): void {
  storage.setItem(SERVERS_STORAGE_KEY, JSON.stringify(servers));
  if (activeId) {
    storage.setItem(ACTIVE_SERVER_STORAGE_KEY, activeId);
  }
}

beforeEach(() => {
  storage = new FakeStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });
  setOrigin('https://omni.local');
  resetClient();
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage');
  Reflect.deleteProperty(globalThis, 'window');
  resetClient();
});

describe('legacy migration', () => {
  test('moves the legacy omni-api-key into a default entry on first read', () => {
    storage.setItem(LEGACY_API_KEY_STORAGE_KEY, 'omni_legacy_key');

    const servers = listServers();

    expect(servers).toEqual([{ id: DEFAULT_SERVER_ID, name: 'Default', baseUrl: null, apiKey: 'omni_legacy_key' }]);
    expect(getActiveServerId()).toBe(DEFAULT_SERVER_ID);
    expect(getActiveApiKey()).toBe('omni_legacy_key');
    expect(isAuthenticated()).toBe(true);
    // The legacy item is consumed, not left behind as a stray credential.
    expect(storage.getItem(LEGACY_API_KEY_STORAGE_KEY)).toBeNull();
  });

  test('creates an unauthenticated default entry when there is no legacy key', () => {
    const servers = listServers();

    expect(servers).toEqual([{ id: DEFAULT_SERVER_ID, name: 'Default', baseUrl: null, apiKey: null }]);
    expect(isAuthenticated()).toBe(false);
  });

  test('does not re-migrate once a registry exists', () => {
    seedRegistry([{ id: DEFAULT_SERVER_ID, name: 'Default', baseUrl: null, apiKey: null }], DEFAULT_SERVER_ID);
    storage.setItem(LEGACY_API_KEY_STORAGE_KEY, 'omni_stale_key');

    expect(getActiveApiKey()).toBeNull();
    expect(storage.getItem(LEGACY_API_KEY_STORAGE_KEY)).toBe('omni_stale_key');
  });
});

describe('same-origin sentinel', () => {
  test('resolves the migrated entry against the current origin at call time', () => {
    storage.setItem(LEGACY_API_KEY_STORAGE_KEY, 'omni_legacy_key');
    listServers();

    expect(getBaseUrl()).toBe('https://omni.local');

    // Host/port change (dev server moved, deployed behind another domain).
    setOrigin('http://localhost:5173');
    expect(getBaseUrl()).toBe('http://localhost:5173');
  });

  test('keeps the absolute URL of an explicitly added server', () => {
    listServers();
    const added = addServer({ name: 'Prod', baseUrl: 'https://api.example.com', apiKey: 'omni_prod' });

    expect(resolveBaseUrl(added)).toBe('https://api.example.com');
    setOrigin('http://localhost:5173');
    expect(resolveBaseUrl(added)).toBe('https://api.example.com');
  });

  test('falls back to an empty base URL when there is no window', () => {
    Reflect.deleteProperty(globalThis, 'window');

    expect(resolveBaseUrl(null)).toBe('');
  });
});

describe('corrupt localStorage', () => {
  test('falls back to an empty registry when the payload is not JSON', () => {
    storage.setItem(SERVERS_STORAGE_KEY, '{not json');

    expect(listServers()).toEqual([]);
    expect(getActiveServer()).toBeNull();
    // No active server -> ProtectedRoute sends the user to /login.
    expect(isAuthenticated()).toBe(false);
  });

  test('falls back to an empty registry when the payload fails schema validation', () => {
    storage.setItem(SERVERS_STORAGE_KEY, JSON.stringify([{ id: 'x', name: 'X', baseUrl: 'not-a-url', apiKey: null }]));

    expect(listServers()).toEqual([]);
    expect(isAuthenticated()).toBe(false);
  });

  test('recovers by recreating the default entry when a key is stored after corruption', () => {
    storage.setItem(SERVERS_STORAGE_KEY, '[[[');

    setActiveApiKey('omni_recovered');

    expect(listServers()).toEqual([
      { id: DEFAULT_SERVER_ID, name: 'Default', baseUrl: null, apiKey: 'omni_recovered' },
    ]);
    expect(isAuthenticated()).toBe(true);
  });
});

describe('registry CRUD', () => {
  test('logout clears only the active key and keeps the entry', () => {
    storage.setItem(LEGACY_API_KEY_STORAGE_KEY, 'omni_legacy_key');
    listServers();

    clearActiveApiKey();

    expect(listServers()).toEqual([{ id: DEFAULT_SERVER_ID, name: 'Default', baseUrl: null, apiKey: null }]);
    expect(isAuthenticated()).toBe(false);
  });

  test('update and remove keep the active pointer coherent', () => {
    listServers();
    const staging = addServer({ name: 'Staging', baseUrl: 'https://staging.example.com' });

    expect(updateServer(staging.id, { name: 'Staging 2' })?.name).toBe('Staging 2');
    expect(updateServer('missing', { name: 'nope' })).toBeNull();

    switchServer(staging.id, noopQueryClient());
    expect(getActiveServerId()).toBe(staging.id);

    removeServer(staging.id);
    expect(listServers().map((s) => s.id)).toEqual([DEFAULT_SERVER_ID]);
    // Pointer moved off the deleted entry instead of dangling.
    expect(getActiveServer()?.id).toBe(DEFAULT_SERVER_ID);
  });

  test('removing the last entry clears the active pointer instead of dangling it', () => {
    seedRegistry([{ id: 'only', name: 'Only', baseUrl: 'https://only.example.com', apiKey: 'omni_only' }], 'only');

    removeServer('only');

    expect(listServers()).toEqual([]);
    // The pointer is *removed*, not left pointing at a deleted entry: a stale
    // id would survive the next server being added under a different id.
    expect(storage.getItem(ACTIVE_SERVER_STORAGE_KEY)).toBeNull();
    expect(getActiveServerId()).toBeNull();
    expect(getActiveServer()).toBeNull();
    expect(isAuthenticated()).toBe(false);
  });

  test('addServer still mints an id without crypto.randomUUID (insecure context)', () => {
    // Plain-http dashboards (http://<remote-ip>) are not secure contexts, so
    // `crypto.randomUUID` is undefined there.
    // `randomUUID` lives on Crypto.prototype, so shadow it with an own
    // undefined property rather than deleting it.
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    try {
      listServers();
      const added = addServer({ name: 'Remote', baseUrl: 'http://10.0.0.5:8080' });

      expect(added.id).toMatch(/^srv_/);
      expect(listServers().map((s) => s.id)).toEqual([DEFAULT_SERVER_ID, added.id]);
      // The minted id is a usable registry key, not just a non-empty string.
      switchServer(added.id, noopQueryClient());
      expect(getActiveServer()?.id).toBe(added.id);
    } finally {
      // Dropping the shadow re-exposes the prototype implementation.
      Reflect.deleteProperty(globalThis.crypto, 'randomUUID');
    }
  });
});

describe('switchServer', () => {
  test('swaps baseUrl + key, resets the SDK singleton and clears the query cache', () => {
    seedRegistry(
      [
        { id: 'a', name: 'A', baseUrl: 'https://a.example.com', apiKey: 'omni_a' },
        { id: 'b', name: 'B', baseUrl: 'https://b.example.com', apiKey: 'omni_b' },
      ],
      'a',
    );

    const clientA = getClient();
    expect(getBaseUrl()).toBe('https://a.example.com');
    expect(getApiKey()).toBe('omni_a');
    expect(getClient()).toBe(clientA); // cached while the active entry is unchanged

    let cleared = 0;
    switchServer('b', { clear: () => cleared++ });

    expect(cleared).toBe(1);
    expect(getActiveServerId()).toBe('b');
    expect(getBaseUrl()).toBe('https://b.example.com');
    expect(getApiKey()).toBe('omni_b');
    expect(getClient()).not.toBe(clientA);
  });

  test('apiFetch targets the newly active server with its own key', async () => {
    seedRegistry(
      [
        { id: 'a', name: 'A', baseUrl: 'https://a.example.com', apiKey: 'omni_a' },
        { id: 'b', name: 'B', baseUrl: 'https://b.example.com', apiKey: 'omni_b' },
      ],
      'a',
    );

    const calls: Array<{ url: string; apiKey: string | undefined }> = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(input), apiKey: headers.get('x-api-key') ?? undefined });
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    try {
      await apiFetch('/persons/link', { method: 'POST' });
      switchServer('b', noopQueryClient());
      await apiFetch('/persons/link', { method: 'POST' });
    } finally {
      globalThis.fetch = realFetch;
    }

    expect(calls).toEqual([
      { url: 'https://a.example.com/api/v2/persons/link', apiKey: 'omni_a' },
      { url: 'https://b.example.com/api/v2/persons/link', apiKey: 'omni_b' },
    ]);
  });

  test('getClient throws when the active server has no key', () => {
    seedRegistry([{ id: 'a', name: 'A', baseUrl: 'https://a.example.com', apiKey: null }], 'a');

    expect(() => getClient()).toThrow('Not authenticated');
    expect(isAuthenticated()).toBe(false);
  });

  test('is a no-op for an id that is not in the registry', () => {
    seedRegistry(
      [
        { id: 'a', name: 'A', baseUrl: 'https://a.example.com', apiKey: 'omni_a' },
        { id: 'b', name: 'B', baseUrl: 'https://b.example.com', apiKey: 'omni_b' },
      ],
      'a',
    );

    const clientA = getClient();
    let cleared = 0;

    // A stale switcher entry, or an entry another tab just removed.
    expect(switchServer('ghost', { clear: () => cleared++ })).toBe(false);

    // Nothing moved: pointer, client and cache are all untouched.
    expect(cleared).toBe(0);
    expect(getActiveServerId()).toBe('a');
    expect(getBaseUrl()).toBe('https://a.example.com');
    expect(getClient()).toBe(clientA);

    expect(switchServer('b', { clear: () => cleared++ })).toBe(true);
    expect(cleared).toBe(1);
  });
});

describe('dangling active pointer', () => {
  test('persists the fallback so the pointer and the resolved server agree', () => {
    seedRegistry(
      [
        { id: 'a', name: 'A', baseUrl: 'https://a.example.com', apiKey: 'omni_a' },
        { id: 'b', name: 'B', baseUrl: 'https://b.example.com', apiKey: 'omni_b' },
      ],
      // Points at an entry that no longer exists (removed in another tab).
      'gone',
    );

    expect(getActiveServer()?.id).toBe('a');
    // The correction is written back, so every later reader — including a
    // switcher rendering its checkmark from the id — sees the same server.
    expect(getActiveServerId()).toBe('a');
    expect(storage.getItem(ACTIVE_SERVER_STORAGE_KEY)).toBe('a');
    expect(getBaseUrl()).toBe('https://a.example.com');
  });

  test('leaves no pointer behind when the registry is empty', () => {
    seedRegistry([], 'gone');

    expect(getActiveServer()).toBeNull();
    // Nothing to fall back to: the pointer is left alone and the app redirects.
    expect(getActiveServerId()).toBe('gone');
    expect(isAuthenticated()).toBe(false);
  });
});
