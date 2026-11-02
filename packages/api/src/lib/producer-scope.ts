import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage<string>();

/** Entered only after authentication; asynchronous concurrent requests stay isolated. */
export function runWithProducingKey<T>(keyId: string, fn: () => Promise<T>): Promise<T> {
  return storage.run(keyId, fn);
}

export function currentProducingKeyId(): string | null {
  return storage.getStore() ?? null;
}
