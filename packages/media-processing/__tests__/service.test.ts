/**
 * Tests for MediaProcessingService
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { MediaProcessingService, createMediaProcessingService } from '../src/service';

describe('MediaProcessingService', () => {
  describe('constructor', () => {
    it('initializes with config', () => {
      const service = new MediaProcessingService({
        groqApiKey: 'test-key',
        defaultLanguage: 'en',
      });
      expect(service).toBeDefined();
    });

    it('initializes without API keys', () => {
      const service = new MediaProcessingService({});
      expect(service).toBeDefined();
    });
  });

  describe('missing vision API key warning', () => {
    let stdoutSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
      stdoutSpy = spyOn(process.stdout, 'write');
    });

    afterEach(() => {
      stdoutSpy.mockRestore();
    });

    it('logs warning when no vision API keys are configured', () => {
      new MediaProcessingService({});

      const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('');
      expect(output).toContain('No vision API configured');
      expect(output).toContain('GEMINI_API_KEY');
      expect(output).toContain('OPENAI_API_KEY');
    });

    it('does not warn when geminiApiKey is set', () => {
      new MediaProcessingService({ geminiApiKey: 'test-gemini-key' });

      const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('');
      expect(output).not.toContain('No vision API configured');
    });

    it('does not warn when openaiApiKey is set', () => {
      new MediaProcessingService({ openaiApiKey: 'test-openai-key' });

      const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('');
      expect(output).not.toContain('No vision API configured');
    });

    it('does not warn when both keys are set', () => {
      new MediaProcessingService({
        geminiApiKey: 'test-gemini-key',
        openaiApiKey: 'test-openai-key',
      });

      const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('');
      expect(output).not.toContain('No vision API configured');
    });
  });

  describe('canProcess', () => {
    const service = new MediaProcessingService({});

    it('returns true for audio types', () => {
      expect(service.canProcess('audio/ogg')).toBe(true);
      expect(service.canProcess('audio/mp3')).toBe(true);
      expect(service.canProcess('audio/webm')).toBe(true);
    });

    it('returns true for image types', () => {
      expect(service.canProcess('image/jpeg')).toBe(true);
      expect(service.canProcess('image/png')).toBe(true);
      expect(service.canProcess('image/webp')).toBe(true);
    });

    it('returns true for document types', () => {
      expect(service.canProcess('application/pdf')).toBe(true);
      expect(service.canProcess('text/plain')).toBe(true);
      expect(service.canProcess('application/json')).toBe(true);
    });

    it('returns true for video types', () => {
      expect(service.canProcess('video/mp4')).toBe(true);
      expect(service.canProcess('video/webm')).toBe(true);
    });

    it('returns false for unsupported types', () => {
      expect(service.canProcess('application/zip')).toBe(false);
      expect(service.canProcess('application/x-executable')).toBe(false);
    });
  });

  describe('getProcessorName', () => {
    const service = new MediaProcessingService({});

    it('returns audio for audio types', () => {
      expect(service.getProcessorName('audio/ogg')).toBe('audio');
      expect(service.getProcessorName('audio/mp3')).toBe('audio');
    });

    it('returns image for image types', () => {
      expect(service.getProcessorName('image/jpeg')).toBe('image');
      expect(service.getProcessorName('image/png')).toBe('image');
    });

    it('returns document for document types', () => {
      expect(service.getProcessorName('application/pdf')).toBe('document');
      expect(service.getProcessorName('text/plain')).toBe('document');
    });

    it('returns video for video types', () => {
      expect(service.getProcessorName('video/mp4')).toBe('video');
      expect(service.getProcessorName('video/webm')).toBe('video');
    });

    it('returns undefined for unsupported types', () => {
      expect(service.getProcessorName('application/zip')).toBeUndefined();
    });
  });

  describe('getSupportedMimeTypes', () => {
    const service = new MediaProcessingService({});

    it('returns array of supported types', () => {
      const mimeTypes = service.getSupportedMimeTypes();
      expect(Array.isArray(mimeTypes)).toBe(true);
      expect(mimeTypes.length).toBeGreaterThan(0);
    });

    it('includes common types', () => {
      const mimeTypes = service.getSupportedMimeTypes();
      expect(mimeTypes).toContain('audio/*');
      expect(mimeTypes).toContain('image/*');
      expect(mimeTypes).toContain('application/pdf');
    });
  });

  describe('process', () => {
    const service = new MediaProcessingService({});

    it('returns error for unsupported mime type', async () => {
      const result = await service.process('/some/file.zip', 'application/zip');
      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain('No processor available');
    });
  });

  describe('createMediaProcessingService', () => {
    it('creates service with defaults', () => {
      const service = createMediaProcessingService();
      expect(service).toBeInstanceOf(MediaProcessingService);
    });

    it('creates service with partial config', () => {
      const service = createMediaProcessingService({
        defaultLanguage: 'en',
      });
      expect(service).toBeInstanceOf(MediaProcessingService);
    });

    it('preserves audio provider/model/prompt config for event-driven processors', () => {
      const service = createMediaProcessingService({
        audioProvider: 'groq',
        audioModel: 'whisper-large-v3-turbo',
        audioPrompt: 'Use the Namastex glossary.',
        audioGlossary: ['KHAL', 'Namastex'],
      });

      const config = (service as unknown as { config: Record<string, unknown> }).config;
      expect(config.audioProvider).toBe('groq');
      expect(config.audioModel).toBe('whisper-large-v3-turbo');
      expect(config.audioPrompt).toBe('Use the Namastex glossary.');
      expect(config.audioGlossary).toEqual(['KHAL', 'Namastex']);
    });
  });
});
