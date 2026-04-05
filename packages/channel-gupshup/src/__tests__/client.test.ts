/**
 * GupshupClient — unit tests
 *
 * Mocks fetch to verify:
 * - Correct request format (method, headers, body fields)
 * - Error classification (retryable vs non-retryable by HTTP status)
 * - Happy path response parsing
 */

import { describe, expect, it, spyOn } from 'bun:test';
import { GupshupClient } from '../client';
import { GupshupError } from '../utils/errors';

const API_KEY = 'test-api-key';
const APP_NAME = 'TestApp';
const SOURCE_PHONE = '5511999990000';

function makeClient(): GupshupClient {
  return new GupshupClient(API_KEY, APP_NAME, SOURCE_PHONE);
}

function makeOkResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeErrorResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('GupshupClient — sendText', () => {
  it('sends correct request format', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      makeOkResponse({ status: 'submitted', messageId: 'msg_001' }),
    );

    const client = makeClient();
    const result = await client.sendText('5511888880000', 'Hello!');

    expect(result.messageId).toBe('msg_001');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.gupshup.io/wa/api/v1/msg');
    expect((init.headers as Record<string, string>).apikey).toBe(API_KEY);
    expect(init.method).toBe('POST');

    const body = new URLSearchParams(init.body as string);
    expect(body.get('channel')).toBe('whatsapp');
    expect(body.get('source')).toBe(SOURCE_PHONE);
    expect(body.get('destination')).toBe('5511888880000');
    expect(body.get('src.name')).toBe(APP_NAME);

    const msg = JSON.parse(body.get('message') ?? '{}');
    expect(msg.type).toBe('text');
    expect(msg.text).toBe('Hello!');

    fetchSpy.mockRestore();
  });
});

describe('GupshupClient — sendMedia', () => {
  it('sends image with caption', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      makeOkResponse({ status: 'submitted', messageId: 'msg_002' }),
    );

    const client = makeClient();
    await client.sendMedia('5511888880000', 'image', 'https://cdn.example.com/photo.jpg', 'Look at this');

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = new URLSearchParams(init.body as string);
    const msg = JSON.parse(body.get('message') ?? '{}');
    expect(msg.type).toBe('image');
    expect(msg.url).toBe('https://cdn.example.com/photo.jpg');
    expect(msg.caption).toBe('Look at this');

    fetchSpy.mockRestore();
  });
});

describe('GupshupClient — sendTemplate', () => {
  it('sends template with params', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      makeOkResponse({ status: 'submitted', messageId: 'msg_003' }),
    );

    const client = makeClient();
    await client.sendTemplate('5511888880000', 'welcome_template', { name: 'Alice', code: '1234' });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = new URLSearchParams(init.body as string);
    const msg = JSON.parse(body.get('message') ?? '{}');
    expect(msg.type).toBe('template');
    expect(msg.template.id).toBe('welcome_template');
    expect(msg.template.params).toEqual(['Alice', '1234']);

    fetchSpy.mockRestore();
  });
});

describe('GupshupClient — sendLocation', () => {
  it('sends location with name and address', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      makeOkResponse({ status: 'submitted', messageId: 'msg_004' }),
    );

    const client = makeClient();
    await client.sendLocation('5511888880000', -23.5505, -46.6333, 'São Paulo', 'Av. Paulista');

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = new URLSearchParams(init.body as string);
    const msg = JSON.parse(body.get('message') ?? '{}');
    expect(msg.type).toBe('location');
    expect(msg.location.latitude).toBe('-23.5505');
    expect(msg.location.longitude).toBe('-46.6333');
    expect(msg.location.name).toBe('São Paulo');
    expect(msg.location.address).toBe('Av. Paulista');

    fetchSpy.mockRestore();
  });
});

describe('GupshupClient — error classification', () => {
  it('throws retryable GupshupError on HTTP 429', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      makeErrorResponse(429, { status: 'error', message: 'Rate limit exceeded' }),
    );

    const client = makeClient();
    let caught: unknown;
    try {
      await client.sendText('5511888880000', 'hi');
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(GupshupError);
    if (caught instanceof GupshupError) {
      expect(caught.recoverable).toBe(true);
    }

    fetchSpy.mockRestore();
  });

  it('throws non-retryable GupshupError on HTTP 401', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      makeErrorResponse(401, { status: 'error', message: 'Unauthorized' }),
    );

    const client = makeClient();
    try {
      await client.sendText('5511888880000', 'hi');
    } catch (e) {
      expect(e).toBeInstanceOf(GupshupError);
      if (e instanceof GupshupError) {
        expect(e.recoverable).toBe(false);
      }
    }

    fetchSpy.mockRestore();
  });

  it('throws non-retryable GupshupError on HTTP 400', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      makeErrorResponse(400, { status: 'error', message: 'Invalid destination' }),
    );

    const client = makeClient();
    try {
      await client.sendText('5511888880000', 'hi');
    } catch (e) {
      expect(e).toBeInstanceOf(GupshupError);
      if (e instanceof GupshupError) {
        expect(e.recoverable).toBe(false);
      }
    }

    fetchSpy.mockRestore();
  });

  it('throws retryable GupshupError on HTTP 503', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      makeErrorResponse(503, { status: 'error', message: 'Service Unavailable' }),
    );

    const client = makeClient();
    try {
      await client.sendText('5511888880000', 'hi');
    } catch (e) {
      expect(e).toBeInstanceOf(GupshupError);
      if (e instanceof GupshupError) {
        expect(e.recoverable).toBe(true);
      }
    }

    fetchSpy.mockRestore();
  });
});

describe('GupshupClient — validateCredentials', () => {
  it('returns true on 200', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{"balance":100}', { status: 200 }));

    const client = makeClient();
    expect(await client.validateCredentials()).toBe(true);
    fetchSpy.mockRestore();
  });

  it('returns false on 401', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

    const client = makeClient();
    expect(await client.validateCredentials()).toBe(false);
    fetchSpy.mockRestore();
  });

  it('returns false on fetch error', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'));

    const client = makeClient();
    expect(await client.validateCredentials()).toBe(false);
    fetchSpy.mockRestore();
  });
});
