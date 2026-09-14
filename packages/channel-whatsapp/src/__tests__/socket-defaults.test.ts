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

describe('resolveHistoryIdentity (#1126)', () => {
  it('keeps the web identity without group history by default', () => {
    expect(resolveHistoryIdentity({})).toEqual({ browser: Browsers.ubuntu('Chrome'), supportGroupHistory: false });
  });

  it('pairs as macOS Desktop with group history when syncFullHistory is on', () => {
    expect(resolveHistoryIdentity({ syncFullHistory: true })).toEqual({
      browser: Browsers.macOS('Desktop'),
      supportGroupHistory: true,
    });
  });

  it('honours per-instance overrides', () => {
    const browser: [string, string, string] = ['Omni', 'Chrome', '1.0'];
    expect(resolveHistoryIdentity({ syncFullHistory: true, browser, supportGroupHistory: false })).toEqual({
      browser,
      supportGroupHistory: false,
    });
  });
});
