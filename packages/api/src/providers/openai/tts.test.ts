import { afterEach, describe, expect, it, mock } from 'bun:test';
import { OpenAiTtsProvider } from './tts';

const originalFetch = globalThis.fetch;

describe('OpenAiTtsProvider', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends expressive instructions to the OpenAI speech endpoint', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
    }) as unknown as typeof fetch;

    const provider = new OpenAiTtsProvider({
      getSecret: async () => 'test-key',
      getString: async (_key, _env, defaultValue) => defaultValue,
    });

    const result = await provider.synthesize('fala curto', {
      voice: 'cedar',
      language: 'pt-BR',
      style: 'WhatsApp note',
      tone: 'direto',
      format: 'mp3',
    });

    expect(result.mimeType).toBe('audio/mpeg');
    expect(result.sizeBytes).toBe(3);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain('/audio/speech');
    const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, string>;
    expect(body.model).toBe('gpt-4o-mini-tts');
    expect(body.voice).toBe('cedar');
    expect(body.response_format).toBe('mp3');
    expect(body.instructions).toContain('Language/accent: pt-BR.');
    expect(body.instructions).toContain('Style: WhatsApp note.');
    expect(body.instructions).toContain('Tone: direto.');
  });
});
