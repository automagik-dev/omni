import { describe, expect, test } from 'bun:test';
import { buildSubject, buildSubscribePattern, eventTypeToPattern, matchesPattern, parseSubject } from '../subjects';

describe('subjects', () => {
  describe('buildSubject', () => {
    test('builds full subject with all parts', () => {
      const subject = buildSubject('message.received', 'whatsapp-baileys', 'wa-001');
      expect(subject).toBe('message.received.whatsapp-baileys.wa-001');
    });

    test('handles different event types', () => {
      expect(buildSubject('instance.connected', 'discord', 'dc-123')).toBe('instance.connected.discord.dc-123');
      expect(buildSubject('identity.linked', 'slack', 'sl-abc')).toBe('identity.linked.slack.sl-abc');
    });

    test('handles custom events', () => {
      const subject = buildSubject('custom.webhook.github', 'whatsapp-baileys', 'wa-001');
      expect(subject).toBe('custom.webhook.github.whatsapp-baileys.wa-001');
    });

    test('handles system events', () => {
      const subject = buildSubject('system.dead_letter', 'whatsapp-baileys', 'wa-001');
      expect(subject).toBe('system.dead_letter.whatsapp-baileys.wa-001');
    });
  });

  describe('buildSubscribePattern', () => {
    test('builds pattern for specific event type', () => {
      const pattern = buildSubscribePattern({ eventType: 'message.received' });
      expect(pattern).toBe('message.received.>');
    });

    test('builds pattern for channel type only', () => {
      const pattern = buildSubscribePattern({ channelType: 'whatsapp-baileys' });
      expect(pattern).toBe('*.*.whatsapp-baileys.>');
    });

    test('builds pattern for event type and channel', () => {
      const pattern = buildSubscribePattern({
        eventType: 'message.received',
        channelType: 'whatsapp-baileys',
      });
      expect(pattern).toBe('message.received.whatsapp-baileys.>');
    });

    test('builds pattern for specific instance', () => {
      const pattern = buildSubscribePattern({
        eventType: 'message.received',
        channelType: 'whatsapp-baileys',
        instanceId: 'wa-001',
      });
      expect(pattern).toBe('message.received.whatsapp-baileys.wa-001');
    });

    test('builds wildcard pattern for all events', () => {
      const pattern = buildSubscribePattern({});
      expect(pattern).toBe('>');
    });
  });

  describe('parseSubject', () => {
    test('parses full subject', () => {
      const parsed = parseSubject('message.received.whatsapp-baileys.wa-001');
      expect(parsed).toEqual({
        domain: 'message',
        action: 'received',
        eventType: 'message.received',
        channelType: 'whatsapp-baileys',
        instanceId: 'wa-001',
      });
    });

    test('handles instance IDs with dots', () => {
      const parsed = parseSubject('message.received.discord.dc.server.123');
      expect(parsed).toEqual({
        domain: 'message',
        action: 'received',
        eventType: 'message.received',
        channelType: 'discord',
        instanceId: 'dc.server.123',
      });
    });

    test('returns null for invalid subjects', () => {
      expect(parseSubject('message')).toBeNull();
      expect(parseSubject('message.received')).toBeNull();
      expect(parseSubject('message.received.whatsapp')).toBeNull();
    });
  });

  describe('matchesPattern', () => {
    test('matches exact subjects', () => {
      expect(
        matchesPattern('message.received.whatsapp-baileys.wa-001', 'message.received.whatsapp-baileys.wa-001'),
      ).toBe(true);
    });

    test('matches with > wildcard', () => {
      expect(matchesPattern('message.received.whatsapp-baileys.wa-001', 'message.received.>')).toBe(true);
      expect(matchesPattern('message.received.discord.dc-123', 'message.received.>')).toBe(true);
    });

    test('matches with * wildcard', () => {
      expect(matchesPattern('message.received.whatsapp-baileys.wa-001', 'message.*.whatsapp-baileys.wa-001')).toBe(
        true,
      );
      expect(matchesPattern('message.sent.whatsapp-baileys.wa-001', 'message.*.whatsapp-baileys.wa-001')).toBe(true);
    });

    test('does not match different subjects', () => {
      expect(matchesPattern('message.received.whatsapp-baileys.wa-001', 'message.sent.whatsapp-baileys.wa-001')).toBe(
        false,
      );
      expect(
        matchesPattern('message.received.whatsapp-baileys.wa-001', 'instance.connected.whatsapp-baileys.wa-001'),
      ).toBe(false);
    });
  });

  describe('eventTypeToPattern', () => {
    test('converts event type to subscribe pattern', () => {
      expect(eventTypeToPattern('message.received')).toBe('message.received.>');
      expect(eventTypeToPattern('instance.connected')).toBe('instance.connected.>');
      expect(eventTypeToPattern('custom.webhook.github')).toBe('custom.webhook.github.>');
    });
  });
});
