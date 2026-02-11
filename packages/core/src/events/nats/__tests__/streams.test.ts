import { describe, expect, test } from 'bun:test';
import { RetentionPolicy, StorageType } from 'nats';
import { STREAM_CONFIGS, STREAM_NAMES, getStreamForEventType } from '../streams';

describe('streams', () => {
  describe('STREAM_NAMES', () => {
    test('has all 8 streams defined', () => {
      expect(Object.keys(STREAM_NAMES)).toHaveLength(8);
      expect(STREAM_NAMES.MESSAGE).toBe('MESSAGE');
      expect(STREAM_NAMES.REACTION).toBe('REACTION');
      expect(STREAM_NAMES.INSTANCE).toBe('INSTANCE');
      expect(STREAM_NAMES.IDENTITY).toBe('IDENTITY');
      expect(STREAM_NAMES.MEDIA).toBe('MEDIA');
      expect(STREAM_NAMES.ACCESS).toBe('ACCESS');
      expect(STREAM_NAMES.CUSTOM).toBe('CUSTOM');
      expect(STREAM_NAMES.SYSTEM).toBe('SYSTEM');
    });
  });

  describe('STREAM_CONFIGS', () => {
    test('has config for each stream', () => {
      for (const name of Object.values(STREAM_NAMES)) {
        expect(STREAM_CONFIGS[name]).toBeDefined();
        expect(STREAM_CONFIGS[name].name).toBe(name);
        expect(STREAM_CONFIGS[name].subjects).toBeDefined();
        expect(STREAM_CONFIGS[name].max_age).toBeGreaterThan(0);
      }
    });

    test('MESSAGE stream has correct config', () => {
      const config = STREAM_CONFIGS.MESSAGE;
      expect(config.subjects).toEqual(['message.>']);
      expect(config.storage).toBe(StorageType.File);
      expect(config.retention).toBe(RetentionPolicy.Limits);
    });

    test('CUSTOM stream captures custom.> subjects', () => {
      const config = STREAM_CONFIGS.CUSTOM;
      expect(config.subjects).toEqual(['custom.>']);
    });

    test('SYSTEM stream captures system.>, sync.>, batch-job.>, and presence.> subjects', () => {
      const config = STREAM_CONFIGS.SYSTEM;
      expect(config.subjects).toEqual(['system.>', 'sync.>', 'batch-job.>', 'presence.>']);
    });
  });

  describe('getStreamForEventType', () => {
    test('routes message events to MESSAGE stream', () => {
      expect(getStreamForEventType('message.received')).toBe('MESSAGE');
      expect(getStreamForEventType('message.sent')).toBe('MESSAGE');
      expect(getStreamForEventType('message.delivered')).toBe('MESSAGE');
    });

    test('routes instance events to INSTANCE stream', () => {
      expect(getStreamForEventType('instance.connected')).toBe('INSTANCE');
      expect(getStreamForEventType('instance.disconnected')).toBe('INSTANCE');
      expect(getStreamForEventType('instance.qr_code')).toBe('INSTANCE');
    });

    test('routes identity events to IDENTITY stream', () => {
      expect(getStreamForEventType('identity.created')).toBe('IDENTITY');
      expect(getStreamForEventType('identity.linked')).toBe('IDENTITY');
      expect(getStreamForEventType('identity.merged')).toBe('IDENTITY');
    });

    test('routes media events to MEDIA stream', () => {
      expect(getStreamForEventType('media.received')).toBe('MEDIA');
      expect(getStreamForEventType('media.processed')).toBe('MEDIA');
    });

    test('routes access events to ACCESS stream', () => {
      expect(getStreamForEventType('access.allowed')).toBe('ACCESS');
      expect(getStreamForEventType('access.denied')).toBe('ACCESS');
    });

    test('routes custom events to CUSTOM stream', () => {
      expect(getStreamForEventType('custom.webhook.github')).toBe('CUSTOM');
      expect(getStreamForEventType('custom.cron.daily')).toBe('CUSTOM');
    });

    test('routes system events to SYSTEM stream', () => {
      expect(getStreamForEventType('system.dead_letter')).toBe('SYSTEM');
      expect(getStreamForEventType('system.replay.started')).toBe('SYSTEM');
    });

    test('routes unknown events to CUSTOM stream', () => {
      expect(getStreamForEventType('unknown.event')).toBe('CUSTOM');
    });
  });
});
