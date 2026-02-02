/**
 * Tests for PIX payment message sender
 */

import { describe, expect, it } from 'bun:test';
import { type PixData, type PixKeyType, buildPixButtonParams, isValidPixData } from '../senders/pix';

describe('PIX Sender', () => {
  describe('isValidPixData', () => {
    it('returns true for valid PIX data', () => {
      const data: PixData = {
        merchantName: 'Test Store',
        key: 'test@example.com',
        keyType: 'EMAIL',
      };
      expect(isValidPixData(data)).toBe(true);
    });

    it('returns false for empty merchant name', () => {
      const data: PixData = {
        merchantName: '',
        key: 'test@example.com',
        keyType: 'EMAIL',
      };
      expect(isValidPixData(data)).toBe(false);
    });

    it('returns false for whitespace-only merchant name', () => {
      const data: PixData = {
        merchantName: '   ',
        key: 'test@example.com',
        keyType: 'EMAIL',
      };
      expect(isValidPixData(data)).toBe(false);
    });

    it('returns false for empty key', () => {
      const data: PixData = {
        merchantName: 'Test Store',
        key: '',
        keyType: 'EMAIL',
      };
      expect(isValidPixData(data)).toBe(false);
    });

    it('returns false for invalid key type', () => {
      const data = {
        merchantName: 'Test Store',
        key: 'test@example.com',
        keyType: 'INVALID' as PixKeyType,
      };
      expect(isValidPixData(data)).toBe(false);
    });

    it('validates all supported key types', () => {
      const keyTypes: PixKeyType[] = ['PHONE', 'EMAIL', 'CPF', 'EVP'];

      for (const keyType of keyTypes) {
        const data: PixData = {
          merchantName: 'Test Store',
          key: 'some-key',
          keyType,
        };
        expect(isValidPixData(data)).toBe(true);
      }
    });
  });

  describe('buildPixButtonParams', () => {
    it('builds valid JSON string', () => {
      const data: PixData = {
        merchantName: 'Test Store',
        key: 'test@example.com',
        keyType: 'EMAIL',
      };

      const paramsJson = buildPixButtonParams(data);
      expect(() => JSON.parse(paramsJson)).not.toThrow();
    });

    it('includes correct payment settings structure', () => {
      const data: PixData = {
        merchantName: 'My Store',
        key: '+5511999990000',
        keyType: 'PHONE',
      };

      const paramsJson = buildPixButtonParams(data);
      const params = JSON.parse(paramsJson);

      expect(params).toHaveProperty('payment_settings');
      expect(params.payment_settings).toHaveLength(1);
      expect(params.payment_settings[0].type).toBe('pix_static_code');
      expect(params.payment_settings[0].pix_static_code).toEqual({
        merchant_name: 'My Store',
        key: '+5511999990000',
        key_type: 'PHONE',
      });
    });

    it('handles EVP (random key) type', () => {
      const data: PixData = {
        merchantName: 'Store Name',
        key: '123e4567-e89b-12d3-a456-426614174000',
        keyType: 'EVP',
      };

      const paramsJson = buildPixButtonParams(data);
      const params = JSON.parse(paramsJson);

      expect(params.payment_settings[0].pix_static_code.key_type).toBe('EVP');
      expect(params.payment_settings[0].pix_static_code.key).toBe('123e4567-e89b-12d3-a456-426614174000');
    });

    it('handles CPF key type', () => {
      const data: PixData = {
        merchantName: 'Test Store',
        key: '12345678901',
        keyType: 'CPF',
      };

      const paramsJson = buildPixButtonParams(data);
      const params = JSON.parse(paramsJson);

      expect(params.payment_settings[0].pix_static_code.key_type).toBe('CPF');
      expect(params.payment_settings[0].pix_static_code.key).toBe('12345678901');
    });

    it('handles special characters in merchant name', () => {
      const data: PixData = {
        merchantName: 'Loja do João & Maria',
        key: 'joao@loja.com',
        keyType: 'EMAIL',
      };

      const paramsJson = buildPixButtonParams(data);
      const params = JSON.parse(paramsJson);

      expect(params.payment_settings[0].pix_static_code.merchant_name).toBe('Loja do João & Maria');
    });
  });
});
