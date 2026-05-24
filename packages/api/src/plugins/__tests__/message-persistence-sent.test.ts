import { describe, expect, test } from 'bun:test';
import type { MessageSentPayload } from '@omni/core';
import { buildSentMessageContentFields } from '../message-persistence';

describe('message-persistence sent content mapping', () => {
  test('maps outbound media caption and metadata for DB persistence', () => {
    const payload: MessageSentPayload = {
      externalId: 'MEDIA-ID-1',
      chatId: '5511999999999@s.whatsapp.net',
      to: '5511999999999@s.whatsapp.net',
      content: {
        type: 'image',
        caption: 'caption test',
        mimeType: 'image/png',
        filename: 'test.png',
        isVoiceNote: false,
      },
      rawPayload: {
        isFromMe: true,
        mediaSource: 'base64',
        filename: 'test.png',
      },
    };

    expect(buildSentMessageContentFields(payload)).toEqual({
      textContent: 'caption test',
      hasMedia: true,
      mediaMimeType: 'image/png',
      mediaUrl: undefined,
      mediaLocalPath: undefined,
      mediaMetadata: {
        caption: 'caption test',
        filename: 'test.png',
        source: 'base64',
      },
      rawPayload: {
        isFromMe: true,
        mediaSource: 'base64',
        filename: 'test.png',
      },
    });
  });

  test('keeps plain outbound text as non-media', () => {
    const payload: MessageSentPayload = {
      externalId: 'TEXT-ID-1',
      chatId: '5511999999999@s.whatsapp.net',
      to: '5511999999999@s.whatsapp.net',
      content: {
        type: 'text',
        text: 'hello',
      },
    };

    expect(buildSentMessageContentFields(payload)).toEqual({
      textContent: 'hello',
      hasMedia: false,
      mediaMimeType: undefined,
      mediaUrl: undefined,
      mediaLocalPath: undefined,
      mediaMetadata: undefined,
      rawPayload: undefined,
    });
  });
});
