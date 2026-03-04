/**
 * Media message sender for Telegram
 *
 * Includes recursive caption overflow splitting: captions >1024 chars are
 * split at the 1024-char boundary, with remaining text sent as follow-up
 * sendMessage() calls (recursively, so all chunks respect the 1024 limit).
 *
 * All media senders accept either a URL string or a Buffer (for base64-sourced
 * media). When a Buffer is provided, grammy's InputFile is used to upload the
 * file directly to Telegram.
 */

import { createLogger } from '@omni/core';
import type { TelegramBotLike } from '../grammy-shim';

const log = createLogger('telegram:sender:media');

/** Resolve a URL string or Buffer into a grammy-compatible file source */
async function resolveFileSource(source: string | Buffer, filename?: string): Promise<unknown> {
  if (typeof source === 'string') {
    return source;
  }
  // source is a Buffer — upload directly via InputFile
  try {
    const { InputFile } = await import('grammy');
    return new InputFile(source, filename);
  } catch (error) {
    throw new Error(`Failed to load grammy InputFile for buffer upload: ${String(error)}`);
  }
}

/** Telegram's caption character limit */
const CAPTION_MAX_LENGTH = 1024;

/**
 * Split a caption that exceeds the limit. Returns the first chunk (for the media caption)
 * and an array of overflow chunks (each <=1024 chars) for follow-up messages.
 */
export function splitCaption(caption: string): { first: string; overflow: string[] } {
  if (caption.length <= CAPTION_MAX_LENGTH) {
    return { first: caption, overflow: [] };
  }

  const first = caption.slice(0, CAPTION_MAX_LENGTH);
  const remaining = caption.slice(CAPTION_MAX_LENGTH);

  // Recursively split the remaining text
  const overflow: string[] = [];
  let rest = remaining;
  while (rest.length > 0) {
    overflow.push(rest.slice(0, CAPTION_MAX_LENGTH));
    rest = rest.slice(CAPTION_MAX_LENGTH);
  }

  return { first, overflow };
}

/**
 * Send caption overflow chunks as follow-up text messages.
 */
async function sendCaptionOverflow(
  bot: TelegramBotLike,
  chatId: string,
  overflowChunks: string[],
  options?: Record<string, unknown>,
): Promise<void> {
  for (const chunk of overflowChunks) {
    await bot.api.sendMessage(chatId, chunk, options ?? {});
  }
}

/**
 * Send a photo to a Telegram chat, with automatic caption overflow splitting.
 * Accepts a URL string or a Buffer (uploaded directly via InputFile).
 */
export async function sendPhoto(
  bot: TelegramBotLike,
  chatId: string,
  photoUrl: string | Buffer,
  caption?: string,
  replyToMessageId?: number,
  options?: Record<string, unknown>,
): Promise<number> {
  const file = await resolveFileSource(photoUrl);
  const { first, overflow } = splitCaption(caption ?? '');
  const result = await bot.api.sendPhoto(chatId, file as string, {
    ...(first ? { caption: first } : {}),
    ...(replyToMessageId ? { reply_parameters: { message_id: replyToMessageId } } : {}),
    ...(options ?? {}),
  });
  if (overflow.length > 0) {
    await sendCaptionOverflow(bot, chatId, overflow, options);
  }
  log.debug('Sent photo', { chatId, messageId: result.message_id, captionOverflow: overflow.length });
  return result.message_id;
}

/**
 * Send an audio file to a Telegram chat, with automatic caption overflow splitting.
 * Accepts a URL string or a Buffer (uploaded directly via InputFile).
 */
export async function sendAudio(
  bot: TelegramBotLike,
  chatId: string,
  audioUrl: string | Buffer,
  caption?: string,
  replyToMessageId?: number,
  options?: Record<string, unknown>,
): Promise<number> {
  const file = await resolveFileSource(audioUrl);
  const { first, overflow } = splitCaption(caption ?? '');
  const result = await bot.api.sendAudio(chatId, file as string, {
    ...(first ? { caption: first } : {}),
    ...(replyToMessageId ? { reply_parameters: { message_id: replyToMessageId } } : {}),
    ...(options ?? {}),
  });
  if (overflow.length > 0) {
    await sendCaptionOverflow(bot, chatId, overflow, options);
  }
  log.debug('Sent audio', { chatId, messageId: result.message_id });
  return result.message_id;
}

