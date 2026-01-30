/**
 * Tests for media utilities and senders
 */

import { describe, expect, it } from 'bun:test';
import {
  buildAudioContent,
  buildDocumentContent,
  buildImageContent,
  buildStickerContent,
  buildVideoContent,
} from '../senders/media';
import { generateFilename, getExtension } from '../utils/download';

describe('Media Utilities', () => {
  describe('getExtension', () => {
    it('returns .jpg for image/jpeg', () => {
      expect(getExtension('image/jpeg')).toBe('.jpg');
    });

    it('returns .png for image/png', () => {
      expect(getExtension('image/png')).toBe('.png');
    });

    it('returns .webp for image/webp', () => {
      expect(getExtension('image/webp')).toBe('.webp');
    });

    it('returns .ogg for audio/ogg', () => {
      expect(getExtension('audio/ogg')).toBe('.ogg');
    });

    it('returns .ogg for audio/ogg; codecs=opus', () => {
      expect(getExtension('audio/ogg; codecs=opus')).toBe('.ogg');
    });

    it('returns .mp4 for video/mp4', () => {
      expect(getExtension('video/mp4')).toBe('.mp4');
    });

    it('returns .pdf for application/pdf', () => {
      expect(getExtension('application/pdf')).toBe('.pdf');
    });

    it('returns .bin for unknown types', () => {
      expect(getExtension('application/x-custom')).toBe('.bin');
    });
  });

  describe('generateFilename', () => {
    it('uses original filename if provided', () => {
      expect(generateFilename('image/jpeg', 'photo.jpg')).toBe('photo.jpg');
    });

    it('generates UUID filename with correct extension', () => {
      const filename = generateFilename('image/png');
      expect(filename).toMatch(/^[a-f0-9-]+\.png$/);
    });

    it('generates different filenames each call', () => {
      const filename1 = generateFilename('audio/ogg');
      const filename2 = generateFilename('audio/ogg');
      expect(filename1).not.toBe(filename2);
    });
  });
});

describe('Media Senders', () => {
  describe('buildImageContent', () => {
    it('builds basic image content', () => {
      const content = buildImageContent('https://example.com/image.jpg');
      expect(content).toHaveProperty('image');
      expect((content as { image: { url: string } }).image.url).toBe('https://example.com/image.jpg');
    });

    it('includes caption when provided', () => {
      const content = buildImageContent('https://example.com/image.jpg', {
        caption: 'Test caption',
      });
      expect((content as { caption: string }).caption).toBe('Test caption');
    });

    it('includes mimetype when provided', () => {
      const content = buildImageContent('https://example.com/image.jpg', {
        mimeType: 'image/png',
      });
      expect((content as { mimetype: string }).mimetype).toBe('image/png');
    });
  });

  describe('buildAudioContent', () => {
    it('builds basic audio content', () => {
      const content = buildAudioContent('https://example.com/audio.ogg');
      expect(content).toHaveProperty('audio');
      expect((content as { ptt: boolean }).ptt).toBe(false);
    });

    it('sets ptt flag for voice notes', () => {
      const content = buildAudioContent('https://example.com/audio.ogg', {
        ptt: true,
      });
      expect((content as { ptt: boolean }).ptt).toBe(true);
    });

    it('uses default mimetype', () => {
      const content = buildAudioContent('https://example.com/audio.ogg');
      expect((content as { mimetype: string }).mimetype).toBe('audio/ogg; codecs=opus');
    });
  });

  describe('buildVideoContent', () => {
    it('builds basic video content', () => {
      const content = buildVideoContent('https://example.com/video.mp4');
      expect(content).toHaveProperty('video');
    });

    it('includes caption when provided', () => {
      const content = buildVideoContent('https://example.com/video.mp4', {
        caption: 'Video caption',
      });
      expect((content as { caption: string }).caption).toBe('Video caption');
    });
  });

  describe('buildDocumentContent', () => {
    it('builds basic document content', () => {
      const content = buildDocumentContent('https://example.com/doc.pdf');
      expect(content).toHaveProperty('document');
    });

    it('uses default filename', () => {
      const content = buildDocumentContent('https://example.com/doc.pdf');
      expect((content as { fileName: string }).fileName).toBe('document');
    });

    it('uses provided filename', () => {
      const content = buildDocumentContent('https://example.com/doc.pdf', {
        filename: 'report.pdf',
      });
      expect((content as { fileName: string }).fileName).toBe('report.pdf');
    });
  });

  describe('buildStickerContent', () => {
    it('builds sticker content', () => {
      const content = buildStickerContent('https://example.com/sticker.webp');
      expect(content).toHaveProperty('sticker');
      expect((content as { sticker: { url: string } }).sticker.url).toBe('https://example.com/sticker.webp');
    });
  });
});
