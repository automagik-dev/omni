import { AsyncLocalStorage } from 'node:async_hooks';
import type { Database } from '@omni/db';
import type { KeyAgentResolution } from './key-agent';

interface ProducerHolder {
  keyId: string | null;
  resolutions: WeakMap<Database, Promise<KeyAgentResolution>>;
}

const storage = new AsyncLocalStorage<ProducerHolder>();

/** Inherited timers share this holder, so request completion revokes them too. */
export async function runWithProducingKey<T>(keyId: string, fn: () => Promise<T>): Promise<T> {
  const holder: ProducerHolder = { keyId, resolutions: new WeakMap() };
  try {
    return await storage.run(holder, fn);
  } finally {
    holder.keyId = null;
    holder.resolutions = new WeakMap();
  }
}

export function currentProducingKeyId(): string | null {
  return storage.getStore()?.keyId ?? null;
}

/** Long-lived channel/consumer setup must not inherit even an active request's key. */
export function runOutsideProducerScope<T>(fn: () => T): T {
  return storage.exit(fn);
}

/** Only the active request's own principal is memoized; never share across requests or pools. */
export function memoizeProducingKeyResolution(
  db: Database,
  keyId: string,
  resolve: () => Promise<KeyAgentResolution>,
): Promise<KeyAgentResolution> {
  const holder = storage.getStore();
  if (!holder?.keyId || holder.keyId !== keyId) return resolve();
  let resolution = holder.resolutions.get(db);
  if (!resolution) {
    resolution = resolve();
    holder.resolutions.set(db, resolution);
  }
  return resolution;
}
