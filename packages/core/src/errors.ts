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
    options?: { cause?: Error; recoverable?: boolean },
  ) {
    super({
      code,
      message,
      context: { channelType, instanceId },
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
