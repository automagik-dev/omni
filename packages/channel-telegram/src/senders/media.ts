/**
 * Media message sender for Telegram
 */

import { createLogger } from '@omni/core';
import type { TelegramBotLike } from '../grammy-shim';

const log = createLogger('telegram:sender:media');

/**
 * Send a photo to a Telegram chat
 */
export async function sendPhoto(
  bot: TelegramBotLike,
  chatId: string,
  photoUrl: string,
  caption?: string,
  replyToMessageId?: number,
): Promise<number> {
  const result = await bot.api.sendPhoto(chatId, photoUrl, {
    caption,
    ...(replyToMessageId ? { reply_parameters: { message_id: replyToMessageId } } : {}),
  });
  log.debug('Sent photo', { chatId, messageId: result.message_id });
  return result.message_id;
}

/**
 * Send an audio file to a Telegram chat
 */
export async function sendAudio(
  bot: TelegramBotLike,
  chatId: string,
  audioUrl: string,
  caption?: string,
  replyToMessageId?: number,
): Promise<number> {
  const result = await bot.api.sendAudio(chatId, audioUrl, {
    caption,
    ...(replyToMessageId ? { reply_parameters: { message_id: replyToMessageId } } : {}),
  });
  log.debug('Sent audio', { chatId, messageId: result.message_id });
  return result.message_id;
}

/**
 * Send a video to a Telegram chat
 */
export async function sendVideo(
  bot: TelegramBotLike,
  chatId: string,
  videoUrl: string,
  caption?: string,
  replyToMessageId?: number,
): Promise<number> {
  const result = await bot.api.sendVideo(chatId, videoUrl, {
    caption,
    ...(replyToMessageId ? { reply_parameters: { message_id: replyToMessageId } } : {}),
  });
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
): Promise<number> {
  const result = await bot.api.sendSticker(chatId, stickerUrl, {
    ...(replyToMessageId ? { reply_parameters: { message_id: replyToMessageId } } : {}),
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
 * Send a document to a Telegram chat
 */
export async function sendDocument(
  bot: TelegramBotLike,
  chatId: string,
  documentUrl: string,
  caption?: string,
  filename?: string,
  replyToMessageId?: number,
): Promise<number> {
  const file = filename
    ? // Lazy-load to keep this module importable in tests without loading grammy.
      new (await import('grammy')).InputFile({ url: documentUrl }, filename)
    : documentUrl;

  const result = await bot.api.sendDocument(chatId, file, {
    caption,
    ...(replyToMessageId ? { reply_parameters: { message_id: replyToMessageId } } : {}),
  });
  log.debug('Sent document', { chatId, messageId: result.message_id });
  return result.message_id;
}
