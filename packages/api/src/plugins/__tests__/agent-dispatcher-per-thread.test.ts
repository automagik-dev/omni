/**
 * Tests for unsupported dispatcher provider resolution.
 */

import { describe, expect, it } from 'bun:test';
import { resolveProvider } from '../agent-dispatcher';

describe('resolveProvider — exported from dispatcher', () => {
  it('returns null for unsupported provider schema', () => {
    const mockInstance = { id: 'inst-1', agentProvider: { schema: 'unknown-provider' } };
    const result = resolveProvider(
      mockInstance.agentProvider as Parameters<typeof resolveProvider>[0],
      {} as Parameters<typeof resolveProvider>[1],
      {} as Parameters<typeof resolveProvider>[2],
    );
    expect(result).toBeNull();
  });
});
