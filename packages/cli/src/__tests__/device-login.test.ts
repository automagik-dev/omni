/**
 * The CLI's device flow (#1461) against a scripted fake server: every fetch is answered
 * from a queue, sleeps advance a fake clock instead of waiting, and nothing touches the
 * network or a config file.
 */

import { describe, expect, spyOn, test } from 'bun:test';
import { type DeviceLoginResult, SLOW_DOWN_STEP_S, devicePromptLines, runDeviceLogin } from '../device-login';

const URL_BASE = 'http://omni.test';
const DEVICE_KEY = 'omni_sk_devicekeyDEVICEKEYdevicekey0001';
const DEVICE_TOKEN = 'device-token-secret-0001';
const CODE = {
  device_code: 'device-code-secret-0001',
  user_code: 'ABCDEFGH',
  verification_uri: '/api/login/device',
  verification_uri_complete: '/api/login/device?user_code=ABCDEFGH',
  expires_in: 600,
  interval: 2,
};
const MINTED = {
  data: {
    apiKey: DEVICE_KEY,
    keyId: 'key-0001',
    scopes: ['instances:*', 'system:read'],
    keyExpiresAt: null,
    apiUrl: URL_BASE,
    companions: [],
  },
};

type Reply = { status: number; body?: unknown };
const json = (status: number, body?: unknown): Reply => ({ status, body });
const pending = json(400, { error: 'authorization_pending', error_description: 'waiting' });
const granted = json(200, { access_token: DEVICE_TOKEN, token_type: 'Bearer', expires_in: 3600 });

interface Run {
  result: DeviceLoginResult;
  calls: Array<{ path: string; body: unknown; authorization: string | null }>;
  sleeps: number[];
  prompts: string[];
}

/** Run the flow against `replies` (code first, then token polls, then the key). */
async function run(
  replies: Array<Reply | Error>,
  options: { abortAt?: 'sleep' | 'fetch'; abortAfterSleeps?: number; deviceName?: string } = {},
): Promise<Run> {
  const calls: Run['calls'] = [];
  const sleeps: number[] = [];
  const prompts: string[] = [];
  const controller = new AbortController();
  let clock = 1_000_000;
  const queue = [...replies];
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      path: String(input).replace(URL_BASE, ''),
      body: init?.body ? JSON.parse(String(init.body)) : null,
      authorization: headers.get('authorization'),
    });
    if (options.abortAt === 'fetch' && calls.length === 2) {
      controller.abort();
      throw new DOMException('The operation was aborted.', 'AbortError');
    }
    const next = queue.shift();
    if (!next) throw new Error('the fake server ran out of replies');
    if (next instanceof Error) throw next;
    const text = typeof next.body === 'string' ? next.body : JSON.stringify(next.body ?? null);
    return new Response(text, { status: next.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const result = await runDeviceLogin({
    url: URL_BASE,
    fetch: fakeFetch,
    signal: controller.signal,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
      if (options.abortAt === 'sleep' && sleeps.length === (options.abortAfterSleeps ?? 1)) controller.abort();
    },
    onPrompt: (prompt) => prompts.push(...devicePromptLines(prompt)),
    ...(options.deviceName ? { deviceName: options.deviceName } : {}),
  });
  return { result, calls, sleeps, prompts };
}

/** No secret the flow handles may appear in what it shows or returns as an error. */
function expectNoSecrets(outcome: Run) {
  const shown =
    JSON.stringify(outcome.prompts) + JSON.stringify(outcome.result.status === 'failed' ? outcome.result : {});
  for (const secret of [DEVICE_KEY, DEVICE_TOKEN, CODE.device_code]) expect(shown).not.toContain(secret);
}

