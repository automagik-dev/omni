/**
 * Tests for vCard contact builder — waid computation and BR mobile normalization
 */

import { describe, expect, it } from 'bun:test';
import { buildVCard, computeWaid } from '../senders/contact';

describe('computeWaid', () => {
  // DDDs 11-30: keep the 9 (WhatsApp stores with it)
  it('keeps leading 9 for DDD 11 (São Paulo)', () => {
    expect(computeWaid('5511960008976')).toBe('5511960008976');
  });

  it('keeps leading 9 for DDD 21 (Rio de Janeiro)', () => {
    expect(computeWaid('5521999887766')).toBe('5521999887766');
  });

  it('keeps leading 9 for DDD 27 (Vitória)', () => {
    expect(computeWaid('5527999112233')).toBe('5527999112233');
  });

  it('keeps leading 9 for DDD 30 (boundary)', () => {
    expect(computeWaid('5530999001122')).toBe('5530999001122');
  });

  // DDDs 31+: strip the 9 (WhatsApp stores without it)
  it('strips leading 9 for DDD 31 (Belo Horizonte)', () => {
    expect(computeWaid('5531960008976')).toBe('553160008976');
  });

  it('strips leading 9 for DDD 62 (Goiânia)', () => {
    expect(computeWaid('5562999991234')).toBe('556299991234');
  });

  it('strips leading 9 for DDD 85 (Fortaleza)', () => {
    expect(computeWaid('5585988776655')).toBe('558588776655');
  });

  // Non-BR and edge cases
  it('leaves 12-digit BR numbers unchanged', () => {
    expect(computeWaid('551160008976')).toBe('551160008976');
  });

  it('leaves US numbers unchanged', () => {
    expect(computeWaid('14155551234')).toBe('14155551234');
  });

  it('leaves international non-BR numbers unchanged', () => {
    expect(computeWaid('447911123456')).toBe('447911123456');
  });

  it('leaves 13-digit non-BR numbers unchanged', () => {
    expect(computeWaid('4479111234567')).toBe('4479111234567');
  });

  it('leaves 13-digit BR number unchanged when position 4 is not 9', () => {
    // 55 + 11 + 3 + ... (landline, position 4 != 9)
    expect(computeWaid('5511312345678')).toBe('5511312345678');
  });
});

describe('buildVCard', () => {
  it('emits TEL line with correct waid for 13-digit BR mobile (DDD 11, keeps 9)', () => {
    const vcard = buildVCard({ name: 'Test User', phone: '+5511960008976' });
    expect(vcard).toContain('TEL;type=CELL;type=VOICE;waid=5511960008976:+5511960008976');
  });

  it('emits TEL line with correct waid for 12-digit BR number', () => {
    const vcard = buildVCard({ name: 'Test User', phone: '+551160008976' });
    expect(vcard).toContain('TEL;type=CELL;type=VOICE;waid=551160008976:+551160008976');
  });

  it('emits TEL line with correct waid for US number', () => {
    const vcard = buildVCard({ name: 'Test User', phone: '+14155551234' });
    expect(vcard).toContain('TEL;type=CELL;type=VOICE;waid=14155551234:+14155551234');
  });

  it('emits TEL line with correct waid for international non-BR number', () => {
    const vcard = buildVCard({ name: 'Test User', phone: '+447911123456' });
    expect(vcard).toContain('TEL;type=CELL;type=VOICE;waid=447911123456:+447911123456');
  });

  it('omits TEL line when phone is empty', () => {
    const vcard = buildVCard({ name: 'Test User' });
    expect(vcard).not.toContain('TEL');
  });

  it('omits TEL line when phone is undefined', () => {
    const vcard = buildVCard({ name: 'Test User', phone: undefined });
    expect(vcard).not.toContain('TEL');
  });

  it('includes BEGIN/END VCARD and FN fields', () => {
    const vcard = buildVCard({ name: 'Jane Doe', phone: '+5511960008976' });
    expect(vcard).toContain('BEGIN:VCARD');
    expect(vcard).toContain('VERSION:3.0');
    expect(vcard).toContain('FN:Jane Doe');
    expect(vcard).toContain('END:VCARD');
  });
});
