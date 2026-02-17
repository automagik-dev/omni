/**
 * Voice Transcription Integration Tests
 *
 * Tests the preflight voice transcription pipeline:
 * - Voice note detection → transcription → text injection
 * - Per-instance toggle
 * - Duration limits
 * - Fallback behavior on failure
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetProvider, transcribeVoiceNote } from '../utils/voice-transcription';

/**
 * Creates a mock fetch for Whisper API
 */
function createMockFetch(response: { text: string; duration: number } | null, status = 200) {
  const mockImpl = mock((_input: string | URL | Request, _init?: RequestInit) => {
    if (!response) return Promise.reject(new Error('Network error'));
    return Promise.resolve(
      new Response(JSON.stringify(response), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  return Object.assign((input: string | URL | Request, init?: RequestInit) => mockImpl(input, init), {
    preconnect: () => {},
  }) as typeof fetch;
}

describe('Voice Transcription', () => {
  let originalFetch: typeof globalThis.fetch;
  let originalEnv: Record<string, string | undefined>;
  let tmpDir: string;
  let testAudioPath: string;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalEnv = {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      WHISPER_MODEL: process.env.WHISPER_MODEL,
      OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    };

    // Create a temp audio file
    tmpDir = mkdtempSync(join(tmpdir(), 'voice-test-'));
    testAudioPath = join(tmpDir, 'test.ogg');
    writeFileSync(testAudioPath, Buffer.from('fake-ogg-audio-data'));

    // Reset cached provider
    _resetProvider();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalEnv.OPENAI_API_KEY;
    process.env.WHISPER_MODEL = originalEnv.WHISPER_MODEL;
    process.env.OPENAI_BASE_URL = originalEnv.OPENAI_BASE_URL;
    _resetProvider();

    try {
      rmSync(tmpDir, { recursive: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe('transcribeVoiceNote', () => {
    it('transcribes voice note and returns formatted text', async () => {
      process.env.OPENAI_API_KEY = 'test-key';
      globalThis.fetch = createMockFetch({ text: 'Hello world', duration: 5.2 });

      const result = await transcribeVoiceNote(testAudioPath, 5, 'audio/ogg');

      expect(result.success).toBe(true);
      expect(result.text).toBe('[Voice Note Transcription]: Hello world');
    });

    it('returns fallback when OPENAI_API_KEY is not set', async () => {
      process.env.OPENAI_API_KEY = undefined;

      const result = await transcribeVoiceNote(testAudioPath, 5, 'audio/ogg');

      expect(result.success).toBe(false);
      expect(result.text).toBe('[Voice note - transcription unavailable]');
    });

    it('returns fallback when duration exceeds 5 minutes', async () => {
      process.env.OPENAI_API_KEY = 'test-key';

      const result = await transcribeVoiceNote(testAudioPath, 301, 'audio/ogg');

      expect(result.success).toBe(false);
      expect(result.text).toBe('[Voice note - transcription unavailable]');
    });

    it('allows duration up to 300 seconds', async () => {
      process.env.OPENAI_API_KEY = 'test-key';
      globalThis.fetch = createMockFetch({ text: 'Long message', duration: 300 });

      const result = await transcribeVoiceNote(testAudioPath, 300, 'audio/ogg');

      expect(result.success).toBe(true);
      expect(result.text).toContain('Long message');
    });

    it('returns fallback when Whisper API fails', async () => {
      process.env.OPENAI_API_KEY = 'test-key';
      globalThis.fetch = createMockFetch(null);

      const result = await transcribeVoiceNote(testAudioPath, 5, 'audio/ogg');

      expect(result.success).toBe(false);
      expect(result.text).toBe('[Voice note - transcription unavailable]');
    });

    it('returns fallback when API returns error status', async () => {
      process.env.OPENAI_API_KEY = 'test-key';
      globalThis.fetch = createMockFetch({ text: '', duration: 0 }, 500);

      const result = await transcribeVoiceNote(testAudioPath, 5, 'audio/ogg');

      expect(result.success).toBe(false);
      expect(result.text).toBe('[Voice note - transcription unavailable]');
    });

    it('returns fallback when transcription text is empty', async () => {
      process.env.OPENAI_API_KEY = 'test-key';
      globalThis.fetch = createMockFetch({ text: '   ', duration: 1 });

      const result = await transcribeVoiceNote(testAudioPath, 5, 'audio/ogg');

      expect(result.success).toBe(false);
      expect(result.text).toBe('[Voice note - transcription unavailable]');
    });

    it('handles undefined duration (no max check)', async () => {
      process.env.OPENAI_API_KEY = 'test-key';
      globalThis.fetch = createMockFetch({ text: 'No duration info', duration: 10 });

      const result = await transcribeVoiceNote(testAudioPath, undefined, 'audio/ogg');

      expect(result.success).toBe(true);
      expect(result.text).toBe('[Voice Note Transcription]: No duration info');
    });

    it('handles various MIME types', async () => {
      process.env.OPENAI_API_KEY = 'test-key';
      globalThis.fetch = createMockFetch({ text: 'Test', duration: 1 });

      for (const mime of ['audio/ogg', 'audio/opus', 'audio/mpeg', 'audio/wav']) {
        _resetProvider();
        const result = await transcribeVoiceNote(testAudioPath, 5, mime);
        expect(result.success).toBe(true);
      }
    });
  });

  describe('extract-content voice detection', () => {
    it('extracts voice note with duration from Telegram message', async () => {
      // Import dynamically to avoid grammy module loading issues
      const { extractTelegramMessageContent } = await import('../handlers/extract-content');

      const msg = {
        message_id: 1,
        date: Date.now(),
        chat: { id: 123, type: 'private' },
        voice: {
          file_id: 'voice-file-id',
          mime_type: 'audio/ogg',
          duration: 15,
        },
      };

      const content = extractTelegramMessageContent(msg as never);
      expect(content.type).toBe('audio');
      expect(content.isVoiceNote).toBe(true);
      expect(content.voiceDurationSeconds).toBe(15);
      expect(content.mediaFileId).toBe('voice-file-id');
    });

    it('does not set isVoiceNote for regular audio', async () => {
      const { extractTelegramMessageContent } = await import('../handlers/extract-content');

      const msg = {
        message_id: 1,
        date: Date.now(),
        chat: { id: 123, type: 'private' },
        audio: {
          file_id: 'audio-file-id',
          mime_type: 'audio/mpeg',
          file_name: 'song.mp3',
        },
      };

      const content = extractTelegramMessageContent(msg as never);
      expect(content.type).toBe('audio');
      expect(content.isVoiceNote).toBeUndefined();
      expect(content.voiceDurationSeconds).toBeUndefined();
    });
  });
});
