import { describe, expect, it, mock, spyOn } from 'bun:test';
import type { EventBus } from '@omni/core';
import { GupshupPlugin } from '../plugin';

function makeOkResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeLogger() {
  const logger = {
    child: mock(() => logger),
    info: mock(() => undefined),
    debug: mock(() => undefined),
    warn: mock(() => undefined),
    error: mock(() => undefined),
  };
  return logger;
}

describe('GupshupPlugin — outbound provider aliases', () => {
  it('emits message.sent with gupshup response aliases in rawPayload', async () => {
    const published: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [];
    const publish = mock(async (type: string, payload: unknown, metadata: unknown) => {
      published.push([type, payload as Record<string, unknown>, metadata as Record<string, unknown>]);
    });
    const fetchSpy = spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(makeOkResponse({ status: 'ok' }))
      .mockResolvedValueOnce(
        makeOkResponse({
          status: 'ok',
          messageId: '033ve4XFB8ikDjlsH9KcOI',
          gsId: 'f5d6cdc1-3b1d-4c8d-a1fa-089b43c7105b',
          messageIds: ['033ve4XFB8ikDjlsH9KcOI'],
          echoedSecret: 'must-not-persist',
        }),
      );

    const plugin = new GupshupPlugin();
    await plugin.initialize({
      eventBus: { publish } as unknown as EventBus,
      logger: makeLogger(),
      storage: {} as never,
      config: {} as never,
      db: {} as never,
    });
    await plugin.connect('inst-1', {
      instanceId: 'inst-1',
      credentials: {
        gupshupCallbackUrl: 'https://callbacks.gupshup.io/custom/abc123',
        gupshupAuthToken: 'Bearer test-auth-token',
      },
    });

    const result = await plugin.sendMessage('inst-1', {
      to: '+55 11 98888-0000',
      content: { type: 'text', text: 'Plano Notrelife' },
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('033ve4XFB8ikDjlsH9KcOI');

    const sentEvent = published.find(([type]) => type === 'message.sent');
    expect(sentEvent).toBeDefined();
    const [, payload] = sentEvent!;
    expect(payload.externalId).toBe('033ve4XFB8ikDjlsH9KcOI');
    expect(payload.rawPayload).toEqual({
      gupshupResponse: {
        status: 'ok',
        messageId: '033ve4XFB8ikDjlsH9KcOI',
        gsId: 'f5d6cdc1-3b1d-4c8d-a1fa-089b43c7105b',
        messageIds: ['033ve4XFB8ikDjlsH9KcOI'],
      },
      gupshupProviderAliases: ['033ve4XFB8ikDjlsH9KcOI', 'f5d6cdc1-3b1d-4c8d-a1fa-089b43c7105b'],
    });

    fetchSpy.mockRestore();
  });

  it('keeps UUID externalId fallback when Gupshup response has aliases but no messageId', async () => {
    const published: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [];
    const publish = mock(async (type: string, payload: unknown, metadata: unknown) => {
      published.push([type, payload as Record<string, unknown>, metadata as Record<string, unknown>]);
    });
    const fetchSpy = spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(makeOkResponse({ status: 'ok' }))
      .mockResolvedValueOnce(
        makeOkResponse({
          status: 'ok',
          gsId: 'f5d6cdc1-3b1d-4c8d-a1fa-089b43c7105b',
          id: 'provider-short-id',
        }),
      );

    const plugin = new GupshupPlugin();
    await plugin.initialize({
      eventBus: { publish } as unknown as EventBus,
      logger: makeLogger(),
      storage: {} as never,
      config: {} as never,
      db: {} as never,
    });
    await plugin.connect('inst-1', {
      instanceId: 'inst-1',
      credentials: {
        gupshupCallbackUrl: 'https://callbacks.gupshup.io/custom/abc123',
        gupshupAuthToken: 'Bearer test-auth-token',
      },
    });

    const result = await plugin.sendMessage('inst-1', {
      to: '+55 11 98888-0000',
      content: { type: 'text', text: 'Sem messageId' },
    });

    expect(result.success).toBe(true);
    expect(result.messageId).not.toBe('f5d6cdc1-3b1d-4c8d-a1fa-089b43c7105b');
    expect(result.messageId).not.toBe('provider-short-id');
    expect(typeof result.messageId).toBe('string');

    const sentEvent = published.find(([type]) => type === 'message.sent');
    expect(sentEvent).toBeDefined();
    const [, payload] = sentEvent!;
    expect(payload.externalId).toBe(result.messageId);
    expect(payload.rawPayload).toEqual({
      gupshupResponse: {
        status: 'ok',
        messageId: undefined,
        gsId: 'f5d6cdc1-3b1d-4c8d-a1fa-089b43c7105b',
        id: 'provider-short-id',
        messageIds: [],
      },
      gupshupProviderAliases: ['f5d6cdc1-3b1d-4c8d-a1fa-089b43c7105b', 'provider-short-id'],
    });

    fetchSpy.mockRestore();
  });
});
