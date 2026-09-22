/**
 * Slack OAuth v2 primitives (wish: slack-personal-oauth, Group 4).
 *
 * Everything here is pure or talks to Slack over `fetch`; nothing touches the
 * database or the Hono context. Three concerns:
 *
 *   * the authorize URL the browser is sent to;
 *   * the signed `state` parameter — `nonce + '.' + HMAC-SHA256(nonce, K)` with
 *     `K = HKDF(slack.app.client_secret, info: 'slack-oauth-state')`. The state
 *     carries no tenant, user or instance: the callback establishes the tenant
 *     from the server-side pending record the nonce names (design D9). No new
 *     secret is introduced — the flow cannot run without the client secret
 *     anyway — and HKDF keeps the signing key distinct from the secret Slack
 *     sees;
 *   * the two Slack Web API calls the callback makes, `oauth.v2.access` and
 *     `users.info`, each parsed through Zod before any field is read.
 *
 * Tokens returned by Slack are NEVER logged here; callers must not log the
 * parsed responses either.
 */

import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { slackAuthorizeScopes } from '@omni/channel-slack';
import { z } from 'zod';

const SLACK_AUTHORIZE_URL = 'https://slack.com/oauth/v2/authorize';
const SLACK_OAUTH_ACCESS_URL = 'https://slack.com/api/oauth.v2.access';
const SLACK_USERS_INFO_URL = 'https://slack.com/api/users.info';
const STATE_KEY_INFO = 'slack-oauth-state';
const STATE_KEY_BYTES = 32;

/**
 * Wall-clock budget for each Slack Web API call the callback makes.
 *
 * Both calls run in the public callback AFTER the pending record was consumed,
 * so a Slack that never answers would leave the member with no outcome to read
 * and no record to retry against — and that callback is deliberately exempt
 * from the GET timeout race, so nothing else bounds it. Ten seconds each keeps
 * the whole callback (two calls, the upsert, the plugin connect) inside what a
 * browser will wait for.
 */
export const SLACK_FETCH_TIMEOUT_MS = 10_000;

/**
 * Strip Slack token shapes out of arbitrary text — a bot/user token
 * (`xoxb-`, `xoxp-`, `xoxa-`, …) or an app-level token (`xapp-`).
 *
 * Belt and braces for anything derived from a Slack error or an exception
 * message: no such text may reach a log line, an outcome message or a response
 * body carrying a live token (wish success criterion 9).
 */
export function redactSlackTokens(text: string): string {
  return text.replace(/(?:xox[a-z]|xapp)-[A-Za-z0-9-]+/g, '[redacted]');
}

export type SlackOAuthMode = 'user' | 'bot';

// ---------------------------------------------------------------------------
// state = nonce.hmac
// ---------------------------------------------------------------------------

/** K = HKDF-SHA256(ikm: client secret, salt: none, info: 'slack-oauth-state'). */
function deriveStateKey(clientSecret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', clientSecret, '', STATE_KEY_INFO, STATE_KEY_BYTES));
}

function hmacNonce(nonce: string, clientSecret: string): string {
  return createHmac('sha256', deriveStateKey(clientSecret)).update(nonce).digest('hex');
}

/** The nonce is a store handle: prefix + UUID. Anything else is refused before hashing. */
const NONCE_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const STATE_PATTERN = /^([A-Za-z0-9_-]{8,128})\.([0-9a-f]{64})$/;

export function signState(nonce: string, clientSecret: string): string {
  if (!NONCE_PATTERN.test(nonce)) throw new Error('slack-oauth: nonce is not a store handle');
  return `${nonce}.${hmacNonce(nonce, clientSecret)}`;
}

/**
 * Verify a `state` and return its nonce, or `null` when the state is malformed
 * or its signature does not match. Comparison is constant-time over equal-length
 * hex digests, so a forged tail cannot be probed byte by byte.
 */
export function verifyState(state: string, clientSecret: string): string | null {
  const match = STATE_PATTERN.exec(state);
  if (!match) return null;
  const nonce = match[1] as string;
  const presented = Buffer.from(match[2] as string, 'hex');
  const expected = Buffer.from(hmacNonce(nonce, clientSecret), 'hex');
  if (presented.length !== expected.length) return null;
  return timingSafeEqual(presented, expected) ? nonce : null;
}

/**
 * The nonce a `state` names, WITHOUT verifying its signature — `null` when the
 * state is not even shaped like one.
 *
 * The only legitimate use is looking up the server-side pending record whose
 * tenant context is needed to READ the app's own client secret (the key this
 * state is signed with): the signature cannot be checked before that key is in
 * hand. Every security decision still waits for `verifyState`, which runs
 * before the record is consumed and before any Slack call. Treat the result as
 * attacker-chosen: it is a store handle to look up, never an identity.
 */
export function readStateNonce(state: string): string | null {
  const match = STATE_PATTERN.exec(state);
  return match ? (match[1] as string) : null;
}

// ---------------------------------------------------------------------------
// Authorize URL
// ---------------------------------------------------------------------------

