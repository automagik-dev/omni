/**
 * HermesClient — auth flow + endpoint contract tests.
 *
 * Covers: sign_in exchange, Bearer header propagation, the single
 * 401 → re-sign-in → retry cycle (second 401 throws AUTH_FAILED),
 * markAsRead / upload payload shapes, and HTTP → error-code mapping.
 */

import { afterEach, describe, expect, it, spyOn } from 'bun:test';

import { HermesClient } from '../client';
import { HermesApiError, HermesErrorCode } from '../utils/errors';
import { jsonResponse } from './helpers';

const MEDIA_ID = 'line-uuid-0001';

function makeClient(): HermesClient {
  return new HermesClient({
    baseUrl: 'https://hermes.example.com/',
    username: 'user',
    password: 'pass',
    mediaId: MEDIA_ID,
  });
}

type FetchCall = [string | URL | Request, RequestInit | undefined];

function callAt(spy: ReturnType<typeof spyOn>, index: number): { url: string; init: RequestInit } {
  const [url, init] = spy.mock.calls[index] as FetchCall;
  return { url: String(url), init: init ?? {} };
}

function headerOf(init: RequestInit, name: string): string | undefined {
  return (init.headers as Record<string, string> | undefined)?.[name];
}

afterEach(() => {
  spyOn(globalThis, 'fetch').mockRestore();
});

describe('HermesClient.signIn', () => {
  it('POSTs username/password to /api/v2/users/sign_in and caches the jwt', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ jwt: 'jwt-1' }));

    const client = makeClient();
    const jwt = await client.signIn();

    expect(jwt).toBe('jwt-1');
    const { url, init } = callAt(fetchSpy, 0);
    expect(url).toBe('https://hermes.example.com/api/v2/users/sign_in');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ username: 'user', password: 'pass' });
  });

  it('throws AUTH_FAILED when credentials are rejected', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ error: 'nope' }, 401));

    const client = makeClient();
    await expect(client.signIn()).rejects.toThrow(HermesApiError);
  });

  it('ping() returns true on successful sign_in, false on rejection', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ jwt: 'jwt-1' }))
      .mockResolvedValueOnce(jsonResponse({}, 403));

    expect(await makeClient().ping()).toBe(true);
    expect(await makeClient().ping()).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe('HermesClient.sendMessage', () => {
  it('signs in lazily, sends Bearer header, and wraps the message in the media_id envelope', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ jwt: 'jwt-1' }))
      .mockResolvedValueOnce(jsonResponse({ message: { id: 'hermes-uuid-1' } }));

    const client = makeClient();
    const res = await client.sendMessage({
      to: '5511999998888',
      recipient_type: 'individual',
      type: 'text',
      text: 'oi',
    });

    expect(res.message?.id).toBe('hermes-uuid-1');
    const { url, init } = callAt(fetchSpy, 1);
    expect(url).toBe('https://hermes.example.com/api/v2/messages');
    expect(headerOf(init, 'Authorization')).toBe('Bearer jwt-1');
    expect(JSON.parse(init.body as string)).toEqual({
      message: {
        media_id: MEDIA_ID,
        to: '5511999998888',
        recipient_type: 'individual',
        type: 'text',
        text: 'oi',
      },
    });
  });

  it('re-signs-in once on 401 and retries with the fresh token', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ jwt: 'jwt-1' })) // lazy sign_in
      .mockResolvedValueOnce(jsonResponse({}, 401)) // stale token rejected
      .mockResolvedValueOnce(jsonResponse({ jwt: 'jwt-2' })) // re-sign-in
      .mockResolvedValueOnce(jsonResponse({ message: { id: 'hermes-uuid-2' } })); // retry OK

    const client = makeClient();
    const res = await client.sendMessage({ to: '551199', type: 'text', text: 'retry me' });

    expect(res.message?.id).toBe('hermes-uuid-2');
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(callAt(fetchSpy, 2).url).toBe('https://hermes.example.com/api/v2/users/sign_in');
    expect(headerOf(callAt(fetchSpy, 3).init, 'Authorization')).toBe('Bearer jwt-2');
  });

  it('throws AUTH_FAILED when the retry after re-sign-in is rejected again', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ jwt: 'jwt-1' }))
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse({ jwt: 'jwt-2' }))
      .mockResolvedValueOnce(jsonResponse({}, 401)); // fresh token ALSO rejected

    const client = makeClient();
    const err = await client.sendMessage({ to: '551199', type: 'text', text: 'x' }).catch((e) => e);

    expect(err).toBeInstanceOf(HermesApiError);
    expect((err as HermesApiError).channelCode).toBe(HermesErrorCode.AUTH_FAILED);
    expect((err as HermesApiError).retryable).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(4); // no infinite retry loop
  });

  it('maps 429 to retryable RATE_LIMITED and 500 to retryable UPSTREAM_ERROR', async () => {
    spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ jwt: 'jwt-1' }))
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockResolvedValueOnce(jsonResponse({ jwt: 'jwt-1' }))
      .mockResolvedValueOnce(jsonResponse({}, 500));

    const rateLimited = (await makeClient()
      .sendMessage({ to: '1', type: 'text', text: 'a' })
      .catch((e) => e)) as HermesApiError;
    expect(rateLimited.channelCode).toBe(HermesErrorCode.RATE_LIMITED);
    expect(rateLimited.retryable).toBe(true);

    const upstream = (await makeClient()
      .sendMessage({ to: '1', type: 'text', text: 'b' })
      .catch((e) => e)) as HermesApiError;
    expect(upstream.channelCode).toBe(HermesErrorCode.UPSTREAM_ERROR);
    expect(upstream.retryable).toBe(true);
  });

  it('maps 422 to non-retryable INVALID_REQUEST', async () => {
    spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ jwt: 'jwt-1' }))
      .mockResolvedValueOnce(jsonResponse({ error: 'bad payload' }, 422));

    const err = (await makeClient()
      .sendMessage({ to: '1', type: 'text', text: 'c' })
      .catch((e) => e)) as HermesApiError;
    expect(err.channelCode).toBe(HermesErrorCode.INVALID_REQUEST);
    expect(err.retryable).toBe(false);
  });
});

describe('HermesClient.markAsRead', () => {
  it('POSTs the wamid wrapped in the media_id envelope to /api/v2/messages/read', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ jwt: 'jwt-1' }))
      .mockResolvedValueOnce(jsonResponse({}));

    await makeClient().markAsRead('wamid.ABC123');

    const { url, init } = callAt(fetchSpy, 1);
    expect(url).toBe('https://hermes.example.com/api/v2/messages/read');
    expect(JSON.parse(init.body as string)).toEqual({
      message: { media_id: MEDIA_ID, id: 'wamid.ABC123' },
    });
  });
});

describe('HermesClient.upload', () => {
  it('POSTs raw bytes with Content-Type and media_id query param', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ jwt: 'jwt-1' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'file-uuid-1' }));

    const bytes = new TextEncoder().encode('PDFDATA').buffer as ArrayBuffer;
    const result = await makeClient().upload(bytes, 'application/pdf');

    expect(result.id).toBe('file-uuid-1');
    const { url, init } = callAt(fetchSpy, 1);
    expect(url).toBe(`https://hermes.example.com/api/v2/upload?media_id=${MEDIA_ID}`);
    expect(headerOf(init, 'Content-Type')).toBe('application/pdf');
    expect(init.body).toBe(bytes);
  });
});
