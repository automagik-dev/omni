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
                      data: Buffer.from([1, 2, 3, 4]).toString('base64'),
                      mimeType: 'audio/L16;rate=24000',
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

const { GeminiTtsProvider } = await import('./tts');

describe('GeminiTtsProvider expressive controls', () => {
  it('builds Felipe voice-note prompt and multi-speaker speech config', async () => {
    generateContentCalls.length = 0;
    const provider = new GeminiTtsProvider({
      getSecret: async () => 'test-gemini-key',
      getString: async (_key: string, _env?: string, defaultValue?: string) => defaultValue,
    });

    const result = await provider.synthesize('fala com o time', {
      format: 'pcm',
      tone: 'direto e quente',
      accent: 'pt-BR paulistano leve',
      pace: 'rápido mas claro',
      emotion: 'confiante',
      voiceNoteProfile: 'Felipe WhatsApp',
      multiSpeaker: [
        { speaker: 'Felipe', voice: 'Orus' },
        { speaker: 'Cliente', voice: 'Kore' },
      ],
    });

    expect(result.mimeType).toBe('audio/L16;rate=24000');
    expect(generateContentCalls).toHaveLength(1);
    const request = generateContentCalls[0] as {
      model: string;
      contents: Array<{ parts: Array<{ text?: string }> }>;
      config?: { speechConfig?: Record<string, unknown> };
    };
    expect(request.model).toBe('gemini-3.1-flash-tts-preview');
    const prompt = request.contents[0]?.parts[0]?.text ?? '';
    expect(prompt).toContain('nota de WhatsApp natural');
    expect(prompt).toContain('Voice-note profile: Felipe WhatsApp.');
    expect(prompt).toContain('Tone: direto e quente.');
    expect(prompt).toContain('Accent: pt-BR paulistano leve.');
    expect(prompt).toContain('Pace: rápido mas claro.');
    expect(prompt).toContain('Emotion: confiante.');
    expect(prompt).toContain('Texto/transcript:\nfala com o time');
    expect(request.config?.speechConfig).toEqual({
      multiSpeakerVoiceConfig: {
        speakerVoiceConfigs: [
          { speaker: 'Felipe', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Orus' } } },
          { speaker: 'Cliente', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
        ],
      },
    });
  });
});
