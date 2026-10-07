import type { ChannelPlugin } from '@omni/channel-sdk';

const activations = new Map<string, Promise<unknown>>();

/** Serialize gateway rotations and persist credentials before activating their webhook binding. */
export async function connectAndPersist<T>(
  plugin: ChannelPlugin,
  instanceId: string,
  options: Record<string, unknown> | (() => Promise<Record<string, unknown>>),
  persist: () => Promise<T>,
  gateway: boolean,
): Promise<{ updated: T } | { errorMessage: string }> {
  const work = async (): Promise<{ updated: T } | { errorMessage: string }> => {
    // A failed write leaves the previous binding untouched. Failed activation
    // detaches locally; the durable configuration remains available for recovery.
    // Resolve persisted defaults inside the queue, after earlier rotations finish.
    const resolvedOptions = typeof options === 'function' ? await options() : options;
    const persisted = gateway ? await persist() : undefined;
    try {
      await plugin.connect(instanceId, { instanceId, credentials: {}, options: resolvedOptions });
    } catch (error) {
      if (gateway) await plugin.disconnect(instanceId);
      return { errorMessage: error instanceof Error ? error.message : 'Unknown error' };
    }
    return { updated: gateway ? (persisted as T) : await persist() };
  };
  if (!gateway) return work();
  const previous = activations.get(instanceId) ?? Promise.resolve();
  const pending = previous.catch(() => {}).then(work);
  activations.set(instanceId, pending);
  try {
    return await pending;
  } finally {
    if (activations.get(instanceId) === pending) activations.delete(instanceId);
  }
}
