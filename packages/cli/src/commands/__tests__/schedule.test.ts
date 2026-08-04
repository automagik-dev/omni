/**
 * `--at` parsing for `omni schedule send` (#889).
 */

import { describe, expect, it } from 'bun:test';
import { parseSendAt } from '../schedule';

const NOW = new Date('2026-08-04T12:00:00.000Z');

describe('parseSendAt — relative offsets', () => {
  it('reads minutes', () => {
    expect(parseSendAt('30m', NOW).toISOString()).toBe('2026-08-04T12:30:00.000Z');
  });

  it('reads hours', () => {
    expect(parseSendAt('2h', NOW).toISOString()).toBe('2026-08-04T14:00:00.000Z');
  });

  it('reads days', () => {
    expect(parseSendAt('3d', NOW).toISOString()).toBe('2026-08-07T12:00:00.000Z');
  });

  it('tolerates a space and uppercase', () => {
    expect(parseSendAt('2 H', NOW).toISOString()).toBe('2026-08-04T14:00:00.000Z');
  });
});

describe('parseSendAt — absolute instants', () => {
  it('reads an ISO-8601 instant unchanged', () => {
    expect(parseSendAt('2026-08-05T09:30:00.000Z', NOW).toISOString()).toBe('2026-08-05T09:30:00.000Z');
  });

  it('honours an explicit offset rather than assuming UTC', () => {
    // BRT is UTC-3, so 09:00-03:00 is 12:00Z. Getting this wrong would send
    // three hours off, which is the classic scheduling bug.
    expect(parseSendAt('2026-08-05T09:00:00-03:00', NOW).toISOString()).toBe('2026-08-05T12:00:00.000Z');
  });
});

describe('parseSendAt — rejections', () => {
  it('rejects text that is not a time', () => {
    expect(() => parseSendAt('amanhã de manhã', NOW)).toThrow(/Could not read/);
  });

  it('rejects an offset with no unit', () => {
    expect(() => parseSendAt('30', NOW)).toThrow(/Could not read/);
  });

  it('rejects an unsupported unit rather than guessing', () => {
    // 's' and 'w' are not supported; silently reading '5w' as 5 minutes would
    // be far worse than refusing.
    expect(() => parseSendAt('5w', NOW)).toThrow(/Could not read/);
  });
});
