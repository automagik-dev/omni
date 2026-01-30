/**
 * Tests for ws/logs.ts refactored helpers
 */

import { describe, expect, test } from 'bun:test';
import { createLogsWebSocketHandler } from '../ws/logs';

// Mock database
const mockDb = {} as Parameters<typeof createLogsWebSocketHandler>[0];

describe('createLogsWebSocketHandler', () => {
  describe('broadcast filtering', () => {
    test('should broadcast to subscribers with matching service', () => {
      const handler = createLogsWebSocketHandler(mockDb);
      const received: string[] = [];

      const mockWs = {
        send: (data: string) => received.push(data),
      };

      handler.open(mockWs);
      handler.message(
        mockWs,
        JSON.stringify({
          type: 'subscribe',
          services: ['api'],
          level: 'info',
        }),
      );

      handler.broadcast({
        type: 'log',
        service: 'api',
        level: 'info',
        timestamp: new Date().toISOString(),
        message: 'Test log',
      });

      expect(received.length).toBe(1);
      const parsed = JSON.parse(received[0] ?? '{}') as Record<string, unknown>;
      expect(parsed).toMatchObject({
        service: 'api',
        level: 'info',
      });
    });

    test('should filter by service when not using wildcard', () => {
      const handler = createLogsWebSocketHandler(mockDb);
      const received: string[] = [];

      const mockWs = {
        send: (data: string) => received.push(data),
      };

      handler.open(mockWs);
      handler.message(
        mockWs,
        JSON.stringify({
          type: 'subscribe',
          services: ['api'],
          level: 'info',
        }),
      );

      // Different service - should NOT receive
      handler.broadcast({
        type: 'log',
        service: 'worker',
        level: 'info',
        timestamp: new Date().toISOString(),
        message: 'Test log',
      });

      expect(received.length).toBe(0);
    });

    test('should receive all services with wildcard', () => {
      const handler = createLogsWebSocketHandler(mockDb);
      const received: string[] = [];

      const mockWs = {
        send: (data: string) => received.push(data),
      };

      handler.open(mockWs);
      handler.message(
        mockWs,
        JSON.stringify({
          type: 'subscribe',
          services: ['*'],
          level: 'info',
        }),
      );

      handler.broadcast({
        type: 'log',
        service: 'api',
        level: 'info',
        timestamp: new Date().toISOString(),
        message: 'API log',
      });

      handler.broadcast({
        type: 'log',
        service: 'worker',
        level: 'info',
        timestamp: new Date().toISOString(),
        message: 'Worker log',
      });

      expect(received.length).toBe(2);
    });

    test('should filter by log level (show level and above)', () => {
      const handler = createLogsWebSocketHandler(mockDb);
      const received: string[] = [];

      const mockWs = {
        send: (data: string) => received.push(data),
      };

      handler.open(mockWs);
      handler.message(
        mockWs,
        JSON.stringify({
          type: 'subscribe',
          services: ['*'],
          level: 'warning',
        }),
      );

      // Debug - should NOT receive (below warning)
      handler.broadcast({
        type: 'log',
        service: 'api',
        level: 'debug',
        timestamp: new Date().toISOString(),
        message: 'Debug log',
      });

      expect(received.length).toBe(0);

      // Info - should NOT receive (below warning)
      handler.broadcast({
        type: 'log',
        service: 'api',
        level: 'info',
        timestamp: new Date().toISOString(),
        message: 'Info log',
      });

      expect(received.length).toBe(0);

      // Warning - should receive
      handler.broadcast({
        type: 'log',
        service: 'api',
        level: 'warning',
        timestamp: new Date().toISOString(),
        message: 'Warning log',
      });

      expect(received.length).toBe(1);

      // Error - should receive (above warning)
      handler.broadcast({
        type: 'log',
        service: 'api',
        level: 'error',
        timestamp: new Date().toISOString(),
        message: 'Error log',
      });

      expect(received.length).toBe(2);
    });

    test('should filter by search string (case insensitive)', () => {
      const handler = createLogsWebSocketHandler(mockDb);
      const received: string[] = [];

      const mockWs = {
        send: (data: string) => received.push(data),
      };

      handler.open(mockWs);
      handler.message(
        mockWs,
        JSON.stringify({
          type: 'subscribe',
          services: ['*'],
          level: 'info',
        }),
      );

      // Apply filter
      handler.message(
        mockWs,
        JSON.stringify({
          type: 'filter',
          search: 'error',
        }),
      );

      // Should NOT receive (no match)
      handler.broadcast({
        type: 'log',
        service: 'api',
        level: 'info',
        timestamp: new Date().toISOString(),
        message: 'Normal log message',
      });

      expect(received.length).toBe(0);

      // Should receive (matches 'error' case-insensitive)
      handler.broadcast({
        type: 'log',
        service: 'api',
        level: 'info',
        timestamp: new Date().toISOString(),
        message: 'An ERROR occurred',
      });

      expect(received.length).toBe(1);
    });

    test('should update filter without losing existing settings', () => {
      const handler = createLogsWebSocketHandler(mockDb);
      const received: string[] = [];

      const mockWs = {
        send: (data: string) => received.push(data),
      };

      handler.open(mockWs);
      handler.message(
        mockWs,
        JSON.stringify({
          type: 'subscribe',
          services: ['api'],
          level: 'error',
        }),
      );

      // Update only level
      handler.message(
        mockWs,
        JSON.stringify({
          type: 'filter',
          level: 'info',
        }),
      );

      // Should still filter by service 'api'
      handler.broadcast({
        type: 'log',
        service: 'worker',
        level: 'info',
        timestamp: new Date().toISOString(),
        message: 'Worker log',
      });

      expect(received.length).toBe(0);

      // Should receive 'api' at 'info' level
      handler.broadcast({
        type: 'log',
        service: 'api',
        level: 'info',
        timestamp: new Date().toISOString(),
        message: 'API log',
      });

      expect(received.length).toBe(1);
    });

    test('should handle unsubscribe', () => {
      const handler = createLogsWebSocketHandler(mockDb);
      const received: string[] = [];

      const mockWs = {
        send: (data: string) => received.push(data),
      };

      handler.open(mockWs);
      handler.message(
        mockWs,
        JSON.stringify({
          type: 'subscribe',
          services: ['*'],
          level: 'info',
        }),
      );
      handler.message(mockWs, JSON.stringify({ type: 'unsubscribe' }));

      handler.broadcast({
        type: 'log',
        service: 'api',
        level: 'info',
        timestamp: new Date().toISOString(),
        message: 'Test log',
      });

      expect(received.length).toBe(0);
    });

    test('should handle close', () => {
      const handler = createLogsWebSocketHandler(mockDb);
      const received: string[] = [];

      const mockWs = {
        send: (data: string) => received.push(data),
      };

      handler.open(mockWs);
      handler.message(
        mockWs,
        JSON.stringify({
          type: 'subscribe',
          services: ['*'],
          level: 'info',
        }),
      );
      handler.close(mockWs);

      handler.broadcast({
        type: 'log',
        service: 'api',
        level: 'info',
        timestamp: new Date().toISOString(),
        message: 'Test log',
      });

      expect(received.length).toBe(0);
    });
  });
});
