import { describe, expect, test } from 'bun:test';
import { CORE_EVENT_TYPES, isCoreEvent, isCustomEvent, isSystemEvent } from '../../types';

describe('event types', () => {
  describe('CORE_EVENT_TYPES', () => {
    test('contains all expected core events', () => {
      expect(CORE_EVENT_TYPES).toContain('message.received');
      expect(CORE_EVENT_TYPES).toContain('message.sent');
      expect(CORE_EVENT_TYPES).toContain('message.delivered');
      expect(CORE_EVENT_TYPES).toContain('message.read');
      expect(CORE_EVENT_TYPES).toContain('message.failed');
      expect(CORE_EVENT_TYPES).toContain('media.received');
      expect(CORE_EVENT_TYPES).toContain('media.processed');
      expect(CORE_EVENT_TYPES).toContain('identity.created');
      expect(CORE_EVENT_TYPES).toContain('identity.linked');
      expect(CORE_EVENT_TYPES).toContain('identity.merged');
      expect(CORE_EVENT_TYPES).toContain('identity.unlinked');
      expect(CORE_EVENT_TYPES).toContain('instance.connected');
      expect(CORE_EVENT_TYPES).toContain('instance.disconnected');
      expect(CORE_EVENT_TYPES).toContain('instance.qr_code');
      expect(CORE_EVENT_TYPES).toContain('access.allowed');
      expect(CORE_EVENT_TYPES).toContain('access.denied');
    });
  });

  describe('isCoreEvent', () => {
    test('returns true for core events', () => {
      expect(isCoreEvent('message.received')).toBe(true);
      expect(isCoreEvent('instance.connected')).toBe(true);
      expect(isCoreEvent('identity.merged')).toBe(true);
    });

    test('returns false for custom events', () => {
      expect(isCoreEvent('custom.webhook.github')).toBe(false);
      expect(isCoreEvent('custom.cron.daily')).toBe(false);
    });

    test('returns false for system events', () => {
      expect(isCoreEvent('system.dead_letter')).toBe(false);
      expect(isCoreEvent('system.health.degraded')).toBe(false);
    });

    test('returns false for unknown events', () => {
      expect(isCoreEvent('unknown.event')).toBe(false);
    });
  });

  describe('isCustomEvent', () => {
    test('returns true for custom events', () => {
      expect(isCustomEvent('custom.webhook.github')).toBe(true);
      expect(isCustomEvent('custom.cron.daily.report')).toBe(true);
      expect(isCustomEvent('custom.trigger.vip')).toBe(true);
    });

    test('returns false for core events', () => {
      expect(isCustomEvent('message.received')).toBe(false);
    });

    test('returns false for system events', () => {
      expect(isCustomEvent('system.dead_letter')).toBe(false);
    });
  });

  describe('isSystemEvent', () => {
    test('returns true for system events', () => {
      expect(isSystemEvent('system.dead_letter')).toBe(true);
      expect(isSystemEvent('system.replay.started')).toBe(true);
      expect(isSystemEvent('system.health.degraded')).toBe(true);
    });

    test('returns false for core events', () => {
      expect(isSystemEvent('message.received')).toBe(false);
    });

    test('returns false for custom events', () => {
      expect(isSystemEvent('custom.webhook.github')).toBe(false);
    });
  });
});
