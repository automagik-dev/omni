/**
 * Type safety verification tests
 *
 * Tests that the SDK provides proper TypeScript type safety.
 * Compile-time tests run always; API-calling tests use a mock server.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { MOCK_API_KEY, startMockApi, stopMockApi } from '../../../cli/src/__tests__/mock-api';
import { createOmniClient } from '../index';

// ── Compile-time type checks (always run, no API needed) ──
describe('SDK Type Safety (compile-time)', () => {
  const client = createOmniClient({
    baseUrl: 'http://localhost:1', // never called
    apiKey: 'unused',
  });

  test('raw client provides typed body for POST /instances', () => {
    // Not actually calling — just verifying types compile
    // The body type is inferred from OpenAPI spec
    const bodyTypeCheck: Parameters<typeof client.raw.POST<'/instances'>>[1] = {
      body: {
        name: 'test',
        channel: 'whatsapp-baileys' as const,
      },
    };

    expect(bodyTypeCheck).toBeDefined();
  });

  test('raw client provides typed response for POST /instances/{id}/connect', () => {
    // Testing that complex nested endpoints have proper types
    // Not calling — just verifying types
    const pathTypeCheck: Parameters<typeof client.raw.POST<'/instances/{id}/connect'>>[1] = {
      params: { path: { id: 'test-id' } },
      body: {
        forceNewQr: true,
        token: 'optional-token',
      },
    };

    expect(pathTypeCheck).toBeDefined();
  });

  test('raw client provides typed path params for /instances/{id}', () => {
    // Just verify types compile without calling
    const paramsTypeCheck: Parameters<typeof client.raw.GET<'/instances/{id}'>>[1] = {
      params: { path: { id: 'some-uuid' } },
    };
    expect(paramsTypeCheck).toBeDefined();
  });
});

// ── API-calling type checks (use mock server) ──
describe('SDK Type Safety (API calls)', () => {
  let client: ReturnType<typeof createOmniClient>;
  let mockUrl: string;

  beforeAll(async () => {
    const mock = await startMockApi();
    mockUrl = mock.url;
    client = createOmniClient({
      baseUrl: mockUrl,
      apiKey: MOCK_API_KEY,
    });
  });

  afterAll(() => {
    stopMockApi();
  });

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
});
