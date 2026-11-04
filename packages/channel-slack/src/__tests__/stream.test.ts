/**
 * Tests for Slack streaming and text sending
 *
 * Tests Group B: Outbound Messages + Streaming
 */

import { describe, expect, it } from 'bun:test';

import { resolveStreamMode, resolveStreamThrottle } from '../config/stream-mode';
import { STREAM_MODES } from '../types';

// ─────────────────────────────────────────────────────────────
// Stream mode configuration
// ─────────────────────────────────────────────────────────────

describe('Stream mode configuration', () => {
  it('resolves valid stream modes', () => {
    expect(resolveStreamMode('replace')).toBe('replace');
    expect(resolveStreamMode('status_final')).toBe('status_final');
    expect(resolveStreamMode('off')).toBe('off');
    expect(resolveStreamMode('native')).toBe('native');
    expect(STREAM_MODES).toContain('native');
  });

  it('defaults to replace for invalid modes', () => {
    expect(resolveStreamMode('invalid')).toBe('replace');
    expect(resolveStreamMode(undefined)).toBe('replace');
    expect(resolveStreamMode('')).toBe('replace');
  });

  it('resolves throttle with default', () => {
    expect(resolveStreamThrottle(undefined)).toBe(1000);
    expect(resolveStreamThrottle(0)).toBe(1000);
    expect(resolveStreamThrottle(-1)).toBe(1000);
  });

  it('accepts valid throttle values', () => {
    expect(resolveStreamThrottle(500)).toBe(500);
    expect(resolveStreamThrottle(2000)).toBe(2000);
  });
});
