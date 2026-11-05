/**
 * Keyless sign-in for the CLI: the server's RFC 8628 device flow for client `omni-cli` (#1461).
 *
 *   1. POST /api/auth/device/code    { client_id }         -> a user code and a link to approve it
 *   2. POST /api/auth/device/token   (polled)              -> once the owner approves, a one-time token
 *   3. POST /api/v2/login/device-key  Bearer token          -> this device's Omni key
 *
 * The owner approves on the link, with `omni approve <code>` on the server, or by texting the
 * code to their own WhatsApp. Every reply is checked with Zod, and only an approved, well-formed
 * key comes back: the caller stores it, and nothing here prints the key or the device token.
 *
 * fetch, sleep, the clock and the abort signal are injectable so tests never need a live
 * server or real waiting.
 */

import { hostname } from 'node:os';
import { z } from 'zod';
import { stripTerminalControls } from './utils/terminal.js';
import { VERSION } from './version.js';

const DEVICE_CLIENT_ID = 'omni-cli';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
/** RFC 8628 3.5: each slow_down adds 5 seconds to the polling interval. */
export const SLOW_DOWN_STEP_S = 5;
/** The server's device-name limit (routes/v2/login.ts DeviceNameSchema). */
const DEVICE_NAME_MAX = 80;
/** Never wait longer than fifteen minutes for an untrusted server's code. */
const MAX_DEVICE_CODE_TTL_S = 15 * 60;

const DeviceCodeSchema = z.object({
  device_code: z.string().min(1),
  user_code: z.string().min(1),
  verification_uri: z.string().min(1),
  verification_uri_complete: z.string().min(1).optional(),
  expires_in: z
    .number()
    .positive()
    .transform((seconds) => Math.min(seconds, MAX_DEVICE_CODE_TTL_S)),
  interval: z
    .number()
    .nonnegative()
    .transform((seconds) => Math.max(1, seconds))
    .optional(),
});

const DeviceTokenSchema = z.object({ access_token: z.string().regex(/^\S+$/) });

const DeviceTokenErrorSchema = z.object({ error: z.string().min(1) });

const DeviceKeyResponseSchema = z.object({
  data: z.object({
    apiKey: z.string().regex(/^\S+$/),
    keyId: z.string().min(1).transform(stripTerminalControls),
    scopes: z.array(z.string().transform(stripTerminalControls)),
    keyExpiresAt: z.string().transform(stripTerminalControls).nullable(),
  }),
});

const ErrorEnvelopeSchema = z.object({ error: z.object({ message: z.string() }) });

export interface DeviceKey {
  apiKey: string;
  keyId: string;
  scopes: string[];
  keyExpiresAt: string | null;
}

export interface DeviceCodePrompt {
  userCode: string;
  verificationUrl: string;
  expiresInSeconds: number;
}

export type DeviceLoginResult =
  | { status: 'approved'; key: DeviceKey }
  /** The server has no device sign-in (login off, or older than it): nothing was asked. */
  | { status: 'unavailable' }
  | { status: 'denied' }
  | { status: 'expired' }
  | { status: 'cancelled' }
  | { status: 'failed'; message: string };

export interface DeviceLoginOptions {
  /** The server's base URL, without a trailing slash. */
  url: string;
  /** Called once with the code to show the person. */
  onPrompt: (prompt: DeviceCodePrompt) => void;
  deviceName?: string;
  signal?: AbortSignal;
  fetch?: typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}

const defaultDeviceName = () => `omni CLI on ${hostname()}`.slice(0, DEVICE_NAME_MAX);

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

class Cancelled extends Error {}

