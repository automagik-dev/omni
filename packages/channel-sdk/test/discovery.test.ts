/**
 * Tests for auto-discovery utilities
 */

import { describe, expect, it } from 'bun:test';
import { formatValidationErrors, isValidChannelType, validatePluginInterface } from '../src';

describe('Plugin validation', () => {
  describe('isValidChannelType', () => {
    it('should accept valid channel types', () => {
      expect(isValidChannelType('whatsapp-baileys')).toBe(true);
      expect(isValidChannelType('whatsapp-cloud')).toBe(true);
      expect(isValidChannelType('discord')).toBe(true);
      expect(isValidChannelType('slack')).toBe(true);
      expect(isValidChannelType('telegram')).toBe(true);
    });

    it('should reject invalid channel types', () => {
      expect(isValidChannelType('invalid')).toBe(false);
      expect(isValidChannelType('')).toBe(false);
      expect(isValidChannelType(123)).toBe(false);
      expect(isValidChannelType(null)).toBe(false);
    });
  });

  describe('validatePluginInterface', () => {
    it('should validate a complete plugin', () => {
      const validPlugin = {
        id: 'whatsapp-baileys',
        name: 'WhatsApp',
        version: '1.0.0',
        capabilities: { canSendText: true },
        initialize: async () => {},
        destroy: async () => {},
        connect: async () => {},
        disconnect: async () => {},
        getStatus: async () => ({ state: 'connected', since: new Date() }),
        getConnectedInstances: () => [],
        sendMessage: async () => ({ success: true, timestamp: Date.now() }),
        getHealth: async () => ({ status: 'healthy', checks: [], checkedAt: new Date() }),
      };

      const result = validatePluginInterface(validPlugin);
      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should reject non-objects', () => {
      expect(validatePluginInterface(null).valid).toBe(false);
      expect(validatePluginInterface('string').valid).toBe(false);
      expect(validatePluginInterface(123).valid).toBe(false);
    });

    it('should require id', () => {
      const plugin = {
        name: 'Test',
        version: '1.0.0',
        capabilities: {},
        initialize: async () => {},
        destroy: async () => {},
        connect: async () => {},
        disconnect: async () => {},
        getStatus: async () => ({ state: 'connected', since: new Date() }),
        getConnectedInstances: () => [],
        sendMessage: async () => ({ success: true, timestamp: Date.now() }),
        getHealth: async () => ({ status: 'healthy', checks: [], checkedAt: new Date() }),
      };

      const result = validatePluginInterface(plugin);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'id')).toBe(true);
    });

    it('should require valid channel type for id', () => {
      const plugin = {
        id: 'invalid-type',
        name: 'Test',
        version: '1.0.0',
        capabilities: {},
        initialize: async () => {},
        destroy: async () => {},
        connect: async () => {},
        disconnect: async () => {},
        getStatus: async () => ({ state: 'connected', since: new Date() }),
        getConnectedInstances: () => [],
        sendMessage: async () => ({ success: true, timestamp: Date.now() }),
        getHealth: async () => ({ status: 'healthy', checks: [], checkedAt: new Date() }),
      };

      const result = validatePluginInterface(plugin);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'id' && e.message.includes('ChannelType'))).toBe(true);
    });

    it('should require all methods', () => {
      const plugin = {
        id: 'whatsapp-baileys',
        name: 'Test',
        version: '1.0.0',
        capabilities: {},
        // Missing methods
      };

      const result = validatePluginInterface(plugin);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'initialize')).toBe(true);
      expect(result.errors.some((e) => e.field === 'destroy')).toBe(true);
      expect(result.errors.some((e) => e.field === 'connect')).toBe(true);
    });
  });

  describe('formatValidationErrors', () => {
    it('should format errors as bullet list', () => {
      const errors = [
        { field: 'id', message: 'required' },
        { field: 'name', message: 'must be string' },
      ];

      const formatted = formatValidationErrors(errors);
      expect(formatted).toContain('- id: required');
      expect(formatted).toContain('- name: must be string');
    });
  });
});
