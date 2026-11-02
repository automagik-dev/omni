import { describe, expect, test } from 'bun:test';
import type { ProviderSchema } from '../../types/agent';
import type { ProviderClientConfig } from '../factory';

// API tests mock @omni/core process-wide; isolate these real implementations
// when the monorepo tests share a single Bun process (pushes / merge groups).
// @ts-expect-error Bun supports query-suffixed imports; TypeScript does not resolve them.
const factory = await import('../factory.ts?real-removed-providers-test');
const { createProviderClient, getSupportedProviderSchemas, isProviderSchemaSupported } = factory;
// @ts-expect-error Bun supports query-suffixed imports; TypeScript does not resolve them.
const { REMOVED_OPENCLAW_MESSAGE } = await import('../removed-providers.ts?real-removed-providers-test');

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
    }
  });

  test('the six remaining schemas stay supported while the legacy marker is excluded', () => {
    expect(getSupportedProviderSchemas()).toEqual(['agno', 'webhook', 'claude-code', 'ag-ui', 'a2a', 'nats-genie']);
    expect(isProviderSchemaSupported('openclaw' as ProviderSchema)).toBe(false);
    for (const schema of getSupportedProviderSchemas()) expect(isProviderSchemaSupported(schema)).toBe(true);
  });
});
