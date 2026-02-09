/**
 * Media message sender for Telegram
 */

import { createLogger } from '@omni/core';
import { InputFile } from 'grammy';
import type { Bot } from 'grammy';

const log = createLogger('telegram:sender:media');

/**
 * Send a photo to a Telegram chat
 */
export async function sendPhoto(
  bot: Bot,
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
  bot: Bot,
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
  bot: Bot,
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
 * Send a document to a Telegram chat
 */
export async function sendDocument(
  bot: Bot,
  chatId: string,
  documentUrl: string,
  caption?: string,
  filename?: string,
  replyToMessageId?: number,
): Promise<number> {
  const file = filename ? new InputFile({ url: documentUrl }, filename) : documentUrl;

  const result = await bot.api.sendDocument(chatId, file, {
    caption,
    ...(replyToMessageId ? { reply_parameters: { message_id: replyToMessageId } } : {}),
  });
  log.debug('Sent document', { chatId, messageId: result.message_id });
  return result.message_id;
}
