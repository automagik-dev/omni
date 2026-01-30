/**
 * Storage-backed authentication state for Baileys
 *
 * Uses PluginStorage (key-value interface) instead of file-based storage.
 * Keys are namespaced per instance to support multi-device.
 */

import type { PluginStorage } from '@omni/channel-sdk';
import type { AuthenticationCreds, AuthenticationState, SignalDataTypeMap } from '@whiskeysockets/baileys';
import { initAuthCreds } from '@whiskeysockets/baileys';

// proto may not be available in all Baileys versions/runtimes (especially with tsx)
// When unavailable, proto deserialization will be skipped - this is non-critical for initial connection
let proto: any = undefined;

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
  const existingCreds = await storage.get<string>(credsKey);

  if (existingCreds) {
    creds = deserialize<AuthenticationCreds>(existingCreds);
  } else {
    creds = initAuthCreds();
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
            const value = await storage.get<string>(key);

            if (value) {
              const parsed = deserialize<unknown>(value);
              data[id] = deserializeSignalData(type, parsed);
            }
          }

          return data;
        },

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

              if (value !== null && value !== undefined) {
                await storage.set(key, serialize(value));
              } else {
                await storage.delete(key);
              }
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
  for (const key of keys) {
    await storage.delete(key);
  }
}
