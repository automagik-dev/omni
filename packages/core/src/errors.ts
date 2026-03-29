/**
 * Typed error classes for Omni v2
 */

/**
 * Error codes for categorization
 */
export const ERROR_CODES = {
  // General
  UNKNOWN: 'UNKNOWN',
  VALIDATION: 'VALIDATION',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',

  // Channel errors
  CHANNEL_NOT_CONNECTED: 'CHANNEL_NOT_CONNECTED',
  CHANNEL_CONNECTION_FAILED: 'CHANNEL_CONNECTION_FAILED',
  CHANNEL_SEND_FAILED: 'CHANNEL_SEND_FAILED',
  CHANNEL_TIMEOUT: 'CHANNEL_TIMEOUT',
  CHANNEL_RATE_LIMITED: 'CHANNEL_RATE_LIMITED',
  CHANNEL_AUTH_FAILED: 'CHANNEL_AUTH_FAILED',

  // Agent errors
  AGENT_UNAVAILABLE: 'AGENT_UNAVAILABLE',
  AGENT_TIMEOUT: 'AGENT_TIMEOUT',
  AGENT_ERROR: 'AGENT_ERROR',

  // Database errors
  DB_CONNECTION_FAILED: 'DB_CONNECTION_FAILED',
  DB_QUERY_FAILED: 'DB_QUERY_FAILED',

  // Event errors
  EVENT_PUBLISH_FAILED: 'EVENT_PUBLISH_FAILED',
  EVENT_SUBSCRIBE_FAILED: 'EVENT_SUBSCRIBE_FAILED',

  // Send errors
  RECIPIENT_NOT_ON_CHANNEL: 'RECIPIENT_NOT_ON_CHANNEL',
  CAPABILITY_NOT_SUPPORTED: 'CAPABILITY_NOT_SUPPORTED',

  // Discord channel errors
  DISCORD_NOT_CONNECTED: 'DISCORD_NOT_CONNECTED',
  DISCORD_NOT_FOUND: 'DISCORD_NOT_FOUND',
  DISCORD_SEND_FAILED: 'DISCORD_SEND_FAILED',
  DISCORD_AUTH_FAILED: 'DISCORD_AUTH_FAILED',
  DISCORD_RATE_LIMITED: 'DISCORD_RATE_LIMITED',
  DISCORD_MISSING_ACCESS: 'DISCORD_MISSING_ACCESS',
  DISCORD_MISSING_PERMISSIONS: 'DISCORD_MISSING_PERMISSIONS',
  DISCORD_UNKNOWN_MESSAGE: 'DISCORD_UNKNOWN_MESSAGE',
  DISCORD_UNKNOWN_CHANNEL: 'DISCORD_UNKNOWN_CHANNEL',
  DISCORD_UNKNOWN_GUILD: 'DISCORD_UNKNOWN_GUILD',
  DISCORD_INVALID_TOKEN: 'DISCORD_INVALID_TOKEN',
  DISCORD_UNKNOWN_ERROR: 'DISCORD_UNKNOWN_ERROR',

  // WhatsApp channel errors
  WHATSAPP_NOT_CONNECTED: 'WHATSAPP_NOT_CONNECTED',
  WHATSAPP_SEND_FAILED: 'WHATSAPP_SEND_FAILED',
  WHATSAPP_AUTH_FAILED: 'WHATSAPP_AUTH_FAILED',
  WHATSAPP_RATE_LIMITED: 'WHATSAPP_RATE_LIMITED',
  WHATSAPP_INVALID_JID: 'WHATSAPP_INVALID_JID',
  WHATSAPP_INVALID_PHONE: 'WHATSAPP_INVALID_PHONE',
  WHATSAPP_PAIRING_FAILED: 'WHATSAPP_PAIRING_FAILED',
  WHATSAPP_MEDIA_UPLOAD_FAILED: 'WHATSAPP_MEDIA_UPLOAD_FAILED',
  WHATSAPP_UNKNOWN_ERROR: 'WHATSAPP_UNKNOWN_ERROR',

  // Slack channel errors
  SLACK_NOT_CONNECTED: 'SLACK_NOT_CONNECTED',
  SLACK_INVALID_TOKEN: 'SLACK_INVALID_TOKEN',
  SLACK_SEND_FAILED: 'SLACK_SEND_FAILED',
  SLACK_RATE_LIMITED: 'SLACK_RATE_LIMITED',
  SLACK_FILE_UPLOAD_FAILED: 'SLACK_FILE_UPLOAD_FAILED',
  SLACK_FILE_DOWNLOAD_FAILED: 'SLACK_FILE_DOWNLOAD_FAILED',
  SLACK_INTERACTION_FAILED: 'SLACK_INTERACTION_FAILED',
  SLACK_COMMAND_FAILED: 'SLACK_COMMAND_FAILED',
  SLACK_DM_REJECTED: 'SLACK_DM_REJECTED',
  SLACK_CONNECTION_FAILED: 'SLACK_CONNECTION_FAILED',

  // Telegram channel errors
  TELEGRAM_NOT_CONNECTED: 'TELEGRAM_NOT_CONNECTED',
  TELEGRAM_SEND_FAILED: 'TELEGRAM_SEND_FAILED',
  TELEGRAM_AUTH_FAILED: 'TELEGRAM_AUTH_FAILED',
  TELEGRAM_RATE_LIMITED: 'TELEGRAM_RATE_LIMITED',
  TELEGRAM_BOT_BLOCKED: 'TELEGRAM_BOT_BLOCKED',
  TELEGRAM_BOT_MISSING: 'TELEGRAM_BOT_MISSING',
  TELEGRAM_WEBHOOK_FAILED: 'TELEGRAM_WEBHOOK_FAILED',
  TELEGRAM_UNKNOWN_ERROR: 'TELEGRAM_UNKNOWN_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * Base error options
 */
export interface OmniErrorOptions {
  code: ErrorCode;
  message: string;
  cause?: Error;
  context?: Record<string, unknown>;
  recoverable?: boolean;
}

/**
 * Base Omni error class
 */
export class OmniError extends Error {
  readonly code: ErrorCode;
  readonly context?: Record<string, unknown>;
  readonly recoverable: boolean;
  readonly timestamp: number;

  constructor(options: OmniErrorOptions) {
    super(options.message);
    this.name = 'OmniError';
    this.code = options.code;
    this.context = options.context;
    this.recoverable = options.recoverable ?? false;
    this.timestamp = Date.now();

    if (options.cause) {
      this.cause = options.cause;
    }

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, OmniError);
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      recoverable: this.recoverable,
      timestamp: this.timestamp,
      stack: this.stack,
    };
  }
}

