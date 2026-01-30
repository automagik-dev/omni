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
 * Map Baileys/Boom errors to WhatsApp errors
 */
export function mapBaileysError(error: unknown): WhatsAppError {
  if (error instanceof WhatsAppError) {
    return error;
  }

  if (error instanceof Boom) {
    const statusCode = error.output?.statusCode;
    const message = error.output?.payload?.message || error.message;

    // Rate limiting
    if (statusCode === 429) {
      return new WhatsAppError(ErrorCode.RATE_LIMITED, message, true);
    }

    // Authentication errors
    if (statusCode === 401 || statusCode === 403) {
      return new WhatsAppError(ErrorCode.AUTH_FAILED, message, false);
    }

    // Other errors
    return new WhatsAppError(ErrorCode.UNKNOWN, message, statusCode !== undefined && statusCode >= 500);
  }

  if (error instanceof Error) {
    // Check for common error patterns
    const message = error.message.toLowerCase();

    if (message.includes('rate') || message.includes('limit')) {
      return new WhatsAppError(ErrorCode.RATE_LIMITED, error.message, true);
    }

    if (message.includes('not connected') || message.includes('disconnected')) {
      return new WhatsAppError(ErrorCode.NOT_CONNECTED, error.message, true);
    }

    if (message.includes('auth') || message.includes('login')) {
      return new WhatsAppError(ErrorCode.AUTH_FAILED, error.message, false);
    }

    return new WhatsAppError(ErrorCode.UNKNOWN, error.message, false);
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
