/**
 * Microsoft Teams (Bot Framework) error mapping.
 *
 * `MsTeamsApiError` extends `ChannelError` from `@omni/core` (SDK compliance:
 * every channel error participates in the core hierarchy), mirroring the
 * `AscApiError`/`HermesApiError` surface:
 *   - `.code` carries the wire code (`MSTEAMS_*`).
 *   - `.channelCode` duplicates it (SDK compliance property).
 *   - `.retryable` derives from the code — Connector/service 5xx only;
 *     credential and validation failures are NOT retryable.
 */

import { ChannelError, type ErrorCode as CoreErrorCode, ERROR_CODES } from '@omni/core';

/** Keys of the Teams error taxonomy. */
type MsTeamsErrorCodeName =
  | 'AUTH_FAILED'
  | 'INVALID_CONFIG'
  | 'NOT_CONNECTED'
  | 'NO_CONVERSATION_REFERENCE'
  | 'SEND_FAILED'
  | 'UNKNOWN';

/**
 * Teams wire codes. Values are channel-specific (`MSTEAMS_*`) and intentionally
 * NOT part of the core `ErrorCode` union — members are typed `string` so
 * comparisons against the inherited `code: ErrorCode` property stay valid
 * for TypeScript while runtime values are preserved.
 */
export const MsTeamsErrorCode: Record<MsTeamsErrorCodeName, string> = {
  /** Azure Bot credentials rejected (token acquisition or inbound JWT validation). */
  AUTH_FAILED: 'MSTEAMS_AUTH_FAILED',
  /** Credential bag failed the Zod boundary (missing/blank appId or appPassword). */
  INVALID_CONFIG: 'MSTEAMS_INVALID_CONFIG',
  /** Local guard — the instance is not connected (no Bot Framework call made). */
  NOT_CONNECTED: 'MSTEAMS_NOT_CONNECTED',
  /**
   * No stored ConversationReference for the target conversation. Bot Framework
   * bots can only continue conversations they have seen — the reference is
   * captured from inbound activities, so the user must message the bot first.
   */
  NO_CONVERSATION_REFERENCE: 'MSTEAMS_NO_CONVERSATION_REFERENCE',
  /** Connector service rejected the outbound activity — retryable. */
  SEND_FAILED: 'MSTEAMS_SEND_FAILED',
  /** Anything we couldn't classify. */
  UNKNOWN: 'MSTEAMS_UNKNOWN',
} as const;

export type MsTeamsErrorCodeType = (typeof MsTeamsErrorCode)[MsTeamsErrorCodeName];

const RETRYABLE_CODES = new Set<MsTeamsErrorCodeType>([MsTeamsErrorCode.SEND_FAILED]);

/** Teams code → core ErrorCode handed to the ChannelError constructor. */
const CORE_CODE_MAP: Record<string, CoreErrorCode> = {
  [MsTeamsErrorCode.AUTH_FAILED]: ERROR_CODES.CHANNEL_AUTH_FAILED,
  [MsTeamsErrorCode.INVALID_CONFIG]: ERROR_CODES.VALIDATION,
  [MsTeamsErrorCode.NOT_CONNECTED]: ERROR_CODES.CHANNEL_NOT_CONNECTED,
  [MsTeamsErrorCode.NO_CONVERSATION_REFERENCE]: ERROR_CODES.VALIDATION,
  [MsTeamsErrorCode.SEND_FAILED]: ERROR_CODES.CHANNEL_SEND_FAILED,
  [MsTeamsErrorCode.UNKNOWN]: ERROR_CODES.UNKNOWN,
};

export interface MsTeamsApiErrorContext {
  operation?: string;
  raw?: string;
}

/** Microsoft Teams channel error — extends core ChannelError. */
export class MsTeamsApiError extends ChannelError {
  readonly channelCode: string;
  readonly operation?: string;

  constructor(code: MsTeamsErrorCodeType, message: string, context: MsTeamsApiErrorContext = {}) {
    const coreCode = CORE_CODE_MAP[code] ?? ERROR_CODES.UNKNOWN;
    super(coreCode, message, 'msteams', undefined, {
      recoverable: RETRYABLE_CODES.has(code),
      context: { ...context, channelCode: code },
    });
    this.name = 'MsTeamsApiError';
    this.channelCode = code;
    this.operation = context.operation;
  }

  /** True when the error is eligible for retry with backoff. */
  get retryable(): boolean {
    return this.recoverable;
  }
}
