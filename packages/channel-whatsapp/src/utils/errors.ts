/**
 * Error handling utilities for WhatsApp plugin
 *
 * Maps Baileys/Boom errors to Omni error format.
 * WhatsAppError extends core ChannelError for standardized error handling.
 */

import { Boom } from '@hapi/boom';
import { ChannelError, type ErrorCode as CoreErrorCode, ERROR_CODES } from '@omni/core';

/**
 * Error codes for WhatsApp plugin errors
 */
export const ErrorCode = {
  NOT_CONNECTED: 'WHATSAPP_NOT_CONNECTED',
  SEND_FAILED: 'WHATSAPP_SEND_FAILED',
  AUTH_FAILED: 'WHATSAPP_AUTH_FAILED',
  RATE_LIMITED: 'WHATSAPP_RATE_LIMITED',
  INVALID_JID: 'WHATSAPP_INVALID_JID',
  INVALID_PHONE: 'WHATSAPP_INVALID_PHONE',
  PAIRING_FAILED: 'WHATSAPP_PAIRING_FAILED',
  MEDIA_UPLOAD_FAILED: 'WHATSAPP_MEDIA_UPLOAD_FAILED',
  UNKNOWN: 'WHATSAPP_UNKNOWN_ERROR',
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Map WhatsApp-specific error codes to core ErrorCode
 */
const CORE_CODE_MAP: Record<ErrorCodeType, CoreErrorCode> = {
  [ErrorCode.NOT_CONNECTED]: ERROR_CODES.CHANNEL_NOT_CONNECTED,
  [ErrorCode.SEND_FAILED]: ERROR_CODES.CHANNEL_SEND_FAILED,
  [ErrorCode.AUTH_FAILED]: ERROR_CODES.CHANNEL_AUTH_FAILED,
  [ErrorCode.RATE_LIMITED]: ERROR_CODES.CHANNEL_RATE_LIMITED,
  [ErrorCode.INVALID_JID]: ERROR_CODES.VALIDATION,
  [ErrorCode.INVALID_PHONE]: ERROR_CODES.VALIDATION,
  [ErrorCode.PAIRING_FAILED]: ERROR_CODES.CHANNEL_CONNECTION_FAILED,
  [ErrorCode.MEDIA_UPLOAD_FAILED]: ERROR_CODES.CHANNEL_SEND_FAILED,
  [ErrorCode.UNKNOWN]: ERROR_CODES.UNKNOWN,
};

/**
 * WhatsApp plugin error — extends core ChannelError
 */
export class WhatsAppError extends ChannelError {
  readonly channelCode: ErrorCodeType;

  constructor(code: ErrorCodeType, message: string, recoverable = false, context?: Record<string, unknown>) {
    const coreCode = CORE_CODE_MAP[code] ?? ERROR_CODES.UNKNOWN;
    super(coreCode, message, 'whatsapp', undefined, { recoverable, context: { ...context, channelCode: code } });
    this.name = 'WhatsAppError';
    this.channelCode = code;
  }
}

/**
 * HTTP status code to error mapping
 */
const statusCodeErrors: Record<number, { code: ErrorCodeType; recoverable: boolean }> = {
  429: { code: ErrorCode.RATE_LIMITED, recoverable: true },
  401: { code: ErrorCode.AUTH_FAILED, recoverable: false },
  403: { code: ErrorCode.AUTH_FAILED, recoverable: false },
};

/**
 * Error message patterns to error mapping
 */
const messagePatterns: Array<{ patterns: string[]; code: ErrorCodeType; recoverable: boolean }> = [
  { patterns: ['rate', 'limit'], code: ErrorCode.RATE_LIMITED, recoverable: true },
  { patterns: ['not connected', 'disconnected'], code: ErrorCode.NOT_CONNECTED, recoverable: true },
  { patterns: ['auth', 'login'], code: ErrorCode.AUTH_FAILED, recoverable: false },
];

/**
 * Map Boom error to WhatsApp error using lookup table
 */
function mapBoomError(error: Boom): WhatsAppError {
  const statusCode = error.output?.statusCode;
  const message = error.output?.payload?.message || error.message;

  if (statusCode !== undefined && statusCodeErrors[statusCode]) {
    const { code, recoverable } = statusCodeErrors[statusCode];
    return new WhatsAppError(code, message, recoverable);
  }

  return new WhatsAppError(ErrorCode.UNKNOWN, message, statusCode !== undefined && statusCode >= 500);
}

/**
 * Map Error to WhatsApp error using pattern matching
 */
function mapGenericError(error: Error): WhatsAppError {
  const message = error.message.toLowerCase();

  for (const { patterns, code, recoverable } of messagePatterns) {
    if (patterns.some((pattern) => message.includes(pattern))) {
      return new WhatsAppError(code, error.message, recoverable);
    }
  }

  return new WhatsAppError(ErrorCode.UNKNOWN, error.message, false);
}

/**
 * Map Baileys/Boom errors to WhatsApp errors
 */
export function mapBaileysError(error: unknown): WhatsAppError {
  if (error instanceof WhatsAppError) {
    return error;
  }

  if (error instanceof Boom) {
    return mapBoomError(error);
  }

  if (error instanceof Error) {
    return mapGenericError(error);
  }

  return new WhatsAppError(ErrorCode.UNKNOWN, String(error), false);
}

/**
 * Check if an error is retryable
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof WhatsAppError) {
    return error.recoverable;
  }

  if (error instanceof Boom) {
    const statusCode = error.output?.statusCode;
    return statusCode !== undefined && (statusCode >= 500 || statusCode === 429);
  }

  return false;
}