export interface SlackAuthorizeUrlInput {
  clientId: string;
  redirectUri: string;
  state: string;
  mode: SlackOAuthMode;
}

/**
 * `https://slack.com/oauth/v2/authorize?...` with the bot scopes the manifest
 * declares and, in user mode, the user scopes too. Bot scopes are requested on
 * every authorize because the plugin, socket auth and agent-view status all
 * need the workspace bot token (design D7).
 */
export function buildSlackAuthorizeUrl(input: SlackAuthorizeUrlInput): string {
  const scopes = slackAuthorizeScopes();
  const url = new URL(SLACK_AUTHORIZE_URL);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('scope', scopes.scope);
  if (input.mode === 'user') url.searchParams.set('user_scope', scopes.user_scope);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('state', input.state);
  return url.toString();
}

// ---------------------------------------------------------------------------
// oauth.v2.access
// ---------------------------------------------------------------------------

const SlackIdNameSchema = z.object({ id: z.string().min(1), name: z.string().optional() });

/**
 * Successful `oauth.v2.access` response. `access_token` is the workspace bot
 * token (xoxb-…); `authed_user.access_token` is the person's user token
 * (xoxp-…) and is present only when `user_scope` was requested and granted.
 */
export const SlackOAuthAccessSchema = z.object({
  ok: z.literal(true),
  app_id: z.string().optional(),
  access_token: z.string().min(1).optional(),
  token_type: z.string().optional(),
  scope: z.string().optional(),
  bot_user_id: z.string().optional(),
  team: SlackIdNameSchema.nullable().optional(),
  enterprise: SlackIdNameSchema.nullable().optional(),
  is_enterprise_install: z.boolean().optional(),
  authed_user: z.object({
    id: z.string().min(1),
    scope: z.string().optional(),
    access_token: z.string().min(1).optional(),
    token_type: z.string().optional(),
  }),
});

export type SlackOAuthAccess = z.infer<typeof SlackOAuthAccessSchema>;

const SlackApiErrorSchema = z.object({ ok: z.literal(false), error: z.string().optional() });

const SlackOAuthAccessResponseSchema = z.discriminatedUnion('ok', [SlackOAuthAccessSchema, SlackApiErrorSchema]);

/**
 * Thrown when Slack refuses the exchange or answers with a shape the schema
 * does not admit. `slackError` is Slack's own short error identifier
 * (`invalid_code`, `bad_redirect_uri`, …) or `invalid_response`; the message
 * never embeds the response body, which could carry a token.
 */
export class SlackOAuthExchangeError extends Error {
  readonly slackError: string;
  constructor(slackError: string) {
    super(`Slack oauth.v2.access failed: ${slackError}`);
    this.name = 'SlackOAuthExchangeError';
    this.slackError = slackError;
  }
}

export interface SlackOAuthExchangeInput {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}

/**
 * POST oauth.v2.access and return the Zod-validated success payload. A timeout
 * (or any other transport failure) aborts the call and surfaces as
 * `request_failed`, exactly as a refused connection already did.
 */
export async function exchangeSlackOAuthCode(input: SlackOAuthExchangeInput): Promise<SlackOAuthAccess> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    redirect_uri: input.redirectUri,
  });
  let payload: unknown;
  try {
    const res = await fetch(SLACK_OAUTH_ACCESS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(SLACK_FETCH_TIMEOUT_MS),
    });
    payload = await res.json();
  } catch {
    throw new SlackOAuthExchangeError('request_failed');
  }
  const parsed = SlackOAuthAccessResponseSchema.safeParse(payload);
  if (!parsed.success) throw new SlackOAuthExchangeError('invalid_response');
  if (!parsed.data.ok) throw new SlackOAuthExchangeError(parsed.data.error ?? 'unknown_error');
  return parsed.data;
}

// ---------------------------------------------------------------------------
// users.info
// ---------------------------------------------------------------------------

const SlackUsersInfoResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    user: z.object({
      id: z.string(),
      name: z.string().optional(),
      real_name: z.string().optional(),
      profile: z.object({ display_name: z.string().optional(), real_name: z.string().optional() }).partial().optional(),
    }),
  }),
  SlackApiErrorSchema,
]);

/**
 * The person's display name for the instance name, or `undefined` when Slack
 * cannot tell us (the caller falls back to the user id). Never throws: a
 * naming lookup must not fail an install that already holds valid tokens, so a
 * timeout is `undefined` like every other unusable answer.
 */
export async function fetchSlackUserDisplayName(token: string, userId: string): Promise<string | undefined> {
  let payload: unknown;
  try {
    const url = new URL(SLACK_USERS_INFO_URL);
    url.searchParams.set('user', userId);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(SLACK_FETCH_TIMEOUT_MS),
    });
    payload = await res.json();
  } catch {
    return undefined;
  }
  const parsed = SlackUsersInfoResponseSchema.safeParse(payload);
  if (!parsed.success || !parsed.data.ok) return undefined;
  const { user } = parsed.data;
  const candidates = [user.profile?.display_name, user.profile?.real_name, user.real_name, user.name];
  return candidates.find((c) => typeof c === 'string' && c.trim().length > 0)?.trim();
}
