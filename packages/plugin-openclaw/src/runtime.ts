import type { PluginRuntime } from './types.js';

let runtime: PluginRuntime | null = null;

export function setOmniRuntime(next: PluginRuntime) {
  runtime = next;
}

export function getOmniRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error('Omni runtime not initialized');
  }
  return runtime;
}
