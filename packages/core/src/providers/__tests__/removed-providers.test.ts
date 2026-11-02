import { describe, expect, test } from 'bun:test';
import type { ProviderSchema } from '../../types/agent';
import type { ProviderClientConfig } from '../factory';
import { ProviderError } from '../types';

// API tests mock @omni/core process-wide; isolate these real implementations
// when the monorepo tests share a single Bun process (pushes / merge groups).
// @ts-expect-error Bun supports query-suffixed imports; TypeScript does not resolve them.
const factory = await import('../factory.ts?real-removed-providers-test');
const { createProviderClient, getSupportedProviderSchemas, isProviderSchemaSupported } = factory;
// @ts-expect-error Bun supports query-suffixed imports; TypeScript does not resolve them.
const removedProviders = await import('../removed-providers.ts?real-removed-providers-test');
const { REMOVED_OPENCLAW_MESSAGE, assertProviderAvailable, isRemovedProviderError } = removedProviders;

describe('removed provider factory compatibility', () => {
  test('a retained legacy schema is refused with the versioned error before a client is built', () => {
    const config = {
      schema: 'openclaw',
      baseUrl: 'ws://127.0.0.1:1',
      apiKey: 'retained-token',
    } as unknown as ProviderClientConfig;
    expect(() => createProviderClient(config)).toThrow(REMOVED_OPENCLAW_MESSAGE);
    try {
      createProviderClient(config);
    } catch (error) {
      expect(error).toMatchObject({ message: REMOVED_OPENCLAW_MESSAGE, statusCode: 410 });
      expect(isRemovedProviderError(error)).toBe(true);
    }
  });

  test('only a removed-provider marker with NOT_FOUND/410 is classified as removal', () => {
    expect(() => assertProviderAvailable('openclaw')).toThrow(REMOVED_OPENCLAW_MESSAGE);
    for (const error of [
      new ProviderError('upstream gone', 'SERVER_ERROR', 410),
      new ProviderError('upstream gone', 'INVALID_RESPONSE', 410),
      new ProviderError('upstream gone', 'NOT_FOUND', 410),
      new ProviderError('upstream gone', 'NOT_FOUND', 410, { schema: 'agno' }),
      new ProviderError('upstream gone', 'SERVER_ERROR', 410, { schema: 'openclaw' }),
      new ProviderError('upstream missing', 'NOT_FOUND', 404, { schema: 'openclaw' }),
      { code: 'NOT_FOUND', statusCode: 410, details: { schema: 'openclaw' } },
      null,
    ]) {
      expect(isRemovedProviderError(error)).toBe(false);
    }
  });

  test('the six remaining schemas stay supported while the legacy marker is excluded', () => {
    expect(getSupportedProviderSchemas()).toEqual(['agno', 'webhook', 'claude-code', 'ag-ui', 'a2a', 'nats-genie']);
    expect(isProviderSchemaSupported('openclaw' as ProviderSchema)).toBe(false);
    for (const schema of getSupportedProviderSchemas()) expect(isProviderSchemaSupported(schema)).toBe(true);
  });
});
