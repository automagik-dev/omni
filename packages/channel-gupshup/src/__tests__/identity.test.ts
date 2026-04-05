/**
 * Gupshup identity utilities — unit tests
 *
 * Covers phone normalization edge cases and user ID extraction.
 */

import { describe, expect, it } from 'bun:test';
import { extractUserId, normalizePhone, toGupshupPhone } from '../utils/identity';

describe('normalizePhone', () => {
  it('preserves already-normalized E.164 numbers', () => {
    expect(normalizePhone('+5511999999999')).toBe('+5511999999999');
  });

  it('strips spaces', () => {
    expect(normalizePhone('55 11 9 9999-9999')).toBe('+5511999999999');
  });

  it('strips dashes', () => {
    expect(normalizePhone('+55-11-99999-9999')).toBe('+5511999999999');
  });

  it('strips parentheses', () => {
    expect(normalizePhone('+55(11)99999-9999')).toBe('+5511999999999');
  });

  it('strips dots', () => {
    expect(normalizePhone('+55.11.99999.9999')).toBe('+5511999999999');
  });

  it('converts 00-prefix international format', () => {
    expect(normalizePhone('005511999999999')).toBe('+5511999999999');
  });

  it('adds + when number has no prefix', () => {
    expect(normalizePhone('5511999999999')).toBe('+5511999999999');
  });

  it('handles US number', () => {
    expect(normalizePhone('+12125551234')).toBe('+12125551234');
  });
});

describe('extractUserId', () => {
  it('adds + to source without leading +', () => {
    expect(extractUserId('5511999999999')).toBe('+5511999999999');
  });

  it('preserves already E.164 source', () => {
    expect(extractUserId('+5511999999999')).toBe('+5511999999999');
  });

  it('trims whitespace', () => {
    expect(extractUserId('  5511999999999  ')).toBe('+5511999999999');
  });
});

describe('toGupshupPhone', () => {
  it('strips leading + for API destination field', () => {
    expect(toGupshupPhone('+5511999999999')).toBe('5511999999999');
  });

  it('leaves number without + unchanged', () => {
    expect(toGupshupPhone('5511999999999')).toBe('5511999999999');
  });
});
