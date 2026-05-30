import { afterEach, describe, expect, it, mock } from 'bun:test';
import { readFileSync } from 'node:fs';
import { OpenAiSttProvider } from './stt';

const originalFetch = globalThis.fetch;

describe('OpenAiSttProvider', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('routes timestamp requests to the transcriptions endpoint even when audio-chat is configured', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(
        JSON.stringify({
          text: 'olá mundo',
          language: 'pt',
          segments: [{ text: 'olá mundo', start: 0, end: 1.25 }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const provider = new OpenAiSttProvider({
      getSecret: async () => 'test-key',
      getString: async (_key, _env, defaultValue) => defaultValue,
    });

    const result = await provider.transcribe(Buffer.from('fake-audio'), 'audio/mpeg', {
      timestamps: true,
      language: 'pt-BR',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain('/audio/transcriptions');
    expect(calls[0]?.url).not.toContain('/chat/completions');
    expect(result.segments).toEqual([{ text: 'olá mundo', startMs: 0, endMs: 1250 }]);
  });

  it('does not use synchronous ffmpeg/file normalization in the API event loop', () => {
    const source = readFileSync(new URL('./stt.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('execFileSync');
    expect(source).not.toContain('readFileSync');
    expect(source).not.toContain('writeFileSync');
    expect(source).not.toContain('mkdtempSync');
    expect(source).not.toContain('rmSync');
  });
});
