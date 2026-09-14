import { describe, expect, it } from 'bun:test';
import { resolveSyncDepth } from '../instances';

describe('resolveSyncDepth (#1125)', () => {
  it('defaults anchored (chatJids) backfills to all', () => {
    expect(resolveSyncDepth(undefined, ['123@g.us'])).toBe('all');
  });
  it('keeps 7d for instance-wide syncs', () => {
    expect(resolveSyncDepth(undefined, undefined)).toBe('7d');
    expect(resolveSyncDepth(undefined, [])).toBe('7d');
  });
  it('respects an explicit depth', () => {
    expect(resolveSyncDepth('30d', ['123@g.us'])).toBe('30d');
  });
});
