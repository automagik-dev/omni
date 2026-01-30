/**
 * Tests for helper utilities
 */

import { describe, expect, it } from 'bun:test';
import {
  TypingManager,
  audioMessage,
  documentMessage,
  getTextContent,
  imageMessage,
  isMediaContent,
  locationMessage,
  reactionMessage,
  splitText,
  textMessage,
  truncateText,
  videoMessage,
} from '../src';

describe('Message helpers', () => {
  it('should create text messages', () => {
    const msg = textMessage('user-123', 'Hello world');

    expect(msg.to).toBe('user-123');
    expect(msg.content.type).toBe('text');
    expect(msg.content.text).toBe('Hello world');
  });

  it('should create text messages with reply', () => {
    const msg = textMessage('user-123', 'Hello', 'original-msg-id');

    expect(msg.replyTo).toBe('original-msg-id');
  });

  it('should create image messages', () => {
    const msg = imageMessage('user-123', 'https://example.com/image.jpg', {
      caption: 'A nice photo',
    });

    expect(msg.content.type).toBe('image');
    expect(msg.content.mediaUrl).toBe('https://example.com/image.jpg');
    expect(msg.content.caption).toBe('A nice photo');
    expect(msg.content.mimeType).toBe('image/jpeg');
  });

  it('should create document messages', () => {
    const msg = documentMessage('user-123', 'https://example.com/doc.pdf', 'report.pdf');

    expect(msg.content.type).toBe('document');
    expect(msg.content.filename).toBe('report.pdf');
    expect(msg.content.mimeType).toBe('application/octet-stream');
  });

  it('should create audio messages', () => {
    const msg = audioMessage('user-123', 'https://example.com/audio.mp3');

    expect(msg.content.type).toBe('audio');
    expect(msg.content.mimeType).toBe('audio/mpeg');
  });

  it('should create video messages', () => {
    const msg = videoMessage('user-123', 'https://example.com/video.mp4', {
      caption: 'Check this out!',
    });

    expect(msg.content.type).toBe('video');
    expect(msg.content.caption).toBe('Check this out!');
    expect(msg.content.mimeType).toBe('video/mp4');
  });

  it('should create reaction messages', () => {
    const msg = reactionMessage('user-123', 'target-msg-id', '👍');

    expect(msg.content.type).toBe('reaction');
    expect(msg.content.emoji).toBe('👍');
    expect(msg.content.targetMessageId).toBe('target-msg-id');
  });

  it('should create location messages', () => {
    const msg = locationMessage('user-123', 40.7128, -74.006, {
      name: 'New York City',
      address: 'NYC, USA',
    });

    expect(msg.content.type).toBe('location');
    expect(msg.content.location?.latitude).toBe(40.7128);
    expect(msg.content.location?.longitude).toBe(-74.006);
    expect(msg.content.location?.name).toBe('New York City');
  });
});

describe('Text utilities', () => {
  describe('truncateText', () => {
    it('should not truncate short text', () => {
      expect(truncateText('Hello', 10)).toBe('Hello');
    });

    it('should truncate long text with ellipsis', () => {
      expect(truncateText('Hello World', 8)).toBe('Hello...');
    });

    it('should handle custom ellipsis', () => {
      expect(truncateText('Hello World', 9, '…')).toBe('Hello Wo…');
    });

    it('should handle edge cases', () => {
      expect(truncateText('Hi', 0)).toBe('Hi');
      expect(truncateText('', 10)).toBe('');
    });
  });

  describe('splitText', () => {
    it('should not split short text', () => {
      const parts = splitText('Hello', 100);
      expect(parts).toEqual(['Hello']);
    });

    it('should split long text', () => {
      const text = 'Hello World. This is a test message.';
      const parts = splitText(text, 15);

      expect(parts.length).toBeGreaterThan(1);
      for (const part of parts) {
        expect(part.length).toBeLessThanOrEqual(15);
      }
    });

    it('should prefer word boundaries', () => {
      const text = 'Hello World Test';
      const parts = splitText(text, 12);

      // Should split at "Hello World" rather than "Hello World "
      expect(parts[0]).toBe('Hello World');
    });
  });

  describe('getTextContent', () => {
    it('should return text', () => {
      expect(getTextContent({ type: 'text', text: 'Hello' })).toBe('Hello');
    });

    it('should return caption if no text', () => {
      expect(getTextContent({ type: 'image', caption: 'Nice photo' })).toBe('Nice photo');
    });

    it('should return undefined if no text or caption', () => {
      expect(getTextContent({ type: 'audio' })).toBeUndefined();
    });
  });

  describe('isMediaContent', () => {
    it('should identify media types', () => {
      expect(isMediaContent('image')).toBe(true);
      expect(isMediaContent('audio')).toBe(true);
      expect(isMediaContent('video')).toBe(true);
      expect(isMediaContent('document')).toBe(true);
      expect(isMediaContent('sticker')).toBe(true);
    });

    it('should identify non-media types', () => {
      expect(isMediaContent('text')).toBe(false);
      expect(isMediaContent('reaction')).toBe(false);
      expect(isMediaContent('location')).toBe(false);
    });
  });
});

describe('TypingManager', () => {
  it('should track typing state', async () => {
    let isTyping = false;
    const manager = new TypingManager({
      defaultDuration: 1000,
      sendTyping: async (_chatId, typing) => {
        isTyping = typing;
      },
    });

    expect(manager.isTyping('chat-1')).toBe(false);

    await manager.startTyping('chat-1');
    expect(manager.isTyping('chat-1')).toBe(true);
    expect(isTyping).toBe(true);

    await manager.stopTyping('chat-1');
    expect(manager.isTyping('chat-1')).toBe(false);
    expect(isTyping).toBe(false);
  });

  it('should list active chats', async () => {
    const manager = new TypingManager({
      sendTyping: async () => {},
    });

    await manager.startTyping('chat-1');
    await manager.startTyping('chat-2');

    const active = manager.getActiveChats();
    expect(active).toContain('chat-1');
    expect(active).toContain('chat-2');
  });

  it('should stop all typing', async () => {
    const manager = new TypingManager({
      sendTyping: async () => {},
    });

    await manager.startTyping('chat-1');
    await manager.startTyping('chat-2');

    await manager.stopAll();

    expect(manager.getActiveChats().length).toBe(0);
  });
});
