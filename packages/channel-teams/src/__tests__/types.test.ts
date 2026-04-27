/**
 * Tests for the TeamsError taxonomy — verifies it satisfies the cross-channel
 * `ChannelError` contract that the SDK compliance suite relies on.
 */

import { describe, expect, it } from 'bun:test';
import { ChannelError, ERROR_CODES } from '@omni/core';

import { TeamsError, TeamsErrorCode } from '../types';

describe('TeamsError', () => {
  it('extends @omni/core ChannelError', () => {
    const err = new TeamsError(TeamsErrorCode.SEND_FAILED, 'send failed');
    expect(err).toBeInstanceOf(ChannelError);
    expect(err).toBeInstanceOf(Error);
  });

  it('exposes a stable error.name', () => {
    const err = new TeamsError(TeamsErrorCode.AUTH_FAILED, 'auth failed');
    expect(err.name).toBe('TeamsError');
  });

  it('preserves the channel-specific code under .channelCode', () => {
    const err = new TeamsError(TeamsErrorCode.RATE_LIMITED, 'too many');
    expect(err.channelCode).toBe(TeamsErrorCode.RATE_LIMITED);
  });

  it('maps each channel code to a known core ERROR_CODES value', () => {
    const samples: Array<keyof typeof TeamsErrorCode> = [
      'NOT_CONNECTED',
      'AUTH_FAILED',
      'INVALID_CREDENTIALS',
      'SEND_FAILED',
      'RATE_LIMITED',
      'ATTACHMENT_FAILED',
      'WEBHOOK_INVALID',
      'DM_REJECTED',
      'CONNECTION_FAILED',
      'UNSUPPORTED_ACTIVITY',
    ];
    const knownCoreCodes = new Set(Object.values(ERROR_CODES));
    for (const code of samples) {
      const err = new TeamsError(TeamsErrorCode[code], `${code} test`);
      expect(knownCoreCodes.has(err.code)).toBe(true);
    }
  });

  it('records "teams" as the channelType identifier', () => {
    const err = new TeamsError(TeamsErrorCode.SEND_FAILED, 'send failed');
    expect(err.channelType).toBe('teams');
  });

  it('honors the recoverable flag', () => {
    const recoverable = new TeamsError(TeamsErrorCode.RATE_LIMITED, 'try again', true);
    const fatal = new TeamsError(TeamsErrorCode.AUTH_FAILED, 'denied', false);
    expect(recoverable.recoverable).toBe(true);
    expect(fatal.recoverable).toBe(false);
  });
});
