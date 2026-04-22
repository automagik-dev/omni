/**
 * Module-level plugin state flags shared across the API server.
 *
 * `pluginsDegraded` is set when channel plugin initialization throws at
 * startup so the /health endpoint can report `status: 'degraded'` instead
 * of silently returning `healthy` (issue #408).
 */

let pluginsDegraded = false;
let pluginsDegradedReason: string | null = null;

export function markPluginsDegraded(reason: string): void {
  pluginsDegraded = true;
  pluginsDegradedReason = reason;
}

export function arePluginsDegraded(): boolean {
  return pluginsDegraded;
}

export function getPluginsDegradedReason(): string | null {
  return pluginsDegradedReason;
}