/**
 * Validation error (400)
 */
export class ValidationError extends OmniError {
  readonly fields?: Record<string, string[]>;

  constructor(message: string, fields?: Record<string, string[]>, context?: Record<string, unknown>) {
    super({
      code: ERROR_CODES.VALIDATION,
      message,
      context: { ...context, fields },
      recoverable: true,
    });
    this.name = 'ValidationError';
    this.fields = fields;
  }
}

/**
 * Not found error (404)
 */
export class NotFoundError extends OmniError {
  readonly resourceType: string;
  readonly resourceId: string;

  constructor(resourceType: string, resourceId: string) {
    super({
      code: ERROR_CODES.NOT_FOUND,
      message: `${resourceType} not found: ${resourceId}`,
      context: { resourceType, resourceId },
      recoverable: false,
    });
    this.name = 'NotFoundError';
    this.resourceType = resourceType;
    this.resourceId = resourceId;
  }
}

/**
 * Conflict error (409)
 */
export class ConflictError extends OmniError {
  readonly resourceType: string;
  readonly conflictReason: string;

  constructor(resourceType: string, conflictReason: string, context?: Record<string, unknown>) {
    super({
      code: ERROR_CODES.CONFLICT,
      message: `${resourceType} conflict: ${conflictReason}`,
      context: { ...context, resourceType, conflictReason },
      recoverable: true,
    });
    this.name = 'ConflictError';
    this.resourceType = resourceType;
    this.conflictReason = conflictReason;
  }
}

/**
 * Channel error
 */
export class ChannelError extends OmniError {
  readonly channelType: string;
  readonly instanceId?: string;

  constructor(
    code: ErrorCode,
    message: string,
    channelType: string,
    instanceId?: string,
    options?: { cause?: Error; recoverable?: boolean; context?: Record<string, unknown> },
  ) {
    super({
      code,
      message,
      context: { channelType, instanceId, ...options?.context },
      cause: options?.cause,
      recoverable: options?.recoverable ?? true,
    });
    this.name = 'ChannelError';
    this.channelType = channelType;
    this.instanceId = instanceId;
  }
}

/**
 * Agent error
 */
export class AgentError extends OmniError {
  readonly providerId?: string;

  constructor(
    code: ErrorCode,
    message: string,
    providerId?: string,
    options?: { cause?: Error; recoverable?: boolean },
  ) {
    super({
      code,
      message,
      context: { providerId },
      cause: options?.cause,
      recoverable: options?.recoverable ?? true,
    });
    this.name = 'AgentError';
    this.providerId = providerId;
  }
}

/**
 * Type guard for OmniError
 */
export function isOmniError(error: unknown): error is OmniError {
  return error instanceof OmniError;
}

/**
 * Wrap unknown error as OmniError
 */
export function wrapError(error: unknown, context?: Record<string, unknown>): OmniError {
  if (isOmniError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return new OmniError({
      code: ERROR_CODES.UNKNOWN,
      message: error.message,
      cause: error,
      context,
      recoverable: false,
    });
  }

  return new OmniError({
    code: ERROR_CODES.UNKNOWN,
    message: String(error),
    context,
    recoverable: false,
  });
}
