import { describe, expect, it, mock } from 'bun:test';

const generateContentCalls: Array<Record<string, unknown>> = [];

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
      generateContent: mock(async (request: Record<string, unknown>) => {
        generateContentCalls.push(request);
        return {
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      data: Buffer.from('fake-music').toString('base64'),
                      mimeType: 'audio/wav',
                    },
                  },
                ],
              },
            },
          ],
        };
      }),
    },
  }),
}));

const { GeminiMusicGenProvider } = await import('./musicgen');

describe('GeminiMusicGenProvider', () => {
  it('uses Lyria clip/pro settings and enriches the prompt', async () => {
    generateContentCalls.length = 0;
    const provider = new GeminiMusicGenProvider({
      getSecret: async () => 'test-gemini-key',
      getString: async (_key: string, _env?: string, defaultValue?: string) => defaultValue,
    });

    const result = await provider.generate('jingle para onboarding agentico', {
      mode: 'clip',
      genre: 'samba rock',
      mood: 'confiante',
      bpm: 112,
      instruments: ['violão', 'synth bass'],
      instrumental: true,
      singerProfile: 'voz masculina brasileira natural',
      lyrics: 'entra no flow / sem deixar passar',
      durationSec: 45,
      style: 'clean startup ad',
      imageBase64: 'abc123',
      imageMimeType: 'image/webp',
    });

    expect(result.model).toBe('lyria-3-clip-preview');
    expect(result.audio.mimeType).toBe('audio/wav');
    expect(result.audio.data.toString()).toBe('fake-music');
    expect(generateContentCalls).toHaveLength(1);
    const request = generateContentCalls[0] as {
      model: string;
      contents: Array<{ parts: Array<{ text?: string; inlineData?: { data: string; mimeType: string } }> }>;
      config?: { responseModalities?: string[] };
    };
    expect(request.model).toBe('lyria-3-clip-preview');
    expect(request.config?.responseModalities).toEqual(['AUDIO']);
    const parts = request.contents[0]?.parts ?? [];
    expect(parts[0]?.text).toContain('jingle para onboarding agentico');
    expect(parts[0]?.text).toContain('Genre: samba rock.');
    expect(parts[0]?.text).toContain('Tempo: 112 BPM.');
    expect(parts[0]?.text).toContain('Instrumental only; no vocals.');
    expect(parts[0]?.text).toContain('Lyrics:\nentra no flow / sem deixar passar');
    expect(parts[0]?.text).toContain('Target duration: about 45 seconds.');
    expect(parts[1]?.inlineData).toEqual({ data: 'abc123', mimeType: 'image/webp' });
  });
});