describe('runDeviceLogin', () => {
  test('approval: code, polls while pending, then mints and returns the key', async () => {
    const outcome = await run([json(200, CODE), pending, pending, granted, json(200, MINTED)], {
      deviceName: 'omni CLI on test',
    });
    expect(outcome.result).toEqual({
      status: 'approved',
      key: { apiKey: DEVICE_KEY, keyId: 'key-0001', scopes: ['instances:*', 'system:read'], keyExpiresAt: null },
    });
    expect(outcome.calls.map((call) => call.path)).toEqual([
      '/api/auth/device/code',
      '/api/auth/device/token',
      '/api/auth/device/token',
      '/api/auth/device/token',
      '/api/v2/login/device-key',
    ]);
    expect(outcome.calls[0]?.body).toEqual({ client_id: 'omni-cli' });
    expect(outcome.calls[1]?.body).toEqual({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: CODE.device_code,
      client_id: 'omni-cli',
    });
    expect(outcome.calls[4]).toEqual({
      path: '/api/v2/login/device-key',
      body: { deviceName: 'omni CLI on test' },
      authorization: `Bearer ${DEVICE_TOKEN}`,
    });
    // The server's interval, before every poll.
    expect(outcome.sleeps).toEqual([2000, 2000, 2000]);
    // The code and the link, resolved against the server; never the device code.
    expect(outcome.prompts.join('\n')).toContain('ABCDEFGH');
    expect(outcome.prompts.join('\n')).toContain('http://omni.test/api/login/device?user_code=ABCDEFGH');
    expect(outcome.prompts.join('\n')).toContain('omni approve ABCDEFGH');
    expectNoSecrets(outcome);
  });

  test('strips C1 and bidi controls at the minted-key metadata boundary', async () => {
    const outcome = await run([
      json(200, CODE),
      granted,
      json(200, {
        data: {
          ...MINTED.data,
          keyId: '\u009b31mkey-0001\u202e',
          scopes: ['\u009b31minstances:*\u202e', '\u009b31msystem:read\u202e'],
          keyExpiresAt: '\u009b31m2026-12-01T00:00:00Z\u202e',
        },
      }),
    ]);
    expect(outcome.result).toEqual({
      status: 'approved',
      key: {
        apiKey: DEVICE_KEY,
        keyId: 'key-0001',
        scopes: ['instances:*', 'system:read'],
        keyExpiresAt: '2026-12-01T00:00:00Z',
      },
    });
  });

  test.each([0, 0.25])('floors a server interval of %s to one second', async (interval) => {
    const outcome = await run([json(200, { ...CODE, interval }), granted, json(200, MINTED)]);
    expect(outcome.result.status).toBe('approved');
    expect(outcome.sleeps).toEqual([1000]);
  });

  test('caps device-code expiry and even an oversized poll interval at fifteen minutes', async () => {
    const outcome = await run([json(200, { ...CODE, expires_in: 86400, interval: 86400 })]);
    expect(outcome.result).toEqual({ status: 'expired' });
    expect(outcome.sleeps).toEqual([900000]);
    expect(outcome.calls).toHaveLength(1);
    expect(outcome.prompts[0]).toContain('within 15 min');
  });

  test('strips terminal controls from the user code and verification URL before showing them', async () => {
    const outcome = await run([
      json(200, {
        ...CODE,
        user_code: 'AB\u001b[31mCD\u001b[0m\r\n\u0007\u202e',
        verification_uri_complete: '/api/\u001b[31mlogin\u001b[0m?code=ABCD',
      }),
      granted,
      json(200, MINTED),
    ]);
    expect(outcome.result.status).toBe('approved');
    expect(outcome.prompts[0]).toBe('To sign in, approve code ABCD within 10 min:');
    expect(outcome.prompts[1]).toBe('  open http://omni.test/api/login?code=ABCD');
    expect(outcome.prompts[2]).toBe('  or run on the server: omni approve ABCD');
  });

  test.each(['code', 'poll', 'key', 'fetch'])('strips terminal controls from %s failures', async (stage) => {
    const bad = 'ERR\u001b[31mOR\u001b[0m\r\n\u0007\u202e';
    const refusal = json(403, { error: { message: bad } });
    const replies =
      stage === 'code'
        ? [refusal]
        : stage === 'poll'
          ? [json(200, CODE), json(400, { error: bad })]
          : stage === 'key'
            ? [json(200, CODE), granted, refusal]
            : [new Error(bad)];
    const outcome = await run(replies);
    expect(outcome.result).toEqual({
      status: 'failed',
      message: stage === 'poll' ? 'the server refused the sign-in (ERROR)' : 'ERROR',
    });
  });

  test('authorization_pending keeps the interval; slow_down grows it by 5 s each time', async () => {
    const slow = json(400, { error: 'slow_down' });
    const outcome = await run([json(200, CODE), pending, slow, pending, slow, granted, json(200, MINTED)]);
    expect(outcome.result.status).toBe('approved');
    const step = SLOW_DOWN_STEP_S * 1000;
    expect(outcome.sleeps).toEqual([2000, 2000, 2000 + step, 2000 + step, 2000 + 2 * step]);
  });

  test('a 429 slows down like slow_down; a 5xx is waited out', async () => {
    const outcome = await run([json(200, CODE), json(429, {}), json(503, 'down'), granted, json(200, MINTED)]);
    expect(outcome.result.status).toBe('approved');
    expect(outcome.sleeps).toEqual([2000, 7000, 7000]);
  });

  test('access_denied ends the flow as denied, with no key request', async () => {
    const outcome = await run([json(200, CODE), pending, json(400, { error: 'access_denied' })]);
    expect(outcome.result).toEqual({ status: 'denied' });
    expect(outcome.calls.some((call) => call.path === '/api/v2/login/device-key')).toBe(false);
  });

  test('expired_token ends the flow as expired', async () => {
    const outcome = await run([json(200, CODE), json(400, { error: 'expired_token' })]);
    expect(outcome.result).toEqual({ status: 'expired' });
  });

  test("the code's own expiry ends the flow without another poll", async () => {
    const code = { ...CODE, expires_in: 5, interval: 2 };
    const outcome = await run([json(200, code), pending, pending]);
    expect(outcome.result).toEqual({ status: 'expired' });
    // Polls at 2 s and 4 s; the third wait stops at the 5 s expiry.
    expect(outcome.calls.filter((call) => call.path === '/api/auth/device/token')).toHaveLength(2);
  });

  test('Ctrl+C while waiting cancels before any further request', async () => {
    const outcome = await run([json(200, CODE), pending], { abortAt: 'sleep', abortAfterSleeps: 2 });
    expect(outcome.result).toEqual({ status: 'cancelled' });
    expect(outcome.calls.map((call) => call.path)).toEqual(['/api/auth/device/code', '/api/auth/device/token']);
  });

  test('Ctrl+C during a request cancels', async () => {
    const outcome = await run([json(200, CODE)], { abortAt: 'fetch' });
    expect(outcome.result).toEqual({ status: 'cancelled' });
  });

  test('a server without device sign-in (404) is unavailable, and nothing is shown', async () => {
    const outcome = await run([json(404, { error: { code: 'NOT_FOUND', message: 'Not found' } })]);
    expect(outcome.result).toEqual({ status: 'unavailable' });
    expect(outcome.prompts).toEqual([]);
  });

  test('a malformed code, token or key reply fails cleanly', async () => {
    const cases: Array<[Array<Reply>, string]> = [
      [[json(200, { user_code: 'ABCDEFGH' })], 'malformed sign-in code'],
      [[json(200, 'not json at all')], 'malformed sign-in code'],
      [[json(200, CODE), json(200, { token_type: 'Bearer' })], 'malformed device token'],
      [[json(200, CODE), json(400, { nope: true })], 'HTTP 400'],
      [[json(200, CODE), granted, json(200, { data: { keyId: 'key-0001' } })], 'malformed device key'],
      [[json(200, CODE), granted, json(200, { data: { ...MINTED.data, apiKey: '' } })], 'malformed device key'],
    ];
    for (const [replies, message] of cases) {
      const outcome = await run(replies);
      expect(outcome.result.status).toBe('failed');
      expect(outcome.result.status === 'failed' && outcome.result.message).toContain(message);
      expectNoSecrets(outcome);
    }
  });

  test("a refused key request reports the server's message, never the token", async () => {
    const refusal = json(403, { error: { code: 'FORBIDDEN', message: "This Omni's device-key scopes leave nothing" } });
    const outcome = await run([json(200, CODE), granted, refusal]);
    expect(outcome.result).toEqual({ status: 'failed', message: "This Omni's device-key scopes leave nothing" });
    expectNoSecrets(outcome);
  });

  test('an unreachable server fails cleanly', async () => {
    const outcome = await run([new TypeError('Unable to connect')]);
    expect(outcome.result).toEqual({ status: 'failed', message: 'Unable to connect' });
  });
});

