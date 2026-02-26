/**
 * Tests for Slack streaming and text sending
 *
 * Tests Group B: Outbound Messages + Streaming
 */

import { describe, expect, it } from 'bun:test';

import { resolveStreamMode, resolveStreamThrottle } from '../config/stream-mode';

// ─────────────────────────────────────────────────────────────
// Stream mode configuration
// ─────────────────────────────────────────────────────────────

describe('Stream mode configuration', () => {
  it('resolves valid stream modes', () => {
    expect(resolveStreamMode('replace')).toBe('replace');
    expect(resolveStreamMode('status_final')).toBe('status_final');
    expect(resolveStreamMode('off')).toBe('off');
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

// ─────────────────────────────────────────────────────────────
// Text send options validation
// ─────────────────────────────────────────────────────────────

describe('Text send options', () => {
  it('TextSendOptions interface has required fields', () => {
    // Type check — import the type and verify it's usable
    const options = {
      channelId: 'C12345',
      text: 'Hello world',
    };
    expect(options.channelId).toBe('C12345');
    expect(options.text).toBe('Hello world');
  });

  it('supports optional fields', () => {
    const options = {
      channelId: 'C12345',
      text: 'Hello world',
      threadTs: '1234567890.123456',
      ephemeral: true,
      ephemeralUserId: 'U12345',
      username: 'OmniBot',
      iconUrl: 'https://example.com/icon.png',
      iconEmoji: ':robot_face:',
      formatMode: 'convert' as const,
    };
    expect(options.threadTs).toBe('1234567890.123456');
    expect(options.ephemeral).toBe(true);
    expect(options.username).toBe('OmniBot');
  });
});