/**
 * Send a video to a Telegram chat, with automatic caption overflow splitting.
 * Accepts a URL string or a Buffer (uploaded directly via InputFile).
 */
export async function sendVideo(
  bot: TelegramBotLike,
  chatId: string,
  videoUrl: string | Buffer,
  caption?: string,
  replyToMessageId?: number,
  options?: Record<string, unknown>,
): Promise<number> {
  const file = await resolveFileSource(videoUrl);
  const { first, overflow } = splitCaption(caption ?? '');
  const result = await bot.api.sendVideo(chatId, file as string, {
    ...(first ? { caption: first } : {}),
    ...(replyToMessageId ? { reply_parameters: { message_id: replyToMessageId } } : {}),
    ...(options ?? {}),
  });
  if (overflow.length > 0) {
    await sendCaptionOverflow(bot, chatId, overflow, options);
  }
  log.debug('Sent video', { chatId, messageId: result.message_id });
  return result.message_id;
}

/**
 * Send a sticker to a Telegram chat
 */
export async function sendSticker(
  bot: TelegramBotLike,
  chatId: string,
  stickerUrl: string,
  replyToMessageId?: number,
  options?: Record<string, unknown>,
): Promise<number> {
  const result = await bot.api.sendSticker(chatId, stickerUrl, {
    ...(replyToMessageId ? { reply_parameters: { message_id: replyToMessageId } } : {}),
    ...(options ?? {}),
  });
  log.debug('Sent sticker', { chatId, messageId: result.message_id });
  return result.message_id;
}

/**
 * Send a contact card to a Telegram chat
 */
export async function sendContact(
  bot: TelegramBotLike,
  chatId: string,
  phone: string,
  firstName: string,
  lastName?: string,
  replyToMessageId?: number,
): Promise<number> {
  const result = await bot.api.sendContact(chatId, phone, firstName, {
    last_name: lastName,
    ...(replyToMessageId ? { reply_parameters: { message_id: replyToMessageId } } : {}),
  });
  log.debug('Sent contact', { chatId, messageId: result.message_id });
  return result.message_id;
}

/**
 * Send a location pin to a Telegram chat
 */
export async function sendLocation(
  bot: TelegramBotLike,
  chatId: string,
  latitude: number,
  longitude: number,
  replyToMessageId?: number,
): Promise<number> {
  const result = await bot.api.sendLocation(chatId, latitude, longitude, {
    ...(replyToMessageId ? { reply_parameters: { message_id: replyToMessageId } } : {}),
  });
  log.debug('Sent location', { chatId, messageId: result.message_id });
  return result.message_id;
}

/**
 * Send a document to a Telegram chat.
 * Accepts a URL string or a Buffer (uploaded directly via InputFile).
 * When a Buffer is provided, the file is uploaded directly without fetching a URL.
 */
export async function sendDocument(
  bot: TelegramBotLike,
  chatId: string,
  documentSource: string | Buffer,
  caption?: string,
  filename?: string,
  replyToMessageId?: number,
  options?: Record<string, unknown>,
): Promise<number> {
  let file: unknown;
  if (Buffer.isBuffer(documentSource)) {
    // Upload buffer directly via InputFile
    try {
      const { InputFile } = await import('grammy');
      file = new InputFile(documentSource, filename);
    } catch (error) {
      throw new Error(`Failed to load grammy InputFile for buffer upload: ${String(error)}`);
    }
  } else if (filename) {
    // URL with filename — wrap in InputFile so Telegram uses the provided name
    try {
      const { InputFile } = await import('grammy');
      file = new InputFile({ url: documentSource }, filename);
    } catch (error) {
      log.warn('Failed to load grammy InputFile, falling back to URL-only document send', {
        chatId,
        error: String(error),
      });
      file = documentSource;
    }
  } else {
    file = documentSource;
  }

  const { first, overflow } = splitCaption(caption ?? '');
  const result = await bot.api.sendDocument(chatId, file, {
    ...(first ? { caption: first } : {}),
    ...(replyToMessageId ? { reply_parameters: { message_id: replyToMessageId } } : {}),
    ...(options ?? {}),
  });
  if (overflow.length > 0) {
    await sendCaptionOverflow(bot, chatId, overflow, options);
  }
  log.debug('Sent document', { chatId, messageId: result.message_id });
  return result.message_id;
}
