/**
 * Tests for read receipts
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import {
  ReceiptTracker,
  createReceiptTracker,
  isDelivered,
  isRead,
  mapStatusCode,
  shouldSendReadReceipt,
} from '../receipts';
import type { ReadReceiptConfig } from '../receipts';

describe('Read Receipts', () => {
  describe('mapStatusCode', () => {
    it('maps 1 to pending', () => {
      expect(mapStatusCode(1)).toBe('pending');
    });

    it('maps 2 to sent', () => {
      expect(mapStatusCode(2)).toBe('sent');
    });

    it('maps 3 to delivered', () => {
      expect(mapStatusCode(3)).toBe('delivered');
    });

    it('maps 4 to read', () => {
      expect(mapStatusCode(4)).toBe('read');
    });

    it('maps 5 to played', () => {
      expect(mapStatusCode(5)).toBe('played');
    });

    it('maps unknown codes to pending', () => {
      expect(mapStatusCode(0)).toBe('pending');
      expect(mapStatusCode(99)).toBe('pending');
    });
  });

  describe('isDelivered', () => {
    it('returns false for pending', () => {
      expect(isDelivered('pending')).toBe(false);
    });

    it('returns false for sent', () => {
      expect(isDelivered('sent')).toBe(false);
    });

    it('returns true for delivered', () => {
      expect(isDelivered('delivered')).toBe(true);
    });

    it('returns true for read', () => {
      expect(isDelivered('read')).toBe(true);
    });

    it('returns true for played', () => {
      expect(isDelivered('played')).toBe(true);
    });
  });

  describe('isRead', () => {
    it('returns false for pending', () => {
      expect(isRead('pending')).toBe(false);
    });

    it('returns false for sent', () => {
      expect(isRead('sent')).toBe(false);
    });

    it('returns false for delivered', () => {
      expect(isRead('delivered')).toBe(false);
    });

    it('returns true for read', () => {
      expect(isRead('read')).toBe(true);
    });

    it('returns true for played', () => {
      expect(isRead('played')).toBe(true);
    });
  });

  describe('ReceiptTracker', () => {
    let tracker: ReceiptTracker;

    beforeEach(() => {
      tracker = createReceiptTracker();
    });

    it('updates and gets receipt status', () => {
      tracker.update('msg_1', 'sent');
      expect(tracker.get('msg_1')).toBe('sent');
    });

    it('returns undefined for unknown message', () => {
      expect(tracker.get('unknown')).toBeUndefined();
    });

    it('tracks delivery status', () => {
      tracker.update('msg_1', 'delivered');
      expect(tracker.isDelivered('msg_1')).toBe(true);
      expect(tracker.isRead('msg_1')).toBe(false);
    });

    it('tracks read status', () => {
      tracker.update('msg_1', 'read');
      expect(tracker.isDelivered('msg_1')).toBe(true);
      expect(tracker.isRead('msg_1')).toBe(true);
    });

    it('returns false for unknown message delivery', () => {
      expect(tracker.isDelivered('unknown')).toBe(false);
    });

    it('returns false for unknown message read', () => {
      expect(tracker.isRead('unknown')).toBe(false);
    });

    it('clears all receipts', () => {
      tracker.update('msg_1', 'sent');
      tracker.update('msg_2', 'delivered');
      tracker.clear();
      expect(tracker.get('msg_1')).toBeUndefined();
      expect(tracker.get('msg_2')).toBeUndefined();
    });

    it('updates status when called multiple times', () => {
      tracker.update('msg_1', 'sent');
      expect(tracker.get('msg_1')).toBe('sent');

      tracker.update('msg_1', 'delivered');
      expect(tracker.get('msg_1')).toBe('delivered');

      tracker.update('msg_1', 'read');
      expect(tracker.get('msg_1')).toBe('read');
    });
  });

  describe('createReceiptTracker', () => {
    it('creates a new ReceiptTracker instance', () => {
      const tracker = createReceiptTracker();
      expect(tracker).toBeInstanceOf(ReceiptTracker);
    });
  });

  describe('shouldSendReadReceipt', () => {
    it('returns true when mode is on', () => {
      const config: ReadReceiptConfig = { mode: 'on' };
      expect(shouldSendReadReceipt(config)).toBe(true);
    });

    it('returns false when mode is off', () => {
      const config: ReadReceiptConfig = { mode: 'off' };
      expect(shouldSendReadReceipt(config)).toBe(false);
    });

    it('returns true for exclude-self when sender is different', () => {
      const config: ReadReceiptConfig = {
        mode: 'exclude-self',
        ownerJid: '5511999998888@s.whatsapp.net',
      };
      expect(shouldSendReadReceipt(config, '5511888887777@s.whatsapp.net')).toBe(true);
    });

    it('returns false for exclude-self when sender is self', () => {
      const config: ReadReceiptConfig = {
        mode: 'exclude-self',
        ownerJid: '5511999998888@s.whatsapp.net',
      };
      expect(shouldSendReadReceipt(config, '5511999998888@s.whatsapp.net')).toBe(false);
    });

    it('normalizes JIDs with device suffix for exclude-self', () => {
      const config: ReadReceiptConfig = {
        mode: 'exclude-self',
        ownerJid: '5511999998888:42@s.whatsapp.net',
      };
      expect(shouldSendReadReceipt(config, '5511999998888@s.whatsapp.net')).toBe(false);
    });

    it('returns true for exclude-self when no ownerJid configured', () => {
      const config: ReadReceiptConfig = { mode: 'exclude-self' };
      expect(shouldSendReadReceipt(config, '5511999998888@s.whatsapp.net')).toBe(true);
    });

    it('returns true for exclude-self when no senderJid provided', () => {
      const config: ReadReceiptConfig = {
        mode: 'exclude-self',
        ownerJid: '5511999998888@s.whatsapp.net',
      };
      expect(shouldSendReadReceipt(config)).toBe(true);
    });
  });
});
