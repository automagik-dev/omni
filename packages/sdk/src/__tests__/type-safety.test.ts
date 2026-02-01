/**
 * Type safety verification tests
 *
 * These tests verify that the SDK provides proper TypeScript type safety.
 */

import { describe, expect, test } from 'bun:test';
import { createOmniClient } from '../index';

const client = createOmniClient({
  baseUrl: 'http://localhost:8881',
  apiKey: 'test-key',
});

describe('SDK Type Safety', () => {
  test('raw client provides typed responses for /health', async () => {
    const result = await client.raw.GET('/health');

    // TypeScript knows the shape of the response
    if (result.data) {
      expect(typeof result.data.status).toBe('string');
      expect(typeof result.data.version).toBe('string');
      expect(typeof result.data.uptime).toBe('number');
      expect(typeof result.data.checks).toBe('object');
    }
  });

  test('raw client provides typed path params for /instances/{id}', async () => {
    // This would fail at compile time if we passed wrong types
    const result = await client.raw.GET('/instances/{id}', {
      params: { path: { id: '00000000-0000-0000-0000-000000000000' } },
    });

    // TypeScript knows response shape
    expect(result.response.ok || result.error).toBeTruthy();
  });

  test('raw client provides typed query params for /instances', async () => {
    // Query params are typed
    const result = await client.raw.GET('/instances', {
      params: {
        query: {
          limit: 10, // number
          channel: 'whatsapp-baileys', // string
        },
      },
    });

    if (result.data) {
      expect(Array.isArray(result.data.items)).toBe(true);
      expect(result.data.meta).toBeDefined();
    }
  });

  test('raw client provides typed body for POST /instances', async () => {
    // Note: Not actually calling - just verifying types compile
    // The body type is inferred from OpenAPI spec
    const bodyTypeCheck: Parameters<typeof client.raw.POST<'/instances'>>[1] = {
      body: {
        name: 'test',
        channel: 'whatsapp-baileys' as const,
      },
    };

    expect(bodyTypeCheck).toBeDefined();
  });

  test('raw client provides typed response for POST /instances/{id}/connect', async () => {
    // Testing that complex nested endpoints have proper types
    // Not calling - just verifying types
    const pathTypeCheck: Parameters<typeof client.raw.POST<'/instances/{id}/connect'>>[1] = {
      params: { path: { id: 'test-id' } },
      body: {
        forceNewQr: true,
        token: 'optional-token',
      },
    };

    expect(pathTypeCheck).toBeDefined();
  });
});
