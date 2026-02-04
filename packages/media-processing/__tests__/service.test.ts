/**
 * Tests for MediaProcessingService
 */

import { describe, expect, it } from 'bun:test';
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
  });
});
