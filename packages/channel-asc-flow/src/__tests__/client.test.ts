/**
 * Token cache/refresh and the overloaded 401.
 */

import { afterEach, describe, expect, it } from 'bun:test';

import { AscFlowClient, codErrorOf, isPlatformOk } from '../client';
import { AscFlowErrorCode } from '../utils/errors';
import { BASE_URL, CHAVE, LOGIN, MockLogger, OK_BODY, jsonResponse, stubPlatform } from './helpers';

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});

const client = () => new AscFlowClient(`${BASE_URL}/rest/v2`, LOGIN, CHAVE, new MockLogger());

describe('isPlatformOk', () => {
  it('rejects an in-band failure carried on HTTP 200', () => {
    expect(isPlatformOk({ status: 200, body: OK_BODY })).toBe(true);
    expect(isPlatformOk({ status: 200, body: { cod_error: 10, msg: 'Atendimento já finalizado!' } })).toBe(false);
    expect(isPlatformOk({ status: 200, body: { sucesso: 0 } })).toBe(false);
    expect(isPlatformOk({ status: 500, body: OK_BODY })).toBe(false);
  });

  it('reads cod_error as number or string, and only when present', () => {
    expect(codErrorOf({ cod_error: 10 })).toBe(10);
    expect(codErrorOf({ cod_error: '10' })).toBe('10');
    expect(codErrorOf({ msg: 'no code' })).toBeUndefined();
    expect(codErrorOf('plain text')).toBeUndefined();
  });
});

describe('auth', () => {
  it('authenticates once and reuses the cached token', async () => {
    const stub = stubPlatform();
    restore = stub.restore;
    const c = client();

    await c.call('/sendIndicador', { cod: 1, tipo: 1 });
    await c.call('/sendIndicador', { cod: 1, tipo: 1 });

    expect(stub.calls.filter((x) => x.path === '/authuser')).toHaveLength(1);
    expect(
      stub.calls.filter((x) => x.path === '/sendIndicador').every((x) => x.authorization === 'Bearer jwt-token'),
    ).toBe(true);
  });

  it('shares one /authuser round trip across concurrent turns', async () => {
    const stub = stubPlatform();
    restore = stub.restore;
    const c = client();

    await Promise.all([c.call('/sendIndicador', { cod: 1 }), c.call('/sendIndicador', { cod: 2 })]);

    expect(stub.calls.filter((x) => x.path === '/authuser')).toHaveLength(1);
  });

  it('throws AUTH_FAILED when /authuser returns no token', async () => {
    const stub = stubPlatform({ '/authuser': () => jsonResponse({ success: false }, 401) });
    restore = stub.restore;

    expect(client().call('/sendIndicador', { cod: 1 })).rejects.toMatchObject({
      channelCode: AscFlowErrorCode.AUTH_FAILED,
    });
  });
});

describe('the overloaded 401', () => {
  it('re-authenticates and retries ONCE on a 401 with no cod_error', async () => {
    let attempts = 0;
    const stub = stubPlatform({
      '/callbackFlowMsg': () => {
        attempts += 1;
        return attempts === 1 ? jsonResponse({ msg: 'expired' }, 401) : jsonResponse(OK_BODY);
      },
    });
    restore = stub.restore;

    await client().call('/callbackFlowMsg', { cod_atendimento: 1 });

    expect(stub.calls.filter((x) => x.path === '/authuser')).toHaveLength(2);
    expect(stub.calls.filter((x) => x.path === '/callbackFlowMsg')).toHaveLength(2);
  });

  it('does NOT retry a 401 that carries cod_error — the retry would duplicate the bubble', async () => {
    const stub = stubPlatform({
      '/mensagem': () => jsonResponse({ cod_error: 10, msg: 'Atendimento já finalizado!' }, 401),
    });
    restore = stub.restore;

    const error = await client()
      .call('/mensagem', { cod: 1, mensagem: 'oi' })
      .then(
        () => null,
        (e) => e,
      );

    expect(error).toMatchObject({ channelCode: AscFlowErrorCode.BUSINESS_ERROR, retryable: false });
    expect(stub.calls.filter((x) => x.path === '/mensagem')).toHaveLength(1); // sent once, never retried
    expect(stub.calls.filter((x) => x.path === '/authuser')).toHaveLength(1); // the initial auth only
  });

  it('classifies 429 and 5xx as retryable', async () => {
    const stub = stubPlatform({ '/mensagem': () => jsonResponse({}, 503) });
    restore = stub.restore;

    expect(client().call('/mensagem', { cod: 1 })).rejects.toMatchObject({
      channelCode: AscFlowErrorCode.UPSTREAM_ERROR,
      retryable: true,
    });
  });
});
