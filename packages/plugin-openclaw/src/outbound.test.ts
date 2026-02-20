import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { ChannelOutboundContext, OmniPluginConfig } from './types.js';

// Mock runtime before importing outbound
import { setOmniRuntime } from './runtime.js';

const mockChunker = mock((text: string, _limit: number) => [text]);

beforeEach(() => {
  setOmniRuntime({
    channel: {
      text: {
        chunkMarkdownText: mockChunker,
      },
    },
  });
});

// We need to import omniOutbound after the mock is set up,
// but the chunker is a function reference resolved at call time via getOmniRuntime(),
// so import order doesn't matter for that. Import statically.
import { omniOutbound } from './outbound.js';

const baseCfg: OmniPluginConfig = {
  channels: {
    omni: {
      accounts: {
        default: {
          apiUrl: 'https://omni.test',
          apiKey: 'test-key-123',
          instanceId: 'inst-abc',
          enabled: true,
        },
        secondary: {
          apiUrl: 'https://omni2.test',
          apiKey: 'key-2',
          instanceId: 'inst-def',
          enabled: true,
        },
      },
    },
  },
};

function makeCtx(overrides: Partial<ChannelOutboundContext> = {}): ChannelOutboundContext {
  return {
    cfg: baseCfg,
    to: '+5511999999999',
    text: 'Hello from test',
    ...overrides,
  };
}

describe('omniOutbound shape', () => {
  test('deliveryMode is direct', () => {
    expect(omniOutbound.deliveryMode).toBe('direct');
  });

  test('textChunkLimit is 4096', () => {
    expect(omniOutbound.textChunkLimit).toBe(4096);
  });

  test('chunkerMode is markdown', () => {
    expect(omniOutbound.chunkerMode).toBe('markdown');
  });

  test('chunker delegates to runtime chunkMarkdownText', () => {
    const result = omniOutbound.chunker?.('hello world', 100);
    expect(mockChunker).toHaveBeenCalledWith('hello world', 100);
    expect(result).toEqual(['hello world']);
  });
});

describe('omniOutbound.sendText', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('sends POST to correct URL with correct headers and body', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;

    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(JSON.stringify({ id: 'msg-1' }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await omniOutbound.sendText?.(makeCtx());

    expect(capturedUrl).toBe('https://omni.test/api/v2/messages/send');
    expect(capturedInit?.method).toBe('POST');
    expect(capturedInit?.headers).toEqual({
      'Content-Type': 'application/json',
      'x-api-key': 'test-key-123',
    });

    const body = JSON.parse(capturedInit?.body as string);
    expect(body).toEqual({
      to: '+5511999999999',
      text: 'Hello from test',
      instanceId: 'inst-abc',
    });

    expect(result).toEqual({ channel: 'omni', messageId: 'msg-1' });
  });

  test('includes replyToId when provided', async () => {
    let capturedBody = '';

    globalThis.fetch = mock(async (_input: string | URL | Request, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return new Response(JSON.stringify({ id: 'msg-2' }), { status: 200 });
    }) as unknown as typeof fetch;

    await omniOutbound.sendText?.(makeCtx({ replyToId: 'reply-xyz' }));

    const body = JSON.parse(capturedBody);
    expect(body.replyTo).toBe('reply-xyz');
  });

  test('uses specified accountId instead of first account', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response(JSON.stringify({ id: 'msg-3' }), { status: 200 });
    }) as unknown as typeof fetch;

    await omniOutbound.sendText?.(makeCtx({ accountId: 'secondary' }));

    expect(capturedUrl).toBe('https://omni2.test/api/v2/messages/send');
    expect(capturedHeaders['x-api-key']).toBe('key-2');
  });

  test('throws when account not found', async () => {
    await expect(omniOutbound.sendText?.(makeCtx({ accountId: 'nonexistent' }))).rejects.toThrow(
      "Omni account 'nonexistent' not found",
    );
  });

  test('throws when account is disabled', async () => {
    const disabledCfg: OmniPluginConfig = {
      channels: {
        omni: {
          accounts: {
            default: {
              apiUrl: 'https://omni.test',
              apiKey: 'test-key-123',
              instanceId: 'inst-abc',
              enabled: false,
            },
          },
        },
      },
    };
    await expect(omniOutbound.sendText?.(makeCtx({ cfg: disabledCfg }))).rejects.toThrow('is disabled');
  });

  test('throws on non-ok response', async () => {
    globalThis.fetch = mock(async () => {
      return new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' });
    }) as unknown as typeof fetch;

    await expect(omniOutbound.sendText?.(makeCtx())).rejects.toThrow('Omni sendText failed: 401 Unauthorized');
  });
});

describe('omniOutbound.sendMedia', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('sends POST to media URL with mediaUrl in body', async () => {
    let capturedUrl = '';
    let capturedBody = '';

    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedBody = init?.body as string;
      return new Response(JSON.stringify({ id: 'media-1' }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await omniOutbound.sendMedia?.(makeCtx({ mediaUrl: 'https://cdn.test/img.png' }));

    expect(capturedUrl).toBe('https://omni.test/api/v2/messages/send/media');

    const body = JSON.parse(capturedBody);
    expect(body).toEqual({
      to: '+5511999999999',
      caption: 'Hello from test',
      url: 'https://cdn.test/img.png',
      type: 'image',
      instanceId: 'inst-abc',
    });

    expect(result).toEqual({ channel: 'omni', messageId: 'media-1' });
  });

  test('includes replyToId when provided', async () => {
    let capturedBody = '';

    globalThis.fetch = mock(async (_input: string | URL | Request, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return new Response(JSON.stringify({ id: 'media-2' }), { status: 200 });
    }) as unknown as typeof fetch;

    await omniOutbound.sendMedia?.(makeCtx({ mediaUrl: 'https://cdn.test/img.png', replyToId: 'reply-abc' }));

    const body = JSON.parse(capturedBody);
    expect(body.to).toBe('+5511999999999');
    expect(body.replyTo).toBe('reply-abc');
  });

  test('throws on non-ok response', async () => {
    globalThis.fetch = mock(async () => {
      return new Response('Server Error', { status: 500, statusText: 'Internal Server Error' });
    }) as unknown as typeof fetch;

    await expect(omniOutbound.sendMedia?.(makeCtx({ mediaUrl: 'https://cdn.test/img.png' }))).rejects.toThrow(
      'Omni sendMedia failed: 500 Internal Server Error',
    );
  });
});
