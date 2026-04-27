/**
 * Tests for BotFrameworkClient — the thin REST client we own instead of
 * pulling in the official `botbuilder` runtime.
 *
 * Verifies token caching, send/reply URL construction, and error mapping.
 */

import { describe, expect, it, mock } from 'bun:test';

import { BotFrameworkClient, BotFrameworkRequestError } from '../connection/bot-framework-client';
import type { TeamsConnectionOptions } from '../types';

const options: TeamsConnectionOptions = {
  appId: 'app-id',
  appPassword: 'app-secret',
};

interface RecordedCall {
  url: string;
  init?: RequestInit;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function textResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain' } });
}

function buildFetch(responses: Array<(call: RecordedCall) => Response | Promise<Response>>): {
  fetchImpl: typeof fetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  let i = 0;
  const fetchImpl = mock(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const handler = responses[Math.min(i, responses.length - 1)];
    if (!handler) throw new Error('No handler available for fetch call');
    i += 1;
    return handler({ url, init });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

const tokenResponse = () => jsonResponse(200, { access_token: 'cached-token', expires_in: 3600, token_type: 'Bearer' });

describe('BotFrameworkClient.getToken', () => {
  it('caches the AAD token across calls', async () => {
    const { fetchImpl, calls } = buildFetch([tokenResponse, tokenResponse]);
    const client = new BotFrameworkClient({ options, fetchImpl });

    const t1 = await client.getToken();
    const t2 = await client.getToken();

    expect(t1.token).toBe('cached-token');
    expect(t2).toBe(t1);
    // Only one AAD round-trip
    expect(calls.length).toBe(1);
  });

  it('refreshes once the cached token nears expiry (refreshSkewMs)', async () => {
    let issued = 0;
    const { fetchImpl } = buildFetch([
      () => {
        issued += 1;
        return jsonResponse(200, {
          access_token: `token-${issued}`,
          // already past the skew window the moment we receive it
          expires_in: 1,
          token_type: 'Bearer',
        });
      },
      () => {
        issued += 1;
        return jsonResponse(200, {
          access_token: `token-${issued}`,
          expires_in: 3600,
          token_type: 'Bearer',
        });
      },
    ]);

    const client = new BotFrameworkClient({
      options,
      fetchImpl,
      refreshSkewMs: 60_000, // skew >> expires_in → first token always considered stale
    });

    const first = await client.getToken();
    const second = await client.getToken();

    expect(first.token).toBe('token-1');
    expect(second.token).toBe('token-2');
    expect(issued).toBe(2);
  });

  it('coalesces concurrent token requests into one inflight promise', async () => {
    let aadCalls = 0;
    const { fetchImpl } = buildFetch([
      () => {
        aadCalls += 1;
        return jsonResponse(200, { access_token: 'shared', expires_in: 3600, token_type: 'Bearer' });
      },
    ]);

    const client = new BotFrameworkClient({ options, fetchImpl });

    const [a, b, c] = await Promise.all([client.getToken(), client.getToken(), client.getToken()]);
    expect(a.token).toBe('shared');
    expect(b.token).toBe('shared');
    expect(c.token).toBe('shared');
    expect(aadCalls).toBe(1);
  });
});

describe('BotFrameworkClient.sendActivity', () => {
  it('POSTs to {serviceUrl}/v3/conversations/{id}/activities with a Bearer token', async () => {
    const { fetchImpl, calls } = buildFetch([tokenResponse, () => jsonResponse(200, { id: 'activity-out-1' })]);

    const client = new BotFrameworkClient({ options, fetchImpl });
    const result = await client.sendActivity('https://smba.trafficmanager.net/teams/', 'conv:abc', {
      type: 'message',
      text: 'hello',
    });

    expect(result.activityId).toBe('activity-out-1');
    const sendCall = calls[1];
    expect(sendCall?.url).toBe('https://smba.trafficmanager.net/teams/v3/conversations/conv%3Aabc/activities');
    const headers = new Headers(sendCall?.init?.headers ?? {});
    expect(headers.get('authorization')).toBe('Bearer cached-token');
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('strips trailing slashes from serviceUrl', async () => {
    const { fetchImpl, calls } = buildFetch([tokenResponse, () => jsonResponse(200, { id: 'a' })]);

    const client = new BotFrameworkClient({ options, fetchImpl });
    await client.sendActivity('https://example.com/path/', 'c', { type: 'message' });
    expect(calls[1]?.url).toBe('https://example.com/path/v3/conversations/c/activities');
  });

  it('throws BotFrameworkRequestError on non-2xx responses', async () => {
    const { fetchImpl } = buildFetch([tokenResponse, () => textResponse(429, 'Too Many Requests')]);

    const client = new BotFrameworkClient({ options, fetchImpl });

    await expect(client.sendActivity('https://example.com', 'conv', { type: 'message' })).rejects.toBeInstanceOf(
      BotFrameworkRequestError,
    );
  });

  it('captures the http status on the request error', async () => {
    const { fetchImpl } = buildFetch([tokenResponse, () => textResponse(503, 'unavailable')]);

    const client = new BotFrameworkClient({ options, fetchImpl });

    try {
      await client.sendActivity('https://example.com', 'conv', { type: 'message' });
      throw new Error('expected sendActivity to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BotFrameworkRequestError);
      expect((err as BotFrameworkRequestError).httpStatus).toBe(503);
    }
  });
});

describe('BotFrameworkClient.replyToActivity', () => {
  it('POSTs to the reply endpoint with replyToId set in the payload', async () => {
    const { fetchImpl, calls } = buildFetch([tokenResponse, () => jsonResponse(200, { id: 'reply-1' })]);

    const client = new BotFrameworkClient({ options, fetchImpl });
    const result = await client.replyToActivity('https://example.com', 'conv', 'parent-activity', {
      type: 'message',
      text: 'reply',
    });

    expect(result.activityId).toBe('reply-1');
    expect(calls[1]?.url).toBe('https://example.com/v3/conversations/conv/activities/parent-activity');
    const body = JSON.parse(String(calls[1]?.init?.body ?? '{}'));
    expect(body.replyToId).toBe('parent-activity');
    expect(body.text).toBe('reply');
  });
});
