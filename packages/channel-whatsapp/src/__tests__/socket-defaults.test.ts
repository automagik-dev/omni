/**
 * Regression tests for socket defaults that prevent mutex starvation.
 * See: #70
 */

import { describe, expect, it } from 'bun:test';
import { DEFAULT_SOCKET_CONFIG } from '../socket';

describe('DEFAULT_SOCKET_CONFIG (#70)', () => {
  it('syncFullHistory is false (prevents meId mutex contention)', () => {
    expect(DEFAULT_SOCKET_CONFIG.syncFullHistory).toBe(false);
  });

  it('defaultQueryTimeoutMs is 15s (limits mutex hold time)', () => {
    expect(DEFAULT_SOCKET_CONFIG.defaultQueryTimeoutMs).toBe(15_000);
  });
});
