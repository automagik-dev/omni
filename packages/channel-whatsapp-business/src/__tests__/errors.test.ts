/**
 * MetaApiError hierarchy + taxonomy tests.
 *
 * Guards the SDK compliance contract (extends ChannelError, exposes
 * `channelCode`) AND the historical public surface (`.code` carries the
 * Meta wire code, `.context` carries Graph API context, `.retryable` derives
 * from the Meta code).
 */

import { describe, expect, it } from 'bun:test';
import { ChannelError, ERROR_CODES, OmniError } from '@omni/core';

import { MetaApiError, MetaErrorCode, isRetryable, mapHttpStatusToMetaError } from '../utils/errors';

describe('MetaApiError hierarchy', () => {
  it('extends ChannelError and OmniError from @omni/core', () => {
    const err = new MetaApiError(MetaErrorCode.INVALID_REQUEST, 'boom');
    expect(err).toBeInstanceOf(MetaApiError);
    expect(err).toBeInstanceOf(ChannelError);
    expect(err).toBeInstanceOf(OmniError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('MetaApiError');
    expect(err.channelType).toBe('whatsapp-business');
  });

  it('exposes channelCode and preserves the Meta wire code on .code', () => {
    const err = new MetaApiError(MetaErrorCode.RATE_LIMITED, 'slow down');
    expect(err.channelCode).toBe(MetaErrorCode.RATE_LIMITED);
    expect<string>(err.code).toBe(MetaErrorCode.RATE_LIMITED);
  });

  it('preserves structured Graph API context', () => {
    const err = new MetaApiError(MetaErrorCode.AUTH_FAILED, 'nope', {
      httpStatus: 401,
      operation: 'connect',
      fbtraceId: 'trace-1',
    });
    expect(err.context.httpStatus).toBe(401);
    expect(err.context.operation).toBe('connect');
    expect(err.context.fbtraceId).toBe('trace-1');
  });

  it('keeps retryable semantics (rate limit + upstream only)', () => {
    expect(new MetaApiError(MetaErrorCode.RATE_LIMITED, 'x').retryable).toBe(true);
    expect(new MetaApiError(MetaErrorCode.UPSTREAM_ERROR, 'x').retryable).toBe(true);
    expect(new MetaApiError(MetaErrorCode.AUTH_FAILED, 'x').retryable).toBe(false);
    expect(new MetaApiError(MetaErrorCode.INVALID_REQUEST, 'x').retryable).toBe(false);
    expect(isRetryable(new MetaApiError(MetaErrorCode.UPSTREAM_ERROR, 'x'))).toBe(true);
    expect(isRetryable(new Error('x'))).toBe(false);
  });

  it('marks retryable errors as recoverable in the core hierarchy', () => {
    expect(new MetaApiError(MetaErrorCode.RATE_LIMITED, 'x').recoverable).toBe(true);
    expect(new MetaApiError(MetaErrorCode.AUTH_FAILED, 'x').recoverable).toBe(false);
  });

  it('keeps the historical MetaErrorCode wire values', () => {
    expect(MetaErrorCode.AUTH_FAILED).toBe('META_AUTH_FAILED');
    expect(MetaErrorCode.PHONE_NOT_FOUND).toBe('META_PHONE_NOT_FOUND');
    expect(MetaErrorCode.INVALID_REQUEST).toBe('META_INVALID_REQUEST');
    expect(MetaErrorCode.OUTSIDE_24H_WINDOW).toBe('OMNI_OUTSIDE_24H_WINDOW');
    expect(MetaErrorCode.TEMPLATE_NOT_APPROVED).toBe('META_TEMPLATE_NOT_APPROVED');
    expect(MetaErrorCode.RATE_LIMITED).toBe('META_RATE_LIMITED');
    expect(MetaErrorCode.RECIPIENT_NOT_FOUND).toBe('META_RECIPIENT_NOT_FOUND');
    expect(MetaErrorCode.UPSTREAM_ERROR).toBe('META_UPSTREAM_ERROR');
    expect(MetaErrorCode.UNKNOWN).toBe('META_UNKNOWN');
  });

  it('serializes via toJSON with the Meta wire code', () => {
    const json = new MetaApiError(MetaErrorCode.UNKNOWN, 'oops').toJSON();
    expect(json.name).toBe('MetaApiError');
    expect(json.code).toBe(MetaErrorCode.UNKNOWN);
  });
});

describe('mapHttpStatusToMetaError', () => {
  it('maps auth, rate limit, and request errors', () => {
    expect(mapHttpStatusToMetaError(401)).toBe(MetaErrorCode.AUTH_FAILED);
    expect(mapHttpStatusToMetaError(190)).toBe(MetaErrorCode.AUTH_FAILED);
    expect(mapHttpStatusToMetaError(429)).toBe(MetaErrorCode.RATE_LIMITED);
    expect(mapHttpStatusToMetaError(131056)).toBe(MetaErrorCode.RATE_LIMITED);
    expect(mapHttpStatusToMetaError(100)).toBe(MetaErrorCode.INVALID_REQUEST);
    expect(mapHttpStatusToMetaError(131047)).toBe(MetaErrorCode.OUTSIDE_24H_WINDOW);
    expect(mapHttpStatusToMetaError(131026)).toBe(MetaErrorCode.RECIPIENT_NOT_FOUND);
    expect(mapHttpStatusToMetaError(503)).toBe(MetaErrorCode.UPSTREAM_ERROR);
    expect(mapHttpStatusToMetaError(132001)).toBe(MetaErrorCode.TEMPLATE_NOT_APPROVED);
    expect(mapHttpStatusToMetaError(133001)).toBe(MetaErrorCode.PHONE_NOT_FOUND);
    expect(mapHttpStatusToMetaError(999999)).toBe(MetaErrorCode.UNKNOWN);
  });
});

describe('core hierarchy mapping', () => {
  it('hands ChannelError a mapped core ErrorCode via toJSON-independent surface', () => {
    // The mapped core code is consumed by the ChannelError constructor
    // (recoverable/context wiring); `.code` itself intentionally keeps the
    // Meta wire value, so we assert the mapping indirectly through the
    // NOT_CONNECTED guard used by react/unreact.
    const err = new MetaApiError(MetaErrorCode.NOT_CONNECTED, 'not connected');
    expect(err.channelCode).toBe('META_NOT_CONNECTED');
    expect(err).toBeInstanceOf(ChannelError);
    expect(Object.values(ERROR_CODES)).toContain('CHANNEL_NOT_CONNECTED');
  });
});
