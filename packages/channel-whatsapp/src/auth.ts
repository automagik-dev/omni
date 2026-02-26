/**
 * Storage-backed authentication state for Baileys
 *
 * Uses PluginStorage (key-value interface) instead of file-based storage.
 * Keys are namespaced per instance to support multi-device.
 */

import type { PluginStorage } from '@omni/channel-sdk';
import { createLogger } from '@omni/core';
import type { AuthenticationCreds, AuthenticationState, SignalDataTypeMap } from 'baileys';
import { initAuthCreds } from 'baileys';

const log = createLogger('whatsapp:auth');

// proto may not be available in all Baileys versions/runtimes (especially with tsx)
// When unavailable, proto deserialization will be skipped - this is non-critical for initial connection
type ProtoModule = {
  Message: {
    AppStateSyncKeyData: { fromObject: (obj: unknown) => unknown };
    AppStateSyncKeyId: { fromObject: (obj: unknown) => unknown };
  };
};
const proto: ProtoModule | undefined = undefined;

/**
 * Buffer JSON replacer for serialization
 * Converts Buffer instances to a serializable format
 */
function bufferReplacer(_key: string, value: unknown): unknown {
  if (Buffer.isBuffer(value)) {
    return {
      type: 'Buffer',
      data: value.toString('base64'),
    };
  }
  return value;
}

/**
 * Buffer JSON reviver for deserialization
 * Reconstructs Buffer instances from serialized format
 */
function bufferReviver(_key: string, value: unknown): unknown {
  if (
    value &&
    typeof value === 'object' &&
    'type' in value &&
    'data' in value &&
    (value as { type: string }).type === 'Buffer'
  ) {
    return Buffer.from((value as { data: string }).data, 'base64');
  }
  return value;
}

/**
 * Serialize auth data to JSON string with Buffer support
 */
function serialize(data: unknown): string {
  return JSON.stringify(data, bufferReplacer);
}

/**
 * Deserialize JSON string with Buffer reconstruction
 */
function deserialize<T>(json: string): T {
  return JSON.parse(json, bufferReviver) as T;
}

/**
 * Type guard for checking if a value is a protobuf message that needs deserialization
 */
type SignalDataType = keyof SignalDataTypeMap;

const PROTO_MESSAGE_TYPES: SignalDataType[] = ['app-state-sync-key', 'app-state-sync-version'];

/**
 * Deserialize a signal data value based on its type
 */
function deserializeSignalData<T extends SignalDataType>(type: T, data: unknown): SignalDataTypeMap[T] {
  if (PROTO_MESSAGE_TYPES.includes(type) && data && typeof data === 'object' && proto) {
    // For protobuf types, we need to reconstruct them (proto must be available)
    if (type === 'app-state-sync-key') {
      return proto.Message.AppStateSyncKeyData.fromObject(
        data as Record<string, unknown>,
      ) as unknown as SignalDataTypeMap[T];
    }
    if (type === 'app-state-sync-version') {
      return proto.Message.AppStateSyncKeyId.fromObject(
        data as Record<string, unknown>,
      ) as unknown as SignalDataTypeMap[T];
    }
  }
  return data as SignalDataTypeMap[T];
}

/**
 * Create storage-backed authentication state for Baileys
 *
 * Uses PluginStorage key-value interface to persist auth state.
 * Keys are namespaced per instance:
 * - `auth:${instanceId}:creds` - Authentication credentials
 * - `auth:${instanceId}:keys:${type}:${id}` - Signal protocol keys
 *
 * @param storage - PluginStorage instance from plugin context
 * @param instanceId - Instance identifier for namespacing
 * @returns Authentication state and saveCreds callback
 *
 * @example
 * const { state, saveCreds } = await createStorageAuthState(this.storage, instanceId);
 * const sock = makeWASocket({ auth: state });
 * sock.ev.on('creds.update', saveCreds);
 */
