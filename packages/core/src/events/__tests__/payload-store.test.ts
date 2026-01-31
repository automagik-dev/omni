import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_RETENTION_DAYS,
  DEFAULT_STORAGE_CONFIG,
  PAYLOAD_STAGES,
  compressPayload,
  decompressPayload,
  detectContentFlags,
  preparePayloadInsert,
  shouldStoreStage,
} from '../payload-store';

describe('payload-store', () => {
  describe('PAYLOAD_STAGES', () => {
    test('has correct stages', () => {
      expect(PAYLOAD_STAGES).toEqual(['webhook_raw', 'agent_request', 'agent_response', 'channel_send', 'error']);
    });
  });

  describe('DEFAULT_RETENTION_DAYS', () => {
    test('has correct defaults', () => {
      expect(DEFAULT_RETENTION_DAYS.webhook_raw).toBe(14);
      expect(DEFAULT_RETENTION_DAYS.agent_request).toBe(14);
      expect(DEFAULT_RETENTION_DAYS.agent_response).toBe(14);
      expect(DEFAULT_RETENTION_DAYS.channel_send).toBe(14);
      expect(DEFAULT_RETENTION_DAYS.error).toBe(30);
    });
  });

  describe('DEFAULT_STORAGE_CONFIG', () => {
    test('stores all stages by default', () => {
      expect(DEFAULT_STORAGE_CONFIG.storeWebhookRaw).toBe(true);
      expect(DEFAULT_STORAGE_CONFIG.storeAgentRequest).toBe(true);
      expect(DEFAULT_STORAGE_CONFIG.storeAgentResponse).toBe(true);
      expect(DEFAULT_STORAGE_CONFIG.storeChannelSend).toBe(true);
      expect(DEFAULT_STORAGE_CONFIG.storeError).toBe(true);
      expect(DEFAULT_STORAGE_CONFIG.retentionDays).toBe(14);
    });
  });

  describe('compressPayload', () => {
    test('compresses a simple object', () => {
      const payload = { message: 'Hello, World!' };
      const result = compressPayload(payload);

      expect(result.compressed).toBeTruthy();
      expect(result.originalSize).toBeGreaterThan(0);
      expect(result.compressedSize).toBeGreaterThan(0);
      expect(result.compressionRatio).toBeGreaterThan(0);
    });

    test('achieves good compression on repetitive data', () => {
      const payload = { text: 'Hello '.repeat(1000) };
      const result = compressPayload(payload);

      // Repetitive data should compress well (at least 5:1)
      expect(result.compressionRatio).toBeGreaterThan(5);
    });

    test('returns base64 encoded string', () => {
      const payload = { test: 'data' };
      const result = compressPayload(payload);

      // Base64 should only contain valid characters
      expect(result.compressed).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });

    test('handles nested objects', () => {
      const payload = {
        level1: {
          level2: {
            level3: {
              value: 'deep',
            },
          },
        },
      };
      const result = compressPayload(payload);

      expect(result.compressed).toBeTruthy();
    });

    test('handles arrays', () => {
      const payload = { items: [1, 2, 3, 4, 5] };
      const result = compressPayload(payload);

      expect(result.compressed).toBeTruthy();
    });
  });

  describe('decompressPayload', () => {
    test('decompresses to original data', () => {
      const original = { message: 'Hello, World!', count: 42 };
      const { compressed } = compressPayload(original);

      const decompressed = decompressPayload(compressed);

      expect(decompressed).toEqual(original);
    });

    test('preserves complex structures', () => {
      const original = {
        string: 'text',
        number: 123.456,
        boolean: true,
        null: null,
        array: [1, 'two', { three: 3 }],
        nested: { a: { b: { c: 'd' } } },
      };
      const { compressed } = compressPayload(original);

      const decompressed = decompressPayload(compressed);

      expect(decompressed).toEqual(original);
    });

    test('handles empty objects', () => {
      const original = {};
      const { compressed } = compressPayload(original);

      const decompressed = decompressPayload(compressed);

      expect(decompressed).toEqual(original);
    });
  });

  describe('detectContentFlags', () => {
    test('detects no media in plain text', () => {
      const payload = { text: 'Hello, this is plain text' };
      const flags = detectContentFlags(payload);

      expect(flags.containsMedia).toBe(false);
      expect(flags.containsBase64).toBe(false);
    });

    test('detects media URLs', () => {
      const payloadJpg = { url: 'https://example.com/image.jpg' };
      expect(detectContentFlags(payloadJpg).containsMedia).toBe(true);

      const payloadMp4 = { url: 'https://example.com/video.mp4' };
      expect(detectContentFlags(payloadMp4).containsMedia).toBe(true);

      const payloadPdf = { url: 'https://example.com/document.pdf' };
      expect(detectContentFlags(payloadPdf).containsMedia).toBe(true);
    });

    test('detects mimeType field', () => {
      const payload = { mimeType: 'image/png', data: 'something' };
      const flags = detectContentFlags(payload);

      expect(flags.containsMedia).toBe(true);
    });

    test('detects mediaUrl field', () => {
      const payload = { mediaUrl: 'https://storage.example.com/file' };
      const flags = detectContentFlags(payload);

      expect(flags.containsMedia).toBe(true);
    });

    test('detects base64 data', () => {
      // Create a long base64-like string (at least 100 chars)
      const base64Data = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.repeat(5);
      const payload = { data: base64Data };
      const flags = detectContentFlags(payload);

      expect(flags.containsBase64).toBe(true);
    });

    test('detects data URLs', () => {
      const payload = { image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA' };
      const flags = detectContentFlags(payload);

      expect(flags.containsBase64).toBe(true);
    });

    test('does not flag short strings as base64', () => {
      const payload = { code: 'ABC123' };
      const flags = detectContentFlags(payload);

      expect(flags.containsBase64).toBe(false);
    });
  });

  describe('shouldStoreStage', () => {
    test('respects storeWebhookRaw', () => {
      const configTrue = { ...DEFAULT_STORAGE_CONFIG, storeWebhookRaw: true };
      const configFalse = { ...DEFAULT_STORAGE_CONFIG, storeWebhookRaw: false };

      expect(shouldStoreStage('webhook_raw', configTrue)).toBe(true);
      expect(shouldStoreStage('webhook_raw', configFalse)).toBe(false);
    });

    test('respects storeAgentRequest', () => {
      const configTrue = { ...DEFAULT_STORAGE_CONFIG, storeAgentRequest: true };
      const configFalse = { ...DEFAULT_STORAGE_CONFIG, storeAgentRequest: false };

      expect(shouldStoreStage('agent_request', configTrue)).toBe(true);
      expect(shouldStoreStage('agent_request', configFalse)).toBe(false);
    });

    test('respects storeAgentResponse', () => {
      const configTrue = { ...DEFAULT_STORAGE_CONFIG, storeAgentResponse: true };
      const configFalse = { ...DEFAULT_STORAGE_CONFIG, storeAgentResponse: false };

      expect(shouldStoreStage('agent_response', configTrue)).toBe(true);
      expect(shouldStoreStage('agent_response', configFalse)).toBe(false);
    });

    test('respects storeChannelSend', () => {
      const configTrue = { ...DEFAULT_STORAGE_CONFIG, storeChannelSend: true };
      const configFalse = { ...DEFAULT_STORAGE_CONFIG, storeChannelSend: false };

      expect(shouldStoreStage('channel_send', configTrue)).toBe(true);
      expect(shouldStoreStage('channel_send', configFalse)).toBe(false);
    });

    test('respects storeError', () => {
      const configTrue = { ...DEFAULT_STORAGE_CONFIG, storeError: true };
      const configFalse = { ...DEFAULT_STORAGE_CONFIG, storeError: false };

      expect(shouldStoreStage('error', configTrue)).toBe(true);
      expect(shouldStoreStage('error', configFalse)).toBe(false);
    });
  });

  describe('preparePayloadInsert', () => {
    test('prepares insert data correctly', () => {
      const payload = { message: 'test' };
      const result = preparePayloadInsert({
        eventId: 'event-123',
        eventType: 'message.received',
        stage: 'webhook_raw',
        payload,
      });

      expect(result.eventId).toBe('event-123');
      expect(result.eventType).toBe('message.received');
      expect(result.stage).toBe('webhook_raw');
      expect(result.payloadCompressed).toBeTruthy();
      expect(result.payloadSizeOriginal).toBeGreaterThan(0);
      expect(result.payloadSizeCompressed).toBeGreaterThan(0);
    });

    test('sets content flags correctly', () => {
      const payloadWithMedia = {
        mediaUrl: 'https://example.com/image.jpg',
        data: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.repeat(5),
      };

      const result = preparePayloadInsert({
        eventId: 'event-123',
        eventType: 'message.received',
        stage: 'webhook_raw',
        payload: payloadWithMedia,
      });

      expect(result.containsMedia).toBe(true);
      expect(result.containsBase64).toBe(true);
    });

    test('compresses payload and can be decompressed', () => {
      const originalPayload = { deep: { nested: { value: 'test' } } };

      const result = preparePayloadInsert({
        eventId: 'event-123',
        eventType: 'message.received',
        stage: 'agent_request',
        payload: originalPayload,
      });

      const decompressed = decompressPayload(result.payloadCompressed);
      expect(decompressed).toEqual(originalPayload);
    });
  });
});
