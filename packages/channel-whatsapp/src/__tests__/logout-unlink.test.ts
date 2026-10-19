/**
 * #1275 — an explicit logout must unlink the device on WhatsApp's side, not
 * only forget the credentials locally. `DELETE /instances/:id` disconnects
 * before it logs out, so the stored-session path (no live socket) matters as
 * much as the live one.
 */

import { afterEach, describe, expect, it, mock } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { PluginStorage } from '@omni/channel-sdk';

// Keep the real exports: `mock.module` is process-wide, so the fakes below
// only take over while a test sets `fakeSocketFactory`.
const realBaileys = await import('baileys');
const realMakeWASocket = realBaileys.default;
const realFetchLatestBaileysVersion = realBaileys.fetchLatestBaileysVersion;

type SocketOptions = { auth: { creds: { me?: { id: string } }; keys: unknown } };
let fakeSocketFactory: ((options: SocketOptions) => FakeSocket) | null = null;

mock.module('baileys', () => ({
  ...realBaileys,
  default: (options: SocketOptions) =>
    fakeSocketFactory
      ? fakeSocketFactory(options)
      : realMakeWASocket(options as unknown as Parameters<typeof realMakeWASocket>[0]),
  fetchLatestBaileysVersion: async () =>
    fakeSocketFactory ? { version: [2, 3000, 0], isLatest: true } : realFetchLatestBaileysVersion(),
}));

const { WhatsAppPlugin } = await import('../plugin');
const { logoutStoredSession } = await import('../socket');

const ID = 'wa-1275';
const CREDS_KEY = `auth:${ID}:creds`;
const SESSION_KEY = `auth:${ID}:keys:session:5511999999999.0`;

class MemoryStorage implements PluginStorage {
  readonly data = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | null> {
    return (this.data.get(key) as T) ?? null;
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value);
  }
  async delete(key: string): Promise<boolean> {
    return this.data.delete(key);
  }
  async has(key: string): Promise<boolean> {
    return this.data.has(key);
  }
  async keys(pattern?: string): Promise<string[]> {
    const prefix = pattern?.replace(/\*$/, '') ?? '';
    return [...this.data.keys()].filter((key) => key.startsWith(prefix));
  }
}

/** Minimal WASocket: `logout()` and `end()` are what the plugin calls. */
class FakeSocket {
  readonly ev = new EventEmitter();
  readonly logout = mock(async () => {});
  readonly end = mock((_error?: Error) => {});
  constructor(readonly options?: SocketOptions) {}
}

function pairedStorage(): MemoryStorage {
  const storage = new MemoryStorage();
  storage.data.set(CREDS_KEY, { me: { id: '5511999999999:7@s.whatsapp.net' }, registered: true });
  storage.data.set(SESSION_KEY, '{"stored":true}');
  return storage;
}

function makePlugin(storage: PluginStorage) {
  const plugin = new WhatsAppPlugin();
  const internals = plugin as unknown as {
    storage: PluginStorage;
    eventBus: { publish: (...args: unknown[]) => Promise<unknown> };
    sockets: Map<string, unknown>;
    logger: Record<'debug' | 'info' | 'warn' | 'error', (...args: unknown[]) => void>;
  };
  internals.storage = storage;
  internals.logger = { debug: () => {}, info: () => {}, warn: mock(() => {}), error: () => {} };
  internals.eventBus = { publish: mock(async () => ({ id: 'evt', sequence: 1, stream: 'test' })) };
  return { plugin, sockets: internals.sockets, logger: internals.logger };
}

/** Fake Baileys socket that reports `connection` once a listener is attached. */
function socketThatReports(update: Record<string, unknown>) {
  const created: FakeSocket[] = [];
  fakeSocketFactory = (options) => {
    const sock = new FakeSocket(options);
    sock.ev.once('newListener', (event) => {
      if (event === 'connection.update') setImmediate(() => sock.ev.emit('connection.update', update));
    });
    created.push(sock);
    return sock;
  };
  return created;
}

afterEach(() => {
  fakeSocketFactory = null;
});

