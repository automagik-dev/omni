import { describe, expect, it } from 'bun:test';
import { clearAgentSession } from '../session-cleaner';

function makeDbWithAgentProvider(providerId: string) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ agentProviderId: providerId }],
        }),
      }),
    }),
  } as never;
}

describe('session-cleaner canonical KHAL reset guard', () => {
  it('fails closed for Agno/KHAL resets when canonical person identity cannot be resolved', async () => {
    const services = {
      agentRunner: {
        getInstanceWithProvider: async () => ({
          id: 'inst-1',
          agentId: 'agent-1',
          channel: 'whatsapp-gupshup',
          agentSessionStrategy: 'per_chat',
        }),
      },
      providers: {
        getById: async () => ({
          id: 'provider-1',
          schema: 'agno',
          baseUrl: 'http://agno.invalid',
          apiKey: '',
          defaultTimeout: 1,
        }),
      },
      chats: {
        findByExternalIdSmart: async () => null,
      },
    } as never;

    await expect(
      clearAgentSession(services, makeDbWithAgentProvider('provider-1'), 'inst-1', '5547996094523', '5547996094523', {
        rawPayload: { headers: { 'x-khal-env': 'hml' } },
      }),
    ).rejects.toThrow('Canonical KHAL session resolution failed');
  });
});
