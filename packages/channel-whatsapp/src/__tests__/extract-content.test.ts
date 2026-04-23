/**
 * Tests for extractContent — ensures proto media URLs are hoisted into
 * ExtractedContent.mediaUrl so they reach messages.media_url at persist time
 * even when ingest-time blob download fails.
 *
 * Regression guard for omni#500 Bug 1.
 */

import { describe, expect, it } from 'bun:test';
import type { WAMessage } from 'baileys';
import { extractContent } from '../handlers/messages';

function wrap(message: Record<string, unknown>): WAMessage {
  return {
    key: { id: 'TEST', remoteJid: '5511999998888@s.whatsapp.net', fromMe: false },
    message,
  } as unknown as WAMessage;
}

describe('extractContent — mediaUrl hoist (omni#500)', () => {
  it('hoists imageMessage.url into mediaUrl', () => {
    const content = extractContent(
      wrap({
        imageMessage: {
          url: 'https://mmg.whatsapp.net/v/t62.7118-24/img.enc?oe=1',
          mimetype: 'image/jpeg',
          caption: 'hello',
        },
      }),
    );
    expect(content?.type).toBe('image');
    expect(content?.mediaUrl).toBe('https://mmg.whatsapp.net/v/t62.7118-24/img.enc?oe=1');
    expect(content?.mimeType).toBe('image/jpeg');
  });

  it('hoists audioMessage.url into mediaUrl', () => {
    const content = extractContent(
      wrap({
        audioMessage: {
          url: 'https://mmg.whatsapp.net/v/t62.7117-24/audio.enc?oe=2',
          mimetype: 'audio/ogg; codecs=opus',
        },
      }),
    );
    expect(content?.type).toBe('audio');
    expect(content?.mediaUrl).toBe('https://mmg.whatsapp.net/v/t62.7117-24/audio.enc?oe=2');
  });

  it('hoists videoMessage.url into mediaUrl', () => {
    const content = extractContent(
      wrap({
        videoMessage: {
          url: 'https://mmg.whatsapp.net/v/t62.7161-24/video.enc?oe=3',
          mimetype: 'video/mp4',
        },
      }),
    );
    expect(content?.type).toBe('video');
    expect(content?.mediaUrl).toBe('https://mmg.whatsapp.net/v/t62.7161-24/video.enc?oe=3');
  });

  it('hoists documentMessage.url into mediaUrl', () => {
    const content = extractContent(
      wrap({
        documentMessage: {
          url: 'https://mmg.whatsapp.net/v/t62.7119-24/doc.enc?oe=4',
          mimetype: 'application/pdf',
          fileName: 'contract.pdf',
        },
      }),
    );
    expect(content?.type).toBe('document');
    expect(content?.mediaUrl).toBe('https://mmg.whatsapp.net/v/t62.7119-24/doc.enc?oe=4');
    expect(content?.filename).toBe('contract.pdf');
  });

  it('hoists stickerMessage.url into mediaUrl', () => {
    const content = extractContent(
      wrap({
        stickerMessage: {
          url: 'https://mmg.whatsapp.net/v/t62.15575-24/sticker.enc?oe=5',
          mimetype: 'image/webp',
        },
      }),
    );
    expect(content?.type).toBe('sticker');
    expect(content?.mediaUrl).toBe('https://mmg.whatsapp.net/v/t62.15575-24/sticker.enc?oe=5');
  });

  it('leaves mediaUrl undefined when proto url is missing', () => {
    const content = extractContent(wrap({ audioMessage: { mimetype: 'audio/ogg' } }));
    expect(content?.type).toBe('audio');
    expect(content?.mediaUrl).toBeUndefined();
  });
});
