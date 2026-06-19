import { afterEach, describe, expect, it, mock } from 'bun:test';
import { readFileSync } from 'node:fs';
import { OpenAiSttProvider } from './stt';

const originalFetch = globalThis.fetch;

describe('OpenAiSttProvider', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('uses audio-chat input_audio for the quality gpt-audio-mini lane', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"text":"Gupshup HV clear"}' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const provider = new OpenAiSttProvider({
      getSecret: async () => 'test-key',
      getString: async (_key, _env, defaultValue) => defaultValue,
    });

    const result = await provider.transcribe(Buffer.from('fake-audio'), 'audio/mpeg', {
      language: 'pt-BR',
      context: 'KHAL WhatsApp voice note',
      glossary: ['Gupshup', 'HV clear'],
    });

    expect(result.text).toBe('Gupshup HV clear');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain('/chat/completions');

    const body = JSON.parse(String(calls[0]?.init?.body)) as {
      model: string;
      messages: Array<{
        content: Array<{ type: string; text?: string; input_audio?: { data: string; format: string } }>;
      }>;
    };
    expect(body.model).toBe('gpt-audio-mini');
    expect(body.messages[0]?.content[0]?.text).toContain('pt-BR informal');
    expect(body.messages[0]?.content[0]?.text).toContain('Gupshup, HV clear');
    expect(body.messages[0]?.content[1]).toMatchObject({
      type: 'input_audio',
      input_audio: { data: Buffer.from('fake-audio').toString('base64'), format: 'mp3' },
    });
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

  it('falls back to gpt-4o-transcribe when audio-chat is requested with timestamps', async () => {
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      const form = init?.body as FormData;
      expect(form.get('model')).toBe('gpt-4o-transcribe');
      expect(form.get('language')).toBe('pt');
      expect(form.get('response_format')).toBe('verbose_json');
      return new Response(JSON.stringify({ text: 'ok', segments: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const provider = new OpenAiSttProvider({
      getSecret: async () => 'test-key',
      getString: async () => 'gpt-audio-mini',
    });

    await provider.transcribe(Buffer.from('fake-audio'), 'audio/mpeg', {
      timestamps: true,
      language: 'pt-BR',
      model: 'gpt-audio-mini',
    });
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
