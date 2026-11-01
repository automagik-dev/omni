import { describe, expect, test } from 'bun:test';
import type { ProviderSchema } from '../../types/agent';
import {
  type ProviderClientConfig,
  createProviderClient,
  getSupportedProviderSchemas,
  isProviderSchemaSupported,
} from '../factory';
import { REMOVED_OPENCLAW_MESSAGE } from '../removed-providers';

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
