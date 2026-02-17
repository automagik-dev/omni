/**
 * WhisperProvider Tests
 *
 * Tests for TranscriptionProvider interface and WhisperProvider implementation.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { TranscriptionError, TranscriptionResultSchema } from '../providers/transcription';
import type { TranscriptionProvider } from '../providers/transcription';
import { WhisperProvider } from '../providers/whisper-provider';

/**
 * Creates a mock fetch function with Bun-compatible interface
 */
function createMockFetch() {
  const mockImpl = mock((_input: string | URL | Request, _init?: RequestInit) => Promise.resolve(new Response()));

  const mockFetch = Object.assign((input: string | URL | Request, init?: RequestInit) => mockImpl(input, init), {
    preconnect: () => {},
  }) as typeof fetch;

  return { mockFetch, mockImpl };
}

describe('TranscriptionProvider interface', () => {
  it('TranscriptionResultSchema validates correct results', () => {
    const result = TranscriptionResultSchema.parse({
      text: 'Hello world',
      duration: 5.2,
      confidence: 0.95,
    });

    expect(result.text).toBe('Hello world');
    expect(result.duration).toBe(5.2);
    expect(result.confidence).toBe(0.95);
  });

  it('TranscriptionResultSchema allows missing confidence', () => {
    const result = TranscriptionResultSchema.parse({
      text: 'Hello',
      duration: 1.0,
    });

    expect(result.text).toBe('Hello');
    expect(result.confidence).toBeUndefined();
  });

  it('TranscriptionResultSchema rejects invalid data', () => {
    expect(() => TranscriptionResultSchema.parse({ text: 123 })).toThrow();
    expect(() => TranscriptionResultSchema.parse({})).toThrow();
  });
});

describe('TranscriptionError', () => {
  it('creates error with code and message', () => {
    const err = new TranscriptionError('API failed', 'API_ERROR');
    expect(err.message).toBe('API failed');
    expect(err.code).toBe('API_ERROR');
    expect(err.name).toBe('TranscriptionError');
    expect(err).toBeInstanceOf(Error);
  });

  it('creates error with cause', () => {
    const cause = new Error('network down');
    const err = new TranscriptionError('API failed', 'API_ERROR', cause);
    expect(err.cause).toBe(cause);
  });

  it('supports all error codes', () => {
    const codes = ['API_ERROR', 'TIMEOUT', 'UNSUPPORTED_FORMAT', 'FILE_TOO_LARGE', 'NO_PROVIDER'] as const;
    for (const code of codes) {
      const err = new TranscriptionError('test', code);
      expect(err.code).toBe(code);
    }
  });
});

describe('WhisperProvider', () => {
  const config = {
    apiKey: 'test-key',
    model: 'whisper-1',
    timeoutMs: 5000,
  };

  let originalFetch: typeof globalThis.fetch;
  let mockImpl: ReturnType<typeof createMockFetch>['mockImpl'];

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    const mocks = createMockFetch();
    mockImpl = mocks.mockImpl;
    globalThis.fetch = mocks.mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('implements TranscriptionProvider interface', () => {
    const provider: TranscriptionProvider = new WhisperProvider(config);
    expect(typeof provider.transcribe).toBe('function');
  });

  it('calls OpenAI Whisper API with correct URL', async () => {
    mockImpl.mockReturnValue(
      Promise.resolve(
        new Response(JSON.stringify({ text: 'Hello', duration: 2.5 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const provider = new WhisperProvider(config);
    await provider.transcribe(Buffer.from('audio-data'), 'ogg');

    expect(mockImpl).toHaveBeenCalledTimes(1);
    const [url, options] = mockImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(options.method).toBe('POST');
    expect((options.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
  });

  it('returns transcribed text and duration', async () => {
    mockImpl.mockReturnValue(
      Promise.resolve(
        new Response(JSON.stringify({ text: 'Transcribed text here', duration: 12.3 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const provider = new WhisperProvider(config);
    const result = await provider.transcribe(Buffer.from('audio-data'), 'ogg', 'en');

    expect(result.text).toBe('Transcribed text here');
    expect(result.duration).toBe(12.3);
  });

  it('sends language parameter when provided', async () => {
    mockImpl.mockReturnValue(
      Promise.resolve(
        new Response(JSON.stringify({ text: 'Olá', duration: 1 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const provider = new WhisperProvider(config);
    await provider.transcribe(Buffer.from('audio-data'), 'ogg', 'pt');

    const [, options] = mockImpl.mock.calls[0] as [string, RequestInit];
    const body = options.body as FormData;
    expect(body.get('language')).toBe('pt');
    expect(body.get('model')).toBe('whisper-1');
  });

  it('throws TranscriptionError on API error', async () => {
    mockImpl.mockReturnValue(Promise.resolve(new Response('Unauthorized', { status: 401 })));

    const provider = new WhisperProvider(config);

    try {
      await provider.transcribe(Buffer.from('audio-data'), 'ogg');
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(TranscriptionError);
      expect((error as TranscriptionError).code).toBe('API_ERROR');
      expect((error as TranscriptionError).message).toContain('401');
    }
  });

  it('throws TranscriptionError on network error', async () => {
    mockImpl.mockReturnValue(Promise.reject(new Error('ECONNREFUSED')));

    const provider = new WhisperProvider(config);

    try {
      await provider.transcribe(Buffer.from('audio-data'), 'ogg');
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(TranscriptionError);
      expect((error as TranscriptionError).code).toBe('API_ERROR');
      expect((error as TranscriptionError).message).toContain('ECONNREFUSED');
    }
  });

  it('uses custom base URL when provided', async () => {
    mockImpl.mockReturnValue(
      Promise.resolve(
        new Response(JSON.stringify({ text: 'ok', duration: 1 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const provider = new WhisperProvider({
      ...config,
      baseUrl: 'https://custom-api.example.com',
    });
    await provider.transcribe(Buffer.from('audio-data'), 'ogg');

    const [url] = mockImpl.mock.calls[0] as [string];
    expect(url).toBe('https://custom-api.example.com/v1/audio/transcriptions');
  });

  it('defaults model to whisper-1', async () => {
    mockImpl.mockReturnValue(
      Promise.resolve(
        new Response(JSON.stringify({ text: 'ok', duration: 1 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const provider = new WhisperProvider({ apiKey: 'test-key' });
    await provider.transcribe(Buffer.from('audio-data'), 'mp3');

    const [, options] = mockImpl.mock.calls[0] as [string, RequestInit];
    const body = options.body as FormData;
    expect(body.get('model')).toBe('whisper-1');
  });

  it('handles empty text response', async () => {
    mockImpl.mockReturnValue(
      Promise.resolve(
        new Response(JSON.stringify({ text: '', duration: 0.5 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const provider = new WhisperProvider(config);
    const result = await provider.transcribe(Buffer.from('silence'), 'ogg');

    expect(result.text).toBe('');
    expect(result.duration).toBe(0.5);
  });
});
