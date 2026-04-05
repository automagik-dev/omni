/**
 * Tests for vCard contact builder — waid computation and BR mobile normalization
 */

import { describe, expect, it } from 'bun:test';
import { buildVCard, computeWaid } from '../senders/contact';

describe('computeWaid', () => {
  it('strips leading 9 from 13-digit BR mobile numbers', () => {
    // 55 + 11 (area) + 9 (leading) + 60008976 → drop the 9
    expect(computeWaid('5511960008976')).toBe('551160008976');
  });

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
    // 13 digits but does not start with 55
    expect(computeWaid('4479111234567')).toBe('4479111234567');
  });

  it('leaves 13-digit BR number unchanged when position 4 is not 9', () => {
    // 55 + 11 + 3 + ... (landline, position 4 != 9)
    expect(computeWaid('5511312345678')).toBe('5511312345678');
  });
});

describe('buildVCard', () => {
  it('emits TEL line with correct waid for 13-digit BR mobile', () => {
    const vcard = buildVCard({ name: 'Test User', phone: '+5511960008976' });
    expect(vcard).toContain('TEL;type=CELL;type=VOICE;waid=551160008976:+5511960008976');
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
