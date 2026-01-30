/**
 * Error handling utilities for WhatsApp plugin
 */

import { Boom } from '@hapi/boom';

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
 * WhatsApp plugin error
 */
export class WhatsAppError extends Error {
  readonly code: ErrorCodeType;
  readonly retryable: boolean;
  readonly context?: Record<string, unknown>;

  constructor(code: ErrorCodeType, message: string, retryable = false, context?: Record<string, unknown>) {
    super(message);
    this.name = 'WhatsAppError';
    this.code = code;
    this.retryable = retryable;
    this.context = context;
  }
}

/**
 * HTTP status code to error mapping
 */
const statusCodeErrors: Record<number, { code: ErrorCodeType; retryable: boolean }> = {
  429: { code: ErrorCode.RATE_LIMITED, retryable: true },
  401: { code: ErrorCode.AUTH_FAILED, retryable: false },
  403: { code: ErrorCode.AUTH_FAILED, retryable: false },
};

/**
 * Error message patterns to error mapping
 */
const messagePatterns: Array<{ patterns: string[]; code: ErrorCodeType; retryable: boolean }> = [
  { patterns: ['rate', 'limit'], code: ErrorCode.RATE_LIMITED, retryable: true },
  { patterns: ['not connected', 'disconnected'], code: ErrorCode.NOT_CONNECTED, retryable: true },
  { patterns: ['auth', 'login'], code: ErrorCode.AUTH_FAILED, retryable: false },
];

/**
 * Map Boom error to WhatsApp error using lookup table
 */
function mapBoomError(error: Boom): WhatsAppError {
  const statusCode = error.output?.statusCode;
  const message = error.output?.payload?.message || error.message;

  if (statusCode !== undefined && statusCodeErrors[statusCode]) {
    const { code, retryable } = statusCodeErrors[statusCode];
    return new WhatsAppError(code, message, retryable);
  }

  return new WhatsAppError(ErrorCode.UNKNOWN, message, statusCode !== undefined && statusCode >= 500);
}

/**
 * Map Error to WhatsApp error using pattern matching
 */
function mapGenericError(error: Error): WhatsAppError {
  const message = error.message.toLowerCase();

  for (const { patterns, code, retryable } of messagePatterns) {
    if (patterns.some((pattern) => message.includes(pattern))) {
      return new WhatsAppError(code, error.message, retryable);
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
    return error.retryable;
  }

  if (error instanceof Boom) {
    const statusCode = error.output?.statusCode;
    return statusCode !== undefined && (statusCode >= 500 || statusCode === 429);
  }

  return false;
}
