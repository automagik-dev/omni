import { describe, expect, test } from 'bun:test';
import { EFFECTS, confirmSatisfied } from './effect';

describe('EFFECTS', () => {
  test('only the live effect is marked mutating', () => {
    expect(EFFECTS.live.mutating).toBe(true);
    expect(EFFECTS['read-only'].mutating).toBe(false);
    expect(EFFECTS['dry-run'].mutating).toBe(false);
    expect(EFFECTS.synthetic.mutating).toBe(false);
  });
});

describe('confirmSatisfied', () => {
  test('non-destructive actions are always satisfied', () => {
    expect(confirmSatisfied('', 'anything', false)).toBe(true);
  });

  test('destructive actions require an exact phrase match', () => {
    expect(confirmSatisfied('prod-instance', 'prod-instance', true)).toBe(true);
    expect(confirmSatisfied('  prod-instance  ', 'prod-instance', true)).toBe(true);
    expect(confirmSatisfied('nope', 'prod-instance', true)).toBe(false);
  });

  test('an empty phrase can never be satisfied when destructive', () => {
    expect(confirmSatisfied('', '', true)).toBe(false);
  });
});