describe('token poll deadline (#1461)', () => {
  test.each(['headers', 'body'])('aborts a stalled token %s at the remaining deadline', async (stage) => {
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    const budgets: number[] = [];
    const timeoutSpy = spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      budgets.push(ms);
      // First poll completes immediately; only the second request stalls. Keep the test fast.
      return budgets.length === 1 ? new AbortController().signal : timeout(5);
    });
    let clock = 0;
    let polls = 0;
    let mints = 0;
    const stalled = (signal?: AbortSignal | null) =>
      new Promise<never>((_resolve, reject) => {
        const watchdog = setTimeout(() => {
          signal?.removeEventListener('abort', abort);
          reject(new Error('token poll outlived its deadline'));
        }, 100);
        function abort() {
          clearTimeout(watchdog);
          clock = 3000;
          reject(signal?.reason);
        }
        if (signal?.aborted) abort();
        else signal?.addEventListener('abort', abort, { once: true });
      });
    try {
      const result = await runDeviceLogin({
        url: URL_BASE,
        onPrompt: () => {},
        now: () => clock,
        sleep: async (ms) => {
          clock += ms;
        },
        fetch: (async (input, init) => {
          const path = String(input);
          if (path.endsWith('/code')) return Response.json({ ...CODE, expires_in: 3, interval: 1 });
          if (path.endsWith('/device-key')) {
            mints += 1;
            return Response.json(MINTED);
          }
          polls += 1;
          if (polls === 1) return Response.json({ error: 'authorization_pending' }, { status: 400 });
          if (stage === 'headers') return stalled(init?.signal);
          return new Response(
            new ReadableStream({
              start(controller) {
                void stalled(init?.signal).catch((error) => controller.error(error));
              },
            }),
          );
        }) as typeof fetch,
      });
      expect(result).toEqual({ status: 'expired' });
      expect(budgets).toEqual([2000, 1000]);
      expect(polls).toBe(2);
      expect(mints).toBe(0);
    } finally {
      timeoutSpy.mockRestore();
    }
  });
});
