/**
 * Regression tests for socket defaults.
 * See: #70
 */

import { describe, expect, it } from 'bun:test';
import { DEFAULT_SOCKET_CONFIG } from '../socket';

describe('DEFAULT_SOCKET_CONFIG (#70)', () => {
  it('syncFullHistory is false (prevents meId mutex contention)', () => {
    expect(DEFAULT_SOCKET_CONFIG.syncFullHistory).toBe(false);
  });

  it('defaultQueryTimeoutMs uses Baileys default (60s)', () => {
    expect(DEFAULT_SOCKET_CONFIG.defaultQueryTimeoutMs).toBe(60_000);
  });
});
