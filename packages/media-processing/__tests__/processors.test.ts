/**
 * Tests for media processors
 */

import { describe, expect, it } from 'bun:test';
import { AudioProcessor, DocumentProcessor, ImageProcessor, VideoProcessor } from '../src/processors';
import type { ProcessorConfig } from '../src/types';

const mockConfig: ProcessorConfig = {
  groqApiKey: undefined,
  openaiApiKey: undefined,
  geminiApiKey: undefined,
  defaultLanguage: 'pt',
  maxFileSizeMb: 25,
};

describe('processors', () => {
  describe('AudioProcessor', () => {
    const processor = new AudioProcessor(mockConfig);

    describe('canProcess', () => {
      it('handles audio/* wildcard', () => {
        expect(processor.canProcess('audio/ogg')).toBe(true);
        expect(processor.canProcess('audio/mp3')).toBe(true);
        expect(processor.canProcess('audio/wav')).toBe(true);
        expect(processor.canProcess('audio/unknown')).toBe(true);
      });

      it('handles specific audio types', () => {
        expect(processor.canProcess('audio/opus')).toBe(true);
        expect(processor.canProcess('audio/webm')).toBe(true);
        expect(processor.canProcess('audio/m4a')).toBe(true);
      });

      it('rejects non-audio types', () => {
        expect(processor.canProcess('image/jpeg')).toBe(false);
        expect(processor.canProcess('video/mp4')).toBe(false);
        expect(processor.canProcess('application/pdf')).toBe(false);
      });

      it('handles empty/null mime types', () => {
        expect(processor.canProcess('')).toBe(false);
      });
    });

    describe('process (without API keys)', () => {
      it('returns error when no API keys configured', async () => {
        const result = await processor.process('/nonexistent/audio.ogg', 'audio/ogg');
        expect(result.success).toBe(false);
        expect(result.errorMessage).toContain('not configured');
      });
    });
  });

  describe('ImageProcessor', () => {
    const processor = new ImageProcessor(mockConfig);

    describe('canProcess', () => {
      it('handles image/* wildcard', () => {
        expect(processor.canProcess('image/jpeg')).toBe(true);
        expect(processor.canProcess('image/png')).toBe(true);
        expect(processor.canProcess('image/gif')).toBe(true);
      });

      it('handles specific image types', () => {
        expect(processor.canProcess('image/webp')).toBe(true);
        expect(processor.canProcess('image/heic')).toBe(true);
      });

      it('rejects non-image types', () => {
        expect(processor.canProcess('audio/ogg')).toBe(false);
        expect(processor.canProcess('video/mp4')).toBe(false);
        expect(processor.canProcess('application/pdf')).toBe(false);
      });
    });

    describe('process (without API keys)', () => {
      it('returns error when no API keys configured', async () => {
        const result = await processor.process('/nonexistent/image.jpg', 'image/jpeg');
        expect(result.success).toBe(false);
        expect(result.errorMessage).toContain('API');
      });
    });
  });

  describe('DocumentProcessor', () => {
    const processor = new DocumentProcessor(mockConfig);

    describe('canProcess', () => {
      it('handles PDF', () => {
        expect(processor.canProcess('application/pdf')).toBe(true);
      });

      it('handles Word documents', () => {
        expect(processor.canProcess('application/msword')).toBe(true);
        expect(processor.canProcess('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(
          true,
        );
      });

      it('handles Excel documents', () => {
        expect(processor.canProcess('application/vnd.ms-excel')).toBe(true);
        expect(processor.canProcess('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(true);
      });

      it('handles text files', () => {
        expect(processor.canProcess('text/plain')).toBe(true);
        expect(processor.canProcess('text/markdown')).toBe(true);
        expect(processor.canProcess('text/csv')).toBe(true);
        expect(processor.canProcess('application/json')).toBe(true);
      });

      it('rejects non-document types', () => {
        expect(processor.canProcess('audio/ogg')).toBe(false);
        expect(processor.canProcess('image/jpeg')).toBe(false);
        expect(processor.canProcess('video/mp4')).toBe(false);
      });
    });
  });

  describe('VideoProcessor', () => {
    const processor = new VideoProcessor(mockConfig);

    describe('canProcess', () => {
      it('handles common video types', () => {
        expect(processor.canProcess('video/mp4')).toBe(true);
        expect(processor.canProcess('video/webm')).toBe(true);
        expect(processor.canProcess('video/quicktime')).toBe(true);
      });

      it('handles additional video types', () => {
        expect(processor.canProcess('video/x-msvideo')).toBe(true);
        expect(processor.canProcess('video/mpeg')).toBe(true);
        expect(processor.canProcess('video/3gpp')).toBe(true);
      });

      it('rejects non-video types', () => {
        expect(processor.canProcess('audio/ogg')).toBe(false);
        expect(processor.canProcess('image/jpeg')).toBe(false);
        expect(processor.canProcess('application/pdf')).toBe(false);
      });
    });

    describe('process (without API keys)', () => {
      it('returns error when no API keys configured', async () => {
        const result = await processor.process('/nonexistent/video.mp4', 'video/mp4');
        expect(result.success).toBe(false);
        expect(result.errorMessage).toContain('API');
      });
    });
  });
});
