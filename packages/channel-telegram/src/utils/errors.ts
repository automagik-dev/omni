/**
 * Error handling utilities for Telegram plugin
 *
 * TelegramError extends core ChannelError for standardized error handling.
 */

import { ChannelError, type ErrorCode as CoreErrorCode, ERROR_CODES } from '@omni/core';

/**
 * Error codes for Telegram plugin errors
 */
export const TelegramErrorCode = {
  NOT_CONNECTED: 'TELEGRAM_NOT_CONNECTED',
  SEND_FAILED: 'TELEGRAM_SEND_FAILED',
  AUTH_FAILED: 'TELEGRAM_AUTH_FAILED',
  RATE_LIMITED: 'TELEGRAM_RATE_LIMITED',
  BOT_BLOCKED: 'TELEGRAM_BOT_BLOCKED',
  WEBHOOK_FAILED: 'TELEGRAM_WEBHOOK_FAILED',
  UNKNOWN: 'TELEGRAM_UNKNOWN_ERROR',
} as const;

export type TelegramErrorCodeType = (typeof TelegramErrorCode)[keyof typeof TelegramErrorCode];

/**
 * Map Telegram-specific error codes to core ErrorCode
 */
const CORE_CODE_MAP: Record<TelegramErrorCodeType, CoreErrorCode> = {
  [TelegramErrorCode.NOT_CONNECTED]: ERROR_CODES.CHANNEL_NOT_CONNECTED,
  [TelegramErrorCode.SEND_FAILED]: ERROR_CODES.CHANNEL_SEND_FAILED,
  [TelegramErrorCode.AUTH_FAILED]: ERROR_CODES.CHANNEL_AUTH_FAILED,
  [TelegramErrorCode.RATE_LIMITED]: ERROR_CODES.CHANNEL_RATE_LIMITED,
  [TelegramErrorCode.BOT_BLOCKED]: ERROR_CODES.FORBIDDEN,
  [TelegramErrorCode.WEBHOOK_FAILED]: ERROR_CODES.CHANNEL_CONNECTION_FAILED,
  [TelegramErrorCode.UNKNOWN]: ERROR_CODES.UNKNOWN,
};

/**
 * Telegram plugin error — extends core ChannelError
 */
export class TelegramError extends ChannelError {
  readonly channelCode: TelegramErrorCodeType;

  constructor(code: TelegramErrorCodeType, message: string, recoverable = false, context?: Record<string, unknown>) {
    const coreCode = CORE_CODE_MAP[code] ?? ERROR_CODES.UNKNOWN;
    super(coreCode, message, 'telegram', undefined, { recoverable, context: { ...context, channelCode: code } });
    this.name = 'TelegramError';
    this.channelCode = code;
  }
}

/**
 * Map grammy/Telegram API errors to TelegramError
 */
export function mapTelegramError(error: unknown): TelegramError {
  if (error instanceof TelegramError) return error;
  if (!(error instanceof Error)) return new TelegramError(TelegramErrorCode.UNKNOWN, String(error), false);

  const code = classifyErrorMessage(error.message.toLowerCase());
  const recoverable = code === TelegramErrorCode.RATE_LIMITED || code === TelegramErrorCode.NOT_CONNECTED;
  return new TelegramError(code, error.message, recoverable);
}

/** Classify an error message into a TelegramErrorCode based on keyword matching */
function classifyErrorMessage(msg: string): TelegramErrorCodeType {
  if (msg.includes('bot was blocked') || msg.includes('forbidden')) return TelegramErrorCode.BOT_BLOCKED;
  if (msg.includes('not connected') || msg.includes('bot info missing')) return TelegramErrorCode.NOT_CONNECTED;
  if (msg.includes('429') || msg.includes('too many requests') || msg.includes('retry after'))
    return TelegramErrorCode.RATE_LIMITED;
  if (msg.includes('unauthorized') || msg.includes('token')) return TelegramErrorCode.AUTH_FAILED;
  if (msg.includes('webhook')) return TelegramErrorCode.WEBHOOK_FAILED;
  return TelegramErrorCode.UNKNOWN;
}

/**
 * Check if an error is retryable
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof TelegramError) {
    return error.recoverable;
  }

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('429') || msg.includes('too many requests')) return true;
    if (msg.includes('500') || msg.includes('502') || msg.includes('503')) return true;
    if (msg.includes('timeout') || msg.includes('econnreset')) return true;
  }

  return false;
}