export async function createStorageAuthState(
  storage: PluginStorage,
  instanceId: string,
): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  const credsKey = `auth:${instanceId}:creds`;
  const keyPrefix = `auth:${instanceId}:keys`;

  // Load existing credentials or create new ones
  let creds: AuthenticationCreds;
  const existingCreds = await storage.get<AuthenticationCreds | string>(credsKey);

  if (existingCreds) {
    // Handle both cases: raw object (from storage.get parsing) or JSON string (legacy)
    if (typeof existingCreds === 'string') {
      creds = deserialize<AuthenticationCreds>(existingCreds);
    } else {
      // Storage already parsed it, but we need to reconstruct Buffers
      creds = JSON.parse(JSON.stringify(existingCreds), bufferReviver) as AuthenticationCreds;
    }
    log.info('Restored credentials', { instanceId, registered: creds.registered });
  } else {
    creds = initAuthCreds();
    log.info('Created new credentials', { instanceId });
  }

  // #70 FIX: Write-behind cache for signal keys.
  //
  // Root cause: PostgreSQL UPSERT on sender-key rows can hang indefinitely
  // due to row-level locks from concurrent incoming message processing.
  // Baileys' commitWithRetry awaits our keys.set(), holding the meId
  // transaction mutex — freezing ALL message processing.
  //
  // Fix: keys.set() updates an in-memory cache and returns immediately.
  // DB persist happens in the background (fire-and-forget).
  // keys.get() checks cache first, falls through to DB for misses.
  //
  // Safety: Baileys' addTransactionCapability already caches mutations
  // within a transaction via AsyncLocalStorage. The meId mutex serializes
  // all transactions, so cache is always consistent between transactions.
  // DB persist is for durability across restarts only.
  const keyCache = new Map<string, unknown>();
  const persistQueues = new Map<string, Promise<void>>();
  const configuredKeyCacheLimit = Number.parseInt(process.env.WHATSAPP_AUTH_KEY_CACHE_MAX_ENTRIES ?? '50000', 10);
  const keyCacheMaxEntries =
    Number.isFinite(configuredKeyCacheLimit) && configuredKeyCacheLimit > 0 ? configuredKeyCacheLimit : 50_000;
  // Sentinel to distinguish "cached null/deleted" from "not in cache"
  const DELETED = Symbol('deleted');

  /** Set cache entry with bounded size to avoid unbounded long-lived growth */
  function setCachedValue(key: string, value: unknown): void {
    // Refresh insertion order so oldest entries can be evicted first.
    if (keyCache.has(key)) keyCache.delete(key);
    keyCache.set(key, value);

    let scanned = 0;
    while (keyCache.size > keyCacheMaxEntries) {
      const oldestKey = keyCache.keys().next().value;
      if (oldestKey === undefined) break;

      // Keep keys with in-flight persistence in cache until background write finishes.
      if (persistQueues.has(oldestKey)) {
        const oldestValue = keyCache.get(oldestKey);
        keyCache.delete(oldestKey);
        keyCache.set(oldestKey, oldestValue);
        scanned++;
        if (scanned >= keyCache.size) break;
        continue;
      }

      keyCache.delete(oldestKey);
      scanned = 0;
    }
  }

  /** Parse a raw storage value into a usable object, reconstructing Buffers */
  function parseStorageValue(value: unknown): unknown {
    if (typeof value === 'string') return deserialize<unknown>(value);
    return JSON.parse(JSON.stringify(value), bufferReviver);
  }

  /**
   * Persist a single key-value pair to storage in the background.
   * Writes are serialized per key so stale writes cannot overtake newer ones.
   */
  function backgroundPersist(type: string, id: string, key: string, value: unknown): void {
    const previousPersist = persistQueues.get(key) ?? Promise.resolve();
    const nextPersist = previousPersist
      .catch(() => {})
      .then(async () => {
        if (value !== null && value !== undefined) {
          await storage.set(key, serialize(value));
          return;
        }
        await storage.delete(key);
      })
      .catch((err) => {
        if (value !== null && value !== undefined) {
          log.error('Background key persist failed', { type, id: id.slice(-40), instanceId, err: String(err) });
          return;
        }
        log.error('Background key delete failed', { type, id: id.slice(-40), instanceId, err: String(err) });
      })
      .finally(() => {
        if (persistQueues.get(key) === nextPersist) {
          persistQueues.delete(key);
        }
      });

    persistQueues.set(key, nextPersist);
  }

  return {
    state: {
      creds,
      keys: {
        get: async <T extends SignalDataType>(
          type: T,
          ids: string[],
        ): Promise<{ [id: string]: SignalDataTypeMap[T] }> => {
          const data: { [id: string]: SignalDataTypeMap[T] } = {};

          for (const id of ids) {
            const key = `${keyPrefix}:${type}:${id}`;

            // Check write-behind cache first (#70)
            const cached = keyCache.get(key);
            if (cached === DELETED) continue;
            if (cached !== undefined) {
              data[id] = deserializeSignalData(type, cached);
              continue;
            }

            // Cache miss — read from storage
            const value = await storage.get<unknown>(key);
            if (value !== null && value !== undefined) {
              const parsed = parseStorageValue(value);
              setCachedValue(key, parsed);
              data[id] = deserializeSignalData(type, parsed);
            }
          }

          return data;
        },

        // Ordering guarantee: background persists are explicitly serialized per key.
        set: async (
          data: {
            [T in SignalDataType]?: {
              [id: string]: SignalDataTypeMap[T] | null;
            };
          },
        ): Promise<void> => {
          for (const [type, entries] of Object.entries(data)) {
            if (!entries) continue;
            for (const [id, value] of Object.entries(entries)) {
              const key = `${keyPrefix}:${type}:${id}`;
              // 1. Update in-memory cache synchronously — instant, never blocks
              setCachedValue(key, value !== null && value !== undefined ? value : DELETED);
              // 2. Persist to DB in background — fire-and-forget (#70)
              backgroundPersist(type, id, key, value);
            }
          }
        },
      },
    },

    saveCreds: async () => {
      await storage.set(credsKey, serialize(creds));
    },
  };
}

