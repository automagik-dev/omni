import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { omniMessageActions } from './actions.js';
import type { ChannelMessageActionContext, OmniPluginConfig } from './types.js';

function makeCfg(overrides?: Partial<import('./types.js').OmniAccountConfig>): OmniPluginConfig {
  return {
    channels: {
      omni: {
        accounts: {
          default: {
            apiUrl: 'https://api.test.com',
            apiKey: 'test-key',
            instanceId: 'inst-1',
            ...overrides,
          },
        },
      },
    },
  };
}

function makeCtx(
  action: string,
  params: Record<string, unknown>,
  accountId?: string | null,
): ChannelMessageActionContext {
  return {
    channel: 'omni',
    action,
    cfg: makeCfg(),
    params,
    accountId: accountId ?? undefined,
  };
}

describe('omniMessageActions', () => {
  describe('listActions', () => {
    test('returns all supported action names', () => {
      const actions = omniMessageActions.listActions?.({ cfg: makeCfg() });
      expect(actions).toEqual(['send', 'react', 'read', 'reply']);
    });
  });

  describe('supportsAction', () => {
    test('returns true for supported actions', () => {
      for (const action of ['send', 'react', 'read', 'reply']) {
        expect(omniMessageActions.supportsAction?.({ action })).toBe(true);
      }
    });

    test('returns false for unsupported actions', () => {
      for (const action of ['delete', 'forward', 'pin', 'edit']) {
        expect(omniMessageActions.supportsAction?.({ action })).toBe(false);
      }
    });
  });

  describe('handleAction', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      ) as unknown as typeof fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    test('throws for unsupported action', async () => {
      const ctx = makeCtx('delete', {});
      await expect(omniMessageActions.handleAction?.(ctx)).rejects.toThrow(
        "Action 'delete' is not supported for channel omni.",
      );
    });

    test('throws when account is not found', async () => {
      const ctx: ChannelMessageActionContext = {
        channel: 'omni',
        action: 'send',
        cfg: { channels: { omni: { accounts: {} } } },
        params: { to: '123', message: 'hi' },
        accountId: 'nonexistent',
      };
      await expect(omniMessageActions.handleAction?.(ctx)).rejects.toThrow("Omni account 'nonexistent' not found");
    });

    test('throws when account is disabled', async () => {
      const ctx: ChannelMessageActionContext = {
        channel: 'omni',
        action: 'send',
        cfg: makeCfg({ enabled: false }),
        params: { to: '123', message: 'hi' },
      };
      await expect(omniMessageActions.handleAction?.(ctx)).rejects.toThrow('is disabled');
    });

    test('throws when account is not configured', async () => {
      const ctx: ChannelMessageActionContext = {
        channel: 'omni',
        action: 'send',
        cfg: makeCfg({ apiUrl: '', apiKey: '', instanceId: '' }),
        params: { to: '123', message: 'hi' },
      };
      await expect(omniMessageActions.handleAction?.(ctx)).rejects.toThrow('is not configured');
    });

    describe('send action', () => {
      test('sends a text message', async () => {
        const ctx = makeCtx('send', { to: 'recipient-1', message: 'Hello!' });
        const result = await omniMessageActions.handleAction?.(ctx);
        expect(result).toEqual({ content: { success: true } });

        const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('https://api.test.com/api/v2/messages/send');
        expect(opts.method).toBe('POST');
        expect(JSON.parse(opts.body as string)).toEqual({
          to: 'recipient-1',
          text: 'Hello!',
          instanceId: 'inst-1',
        });
        expect((opts.headers as Record<string, string>)['x-api-key']).toBe('test-key');
      });

      test('sends with replyTo when provided', async () => {
        const ctx = makeCtx('send', { to: 'r1', message: 'Reply!', replyTo: 'msg-99' });
        await omniMessageActions.handleAction?.(ctx);

        const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;
        const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
        expect(body.replyTo).toBe('msg-99');
      });

      test('throws when required param "to" is missing', async () => {
        const ctx = makeCtx('send', { message: 'Hello!' });
        await expect(omniMessageActions.handleAction?.(ctx)).rejects.toThrow('Missing required parameter: to');
      });

      test('throws when required param "message" is missing', async () => {
        const ctx = makeCtx('send', { to: 'r1' });
        await expect(omniMessageActions.handleAction?.(ctx)).rejects.toThrow('Missing required parameter: message');
      });
    });

    describe('react action', () => {
      test('sends a reaction with specified emoji', async () => {
        const ctx = makeCtx('react', { messageId: 'msg-1', to: 'chat-1', emoji: '🔥' });
        const result = await omniMessageActions.handleAction?.(ctx);
        expect(result).toEqual({ content: { success: true } });

        const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;
        const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('https://api.test.com/api/v2/messages/send/reaction');
        const body = JSON.parse(opts.body as string);
        expect(body).toEqual({
          messageId: 'msg-1',
          to: 'chat-1',
          emoji: '🔥',
          instanceId: 'inst-1',
        });
      });

      test('defaults emoji to thumbs-up when not provided', async () => {
        const ctx = makeCtx('react', { messageId: 'msg-1', to: 'chat-1' });
        await omniMessageActions.handleAction?.(ctx);

        const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;
        const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
        expect(body.emoji).toBe('\u{1F44D}');
      });

      test('throws when messageId is missing', async () => {
        const ctx = makeCtx('react', { to: 'chat-1' });
        await expect(omniMessageActions.handleAction?.(ctx)).rejects.toThrow('Missing required parameter: messageId');
      });
    });

    describe('read action', () => {
      test('marks a message as read', async () => {
        const ctx = makeCtx('read', { messageId: 'msg-42' });
        const result = await omniMessageActions.handleAction?.(ctx);
        expect(result).toEqual({ content: { success: true } });

        const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;
        const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('https://api.test.com/api/v2/messages/msg-42/read');
        expect(opts.method).toBe('POST');
        const body = JSON.parse(opts.body as string);
        expect(body).toEqual({ instanceId: 'inst-1' });
      });

      test('throws when messageId is missing', async () => {
        const ctx = makeCtx('read', {});
        await expect(omniMessageActions.handleAction?.(ctx)).rejects.toThrow('Missing required parameter: messageId');
      });

      test('throws on API error', async () => {
        globalThis.fetch = mock(() =>
          Promise.resolve(new Response('Not Found', { status: 404, statusText: 'Not Found' })),
        ) as unknown as typeof fetch;
        const ctx = makeCtx('read', { messageId: 'msg-bad' });
        await expect(omniMessageActions.handleAction?.(ctx)).rejects.toThrow(
          'Omni API /api/v2/messages/msg-bad/read failed: 404 Not Found',
        );
      });
    });

    describe('reply action', () => {
      test('sends a reply with replyTo param', async () => {
        const ctx = makeCtx('reply', { to: 'r1', message: 'Got it!', replyTo: 'msg-10' });
        const result = await omniMessageActions.handleAction?.(ctx);
        expect(result).toEqual({ content: { success: true } });

        const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;
        const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('https://api.test.com/api/v2/messages/send');
        const body = JSON.parse(opts.body as string);
        expect(body).toEqual({
          to: 'r1',
          text: 'Got it!',
          instanceId: 'inst-1',
          replyTo: 'msg-10',
        });
      });

      test('accepts replyToId as fallback', async () => {
        const ctx = makeCtx('reply', { to: 'r1', message: 'Ack', replyToId: 'msg-20' });
        await omniMessageActions.handleAction?.(ctx);

        const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;
        const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
        expect(body.replyTo).toBe('msg-20');
      });

      test('accepts messageId as final fallback', async () => {
        const ctx = makeCtx('reply', { to: 'r1', message: 'Ok', messageId: 'msg-30' });
        await omniMessageActions.handleAction?.(ctx);

        const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;
        const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
        expect(body.replyTo).toBe('msg-30');
      });

      test('throws when required param "to" is missing', async () => {
        const ctx = makeCtx('reply', { message: 'hello' });
        await expect(omniMessageActions.handleAction?.(ctx)).rejects.toThrow('Missing required parameter: to');
      });

      test('throws when required param "message" is missing', async () => {
        const ctx = makeCtx('reply', { to: 'r1' });
        await expect(omniMessageActions.handleAction?.(ctx)).rejects.toThrow('Missing required parameter: message');
      });
    });

    describe('API error handling', () => {
      test('throws descriptive error on API failure for send', async () => {
        globalThis.fetch = mock(() =>
          Promise.resolve(new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' })),
        ) as unknown as typeof fetch;
        const ctx = makeCtx('send', { to: 'r1', message: 'test' });
        await expect(omniMessageActions.handleAction?.(ctx)).rejects.toThrow(
          'Omni API /api/v2/messages/send failed: 500 Internal Server Error',
        );
      });
    });
  });
});