/** A reply as parsed JSON, or null for a body that is not JSON. */
async function jsonOf(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

/** The server's own error message, when its reply has one. */
function serverMessage(body: unknown): string | null {
  const parsed = ErrorEnvelopeSchema.safeParse(body);
  return parsed.success ? stripTerminalControls(parsed.data.error.message) : null;
}

type Post = (path: string, body: unknown, bearer?: string, signal?: AbortSignal) => Promise<Response>;
type Outcome = Exclude<DeviceLoginResult, { status: 'approved' }>;

/** A POST to the server that turns an abort into Cancelled. */
function poster(options: DeviceLoginOptions): Post {
  const doFetch = options.fetch ?? fetch;
  return async (path, body, bearer, requestSignal) => {
    if (options.signal?.aborted) throw new Cancelled();
    const signal =
      requestSignal && options.signal
        ? AbortSignal.any([options.signal, requestSignal])
        : (requestSignal ?? options.signal);
    try {
      return await doFetch(`${options.url}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Accept-Encoding': 'identity',
          'x-omni-cli-version': VERSION,
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        },
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (options.signal?.aborted) throw new Cancelled();
      throw error;
    }
  };
}

/** Step 1: a device code, or why there is none. */
async function requestCode(post: Post): Promise<z.infer<typeof DeviceCodeSchema> | Outcome> {
  const reply = await post('/api/auth/device/code', { client_id: DEVICE_CLIENT_ID });
  if (reply.status === 404) return { status: 'unavailable' };
  const body = await jsonOf(reply);
  if (!reply.ok) {
    return { status: 'failed', message: serverMessage(body) ?? `the sign-in request got HTTP ${reply.status}` };
  }
  const code = DeviceCodeSchema.safeParse(body);
  return code.success ? code.data : { status: 'failed', message: 'the server sent a malformed sign-in code' };
}

/** What one token poll says: the token, wait (with a new interval), or a final outcome. */
type Poll = { token: string } | { waitS: number } | Outcome;

async function pollOnce(post: Post, deviceCode: string, intervalS: number, signal: AbortSignal): Promise<Poll> {
  const reply = await post(
    '/api/auth/device/token',
    {
      grant_type: DEVICE_GRANT,
      device_code: deviceCode,
      client_id: DEVICE_CLIENT_ID,
    },
    undefined,
    signal,
  );
  const body = await jsonOf(reply);
  if (reply.ok) {
    const granted = DeviceTokenSchema.safeParse(body);
    return granted.success
      ? { token: granted.data.access_token }
      : { status: 'failed', message: 'the server sent a malformed device token' };
  }
  if (reply.status === 429) return { waitS: intervalS + SLOW_DOWN_STEP_S };
  if (reply.status >= 500) return { waitS: intervalS };
  const refused = DeviceTokenErrorSchema.safeParse(body);
  if (!refused.success) return { status: 'failed', message: `the token request got HTTP ${reply.status}` };
  switch (refused.data.error) {
    case 'authorization_pending':
      return { waitS: intervalS };
    case 'slow_down':
      return { waitS: intervalS + SLOW_DOWN_STEP_S };
    case 'access_denied':
      return { status: 'denied' };
    case 'expired_token':
      return { status: 'expired' };
    default:
      return {
        status: 'failed',
        message: `the server refused the sign-in (${stripTerminalControls(refused.data.error)})`,
      };
  }
}

/** A token poll may wait for headers or its body only until the device code expires. */
async function pollBeforeDeadline(
  options: DeviceLoginOptions,
  post: Post,
  deviceCode: string,
  intervalS: number,
  deadline: number,
): Promise<Poll> {
  const now = options.now ?? Date.now;
  const remainingMs = deadline - now();
  if (remainingMs <= 0) return { status: 'expired' };
  const timeoutSignal = AbortSignal.timeout(Math.max(1, Math.ceil(remainingMs)));
  try {
    const poll = await pollOnce(post, deviceCode, intervalS, timeoutSignal);
    if (options.signal?.aborted) throw new Cancelled();
    return timeoutSignal.aborted || now() >= deadline ? { status: 'expired' } : poll;
  } catch (error) {
    if (options.signal?.aborted) throw new Cancelled();
    if (timeoutSignal.aborted) return { status: 'expired' };
    throw error;
  }
}

/** Step 2: wait for the owner, at the server's pace, until the code expires. */
async function waitForToken(
  options: DeviceLoginOptions,
  post: Post,
  code: z.infer<typeof DeviceCodeSchema>,
): Promise<{ token: string } | Outcome> {
  const sleep = options.sleep ?? abortableSleep;
  const now = options.now ?? Date.now;
  const deadline = now() + code.expires_in * 1000;
  let intervalS = code.interval ?? SLOW_DOWN_STEP_S;
  for (;;) {
    const remainingMs = deadline - now();
    if (remainingMs <= 0) return { status: 'expired' };
    await sleep(Math.min(intervalS * 1000, remainingMs), options.signal);
    if (options.signal?.aborted) throw new Cancelled();
    const poll = await pollBeforeDeadline(options, post, code.device_code, intervalS, deadline);
    if (!('waitS' in poll)) return poll;
    intervalS = poll.waitS;
  }
}

/** Step 3: trade the one-time token for this device's key. */
async function mintKey(post: Post, token: string, deviceName: string): Promise<DeviceLoginResult> {
  const reply = await post('/api/v2/login/device-key', { deviceName }, token);
  const body = await jsonOf(reply);
  if (!reply.ok) {
    return { status: 'failed', message: serverMessage(body) ?? `the key request got HTTP ${reply.status}` };
  }
  const minted = DeviceKeyResponseSchema.safeParse(body);
  return minted.success
    ? { status: 'approved', key: minted.data.data }
    : { status: 'failed', message: 'the server sent a malformed device key' };
}

export async function runDeviceLogin(options: DeviceLoginOptions): Promise<DeviceLoginResult> {
  const post = poster(options);
  try {
    const code = await requestCode(post);
    if ('status' in code) return code;
    const verificationUrl = new URL(
      stripTerminalControls(code.verification_uri_complete ?? code.verification_uri),
      `${options.url}/`,
    );
    options.onPrompt({
      userCode: code.user_code,
      verificationUrl: verificationUrl.toString(),
      expiresInSeconds: code.expires_in,
    });
    const granted = await waitForToken(options, post, code);
    if ('status' in granted) return granted;
    return await mintKey(post, granted.token, options.deviceName ?? defaultDeviceName());
  } catch (error) {
    if (error instanceof Cancelled || options.signal?.aborted) return { status: 'cancelled' };
    return { status: 'failed', message: stripTerminalControls(error instanceof Error ? error.message : String(error)) };
  }
}

/**
 * Run the device flow with Ctrl+C wired to a clean stop: SIGINT aborts the wait or the
 * request in flight, and the result is `cancelled`, so the caller stores nothing.
 */
export async function runDeviceLoginWithInterrupt(
  options: Omit<DeviceLoginOptions, 'signal'>,
): Promise<DeviceLoginResult> {
  const controller = new AbortController();
  const onInterrupt = () => controller.abort();
  process.on('SIGINT', onInterrupt);
  try {
    return await runDeviceLogin({ ...options, signal: controller.signal });
  } finally {
    process.off('SIGINT', onInterrupt);
  }
}

/** One line per outcome that is not an approved key, for the command to exit with. */
export function deviceLoginFailure(result: Exclude<DeviceLoginResult, { status: 'approved' }>): {
  message: string;
  exitCode: number;
} {
  switch (result.status) {
    case 'unavailable':
      return { message: 'This server does not offer device sign-in. Nothing was saved.', exitCode: 1 };
    case 'denied':
      return { message: 'Sign-in was denied on the server. Nothing was saved.', exitCode: 1 };
    case 'expired':
      return { message: 'The sign-in code expired before it was approved. Nothing was saved.', exitCode: 1 };
    case 'cancelled':
      return { message: 'Sign-in cancelled. Nothing was saved.', exitCode: 130 };
    case 'failed':
      return { message: `Sign-in failed: ${stripTerminalControls(result.message)}. Nothing was saved.`, exitCode: 1 };
  }
}

/** The lines that tell the person how to approve this CLI. */
export function devicePromptLines(prompt: DeviceCodePrompt): string[] {
  const minutes = Math.max(1, Math.round(prompt.expiresInSeconds / 60));
  const userCode = stripTerminalControls(prompt.userCode);
  const verificationUrl = stripTerminalControls(prompt.verificationUrl);
  return [
    `To sign in, approve code ${userCode} within ${minutes} min:`,
    `  open ${verificationUrl}`,
    `  or run on the server: omni approve ${userCode}`,
    `  or text "Omni ${userCode}" to yourself on WhatsApp`,
    'Waiting for approval (Ctrl+C to cancel)...',
  ];
}