/**
 * Clear sender keys for an instance — forces fresh key generation + redistribution.
 *
 * Use this to recover from sender key desync caused by previous hung sessions
 * where the DB persist never completed. After clearing, the next group send
 * will generate new sender keys and distribute them to all participants.
 *
 * Note: This only clears persisted keys in storage, not the in-memory keyCache.
 * Intended for use as a recovery tool between sessions, not during an active connection.
 *
 * @param storage - PluginStorage instance
 * @param instanceId - Instance identifier
 * @returns Number of keys deleted
 */
export async function clearSenderKeys(storage: PluginStorage, instanceId: string): Promise<number> {
  const keyPrefix = `auth:${instanceId}:keys`;
  const allKeys = await storage.keys(`${keyPrefix}:sender-key*`);
  const batchSize = 50;

  let deleted = 0;
  for (let i = 0; i < allKeys.length; i += batchSize) {
    const batch = allKeys.slice(i, i + batchSize);
    await Promise.all(batch.map((key) => storage.delete(key)));
    deleted += batch.length;
  }

  log.info('Cleared sender keys', { instanceId, deleted });
  return deleted;
}

/**
 * Clear all authentication data for an instance
 *
 * @param storage - PluginStorage instance
 * @param instanceId - Instance identifier
 */
export async function clearAuthState(storage: PluginStorage, instanceId: string): Promise<void> {
  const credsKey = `auth:${instanceId}:creds`;
  const keyPrefix = `auth:${instanceId}:keys`;

  // Delete credentials
  await storage.delete(credsKey);

  // Delete all keys matching the prefix
  const keys = await storage.keys(`${keyPrefix}:*`);
  const batchSize = 50;
  for (let i = 0; i < keys.length; i += batchSize) {
    const batch = keys.slice(i, i + batchSize);
    await Promise.all(batch.map((key) => storage.delete(key)));
  }
}
