import { describe, expect, it, mock } from 'bun:test';

const generateVideoCalls: Array<Record<string, unknown>> = [];

mock.module('./client', () => ({
  GEMINI_MODELS: {
    FLASH: 'gemini-2.0-flash',
    PRO: 'gemini-2.5-pro-preview-06-05',
    TTS: 'gemini-3.1-flash-tts-preview',
    IMAGE_GEN: 'gemini-3.1-flash-image',
    VIDEO_GEN: 'veo-3.1-generate-preview',
    VISION: 'gemini-3.1-flash-lite',
    STT: 'gemini-3.1-flash-lite',
  },
  resolveGeminiApiKey: async () => 'test-gemini-key',
  getGeminiClient: () => ({
    models: {
      generateVideos: mock(async (request: Record<string, unknown>) => {
        generateVideoCalls.push(request);
        return { name: 'operations/test-veo', done: false };
      }),
    },
    operations: {
      getVideosOperation: mock(async () => ({ name: 'operations/test-veo', done: false })),
    },
  }),
}));

const { GeminiVideoGenProvider } = await import('./videogen');

describe('GeminiVideoGenProvider', () => {
  it('submits image-to-video prompt controls without unsupported generateAudio config', async () => {
    generateVideoCalls.length = 0;
    const provider = new GeminiVideoGenProvider({
      getSecret: async () => 'test-gemini-key',
      getString: async (_key: string, _env?: string, defaultValue?: string) => defaultValue,
    });

    const operation = await provider.submit('slow zoom on product', {
      aspectRatio: '1:1',
      durationSec: 4,
      seed: 123,
      resolution: '720p',
      imageBase64: 'abc123',
      imageMimeType: 'image/png',
      camera: 'slow push in',
      dialogue: 'none',
      audioDirection: 'silent room tone',
      music: 'no music',
      style: 'clean studio',
      shotList: ['hero frame', 'detail frame'],
    });

    expect(operation).toEqual({ operationId: 'operations/test-veo', state: 'processing' });
    expect(generateVideoCalls).toHaveLength(1);
    const request = generateVideoCalls[0] as {
      model: string;
      prompt: string;
      config?: Record<string, unknown>;
      image?: { imageBytes: string; mimeType: string };
    };
    expect(request.model).toBe('veo-3.1-generate-preview');
    expect(request.config?.aspectRatio).toBe('16:9');
    expect(request.config?.durationSeconds).toBe(4);
    expect(request.config?.seed).toBe(123);
    expect(request.config?.resolution).toBe('720p');
    expect(request.config?.generateAudio).toBeUndefined();
    expect(request.image).toEqual({ imageBytes: 'abc123', mimeType: 'image/png' });
    expect(request.prompt).toContain('Visual style: clean studio.');
    expect(request.prompt).toContain('Camera/framing: slow push in.');
    expect(request.prompt).toContain('Audio direction: silent room tone.');
    expect(request.prompt).toContain('Music: no music.');
    expect(request.prompt).toContain('1. hero frame');
  });
});
