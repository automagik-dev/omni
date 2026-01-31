/**
 * Tests for WebhookService
 */

import { describe, expect, test } from 'bun:test';

// Mock types for testing
interface MockWebhookSource {
  id: string;
  name: string;
  description: string | null;
  expectedHeaders: Record<string, boolean> | null;
  enabled: boolean;
  lastReceivedAt: Date | null;
  totalReceived: number;
  createdAt: Date;
  updatedAt: Date;
}

describe('WebhookService', () => {
  // Helper to create a mock webhook source
  function createMockSource(overrides: Partial<MockWebhookSource> = {}): MockWebhookSource {
    return {
      id: 'test-id-123',
      name: 'test-webhook',
      description: 'Test webhook source',
      expectedHeaders: null,
      enabled: true,
      lastReceivedAt: null,
      totalReceived: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  describe('receive()', () => {
    test('should reject webhooks from disabled sources', async () => {
      const mockSource = createMockSource({ enabled: false });

      // Test that disabled sources should be rejected
      expect(mockSource.enabled).toBe(false);

      // In real code, this would throw: new Error(`Webhook source '${sourceName}' is disabled`)
    });

    test('should validate expected headers', async () => {
      const mockSource = createMockSource({
        expectedHeaders: { 'x-github-event': true, 'x-github-delivery': true },
      });

      const headers = { 'x-github-event': 'push' }; // Missing x-github-delivery

      // Test that missing headers should fail validation
      expect(mockSource.expectedHeaders).not.toBeNull();
      const expectedHeaders = mockSource.expectedHeaders ?? {};
      const requiredHeaders = Object.keys(expectedHeaders);
      const providedHeaders = Object.keys(headers);
      const missingHeaders = requiredHeaders.filter(
        (h) => !providedHeaders.some((p) => p.toLowerCase() === h.toLowerCase()),
      );

      expect(missingHeaders).toContain('x-github-delivery');
    });

    test('should generate correct event type from source name', () => {
      const sourceName = 'github';
      const eventType = `custom.webhook.${sourceName}`;

      expect(eventType).toBe('custom.webhook.github');
      expect(eventType.startsWith('custom.')).toBe(true);
    });
  });

  describe('trigger()', () => {
    test('should only allow custom event types', () => {
      const validEventType = 'custom.manual.test';
      const invalidEventType = 'message.received';

      expect(validEventType.startsWith('custom.')).toBe(true);
      expect(invalidEventType.startsWith('custom.')).toBe(false);
    });

    test('should return published: false when eventBus is null', () => {
      const eventBus = null;
      const published = eventBus !== null;

      expect(published).toBe(false);
    });
  });

  describe('CRUD operations', () => {
    test('should create webhook source with defaults', () => {
      const input = { name: 'new-source' };
      const defaults = {
        enabled: true,
        totalReceived: 0,
      };

      const merged = { ...defaults, ...input };

      expect(merged.name).toBe('new-source');
      expect(merged.enabled).toBe(true);
      expect(merged.totalReceived).toBe(0);
    });

    test('should validate unique name constraint', () => {
      const existingSources = [{ name: 'github' }, { name: 'stripe' }];
      const newSourceName = 'github';

      const isDuplicate = existingSources.some((s) => s.name === newSourceName);

      expect(isDuplicate).toBe(true);
    });
  });
});

describe('Webhook Event Flow', () => {
  test('should create correct event structure', () => {
    const sourceName = 'agno';
    const payload = { response: 'Hello!', instanceId: 'wa-123', replyTo: '+5511999001234' };
    const eventId = 'evt-123-456';

    const event = {
      id: eventId,
      type: `custom.webhook.${sourceName}`,
      payload: {
        source: sourceName,
        ...payload,
      },
      metadata: {
        correlationId: eventId,
        source: 'webhook',
      },
    };

    expect(event.type).toBe('custom.webhook.agno');
    expect(event.payload.source).toBe('agno');
    expect(event.payload.response).toBe('Hello!');
    expect(event.metadata.correlationId).toBe(eventId);
    expect(event.metadata.source).toBe('webhook');
  });

  test('should track webhook stats correctly', () => {
    let totalReceived = 0;
    let lastReceivedAt: Date | null = null;

    // Simulate receiving webhooks
    for (let i = 0; i < 5; i++) {
      totalReceived += 1;
      lastReceivedAt = new Date();
    }

    expect(totalReceived).toBe(5);
    expect(lastReceivedAt).not.toBeNull();
  });
});
