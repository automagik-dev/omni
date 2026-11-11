import { describe, expect, it } from 'bun:test';

import { ZenviaErrorCode, type ZenviaErrorCodeType, mapHttpStatusToZenviaError } from '../utils/errors';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type ExpectedCodes =
  | 'ZENVIA_AUTH_FAILED'
  | 'ZENVIA_INVALID_REQUEST'
  | 'ZENVIA_RATE_LIMITED'
  | 'ZENVIA_REFUSED'
  | 'ZENVIA_NOT_CONNECTED'
  | 'ZENVIA_UPSTREAM_ERROR'
  | 'ZENVIA_UNKNOWN';

const codesAreLiterals: Equal<ZenviaErrorCodeType, ExpectedCodes> = true;

describe('Zenvia error codes', () => {
  it('keeps every code as its literal type instead of widening to string', () => {
    expect(codesAreLiterals).toBe(true);
  });

  it('maps an HTTP status to a code of that union', () => {
    const code: ZenviaErrorCodeType = mapHttpStatusToZenviaError(429);
    expect(code).toBe(ZenviaErrorCode.RATE_LIMITED);
  });
});
