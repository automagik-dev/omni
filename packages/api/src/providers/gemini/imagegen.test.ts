import { afterEach, describe, expect, it, mock } from 'bun:test';

const originalGeminiImageModel = process.env.GEMINI_IMAGE_MODEL;
const generateContentCalls: Array<Record<string, unknown>> = [];

mock.module('./client', () => ({
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
                      data: Buffer.from([137, 80, 78, 71]).toString('base64'),
                      mimeType: 'image/png',
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

const { GeminiImageGenProvider } = await import('./imagegen');

describe('GeminiImageGenProvider', () => {
  afterEach(() => {
    generateContentCalls.length = 0;
    if (originalGeminiImageModel === undefined) process.env.GEMINI_IMAGE_MODEL = undefined;
    else process.env.GEMINI_IMAGE_MODEL = originalGeminiImageModel;
  });

  it('lets GEMINI_IMAGE_MODEL override the seeded default setting', async () => {
    process.env.GEMINI_IMAGE_MODEL = 'gemini-3.1-pro-image';
    const provider = new GeminiImageGenProvider({
      getSecret: async () => 'test-gemini-key',
      getString: async () => 'nano-banana-2',
    });

    await provider.generate('a clean product render');

    expect(generateContentCalls).toHaveLength(1);
    expect(generateContentCalls[0]?.model).toBe('gemini-3.1-pro-image');
  });
});
