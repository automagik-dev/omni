/**
 * Error handling utilities for Twilio WhatsApp.
 */

import { ChannelError, type ErrorCode as CoreErrorCode, ERROR_CODES } from '@omni/core';

export const TwilioWhatsAppErrorCode = {
  NOT_CONNECTED: 'TWILIO_WHATSAPP_NOT_CONNECTED',
  SEND_FAILED: 'TWILIO_WHATSAPP_SEND_FAILED',
  AUTH_FAILED: 'TWILIO_WHATSAPP_AUTH_FAILED',
  RATE_LIMITED: 'TWILIO_WHATSAPP_RATE_LIMITED',
  BAD_REQUEST: 'TWILIO_WHATSAPP_BAD_REQUEST',
  NOT_FOUND: 'TWILIO_WHATSAPP_NOT_FOUND',
  WEBHOOK_FAILED: 'TWILIO_WHATSAPP_WEBHOOK_FAILED',
  UNKNOWN: 'TWILIO_WHATSAPP_UNKNOWN_ERROR',
} as const;

export type TwilioWhatsAppErrorCodeType = (typeof TwilioWhatsAppErrorCode)[keyof typeof TwilioWhatsAppErrorCode];

const CORE_CODE_MAP: Record<TwilioWhatsAppErrorCodeType, CoreErrorCode> = {
  [TwilioWhatsAppErrorCode.NOT_CONNECTED]: ERROR_CODES.CHANNEL_NOT_CONNECTED,
  [TwilioWhatsAppErrorCode.SEND_FAILED]: ERROR_CODES.CHANNEL_SEND_FAILED,
  [TwilioWhatsAppErrorCode.AUTH_FAILED]: ERROR_CODES.CHANNEL_AUTH_FAILED,
  [TwilioWhatsAppErrorCode.RATE_LIMITED]: ERROR_CODES.CHANNEL_RATE_LIMITED,
  [TwilioWhatsAppErrorCode.BAD_REQUEST]: ERROR_CODES.VALIDATION,
  [TwilioWhatsAppErrorCode.NOT_FOUND]: ERROR_CODES.NOT_FOUND,
  [TwilioWhatsAppErrorCode.WEBHOOK_FAILED]: ERROR_CODES.CHANNEL_CONNECTION_FAILED,
  [TwilioWhatsAppErrorCode.UNKNOWN]: ERROR_CODES.UNKNOWN,
};

export class TwilioWhatsAppError extends ChannelError {
  readonly channelCode: TwilioWhatsAppErrorCodeType;

  constructor(
    code: TwilioWhatsAppErrorCodeType,
    message: string,
    recoverable = false,
    context?: Record<string, unknown>,
  ) {
    const coreCode = CORE_CODE_MAP[code] ?? ERROR_CODES.UNKNOWN;
    super(coreCode, message, 'twilio-whatsapp', undefined, {
      recoverable,
      context: { ...context, channelCode: code },
    });
    this.name = 'TwilioWhatsAppError';
    this.channelCode = code;
  }
}

export function mapTwilioWhatsAppError(error: unknown, httpStatus?: number): TwilioWhatsAppError {
  if (error instanceof TwilioWhatsAppError) return error;
  const message = error instanceof Error ? error.message : String(error);

  if (httpStatus !== undefined) {
    if (httpStatus === 429) return new TwilioWhatsAppError(TwilioWhatsAppErrorCode.RATE_LIMITED, message, true);
    if (httpStatus === 401 || httpStatus === 403) {
      return new TwilioWhatsAppError(TwilioWhatsAppErrorCode.AUTH_FAILED, message, false);
    }
    if (httpStatus === 400) return new TwilioWhatsAppError(TwilioWhatsAppErrorCode.BAD_REQUEST, message, false);
    if (httpStatus === 404) return new TwilioWhatsAppError(TwilioWhatsAppErrorCode.NOT_FOUND, message, false);
    if (httpStatus >= 500 && httpStatus <= 599) {
      return new TwilioWhatsAppError(TwilioWhatsAppErrorCode.SEND_FAILED, message, true);
    }
  }

  const lower = message.toLowerCase();
  if (lower.includes('timeout') || lower.includes('econnreset') || lower.includes('etimedout')) {
    return new TwilioWhatsAppError(TwilioWhatsAppErrorCode.SEND_FAILED, message, true);
  }
  return new TwilioWhatsAppError(TwilioWhatsAppErrorCode.UNKNOWN, message, false);
}

export function isRetryable(error: unknown): boolean {
  if (error instanceof TwilioWhatsAppError) return error.recoverable;
  if (error instanceof Error) {
    const lower = error.message.toLowerCase();
    return (
      lower.includes('429') ||
      lower.includes('rate limit') ||
      lower.includes('500') ||
      lower.includes('502') ||
      lower.includes('503') ||
      lower.includes('timeout') ||
      lower.includes('econnreset') ||
      lower.includes('etimedout')
    );
  }
  return false;
}
