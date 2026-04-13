/**
 * Gupshup identity utilities — unit tests
 *
 * Covers phone normalization edge cases and user ID extraction.
 * New behavior: normalizePhone strips + and handles BR extra-9.
 */

import { describe, expect, it } from 'bun:test';
import { extractUserId, normalizePhone, toGupshupPhone } from '../utils/identity';

describe('normalizePhone', () => {
  it('strips leading + and BR extra-9 from E.164 mobile', () => {
    // +55 11 9 99999999 → 551199999999
    expect(normalizePhone('+5511999999999')).toBe('551199999999');
  });

  it('strips BR extra-9 digit for 13-digit mobile', () => {
    // 5551997285829 (13 digits with 9) → 555197285829 (12 digits without 9)
    expect(normalizePhone('5551997285829')).toBe('555197285829');
  });

  it('strips + and then BR extra-9', () => {
    expect(normalizePhone('+5551997285829')).toBe('555197285829');
  });

  it('does not strip 9 from non-BR numbers', () => {
    expect(normalizePhone('+12125551234')).toBe('12125551234');
  });

  it('does not strip 9 from BR landline (12 digits, no extra-9)', () => {
    // 55 + 11 + 33334444 = 12 digits — regex requires 13, so no match
    expect(normalizePhone('551133334444')).toBe('551133334444');
  });

  it('strips extra-9 from SP mobile (5511 prefix)', () => {
    // 5511999999999 = 55 + 11 + 9 + 99999999 → matches BR mobile pattern
    expect(normalizePhone('5511999999999')).toBe('551199999999');
  });
});

describe('extractUserId', () => {
  it('normalizes source phone (strips + and BR extra-9)', () => {
    expect(extractUserId('5551997285829')).toBe('555197285829');
  });

  it('strips + prefix and BR extra-9', () => {
    expect(extractUserId('+5511999999999')).toBe('551199999999');
  });

  it('handles already-clean phone', () => {
    expect(extractUserId('5511888880000')).toBe('5511888880000');
  });
});

describe('toGupshupPhone', () => {
  it('strips leading + and BR extra-9', () => {
    expect(toGupshupPhone('+5511999999999')).toBe('551199999999');
  });

  it('strips BR extra-9', () => {
    expect(toGupshupPhone('5551997285829')).toBe('555197285829');
  });

  it('leaves already-clean 12-digit number unchanged', () => {
    // 12-digit BR number (no extra-9 to strip)
    expect(toGupshupPhone('555197285829')).toBe('555197285829');
  });
});
