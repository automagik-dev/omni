/**
 * The two Slack Web API calls the OAuth callback makes, and the token redactor
 * every log line and outcome message goes through (wish: slack-personal-oauth).
 *
 * Both calls run in the PUBLIC callback after the pending record was consumed,
 * so a Slack that never answers must not leave the request hanging: each fetch
 * carries `AbortSignal.timeout(SLACK_FETCH_TIMEOUT_MS)`, and the abort maps
 * onto the failure each function already had — `request_failed` for the
 * exchange, `undefined` for the naming lookup.
 *
 * Nothing here reaches the network: `globalThis.fetch` is replaced for the
 * duration of each test, and `AbortSignal.timeout` is wrapped so the test can
 * see the budget the call sites ask for.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import {
  SLACK_FETCH_TIMEOUT_MS,
  SlackOAuthExchangeError,
  exchangeSlackOAuthCode,
  fetchSlackUserDisplayName,
  redactSlackTokens,
} from '../slack-oauth';

const EXCHANGE_INPUT = {
  clientId: '1234567890.1234567890',
  clientSecret: 'client-secret-under-test',
  code: 'code-123',
  redirectUri: 'https://omni.example.com/api/v2/slack/oauth/callback',
};

interface Observed {
  /** Every `AbortSignal.timeout(ms)` the code under test asked for. */
  budgets: number[];
  /** The `signal` each fetch was given. */
  signals: (AbortSignal | null | undefined)[];
}

const originalFetch = globalThis.fetch;
const originalTimeout = AbortSignal.timeout;

afterEach(() => {
  globalThis.fetch = originalFetch;
  AbortSignal.timeout = originalTimeout;
});

/**
 * Run `body` with `fetch` answering through `respond`, recording the abort
 * budgets requested and the signals handed to fetch.
 */
async function observing<T>(
  respond: (url: string) => Promise<Response>,
  body: (observed: Observed) => Promise<T>,
): Promise<{ observed: Observed; value: T }> {
  const observed: Observed = { budgets: [], signals: [] };
  AbortSignal.timeout = ((ms: number) => {
    observed.budgets.push(ms);
    return originalTimeout.call(AbortSignal, ms);
  }) as typeof AbortSignal.timeout;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    observed.signals.push(init?.signal as AbortSignal | null | undefined);
    return respond(String(input instanceof Request ? input.url : input));
  }) as unknown as typeof fetch;
  const value = await body(observed);
  return { observed, value };
}

/** What Bun's fetch rejects with when an `AbortSignal.timeout` fires. */
function abortError(): Error {
  return new DOMException('The operation timed out.', 'TimeoutError');
}

describe('exchangeSlackOAuthCode', () => {
  test('carries the shared timeout budget as an AbortSignal on the exchange', async () => {
    const { observed, value } = await observing(
      async () =>
        Response.json({
          ok: true,
          access_token: 'xoxb-workspace-bot-token',
          team: { id: 'T0123456789', name: 'Acme' },
          authed_user: { id: 'U0123456789', access_token: 'xoxp-personal-user-token' },
        }),
      () => exchangeSlackOAuthCode(EXCHANGE_INPUT),
    );

    expect(value.access_token).toBe('xoxb-workspace-bot-token');
    expect(observed.budgets).toEqual([SLACK_FETCH_TIMEOUT_MS]);
    expect(observed.signals[0]).toBeInstanceOf(AbortSignal);
    expect(observed.signals[0]?.aborted).toBe(false);
  });

  test('an aborted exchange is request_failed, exactly like a refused connection', async () => {
    const attempt = observing(
      async () => {
        throw abortError();
      },
      () => exchangeSlackOAuthCode(EXCHANGE_INPUT).then(() => 'resolved'),
    );

    await expect(attempt).rejects.toThrow(SlackOAuthExchangeError);
    await attempt.catch((error: unknown) => {
      expect((error as SlackOAuthExchangeError).slackError).toBe('request_failed');
      // The message never embeds the response or the request body.
      expect((error as Error).message).not.toContain(EXCHANGE_INPUT.clientSecret);
    });
  });

  test('the budget is ten seconds, so two calls plus the write stay inside a browser wait', () => {
    expect(SLACK_FETCH_TIMEOUT_MS).toBe(10_000);
  });
});

describe('fetchSlackUserDisplayName', () => {
  test('carries the shared timeout budget as an AbortSignal on users.info', async () => {
    const { observed, value } = await observing(
      async () => Response.json({ ok: true, user: { id: 'U0123456789', profile: { display_name: 'Jane Doe' } } }),
      () => fetchSlackUserDisplayName('xoxb-workspace-bot-token', 'U0123456789'),
    );

    expect(value).toBe('Jane Doe');
    expect(observed.budgets).toEqual([SLACK_FETCH_TIMEOUT_MS]);
    expect(observed.signals[0]).toBeInstanceOf(AbortSignal);
  });

  test('an aborted naming lookup is undefined, not a failed install', async () => {
    const { value } = await observing(
      async () => {
        throw abortError();
      },
      () => fetchSlackUserDisplayName('xoxb-workspace-bot-token', 'U0123456789'),
    );

    expect(value).toBeUndefined();
  });
});

describe('redactSlackTokens', () => {
  test('redacts every Slack token shape, including app-level tokens', () => {
    expect(redactSlackTokens('bot xoxb-123-456-abcDEF failed')).toBe('bot [redacted] failed');
    expect(redactSlackTokens('user xoxp-123-456-abcDEF failed')).toBe('user [redacted] failed');
    expect(redactSlackTokens('legacy xoxa-2-123-456-abc')).toBe('legacy [redacted]');
    expect(redactSlackTokens('refresh xoxe-1-abc')).toBe('refresh [redacted]');
    expect(redactSlackTokens('app xapp-1-A0123456789-456-abcDEF failed')).toBe('app [redacted] failed');
  });

  test('redacts several tokens in one string and leaves everything else alone', () => {
    expect(redactSlackTokens('xoxb-a and xapp-1-b and xoxp-c')).toBe('[redacted] and [redacted] and [redacted]');

    const untouched = 'invalid_auth for U0123456789 in T0123456789 (signing secret unchanged)';
    expect(redactSlackTokens(untouched)).toBe(untouched);
    // Not a token shape: no dash, nothing to redact.
    expect(redactSlackTokens('the word xoxb alone')).toBe('the word xoxb alone');
  });
});
