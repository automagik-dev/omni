/**
 * DeepSeek Vision Provider tests
 */

import { afterEach, describe, expect, mock, test } from 'bun:test';
import { DeepSeekVisionProvider } from './vision';

function createSettings(values: Record<string, string | undefined> = {}) {
  return {
    async getSecret(key: string, envFallback?: string): Promise<string | undefined> {
      return values[key] ?? (envFallback ? values[envFallback] : undefined);
    },
    async getString(key: string, envFallback?: string, defaultValue?: string): Promise<string | undefined> {
      return values[key] ?? (envFallback ? values[envFallback] : undefined) ?? defaultValue;
    },
  };
}

describe('DeepSeekVisionProvider', () => {
  afterEach(() => {
    mock.restore();
  });

  test('sends images through DeepSeek Anthropic-compatible messages API', async () => {
    let capturedUrl = '';
    let capturedBody: any;
    let capturedHeaders: Headers | undefined;
    const fetchMock = mock(async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(String(init?.body));
      capturedHeaders = new Headers(init?.headers);
      return new Response(
        JSON.stringify({
          content: [{ type: 'text', text: 'red square with RED text' }],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = new DeepSeekVisionProvider(
      createSettings({
        'deepseek.api_key': 'test-key',
        'vision.deepseek.model': 'deepseek-v4-flash',
      }),
    );

    const result = await provider.describe(Buffer.from('fake-image'), 'image/png', {
      prompt: 'Describe briefly',
      language: 'pt-BR',
      maxTokens: 123,
    });

    expect(result.text).toBe('red square with RED text');
    expect(result.processingMs).toBeGreaterThanOrEqual(0);
    expect(capturedUrl).toBe('https://api.deepseek.com/anthropic/v1/messages');
    expect(capturedHeaders?.get('x-api-key')).toBe('test-key');
    expect(capturedHeaders?.get('anthropic-version')).toBe('2023-06-01');
    expect(capturedBody.model).toBe('deepseek-v4-flash');
    expect(capturedBody.max_tokens).toBe(123);
    expect(capturedBody.thinking).toEqual({ type: 'disabled' });
    expect(capturedBody.messages[0].content[0].text).toContain('Respond in pt-BR');
    expect(capturedBody.messages[0].content[1]).toEqual({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: Buffer.from('fake-image').toString('base64'),
      },
    });
  });

  test('throws a clear error when the DeepSeek API key is missing', async () => {
    const provider = new DeepSeekVisionProvider(createSettings());

    await expect(provider.describe(Buffer.from('x'), 'image/png')).rejects.toThrow('DeepSeek API key not configured');
  });
});
