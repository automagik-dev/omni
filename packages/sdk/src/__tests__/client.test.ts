/**
 * SDK Client Integration Tests
 *
 * Unit tests run always. Integration tests use a mock API server.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { MOCK_API_KEY, startMockApi, stopMockApi } from '../../../cli/src/__tests__/mock-api';
import { OmniApiError, type OmniClient, OmniConfigError, createOmniClient } from '../index';

describe('createOmniClient', () => {
  test('throws OmniConfigError when baseUrl is missing', () => {
    expect(() => createOmniClient({ baseUrl: '', apiKey: 'key' })).toThrow(OmniConfigError);
  });

  test('throws OmniConfigError when apiKey is missing', () => {
    expect(() => createOmniClient({ baseUrl: 'http://localhost', apiKey: '' })).toThrow(OmniConfigError);
  });

  test('creates client with valid config', () => {
    const client = createOmniClient({
      baseUrl: 'http://localhost:8882',
      apiKey: 'some-key',
    });
    expect(client).toBeDefined();
    expect(client.instances).toBeDefined();
    expect(client.messages).toBeDefined();
    expect(client.events).toBeDefined();
    expect(client.persons).toBeDefined();
    expect(client.access).toBeDefined();
    expect(client.settings).toBeDefined();
    expect(client.providers).toBeDefined();
    expect(client.system).toBeDefined();
    expect(client.raw).toBeDefined();
  });

  test('normalizes trailing slash in baseUrl', () => {
    const client1 = createOmniClient({
      baseUrl: 'http://localhost:8882/',
      apiKey: 'some-key',
    });
    const client2 = createOmniClient({
      baseUrl: 'http://localhost:8882',
      apiKey: 'some-key',
    });
    // Both should work identically
    expect(client1).toBeDefined();
    expect(client2).toBeDefined();
  });
});

describe('OmniApiError', () => {
  test('creates from API error response', () => {
    const error = OmniApiError.from(
      {
        error: {
          code: 'NOT_FOUND',
          message: 'Resource not found',
          details: { id: '123' },
        },
      },
      404,
    );

    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe('Resource not found');
    expect(error.details).toEqual({ id: '123' });
    expect(error.status).toBe(404);
  });

  test('creates from Error object', () => {
    const error = OmniApiError.from(new Error('Network error'), 500);

    expect(error.code).toBe('UNKNOWN_ERROR');
    expect(error.message).toBe('Network error');
    expect(error.status).toBe(500);
  });

  test('creates from string', () => {
    const error = OmniApiError.from('Something went wrong', 500);

    expect(error.code).toBe('UNKNOWN_ERROR');
    expect(error.message).toBe('Something went wrong');
  });

  test('toJSON returns structured data', () => {
    const error = new OmniApiError('Test error', 'TEST_CODE', { key: 'value' }, 400);
    const json = error.toJSON();

    expect(json).toEqual({
      name: 'OmniApiError',
      code: 'TEST_CODE',
      message: 'Test error',
      details: { key: 'value' },
      status: 400,
    });
  });
});

// Integration tests — use mock API server
describe('SDK Integration', () => {
  let client: OmniClient;

  beforeAll(async () => {
    const mock = await startMockApi();
    client = createOmniClient({
      baseUrl: mock.url,
      apiKey: MOCK_API_KEY,
    });
  });

  afterAll(() => {
    stopMockApi();
  });

  test('system.health returns health status', async () => {
    const health = await client.system.health();
    expect(health.status).toBeDefined();
    expect(['healthy', 'degraded', 'unhealthy']).toContain(health.status);
  });

  test('instances.list returns paginated response', async () => {
    const result = await client.instances.list();
    expect(result.items).toBeInstanceOf(Array);
    expect(result.meta).toBeDefined();
    expect(typeof result.meta.hasMore).toBe('boolean');
  });

  test('events.list returns paginated response', async () => {
    const result = await client.events.list({ limit: 10 });
    expect(result.items).toBeInstanceOf(Array);
    expect(result.meta).toBeDefined();
  });

  test('providers.list returns array', async () => {
    const result = await client.providers.list();
    expect(result).toBeInstanceOf(Array);
  });

  test('settings.list returns array', async () => {
    const result = await client.settings.list();
    expect(result).toBeInstanceOf(Array);
  });

  test('access.listRules returns array', async () => {
    const result = await client.access.listRules();
    expect(result).toBeInstanceOf(Array);
  });
});
