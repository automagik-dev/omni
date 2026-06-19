import { describe, expect, it, mock } from 'bun:test';

const generateContentCalls: Array<Record<string, unknown>> = [];

mock.module('./client', () => ({
  GEMINI_MODELS: {
    FLASH: 'gemini-2.0-flash',
    PRO: 'gemini-2.5-pro-preview-06-05',
    TTS: 'gemini-2.5-flash-preview-tts',
    IMAGE_GEN: 'imagen-3.0-generate-002',
    VIDEO_GEN: 'veo-3.1-generate-preview',
    VISION: 'gemini-3.1-flash-lite',
    STT: 'gemini-3.1-flash-lite',
  },
  resolveGeminiApiKey: async () => 'test-gemini-key',
  getGeminiClient: () => ({
    models: {
      generateContent: mock(async (request: Record<string, unknown>) => {
        generateContentCalls.push(request);
        return { text: '{"text":"Omni mergeou","segments":[{"text":"Omni mergeou","startMs":0,"endMs":900}]}' };
      }),
    },
  }),
}));

const { GeminiSttProvider } = await import('./stt');

describe('GeminiSttProvider', () => {
  it('sends audio inlineData with Gemini 3.1 Flash Lite and parses timestamp JSON', async () => {
    generateContentCalls.length = 0;
    const provider = new GeminiSttProvider({
      getSecret: async () => 'test-gemini-key',
      getString: async (_key: string, _env?: string, defaultValue?: string) => defaultValue,
    });

    const result = await provider.transcribe(Buffer.from('fake-audio'), 'audio/mpeg', {
      language: 'pt-BR',
      timestamps: true,
      context: 'KHAL WhatsApp voice note',
      glossary: ['Omni', 'mergeou'],
    });

    expect(result.text).toBe('Omni mergeou');
    expect(result.segments).toEqual([{ text: 'Omni mergeou', startMs: 0, endMs: 900 }]);
    expect(generateContentCalls).toHaveLength(1);

    const request = generateContentCalls[0] as {
      model: string;
      contents: Array<{ parts: Array<{ text?: string; inlineData?: { data: string; mimeType: string } }> }>;
      config?: { responseMimeType?: string };
    };
    expect(request.model).toBe('gemini-3.1-flash-lite');
    expect(request.config?.responseMimeType).toBe('application/json');
    expect(request.contents[0]?.parts[0]?.text).toContain('pt-BR informal');
    expect(request.contents[0]?.parts[0]?.text).toContain('Glossary: Omni, mergeou');
    expect(request.contents[0]?.parts[1]?.inlineData).toEqual({
      data: Buffer.from('fake-audio').toString('base64'),
      mimeType: 'audio/mp3',
    });
  });
});
