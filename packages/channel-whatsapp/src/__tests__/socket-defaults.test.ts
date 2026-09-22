/**
 * Regression tests for socket defaults.
 * See: #70
 */

import { describe, expect, it } from 'bun:test';
import { Browsers } from 'baileys';
import { DEFAULT_SOCKET_CONFIG, resolveHistoryIdentity } from '../socket';

describe('DEFAULT_SOCKET_CONFIG (#70)', () => {
  it('syncFullHistory is false (prevents meId mutex contention)', () => {
    expect(DEFAULT_SOCKET_CONFIG.syncFullHistory).toBe(false);
  });

  it('defaultQueryTimeoutMs uses Baileys default (60s)', () => {
    expect(DEFAULT_SOCKET_CONFIG.defaultQueryTimeoutMs).toBe(60_000);
  });
});

describe('resolveHistoryIdentity (#1126, #1211)', () => {
  it('defaults to the macOS Desktop identity with group history', () => {
    expect(resolveHistoryIdentity({})).toEqual({ browser: Browsers.macOS('Desktop'), supportGroupHistory: true });
  });

  it("'desktop' pairs as macOS Desktop with group history", () => {
    expect(resolveHistoryIdentity({ historyIdentity: 'desktop' })).toEqual({
      browser: Browsers.macOS('Desktop'),
      supportGroupHistory: true,
    });
  });

  it("'web' keeps the Ubuntu/Chrome identity without group history", () => {
    expect(resolveHistoryIdentity({ historyIdentity: 'web' })).toEqual({
      browser: Browsers.ubuntu('Chrome'),
      supportGroupHistory: false,
    });
  });

  it('honours per-instance overrides', () => {
    const browser: [string, string, string] = ['Omni', 'Chrome', '1.0'];
    expect(resolveHistoryIdentity({ historyIdentity: 'desktop', browser, supportGroupHistory: false })).toEqual({
      browser,
      supportGroupHistory: false,
    });
  });
});
