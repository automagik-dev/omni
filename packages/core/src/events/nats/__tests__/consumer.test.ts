import { describe, expect, test } from 'bun:test';
import { AckPolicy, DeliverPolicy } from 'nats';
import {
  DEFAULT_CONSUMER_CONFIG,
  buildConsumerConfig,
  calculateBackoffDelay,
  generateConsumerName,
  getStreamForPattern,
} from '../consumer';

describe('consumer', () => {
  describe('buildConsumerConfig', () => {
    test('builds config with defaults', () => {
      const config = buildConsumerConfig('message.received.>');

      expect(config.filter_subject).toBe('message.received.>');
      expect(config.ack_policy).toBe(AckPolicy.Explicit);
      expect(config.deliver_policy).toBe(DeliverPolicy.New);
      expect(config.max_deliver).toBe(DEFAULT_CONSUMER_CONFIG.maxRetries + 1);
    });

    test('includes durable name when provided', () => {
      const config = buildConsumerConfig('message.received.>', {
        durable: 'my-consumer',
      });

      expect(config.durable_name).toBe('my-consumer');
    });

    test('includes queue group when provided', () => {
      const config = buildConsumerConfig('message.received.>', {
        queue: 'message-processors',
      });

      expect(config.deliver_group).toBe('message-processors');
    });

    test('maps startFrom to deliver policy', () => {
      expect(buildConsumerConfig('test', { startFrom: 'new' }).deliver_policy).toBe(DeliverPolicy.New);
      expect(buildConsumerConfig('test', { startFrom: 'first' }).deliver_policy).toBe(DeliverPolicy.All);
      expect(buildConsumerConfig('test', { startFrom: 'last' }).deliver_policy).toBe(DeliverPolicy.Last);
    });

    test('uses StartTime for Date startFrom', () => {
      const config = buildConsumerConfig('test', { startFrom: new Date() });
      expect(config.deliver_policy).toBe(DeliverPolicy.StartTime);
    });

    test('respects custom maxRetries', () => {
      const config = buildConsumerConfig('test', { maxRetries: 5 });
      expect(config.max_deliver).toBe(6); // +1 for first delivery
    });

    test('respects custom ackWaitMs', () => {
      const config = buildConsumerConfig('test', { ackWaitMs: 60000 });
      expect(config.ack_wait).toBe(60000 * 1_000_000); // nanoseconds
    });
  });

  describe('generateConsumerName', () => {
    test('generates unique names', () => {
      const name1 = generateConsumerName('message.received.>');
      const name2 = generateConsumerName('message.received.>');

      expect(name1).not.toBe(name2);
      expect(name1).toMatch(/^consumer-message-received-/);
    });

    test('sanitizes pattern', () => {
      const name = generateConsumerName('message.*.whatsapp.>');
      expect(name).not.toContain('*');
      expect(name).not.toContain('>');
      expect(name).not.toContain('.');
    });
  });

  describe('getStreamForPattern', () => {
    test('determines stream from pattern prefix', () => {
      expect(getStreamForPattern('message.received.>')).toBe('MESSAGE');
      expect(getStreamForPattern('instance.connected.>')).toBe('INSTANCE');
      expect(getStreamForPattern('identity.linked.>')).toBe('IDENTITY');
      expect(getStreamForPattern('media.processed.>')).toBe('MEDIA');
      expect(getStreamForPattern('access.allowed.>')).toBe('ACCESS');
      expect(getStreamForPattern('custom.webhook.>')).toBe('CUSTOM');
      expect(getStreamForPattern('system.dead_letter.>')).toBe('SYSTEM');
    });

    test('throws for pure wildcard patterns', () => {
      expect(() => getStreamForPattern('>')).toThrow('Cannot determine stream');
      expect(() => getStreamForPattern('*.>')).toThrow('Cannot determine stream');
    });
  });

  describe('calculateBackoffDelay', () => {
    test('calculates exponential backoff', () => {
      // First retry (retryCount = 0): baseDelay * 2^0 = 1000ms
      const delay0 = calculateBackoffDelay(0, 1000);
      expect(delay0).toBeGreaterThanOrEqual(900);
      expect(delay0).toBeLessThanOrEqual(1100);

      // Second retry (retryCount = 1): baseDelay * 2^1 = 2000ms
      const delay1 = calculateBackoffDelay(1, 1000);
      expect(delay1).toBeGreaterThanOrEqual(1800);
      expect(delay1).toBeLessThanOrEqual(2200);

      // Third retry (retryCount = 2): baseDelay * 2^2 = 4000ms
      const delay2 = calculateBackoffDelay(2, 1000);
      expect(delay2).toBeGreaterThanOrEqual(3600);
      expect(delay2).toBeLessThanOrEqual(4400);
    });

    test('caps at maxDelayMs', () => {
      const delay = calculateBackoffDelay(10, 1000, 5000);
      expect(delay).toBeLessThanOrEqual(5000);
    });

    test('uses default values', () => {
      const delay = calculateBackoffDelay(0);
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThanOrEqual(DEFAULT_CONSUMER_CONFIG.retryDelayMs * 1.1);
    });
  });

  describe('DEFAULT_CONSUMER_CONFIG', () => {
    test('has sensible defaults', () => {
      expect(DEFAULT_CONSUMER_CONFIG.maxRetries).toBe(3);
      expect(DEFAULT_CONSUMER_CONFIG.retryDelayMs).toBe(1000);
      expect(DEFAULT_CONSUMER_CONFIG.ackWaitMs).toBe(30_000);
      expect(DEFAULT_CONSUMER_CONFIG.maxAckPending).toBe(1000);
    });
  });
});