describe('WhatsAppPlugin.logout unlinks the device (#1275)', () => {
  it('logs out on the live socket, then clears the stored auth', async () => {
    const storage = pairedStorage();
    const { plugin, sockets } = makePlugin(storage);
    const sock = new FakeSocket();
    sockets.set(ID, sock);
    const created = socketThatReports({ connection: 'open' });

    await plugin.logout(ID);

    expect(sock.logout).toHaveBeenCalledTimes(1);
    expect(sock.end).toHaveBeenCalled();
    expect(sockets.has(ID)).toBe(false);
    expect(created).toHaveLength(0);
    expect(await storage.keys(`auth:${ID}:`)).toEqual([]);
  });

  it('with no live socket, logs out through the stored session (delete route path)', async () => {
    const storage = pairedStorage();
    const { plugin } = makePlugin(storage);
    const created = socketThatReports({ connection: 'open' });

    await plugin.logout(ID);

    expect(created).toHaveLength(1);
    expect(created[0]?.options?.auth.creds.me?.id).toBe('5511999999999:7@s.whatsapp.net');
    expect(created[0]?.logout).toHaveBeenCalledTimes(1);
    expect(created[0]?.end).toHaveBeenCalled();
    expect(await storage.keys(`auth:${ID}:`)).toEqual([]);
  });

  it('falls back to the stored session when the live socket cannot log out', async () => {
    const storage = pairedStorage();
    const { plugin, sockets } = makePlugin(storage);
    const sock = new FakeSocket();
    sock.logout.mockImplementation(async () => {
      throw new Error('Connection Closed');
    });
    sockets.set(ID, sock);
    const created = socketThatReports({ connection: 'open' });

    await plugin.logout(ID);

    expect(created).toHaveLength(1);
    expect(created[0]?.logout).toHaveBeenCalledTimes(1);
    expect(await storage.keys(`auth:${ID}:`)).toEqual([]);
  });

  it('does not open a socket when nothing was ever paired', async () => {
    const { plugin } = makePlugin(new MemoryStorage());
    const created = socketThatReports({ connection: 'open' });

    await plugin.logout(ID);

    expect(created).toHaveLength(0);
  });

  it('still clears the stored auth when WhatsApp cannot be reached', async () => {
    const storage = pairedStorage();
    const { plugin } = makePlugin(storage);
    const created = socketThatReports({ connection: 'close', lastDisconnect: { error: new Error('ENOTFOUND') } });

    await plugin.logout(ID);

    expect(created).toHaveLength(1);
    expect(created[0]?.logout).not.toHaveBeenCalled();
    expect(await storage.keys(`auth:${ID}:`)).toEqual([]);
  });

  it('still clears the stored auth when the stored creds cannot be read', async () => {
    const storage = pairedStorage();
    const readCreds = storage.get.bind(storage);
    storage.get = async <T>(key: string): Promise<T | null> => {
      if (key === CREDS_KEY) throw new Error('corrupt creds');
      return readCreds<T>(key);
    };
    const { plugin, logger } = makePlugin(storage);
    const created = socketThatReports({ connection: 'open' });

    await plugin.logout(ID);

    expect(created).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalled();
    expect(await storage.keys(`auth:${ID}:`)).toEqual([]);
  });
});

describe('logoutStoredSession', () => {
  const auth = { creds: { me: { id: '5511999999999:7@s.whatsapp.net' } }, keys: {} } as never;

  it('reports a session WhatsApp already logged out without calling logout', async () => {
    const created = socketThatReports({
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: realBaileys.DisconnectReason.loggedOut } } },
    });

    expect(await logoutStoredSession({ auth })).toBe('already-logged-out');
    expect(created[0]?.logout).not.toHaveBeenCalled();
    expect(created[0]?.end).toHaveBeenCalled();
  });

  it('reports unreachable when the socket cannot even be created', async () => {
    fakeSocketFactory = () => {
      throw new Error('fetch failed');
    };

    expect(await logoutStoredSession({ auth })).toBe('unreachable');
  });

  it('gives up after the timeout when the connection never opens', async () => {
    const created: FakeSocket[] = [];
    fakeSocketFactory = () => {
      const sock = new FakeSocket();
      created.push(sock);
      return sock;
    };

    expect(await logoutStoredSession({ auth }, 20)).toBe('unreachable');
    expect(created[0]?.logout).not.toHaveBeenCalled();
    expect(created[0]?.end).toHaveBeenCalled();
  });
});

describe('createReadOnlyAuthState', () => {
  it('reads stored creds and keys but keeps every write in memory', async () => {
    const { createReadOnlyAuthState } = await import('../auth');
    const storage = pairedStorage();
    const before = new Map(storage.data);

    const auth = await createReadOnlyAuthState(storage, ID);
    if (!auth) throw new Error('expected a paired session');
    expect(auth.creds.me?.id).toBe('5511999999999:7@s.whatsapp.net');

    await auth.keys.set({ session: { '5511999999999.0': null, '5511888888888.0': new Uint8Array([1]) } });
    await new Promise((resolve) => setImmediate(resolve));

    expect(storage.data).toEqual(before);
    expect(await auth.keys.get('session', ['5511999999999.0', '5511888888888.0'])).toEqual({
      '5511888888888.0': new Uint8Array([1]),
    });
  });

  it('returns null when the instance was never paired', async () => {
    const { createReadOnlyAuthState } = await import('../auth');
    expect(await createReadOnlyAuthState(new MemoryStorage(), ID)).toBeNull();
  });
});
