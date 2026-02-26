/**
 * Tests for Slack file handling
 *
 * Tests Group D: File Handling + Polish
 */

import { describe, expect, it } from 'bun:test';

import { SLACK_CAPABILITIES } from '../capabilities';
import { extractFileInfo, getContentTypeFromMime } from '../handlers/files';
import { extractMessageMeta } from '../handlers/messages';
import type { SlackFileInfo } from '../types';

// ─────────────────────────────────────────────────────────────
// File info extraction
// ─────────────────────────────────────────────────────────────

describe('extractFileInfo', () => {
  it('extracts file metadata from Slack file objects', () => {
    const files = [
      {
        id: 'F12345',
        name: 'photo.jpg',
        mimetype: 'image/jpeg',
        size: 102400,
        url_private_download: 'https://files.slack.com/download/photo.jpg',
        url_private: 'https://files.slack.com/view/photo.jpg',
        thumb_360: 'https://files.slack.com/thumb/360.jpg',
      },
    ];

    const result = extractFileInfo(files);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('F12345');
    expect(result[0]?.name).toBe('photo.jpg');
    expect(result[0]?.mimeType).toBe('image/jpeg');
    expect(result[0]?.size).toBe(102400);
    expect(result[0]?.urlPrivateDownload).toBe('https://files.slack.com/download/photo.jpg');
    expect(result[0]?.urlPrivate).toBe('https://files.slack.com/view/photo.jpg');
    expect(result[0]?.thumbnailUrl).toBe('https://files.slack.com/thumb/360.jpg');
  });

  it('handles missing optional fields', () => {
    const files = [
      {
        id: 'F99',
        title: 'doc.pdf',
        mimetype: 'application/pdf',
        size: 500,
      },
    ];

    const result = extractFileInfo(files);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('doc.pdf'); // falls back to title
    expect(result[0]?.urlPrivateDownload).toBeUndefined();
    expect(result[0]?.urlPrivate).toBeUndefined();
    expect(result[0]?.thumbnailUrl).toBeUndefined();
  });

  it('handles completely empty file objects', () => {
    const files = [{}];
    const result = extractFileInfo(files);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('');
    expect(result[0]?.name).toBe('unknown');
    expect(result[0]?.mimeType).toBe('application/octet-stream');
    expect(result[0]?.size).toBe(0);
  });

  it('handles empty array', () => {
    expect(extractFileInfo([])).toHaveLength(0);
  });

  it('handles null/undefined gracefully', () => {
    expect(extractFileInfo(null as unknown as unknown[])).toHaveLength(0);
    expect(extractFileInfo(undefined as unknown as unknown[])).toHaveLength(0);
  });

  it('extracts multiple files', () => {
    const files = [
      { id: 'F1', name: 'a.txt', mimetype: 'text/plain', size: 100 },
      { id: 'F2', name: 'b.png', mimetype: 'image/png', size: 200 },
      { id: 'F3', name: 'c.mp3', mimetype: 'audio/mpeg', size: 300 },
    ];
    const result = extractFileInfo(files);
    expect(result).toHaveLength(3);
    expect(result[0]?.name).toBe('a.txt');
    expect(result[1]?.name).toBe('b.png');
    expect(result[2]?.name).toBe('c.mp3');
  });

  it('uses thumb_160 when thumb_360 is missing', () => {
    const files = [
      {
        id: 'F10',
        name: 'img.png',
        mimetype: 'image/png',
        size: 100,
        thumb_160: 'https://files.slack.com/thumb/160.png',
      },
    ];
    const result = extractFileInfo(files);
    expect(result[0]?.thumbnailUrl).toBe('https://files.slack.com/thumb/160.png');
  });
});

// ─────────────────────────────────────────────────────────────
// Content type detection
// ─────────────────────────────────────────────────────────────

describe('getContentTypeFromMime', () => {
  it('detects image types', () => {
    expect(getContentTypeFromMime('image/jpeg')).toBe('image');
    expect(getContentTypeFromMime('image/png')).toBe('image');
    expect(getContentTypeFromMime('image/gif')).toBe('image');
    expect(getContentTypeFromMime('image/webp')).toBe('image');
  });

  it('detects audio types', () => {
    expect(getContentTypeFromMime('audio/mpeg')).toBe('audio');
    expect(getContentTypeFromMime('audio/wav')).toBe('audio');
    expect(getContentTypeFromMime('audio/ogg')).toBe('audio');
  });

  it('detects video types', () => {
    expect(getContentTypeFromMime('video/mp4')).toBe('video');
    expect(getContentTypeFromMime('video/webm')).toBe('video');
  });

  it('defaults to document for other types', () => {
    expect(getContentTypeFromMime('application/pdf')).toBe('document');
    expect(getContentTypeFromMime('text/plain')).toBe('document');
    expect(getContentTypeFromMime('application/json')).toBe('document');
    expect(getContentTypeFromMime('application/octet-stream')).toBe('document');
  });
});

