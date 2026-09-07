import { afterEach, describe, expect, it, mock } from 'bun:test';
import { readFileSync } from 'node:fs';
import { OpenAiSttProvider } from './stt';

const originalFetch = globalThis.fetch;

describe('OpenAiSttProvider', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('defaults to the transcriptions endpoint with gpt-4o-transcribe', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ text: 'transcrição real' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const provider = new OpenAiSttProvider({
      getSecret: async () => 'test-key',
      getString: async (_key, _env, defaultValue) => defaultValue,
    });

    const result = await provider.transcribe(Buffer.from('fake-audio'), 'audio/mpeg', { language: 'pt-BR' });

    expect(result.text).toBe('transcrição real');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain('/audio/transcriptions');
    expect((calls[0]?.init?.body as FormData).get('model')).toBe('gpt-4o-transcribe');
  });

  it('uses audio-chat input_audio when a gpt-audio model is requested', async () => {
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
      model: 'gpt-audio-mini',
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

  it('falls back to the transcriptions endpoint when the chat lane returns a conversational reply (issue #942)', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('/chat/completions')) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    'Claro, por favor me diga o que você gostaria que fosse transcrito. Se tiver um áudio, descreva o conteúdo.',
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ text: 'transcrição de verdade' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const provider = new OpenAiSttProvider({
      getSecret: async () => 'test-key',
      getString: async () => 'gpt-audio-mini',
    });

    const result = await provider.transcribe(Buffer.from('fake-audio'), 'audio/mpeg', { language: 'pt-BR' });

    expect(result.text).toBe('transcrição de verdade');
    expect(calls.map((call) => String(call.url))).toEqual([
      'https://api.openai.com/v1/chat/completions',
      'https://api.openai.com/v1/audio/transcriptions',
    ]);
    expect((calls[1]?.init?.body as FormData).get('model')).toBe('gpt-4o-transcribe');
  });

  it('falls back to the transcriptions endpoint when the chat lane returns empty text', async () => {
    const calls: string[] = [];
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      calls.push(String(url));
      if (String(url).includes('/chat/completions')) {
        return new Response(JSON.stringify({ choices: [{ message: { content: '   ' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ text: 'olá mundo' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const provider = new OpenAiSttProvider({
      getSecret: async () => 'test-key',
      getString: async () => 'gpt-audio-mini',
    });

    const result = await provider.transcribe(Buffer.from('fake-audio'), 'audio/mpeg', { language: 'pt-BR' });

    expect(result.text).toBe('olá mundo');
    expect(calls).toEqual([
      'https://api.openai.com/v1/chat/completions',
      'https://api.openai.com/v1/audio/transcriptions',
    ]);
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
