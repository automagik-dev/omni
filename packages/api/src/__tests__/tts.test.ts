/**
 * Tests for TTS Service
 *
 * Unit tests with mocked ElevenLabs API.
 * @see send-tts wish
 */

import { describe, expect, mock, test } from 'bun:test';
import { TTSService } from '../services/tts';

describe('TTSService', () => {
  describe('synthesize', () => {
    test('throws when ELEVENLABS_API_KEY is not set', async () => {
      const originalKey = process.env.ELEVENLABS_API_KEY;
      process.env.ELEVENLABS_API_KEY = undefined;

      const service = new TTSService();

      try {
        await expect(service.synthesize('Hello world')).rejects.toThrow('ElevenLabs API key not configured');
      } finally {
        if (originalKey) {
          process.env.ELEVENLABS_API_KEY = originalKey;
        }
      }
    });

    test('throws on ElevenLabs API error', async () => {
      const originalKey = process.env.ELEVENLABS_API_KEY;
      process.env.ELEVENLABS_API_KEY = 'test-key';

      // Mock fetch to simulate API error
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' })),
      ) as unknown as typeof fetch;

      const service = new TTSService();

      try {
        await expect(service.synthesize('Hello world')).rejects.toThrow('ElevenLabs API error (401)');
      } finally {
        globalThis.fetch = originalFetch;
        if (originalKey) {
          process.env.ELEVENLABS_API_KEY = originalKey;
        } else {
          process.env.ELEVENLABS_API_KEY = undefined;
        }
      }
    });

    test('calls ElevenLabs with correct parameters', async () => {
      const originalKey = process.env.ELEVENLABS_API_KEY;
      process.env.ELEVENLABS_API_KEY = 'test-key';

      let capturedUrl = '';
      let capturedBody: Record<string, unknown> = {};
      let capturedHeaders: Record<string, string> = {};

      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = url.toString();
        capturedBody = JSON.parse(init?.body as string);
        capturedHeaders = Object.fromEntries(Object.entries(init?.headers as Record<string, string>));

        // Return a small valid MP3 header (not real audio, but enough for the test)
        // The ffmpeg conversion will fail, which is expected in unit tests
        return new Response(new Uint8Array([0xff, 0xfb, 0x90, 0x00]), {
          status: 200,
          headers: { 'Content-Type': 'audio/mpeg' },
        });
      }) as unknown as typeof fetch;

      const service = new TTSService();

      try {
        // This will succeed the ElevenLabs call but fail at ffmpeg conversion
        // (expected in unit tests without ffmpeg)
        await service.synthesize('Hello world', {
          voiceId: 'test-voice',
          modelId: 'eleven_v3',
          stability: 0.6,
          similarityBoost: 0.8,
        });
      } catch {
        // ffmpeg failure is expected in unit tests
      }

      // Verify the ElevenLabs API was called correctly
      expect(capturedUrl).toContain('https://api.elevenlabs.io/v1/text-to-speech/test-voice');
      expect(capturedHeaders['xi-api-key']).toBe('test-key');
      expect(capturedHeaders['Content-Type']).toBe('application/json');
      expect(capturedBody.text).toBe('Hello world');
      expect(capturedBody.model_id).toBe('eleven_v3');
      expect((capturedBody.voice_settings as Record<string, number>).stability).toBe(0.6);
      expect((capturedBody.voice_settings as Record<string, number>).similarity_boost).toBe(0.8);

      globalThis.fetch = originalFetch;
      if (originalKey) {
        process.env.ELEVENLABS_API_KEY = originalKey;
      } else {
        process.env.ELEVENLABS_API_KEY = undefined;
      }
    });

    test('uses default voice and model when not specified', async () => {
      const originalKey = process.env.ELEVENLABS_API_KEY;
      const originalVoice = process.env.ELEVENLABS_DEFAULT_VOICE;
      process.env.ELEVENLABS_API_KEY = 'test-key';
      process.env.ELEVENLABS_DEFAULT_VOICE = undefined;

      let capturedUrl = '';
      let capturedBody: Record<string, unknown> = {};

      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = _url.toString();
        capturedBody = JSON.parse(init?.body as string);
        return new Response(new Uint8Array([0xff, 0xfb, 0x90, 0x00]), {
          status: 200,
          headers: { 'Content-Type': 'audio/mpeg' },
        });
      }) as unknown as typeof fetch;

      const service = new TTSService();

      try {
        await service.synthesize('Test');
      } catch {
        // ffmpeg failure expected
      }

      // Default voice ID
      expect(capturedUrl).toContain('JBFqnCBsd6RMkjVDRZzb');
      // Default model
      expect(capturedBody.model_id).toBe('eleven_v3');
      // Default settings
      expect((capturedBody.voice_settings as Record<string, number>).stability).toBe(0.5);
      expect((capturedBody.voice_settings as Record<string, number>).similarity_boost).toBe(0.75);

      globalThis.fetch = originalFetch;
      if (originalKey) {
        process.env.ELEVENLABS_API_KEY = originalKey;
      } else {
        process.env.ELEVENLABS_API_KEY = undefined;
      }
      if (originalVoice) {
        process.env.ELEVENLABS_DEFAULT_VOICE = originalVoice;
      }
    });

    test('uses ELEVENLABS_DEFAULT_VOICE env var when set', async () => {
      const originalKey = process.env.ELEVENLABS_API_KEY;
      const originalVoice = process.env.ELEVENLABS_DEFAULT_VOICE;
      process.env.ELEVENLABS_API_KEY = 'test-key';
      process.env.ELEVENLABS_DEFAULT_VOICE = 'custom-voice-id';

      let capturedUrl = '';

      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock(async (url: string | URL | Request) => {
        capturedUrl = url.toString();
        return new Response(new Uint8Array([0xff, 0xfb, 0x90, 0x00]), {
          status: 200,
          headers: { 'Content-Type': 'audio/mpeg' },
        });
      }) as unknown as typeof fetch;

      const service = new TTSService();

      try {
        await service.synthesize('Test');
      } catch {
        // ffmpeg failure expected
      }

      expect(capturedUrl).toContain('custom-voice-id');

      globalThis.fetch = originalFetch;
      if (originalKey) {
        process.env.ELEVENLABS_API_KEY = originalKey;
      } else {
        process.env.ELEVENLABS_API_KEY = undefined;
      }
      if (originalVoice) {
        process.env.ELEVENLABS_DEFAULT_VOICE = originalVoice;
      } else {
        process.env.ELEVENLABS_DEFAULT_VOICE = undefined;
      }
    });

    test('marks 5xx errors as recoverable', async () => {
      const originalKey = process.env.ELEVENLABS_API_KEY;
      process.env.ELEVENLABS_API_KEY = 'test-key';

      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response('Internal Server Error', { status: 500 })),
      ) as unknown as typeof fetch;

      const service = new TTSService();

      try {
        await service.synthesize('Hello');
        expect(true).toBe(false); // Should not reach here
      } catch (error: unknown) {
        const err = error as { recoverable: boolean; code: string };
        expect(err.recoverable).toBe(true);
        expect(err.code).toBe('CHANNEL_SEND_FAILED');
      }

      globalThis.fetch = originalFetch;
      if (originalKey) {
        process.env.ELEVENLABS_API_KEY = originalKey;
      } else {
        process.env.ELEVENLABS_API_KEY = undefined;
      }
    });
  });
});