// ─────────────────────────────────────────────────────────────
// Capabilities (final verification)
// ─────────────────────────────────────────────────────────────

describe('Slack capabilities', () => {
  it('supports streaming', () => {
    expect(SLACK_CAPABILITIES.canStreamResponse).toBe(true);
  });

  it('has correct max message length', () => {
    expect(SLACK_CAPABILITIES.maxMessageLength).toBe(4000);
  });

  it('has correct max file size (1GB)', () => {
    expect(SLACK_CAPABILITIES.maxFileSize).toBe(1024 * 1024 * 1024);
  });

  it('supports media types', () => {
    expect(SLACK_CAPABILITIES.supportedMediaTypes).toBeDefined();
    expect(SLACK_CAPABILITIES.supportedMediaTypes?.length).toBeGreaterThanOrEqual(4);
  });

  it('supports reactions', () => {
    expect(SLACK_CAPABILITIES.canSendReaction).toBe(true);
  });

  it('supports threads', () => {
    expect(SLACK_CAPABILITIES.canHandleThreads).toBe(true);
  });

  it('supports editing', () => {
    expect(SLACK_CAPABILITIES.canEditMessage).toBe(true);
  });

  it('supports deleting', () => {
    expect(SLACK_CAPABILITIES.canDeleteMessage).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// Message meta edge cases
// ─────────────────────────────────────────────────────────────

describe('Message meta edge cases', () => {
  it('detects DM correctly', () => {
    const meta = extractMessageMeta({
      channel: 'D123',
      ts: '1234567.123',
      user: 'U999',
      channel_type: 'im',
    });
    expect(meta.isDm).toBe(true);
    expect(meta.channelType).toBe('im');
  });

  it('detects non-DM correctly', () => {
    const meta = extractMessageMeta({
      channel: 'C123',
      ts: '1234567.123',
      user: 'U999',
      channel_type: 'channel',
    });
    expect(meta.isDm).toBe(false);
  });

  it('detects thread reply', () => {
    const meta = extractMessageMeta({
      channel: 'C123',
      ts: '1234567.456',
      thread_ts: '1234567.123',
      user: 'U999',
    });
    expect(meta.isThreadReply).toBe(true);
    expect(meta.threadTs).toBe('1234567.123');
  });

  it('detects top-level thread message (ts === thread_ts)', () => {
    const meta = extractMessageMeta({
      channel: 'C123',
      ts: '1234567.123',
      thread_ts: '1234567.123',
      user: 'U999',
    });
    expect(meta.isThreadReply).toBe(false);
  });

  it('handles missing optional fields', () => {
    const meta = extractMessageMeta({
      channel: 'C123',
      ts: '1234567.123',
      user: 'U999',
    });
    expect(meta.threadTs).toBeUndefined();
    expect(meta.teamId).toBeUndefined();
    expect(meta.channelType).toBeUndefined();
    expect(meta.isThreadReply).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// Type validation
// ─────────────────────────────────────────────────────────────

describe('SlackFileInfo type', () => {
  it('contains expected fields', () => {
    const file: SlackFileInfo = {
      id: 'F123',
      name: 'test.txt',
      mimeType: 'text/plain',
      size: 256,
    };
    expect(file.id).toBe('F123');
    expect(file.name).toBe('test.txt');
    expect(file.mimeType).toBe('text/plain');
    expect(file.size).toBe(256);
  });

  it('supports optional URL fields', () => {
    const file: SlackFileInfo = {
      id: 'F456',
      name: 'image.png',
      mimeType: 'image/png',
      size: 1024,
      urlPrivateDownload: 'https://files.slack.com/dl',
      urlPrivate: 'https://files.slack.com/view',
      thumbnailUrl: 'https://files.slack.com/thumb',
    };
    expect(file.urlPrivateDownload).toBeDefined();
    expect(file.urlPrivate).toBeDefined();
    expect(file.thumbnailUrl).toBeDefined();
  });
});
