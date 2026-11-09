import { ChannelError, type ErrorCode as CoreErrorCode, ERROR_CODES } from '@omni/core';

type ZenviaErrorCodeName =
  | 'AUTH_FAILED'
  | 'INVALID_REQUEST'
  | 'RATE_LIMITED'
  | 'REFUSED'
  | 'NOT_CONNECTED'
  | 'UPSTREAM_ERROR'
  | 'UNKNOWN';

export const ZenviaErrorCode: Record<ZenviaErrorCodeName, string> = {
  AUTH_FAILED: 'ZENVIA_AUTH_FAILED',
  INVALID_REQUEST: 'ZENVIA_INVALID_REQUEST',
  RATE_LIMITED: 'ZENVIA_RATE_LIMITED',
  REFUSED: 'ZENVIA_REFUSED',
  NOT_CONNECTED: 'ZENVIA_NOT_CONNECTED',
  UPSTREAM_ERROR: 'ZENVIA_UPSTREAM_ERROR',
  UNKNOWN: 'ZENVIA_UNKNOWN',
} as const;

export type ZenviaErrorCodeType = (typeof ZenviaErrorCode)[ZenviaErrorCodeName];

const RETRYABLE_CODES = new Set<ZenviaErrorCodeType>([ZenviaErrorCode.RATE_LIMITED, ZenviaErrorCode.UPSTREAM_ERROR]);

const CORE_CODE_MAP: Record<string, CoreErrorCode> = {
  [ZenviaErrorCode.AUTH_FAILED]: ERROR_CODES.CHANNEL_AUTH_FAILED,
  [ZenviaErrorCode.INVALID_REQUEST]: ERROR_CODES.VALIDATION,
  [ZenviaErrorCode.RATE_LIMITED]: ERROR_CODES.CHANNEL_RATE_LIMITED,
  [ZenviaErrorCode.REFUSED]: ERROR_CODES.CHANNEL_SEND_REJECTED,
  [ZenviaErrorCode.NOT_CONNECTED]: ERROR_CODES.CHANNEL_NOT_CONNECTED,
  [ZenviaErrorCode.UPSTREAM_ERROR]: ERROR_CODES.CHANNEL_SEND_FAILED,
  [ZenviaErrorCode.UNKNOWN]: ERROR_CODES.UNKNOWN,
};

export interface ZenviaApiErrorContext {
  httpStatus?: number;
  operation?: string;
  vendorCode?: string;
  raw?: string;
}

export class ZenviaApiError extends ChannelError {
  readonly channelCode: string;
  readonly httpStatus?: number;
  readonly operation?: string;
  readonly vendorCode?: string;

  constructor(code: ZenviaErrorCodeType, message: string, context: ZenviaApiErrorContext = {}) {
    const coreCode = CORE_CODE_MAP[code] ?? ERROR_CODES.UNKNOWN;
    super(coreCode, message, 'zenvia', undefined, {
      recoverable: RETRYABLE_CODES.has(code),
      context: { ...context, channelCode: code },
    });
    this.name = 'ZenviaApiError';
    this.channelCode = code;
    this.httpStatus = context.httpStatus;
    this.operation = context.operation;
    this.vendorCode = context.vendorCode;
  }

  get retryable(): boolean {
    return this.recoverable;
  }
}

export function mapHttpStatusToZenviaError(status: number): ZenviaErrorCodeType {
  if (status === 401 || status === 403) return ZenviaErrorCode.AUTH_FAILED;
  if (status === 429) return ZenviaErrorCode.RATE_LIMITED;
  if (status >= 400 && status < 500) return ZenviaErrorCode.INVALID_REQUEST;
  if (status >= 500) return ZenviaErrorCode.UPSTREAM_ERROR;
  return ZenviaErrorCode.UNKNOWN;
}

export function isRetryable(error: unknown): boolean {
  return error instanceof ZenviaApiError && error.retryable;
}

export function isDefinitiveRefusal(error: unknown): boolean {
  return (
    error instanceof ZenviaApiError &&
    (error.channelCode === ZenviaErrorCode.INVALID_REQUEST || error.channelCode === ZenviaErrorCode.REFUSED)
  );
}
