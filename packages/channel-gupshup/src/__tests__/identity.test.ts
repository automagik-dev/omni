/**
 * Gupshup identity utilities — unit tests
 *
 * Identity is round-tripped: only transport formatting (+, @suffix, :device)
 * is stripped. The Brazilian extra-9 is always preserved — stripping it would
 * point the outbound callback at a different (non-existent) contact and break
 * Journey/Goals matching.
 */

import { describe, expect, it } from 'bun:test';
import { extractUserId, normalizePhone, toGupshupPhone } from '../utils/identity';

describe('normalizePhone', () => {
  it('strips a leading + but preserves all digits, including the BR extra-9', () => {
    expect(normalizePhone('+5511999999999')).toBe('5511999999999');
  });

  it('preserves the BR extra-9 on a 13-digit mobile', () => {
    expect(normalizePhone('5511959946920')).toBe('5511959946920');
  });

  it('leaves a 12-digit number (no extra-9) unchanged', () => {
    expect(normalizePhone('551133334444')).toBe('551133334444');
  });

  it('strips a JID @suffix', () => {
    expect(normalizePhone('5511959946920@s.whatsapp.net')).toBe('5511959946920');
  });

  it('strips a :device suffix', () => {
    expect(normalizePhone('5511959946920:12')).toBe('5511959946920');
  });

  it('does not touch non-BR numbers', () => {
    expect(normalizePhone('+12125551234')).toBe('12125551234');
  });
});

describe('extractUserId', () => {
  it('preserves the real number (incl. BR extra-9)', () => {
    expect(extractUserId('+5511959946920')).toBe('5511959946920');
  });

  it('strips a JID @suffix', () => {
    expect(extractUserId('5585999726413@s.whatsapp.net')).toBe('5585999726413');
  });
});

describe('toGupshupPhone', () => {
  it('round-trips the contact number with the BR extra-9 (regression: customer_id must keep the 9)', () => {
    // The exact case behind the Journey mismatch: must NOT become 551159946920.
    expect(toGupshupPhone('5511959946920')).toBe('5511959946920');
  });

  it('strips a leading + but keeps the 9', () => {
    expect(toGupshupPhone('+5511911349383')).toBe('5511911349383');
  });

  it('leaves an already-clean 12-digit number unchanged', () => {
    expect(toGupshupPhone('555197285829')).toBe('555197285829');
  });
});
