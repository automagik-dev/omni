import { afterEach, describe, expect, it, mock } from 'bun:test';
import { OpenAiImageGenProvider } from './imagegen';

const originalFetch = globalThis.fetch;

describe('OpenAiImageGenProvider', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('maps aspect ratio and OpenAI image controls into the generation request', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const png = Buffer.from([137, 80, 78, 71]).toString('base64');
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ data: [{ b64_json: png }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const provider = new OpenAiImageGenProvider({
      getSecret: async () => 'test-key',
      getString: async (_key, _env, defaultValue) => defaultValue,
    });

    const result = await provider.generate('a clean product render', {
      aspectRatio: '16:9',
      quality: 'high',
      background: 'transparent',
      outputFormat: 'png',
      compression: 80,
      negativePrompt: 'watermark',
    });

    expect(result.images).toHaveLength(1);
    expect(result.images[0]?.mimeType).toBe('image/png');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain('/images/generations');
    const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(body.model).toBe('gpt-image-2');
    expect(body.response_format).toBeUndefined();
    expect(body.size).toBe('1536x1024');
    expect(body.quality).toBe('high');
    expect(body.background).toBe('transparent');
    expect(body.output_format).toBe('png');
    expect(body.output_compression).toBe(80);
    expect(String(body.prompt)).toContain('Avoid: watermark.');
  });
});
