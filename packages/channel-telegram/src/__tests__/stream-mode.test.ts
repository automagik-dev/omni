import { describe, expect, test } from 'bun:test';
import { isStreamingEnabled } from '../config/stream-mode';

describe('Stream Mode', () => {
  test('streamMode on (default) returns true', () => {
    expect(isStreamingEnabled('on')).toBe(true);
  });

  test('streamMode off returns false', () => {
    expect(isStreamingEnabled('off')).toBe(false);
  });

  test('undefined defaults to on (streaming enabled)', () => {
    expect(isStreamingEnabled(undefined)).toBe(true);
  });
});
