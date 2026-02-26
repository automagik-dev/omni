/**
 * Tests for message content builders
 */

import { describe, expect, it } from 'bun:test';
import type { OutgoingMessage } from '@omni/channel-sdk';
import { buildMessageContent } from '../senders/builders';

const dummyVCard = () => 'BEGIN:VCARD\nEND:VCARD';

function makeVideoMessage(overrides: Partial<OutgoingMessage> = {}): OutgoingMessage {
  return {
    to: '5511999998888@s.whatsapp.net',
    content: {
      type: 'video',
      mediaUrl: 'https://example.com/video.mp4',
      mimeType: 'video/mp4',
      caption: 'Test video',
      ...overrides.content,
    },
    metadata: overrides.metadata,
  } as OutgoingMessage;
}

describe('buildMessageContent', () => {
  describe('buildVideo', () => {
    it('builds regular video without gifPlayback', () => {
      const msg = makeVideoMessage();
      const result = buildMessageContent(msg, dummyVCard) as Record<string, unknown>;
      expect(result.video).toBeDefined();
      expect(result.caption).toBe('Test video');
      expect(result.gifPlayback).toBeUndefined();
    });

    it('sets gifPlayback when MIME type is image/gif', () => {
      const msg = makeVideoMessage({
        content: { type: 'video', mediaUrl: 'https://example.com/anim.gif', mimeType: 'image/gif' },
      });
      const result = buildMessageContent(msg, dummyVCard) as Record<string, unknown>;
      expect(result.gifPlayback).toBe(true);
    });

    it('sets gifPlayback when metadata.gifPlayback is true', () => {
      const msg = makeVideoMessage({ metadata: { gifPlayback: true } });
      const result = buildMessageContent(msg, dummyVCard) as Record<string, unknown>;
      expect(result.gifPlayback).toBe(true);
    });

    it('does not set gifPlayback for regular video with metadata', () => {
      const msg = makeVideoMessage({ metadata: { someOtherFlag: true } });
      const result = buildMessageContent(msg, dummyVCard) as Record<string, unknown>;
      expect(result.gifPlayback).toBeUndefined();
    });

    it('does not set gifPlayback when metadata.gifPlayback is false', () => {
      const msg = makeVideoMessage({ metadata: { gifPlayback: false } });
      const result = buildMessageContent(msg, dummyVCard) as Record<string, unknown>;
      expect(result.gifPlayback).toBeUndefined();
    });
  });
});
