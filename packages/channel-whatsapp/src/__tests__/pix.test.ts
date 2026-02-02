/**
 * Tests for PIX payment message sender
 */

import { describe, expect, it } from 'bun:test';
import { type PixData, type PixKeyType, buildPixContent, isValidPixData } from '../senders/pix';

/** Helper type for accessing the wrapped interactive message structure */
interface PixViewOnceMessage {
  viewOnceMessage: {
    message: {
      interactiveMessage: {
        nativeFlowMessage: {
          buttons: Array<{ name: string; buttonParamsJson: string }>;
        };
      };
    };
  };
}

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

  describe('buildPixContent', () => {
    it('builds correct viewOnceMessage wrapper structure', () => {
      const data: PixData = {
        merchantName: 'Test Store',
        key: 'test@example.com',
        keyType: 'EMAIL',
      };

      const content = buildPixContent(data);
      const msg = content as unknown as PixViewOnceMessage;

      expect(msg).toHaveProperty('viewOnceMessage');
      expect(msg.viewOnceMessage).toHaveProperty('message');
      expect(msg.viewOnceMessage.message).toHaveProperty('interactiveMessage');
      expect(msg.viewOnceMessage.message.interactiveMessage).toHaveProperty('nativeFlowMessage');
      expect(msg.viewOnceMessage.message.interactiveMessage.nativeFlowMessage).toHaveProperty('buttons');
      expect(msg.viewOnceMessage.message.interactiveMessage.nativeFlowMessage.buttons).toHaveLength(1);
    });

    it('builds payment_info button with correct name', () => {
      const data: PixData = {
        merchantName: 'Test Store',
        key: '12345678901',
        keyType: 'CPF',
      };

      const content = buildPixContent(data);
      const msg = content as unknown as PixViewOnceMessage;
      const button = msg.viewOnceMessage.message.interactiveMessage.nativeFlowMessage.buttons[0]!;

      expect(button.name).toBe('payment_info');
    });

    it('includes correct payment settings in buttonParamsJson', () => {
      const data: PixData = {
        merchantName: 'My Store',
        key: '+5511999990000',
        keyType: 'PHONE',
      };

      const content = buildPixContent(data);
      const msg = content as unknown as PixViewOnceMessage;
      const button = msg.viewOnceMessage.message.interactiveMessage.nativeFlowMessage.buttons[0]!;
      const params = JSON.parse(button.buttonParamsJson);

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

      const content = buildPixContent(data);
      const msg = content as unknown as PixViewOnceMessage;
      const button = msg.viewOnceMessage.message.interactiveMessage.nativeFlowMessage.buttons[0]!;
      const params = JSON.parse(button.buttonParamsJson);

      expect(params.payment_settings[0].pix_static_code.key_type).toBe('EVP');
      expect(params.payment_settings[0].pix_static_code.key).toBe('123e4567-e89b-12d3-a456-426614174000');
    });

    it('handles special characters in merchant name', () => {
      const data: PixData = {
        merchantName: 'Loja do João & Maria',
        key: 'joao@loja.com',
        keyType: 'EMAIL',
      };

      const content = buildPixContent(data);
      const msg = content as unknown as PixViewOnceMessage;
      const button = msg.viewOnceMessage.message.interactiveMessage.nativeFlowMessage.buttons[0]!;
      const params = JSON.parse(button.buttonParamsJson);

      expect(params.payment_settings[0].pix_static_code.merchant_name).toBe('Loja do João & Maria');
    });
  });
});
