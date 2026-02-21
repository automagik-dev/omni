/**
 * Stream mode configuration for Slack
 *
 * Three modes:
 * - replace: Edit-in-place progressive rendering (default)
 * - status_final: Show "thinking..." then replace with final
 * - off: No streaming, wait for complete response
 */

import type { StreamMode } from '../types';

const DEFAULT_STREAM_MODE: StreamMode = 'replace';
const DEFAULT_STREAM_THROTTLE_MS = 1000;

/**
 * Validate a stream mode value
 */
function isValidStreamMode(mode: string): mode is StreamMode {
  return mode === 'replace' || mode === 'status_final' || mode === 'off';
}

/**
 * Get stream mode from config with fallback
 */
export function resolveStreamMode(mode?: string): StreamMode {
  if (mode && isValidStreamMode(mode)) {
    return mode;
  }
  return DEFAULT_STREAM_MODE;
}

/**
 * Get stream throttle from config with fallback
 */
export function resolveStreamThrottle(throttleMs?: number): number {
  if (throttleMs && throttleMs > 0) {
    return throttleMs;
  }
  return DEFAULT_STREAM_THROTTLE_MS;
}
