/**
 * Error handling utilities for Discord plugin
 *
 * Maps Discord.js errors to Omni error format.
 * DiscordError extends core ChannelError for standardized error handling.
 */

import { ChannelError, type ErrorCode as CoreErrorCode, ERROR_CODES } from '@omni/core';
import { DiscordAPIError, HTTPError, RateLimitError } from 'discord.js';

/**
 * Error codes for Discord plugin errors
 */
export const ErrorCode = {
  NOT_CONNECTED: 'DISCORD_NOT_CONNECTED',
  NOT_FOUND: 'DISCORD_NOT_FOUND',
  SEND_FAILED: 'DISCORD_SEND_FAILED',
  AUTH_FAILED: 'DISCORD_AUTH_FAILED',
  RATE_LIMITED: 'DISCORD_RATE_LIMITED',
  MISSING_ACCESS: 'DISCORD_MISSING_ACCESS',
  MISSING_PERMISSIONS: 'DISCORD_MISSING_PERMISSIONS',
  UNKNOWN_MESSAGE: 'DISCORD_UNKNOWN_MESSAGE',
  UNKNOWN_CHANNEL: 'DISCORD_UNKNOWN_CHANNEL',
  UNKNOWN_GUILD: 'DISCORD_UNKNOWN_GUILD',
  INVALID_TOKEN: 'DISCORD_INVALID_TOKEN',
  UNKNOWN: 'DISCORD_UNKNOWN_ERROR',
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Map Discord-specific error codes to core ErrorCode
 */
const CORE_CODE_MAP: Record<ErrorCodeType, CoreErrorCode> = {
  [ErrorCode.NOT_CONNECTED]: ERROR_CODES.CHANNEL_NOT_CONNECTED,
  [ErrorCode.NOT_FOUND]: ERROR_CODES.NOT_FOUND,
  [ErrorCode.SEND_FAILED]: ERROR_CODES.CHANNEL_SEND_FAILED,
  [ErrorCode.AUTH_FAILED]: ERROR_CODES.CHANNEL_AUTH_FAILED,
  [ErrorCode.RATE_LIMITED]: ERROR_CODES.CHANNEL_RATE_LIMITED,
  [ErrorCode.MISSING_ACCESS]: ERROR_CODES.FORBIDDEN,
  [ErrorCode.MISSING_PERMISSIONS]: ERROR_CODES.FORBIDDEN,
  [ErrorCode.UNKNOWN_MESSAGE]: ERROR_CODES.NOT_FOUND,
  [ErrorCode.UNKNOWN_CHANNEL]: ERROR_CODES.NOT_FOUND,
  [ErrorCode.UNKNOWN_GUILD]: ERROR_CODES.NOT_FOUND,
  [ErrorCode.INVALID_TOKEN]: ERROR_CODES.CHANNEL_AUTH_FAILED,
  [ErrorCode.UNKNOWN]: ERROR_CODES.UNKNOWN,
};

/**
 * Discord plugin error — extends core ChannelError
 */
export class DiscordError extends ChannelError {
  readonly channelCode: ErrorCodeType;

  constructor(code: ErrorCodeType, message: string, recoverable = false, context?: Record<string, unknown>) {
    const coreCode = CORE_CODE_MAP[code] ?? ERROR_CODES.UNKNOWN;
    super(coreCode, message, 'discord', undefined, { recoverable, context: { ...context, channelCode: code } });
    this.name = 'DiscordError';
    this.channelCode = code;
  }
}

/**
 * Discord API error code to Omni error mapping
 */
const apiErrorCodes: Record<number, { code: ErrorCodeType; recoverable: boolean }> = {
  // Authentication/Permission errors
  50001: { code: ErrorCode.MISSING_ACCESS, recoverable: false },
  50013: { code: ErrorCode.MISSING_PERMISSIONS, recoverable: false },
  50014: { code: ErrorCode.INVALID_TOKEN, recoverable: false },

  // Resource not found
  10003: { code: ErrorCode.UNKNOWN_CHANNEL, recoverable: false },
  10004: { code: ErrorCode.UNKNOWN_GUILD, recoverable: false },
  10008: { code: ErrorCode.UNKNOWN_MESSAGE, recoverable: false },

  // Rate limiting (429 status)
  // Note: Discord.js handles 429 via RateLimitError, but some may come through
  50027: { code: ErrorCode.RATE_LIMITED, recoverable: true },
};

/**
 * Handle DiscordAPIError from discord.js
 */
function handleDiscordAPIError(error: DiscordAPIError): DiscordError {
  // Check for mapped error codes first
  const mapping = apiErrorCodes[error.code as number];
  if (mapping) {
    return new DiscordError(mapping.code, error.message, mapping.recoverable, {
      discordCode: error.code,
      method: error.method,
      url: error.url,
    });
  }

  // Token errors (40001, 40002)
  if (error.code === 40001 || error.code === 40002) {
    return new DiscordError(ErrorCode.INVALID_TOKEN, error.message, false, {
      discordCode: error.code,
    });
  }

  // Map by HTTP status
  return handleDiscordAPIErrorByStatus(error);
}

/**
 * Map DiscordAPIError by HTTP status code
 */
function handleDiscordAPIErrorByStatus(error: DiscordAPIError): DiscordError {
  const context = { discordCode: error.code, status: error.status };

  if (error.status === 401) {
    return new DiscordError(ErrorCode.AUTH_FAILED, error.message, false, context);
  }

  if (error.status === 403) {
    return new DiscordError(ErrorCode.MISSING_PERMISSIONS, error.message, false, context);
  }

  if (error.status >= 500) {
    return new DiscordError(ErrorCode.UNKNOWN, error.message, true, context);
  }

  return new DiscordError(ErrorCode.UNKNOWN, error.message, false, context);
}

/**
 * Handle generic Error by message pattern matching
 */
function handleGenericError(error: Error): DiscordError {
  const message = error.message.toLowerCase();

  if (message.includes('token') || message.includes('unauthorized')) {
    return new DiscordError(ErrorCode.INVALID_TOKEN, error.message, false);
  }

  if (message.includes('not connected') || message.includes('disconnected')) {
    return new DiscordError(ErrorCode.NOT_CONNECTED, error.message, true);
  }

  if (message.includes('permission') || message.includes('access')) {
    return new DiscordError(ErrorCode.MISSING_PERMISSIONS, error.message, false);
  }

  return new DiscordError(ErrorCode.UNKNOWN, error.message, false);
}

/**
 * Map Discord.js error to Omni error
 */
export function mapDiscordError(error: unknown): DiscordError {
  if (error instanceof DiscordError) {
    return error;
  }

  if (error instanceof DiscordAPIError) {
    return handleDiscordAPIError(error);
  }

  if (error instanceof RateLimitError) {
    return new DiscordError(ErrorCode.RATE_LIMITED, error.message, true, {
      timeToReset: error.timeToReset,
      global: error.global,
    });
  }

  if (error instanceof HTTPError) {
    const recoverable = error.status >= 500 || error.status === 429;
    return new DiscordError(ErrorCode.UNKNOWN, error.message, recoverable, {
      status: error.status,
      method: error.method,
    });
  }

  if (error instanceof Error) {
    return handleGenericError(error);
  }

  return new DiscordError(ErrorCode.UNKNOWN, String(error), false);
}

/**
 * Check if an error is retryable
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof DiscordError) {
    return error.recoverable;
  }

  if (error instanceof RateLimitError) {
    return true;
  }

  if (error instanceof DiscordAPIError) {
    return error.status >= 500 || error.status === 429;
  }

  return false;
}
