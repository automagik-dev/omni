/**
 * Shared inbound content extraction for Telegram updates.
 *
 * Used by both:
 * - message handlers (`message`, `edited_message`)
 * - channel post handlers (`channel_post`, `edited_channel_post`)
 */

import type { ContentType } from '@omni/core/types';
import type { TelegramMessageLike, TelegramPhotoSize } from '../grammy-shim';

export interface TelegramExtractedContent {
  type: ContentType;
  text?: string;
  mediaFileId?: string;
  mimeType?: string;
  filename?: string;
}

function extractPhoto(msg: TelegramMessageLike): TelegramExtractedContent | null {
  if (!msg.photo || msg.photo.length === 0) return null;

  // Pick the largest available photo size (best-quality) and use its file_id.
  const largest = msg.photo.reduce((a: TelegramPhotoSize, b: TelegramPhotoSize) =>
    (a.file_size ?? 0) > (b.file_size ?? 0) ? a : b,
  );

  return {
    type: 'image',
    text: msg.caption,
    mediaFileId: largest.file_id,
    mimeType: 'image/jpeg',
  };
}

function extractMedia(msg: TelegramMessageLike): TelegramExtractedContent | null {
  if (msg.audio)
    return {
      type: 'audio',
      text: msg.caption,
      mediaFileId: msg.audio.file_id,
      mimeType: msg.audio.mime_type ?? 'audio/mpeg',
      filename: msg.audio.file_name,
    };

  if (msg.voice)
    return {
      type: 'audio',
      text: msg.caption,
      mediaFileId: msg.voice.file_id,
      mimeType: msg.voice.mime_type ?? 'audio/ogg',
    };

  if (msg.video)
    return {
      type: 'video',
      text: msg.caption,
      mediaFileId: msg.video.file_id,
      mimeType: msg.video.mime_type ?? 'video/mp4',
      filename: msg.video.file_name,
    };

  if (msg.video_note)
    return {
      type: 'video',
      mediaFileId: msg.video_note.file_id,
      mimeType: 'video/mp4',
    };

  if (msg.document)
    return {
      type: 'document',
      text: msg.caption,
      mediaFileId: msg.document.file_id,
      mimeType: msg.document.mime_type ?? 'application/octet-stream',
      filename: msg.document.file_name,
    };

  if (msg.sticker)
    return {
      type: 'sticker',
      text: msg.sticker.emoji,
      mediaFileId: msg.sticker.file_id,
      mimeType: msg.sticker.is_animated ? 'application/x-tgsticker' : 'image/webp',
    };

  return null;
}

function extractSpecial(msg: TelegramMessageLike): TelegramExtractedContent | null {
  if (msg.location)
    return {
      type: 'location',
      text: `Location: ${msg.location.latitude}, ${msg.location.longitude}`,
    };

  if (msg.contact)
    return {
      type: 'contact',
      text: `Contact: ${msg.contact.first_name} ${msg.contact.phone_number}`,
    };

  return null;
}

export function extractTelegramMessageContent(msg: TelegramMessageLike): TelegramExtractedContent {
  if (msg.text) return { type: 'text', text: msg.text };

  return (
    extractPhoto(msg) ??
    extractMedia(msg) ??
    extractSpecial(msg) ?? {
      type: 'text',
      text: msg.caption ?? '[Unsupported message type]',
    }
  );
}
