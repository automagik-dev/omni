/** Pairing code generation without a database connection. */
import { describe, expect, test } from 'bun:test';
import { AccessService } from '../services/access';

describe('Pairing Flow', () => {
  // ==========================================================================
  // Pairing Code Generation
  // ==========================================================================

  describe('Pairing code generation', () => {
    test('generates 6-character code', () => {
      const code = AccessService.generatePairingCode();
      expect(code).toHaveLength(6);
    });

    test('code uses only A-Z, 0-9 charset (no lowercase)', () => {
      // Generate multiple codes and verify charset
      for (let i = 0; i < 100; i++) {
        const code = AccessService.generatePairingCode();
        expect(code).toMatch(/^[A-Z0-9]{6}$/);
      }
    });

    test('generates unique codes (statistical test)', () => {
      const codes = new Set<string>();
      for (let i = 0; i < 50; i++) {
        codes.add(AccessService.generatePairingCode());
      }
      // With 2.1B combinations, 50 codes should all be unique
      expect(codes.size).toBe(50);
    });
  });
});

// ==========================================================================
// Unit tests (no DB required)
// ==========================================================================

describe('Pairing code charset validation', () => {
  test('all generated codes match A-Z0-9 pattern', () => {
    for (let i = 0; i < 200; i++) {
      const code = AccessService.generatePairingCode();
      expect(code).toMatch(/^[A-Z0-9]{6}$/);
      // Ensure no lowercase
      expect(code).toBe(code.toUpperCase());
    }
  });

  test('code length is exactly 6', () => {
    const code = AccessService.generatePairingCode();
    expect(code.length).toBe(6);
  });
});
