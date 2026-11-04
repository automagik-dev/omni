/**
 * Slack-specific routes (#889, slack-personal-oauth)
 *
 * POST /slack/dm/open            - resolve (or open) the DM channel with a user
 * GET  /slack/search             - full-text message search (user token only)
 * GET  /slack/app                - deployment Slack app status (wish: slack-personal-oauth)
 * POST /slack/oauth/start        - begin the one-click OAuth install
 * GET  /slack/oauth/result/:nonce - single-use outcome of an install
 * GET  /api/v2/slack/oauth/callback - the public Slack redirect target; handler
 *                                  exported from here, mounted by app.ts
 *
 * These are deliberately NOT on /messages or /instances: neither has a
 * cross-channel equivalent. Opening a DM by user id, searching messages and
 * installing through Slack OAuth are Slack concepts, and pretending otherwise
 * would put methods on the generic ChannelPlugin contract that no other
 * channel could implement.
 */

import { zValidator } from '@hono/zod-validator';
import type { ChannelRegistry } from '@omni/channel-sdk';
import type { ChannelType } from '@omni/core';
import { ERROR_CODES, OmniError, createLogger } from '@omni/core';
import type { Database } from '@omni/db';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import { createSingleUseStore } from '../../lib/single-use-store';
import {
  type SlackOAuthAccess,
  SlackOAuthExchangeError,
  type SlackOAuthMode,
  buildSlackAuthorizeUrl,
  exchangeSlackOAuthCode,
  fetchSlackUserDisplayName,
  readStateNonce,
  redactSlackTokens,
  signState,
  verifyState,
} from '../../lib/slack-oauth';
import type { Services } from '../../services';
import { ApiKeyService } from '../../services/api-keys';
import {
  type SlackAppCredentials,
  type SlackAppResolution,
  type UpsertSlackOAuthInstanceInput,
  type UpsertSlackOAuthInstanceResult,
  isAllowedReturnTo,
  resolveSlackApp,
  resolveSlackAppConfig,
  upsertSlackOAuthInstance,
} from '../../services/slack-oauth';
import type { TenantAuthContext } from '../../tenancy/auth-context';
import { runInTenantScope } from '../../tenancy/tenant-scope';
import type { ApiKeyData, AppVariables } from '../../types';

export const slackRoutes = new Hono<{ Variables: AppVariables }>();

const openDmSchema = z.object({
  instanceId: z.string().uuid(),
  userId: z.string().min(1).describe('Slack user id (U…) to open a DM with'),
});

const searchSchema = z.object({
  instanceId: z.string().uuid(),
  query: z.string().min(1),
  count: z.coerce.number().int().min(1).max(100).default(20),
  page: z.coerce.number().int().min(1).default(1),
});

interface SlackCapablePlugin {
  openDirectMessage?: (instanceId: string, userId: string) => Promise<string>;
  searchMessages?: (
    instanceId: string,
    query: string,
    options?: { count?: number; page?: number },
  ) => Promise<unknown[]>;
}

/**
 * Check if an API key has access to a specific instance.
 * Throws FORBIDDEN error if access is denied.
 */
function checkInstanceAccess(apiKey: ApiKeyData | undefined, instanceId: string): void {
  if (apiKey && !ApiKeyService.instanceAllowed(apiKey.instanceIds, instanceId)) {
    throw new OmniError({
      code: ERROR_CODES.FORBIDDEN,
      message: 'API key does not have access to this instance',
      context: { instanceId },
      recoverable: false,
    });
  }
}

/** Resolve the Slack plugin, refusing early when the instance is not Slack. */
async function getSlackPlugin(
  c: { get: (k: 'services' | 'channelRegistry' | 'apiKey') => unknown },
  instanceId: string,
): Promise<SlackCapablePlugin> {
  checkInstanceAccess(c.get('apiKey') as ApiKeyData | undefined, instanceId);

  const services = c.get('services') as { instances: { getById: (id: string) => Promise<{ channel: string }> } };
  const registry = c.get('channelRegistry') as { get: (ch: ChannelType) => unknown } | null | undefined;

  const instance = await services.instances.getById(instanceId);

  if (instance.channel !== 'slack') {
    throw new OmniError({
      code: ERROR_CODES.CAPABILITY_NOT_SUPPORTED,
      message: `Instance ${instanceId} is a ${instance.channel} instance; these endpoints are Slack-only`,
      context: { channelType: instance.channel },
      recoverable: false,
    });
  }

  if (!registry) {
    throw new OmniError({
      code: ERROR_CODES.CHANNEL_NOT_CONNECTED,
      message: 'Channel registry not available',
      recoverable: false,
    });
  }

  const plugin = registry.get('slack' as ChannelType) as SlackCapablePlugin | undefined;
  if (!plugin) {
    throw new OmniError({
      code: ERROR_CODES.CHANNEL_NOT_CONNECTED,
      message: 'Slack plugin not registered',
      recoverable: false,
    });
  }

  return plugin;
}

/**
 * POST /slack/dm/open — resolve the DM channel for a user.
 *
 * Idempotent on Slack's side: calling it for an existing DM returns the same
 * channel rather than opening a second one.
 */
slackRoutes.post('/dm/open', zValidator('json', openDmSchema), async (c) => {
  const { instanceId, userId } = c.req.valid('json');
  const plugin = await getSlackPlugin(c, instanceId);

  if (typeof plugin.openDirectMessage !== 'function') {
    throw new OmniError({
      code: ERROR_CODES.CAPABILITY_NOT_SUPPORTED,
      message: 'Slack plugin does not implement openDirectMessage',
      recoverable: false,
    });
  }

  try {
    const channelId = await plugin.openDirectMessage(instanceId, userId);
    return c.json({ success: true, data: { userId, channelId } });
  } catch (error) {
    throw new OmniError({
      code: ERROR_CODES.CHANNEL_SEND_FAILED,
      message: error instanceof Error ? error.message : String(error),
      recoverable: true,
    });
  }
});

/**
 * GET /slack/search — full-text search.
 *
 * Needs an instance in `user` auth mode: search.messages requires the
 * `search:read` user scope and no bot token can hold it. The plugin throws
 * for a bot-mode instance, and that error is surfaced rather than converted
 * into an empty result — empty would read as "nothing matched".
 */
slackRoutes.get('/search', zValidator('query', searchSchema), async (c) => {
  const { instanceId, query, count, page } = c.req.valid('query');
  const plugin = await getSlackPlugin(c, instanceId);

  if (typeof plugin.searchMessages !== 'function') {
    throw new OmniError({
      code: ERROR_CODES.CAPABILITY_NOT_SUPPORTED,
      message: 'Slack plugin does not implement searchMessages',
      recoverable: false,
    });
  }

  try {
    const matches = await plugin.searchMessages(instanceId, query, { count, page });
    return c.json({
      data: matches,
      meta: {
        count: matches.length,
        page,
        // Slack applies the authorizing user's own search preferences, so this
        // is that person's view of the workspace, not a neutral index query.
        scope: 'authorizing-user',
      },
    });
  } catch (error) {
    throw new OmniError({
      code: ERROR_CODES.CAPABILITY_NOT_SUPPORTED,
      message: error instanceof Error ? error.message : String(error),
      recoverable: false,
    });
  }
});

// ===========================================================================
// One-click OAuth install (wish: slack-personal-oauth, Group 4)
//
//   POST /slack/oauth/start          — authenticated; issues a signed state
//   GET  /slack/oauth/callback       — PUBLIC (mounted in app.ts, rate-limited)
//   GET  /slack/oauth/result/:nonce  — authenticated; single-use outcome
//   GET  /slack/app                  — authenticated; app configuration status
//
// The state is `nonce.hmac` (lib/slack-oauth.ts). The nonce names a
// server-side pending record that carries the initiating request's tenant
// context, entry point, mode and returnTo. The callback trusts ONLY that
// record: nothing in its query string, headers or body can select a tenant
// (the multitenancy rule for callback surfaces). After the callback the same
// nonce holds the single-use outcome the authenticated result endpoint
// returns; the browser only ever sees `?slack=<nonce>`.
// ===========================================================================

const OAUTH_TTL_MS = 5 * 60 * 1000;
const OAUTH_MAX_ENTRIES = 100;
const OAUTH_NONCE_PREFIX = 'slackoauth_';
const NONCE_PARAM_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const oauthLog = createLogger('api:slack-oauth');

type SlackOAuthEntry = 'ui' | 'cli';

interface SlackOAuthPending {
  kind: 'pending';
  /** Tenant of the request that started the flow; null on a legacy (unscoped) request. */
  tenantContext: TenantAuthContext | null;
  entry: SlackOAuthEntry;
  mode: SlackOAuthMode;
  returnTo: string | null;
  /** The flow's own deadline, independent of store TTL re-arming. */
  expiresAt: number;
}

type SlackOAuthOutcome =
  | { kind: 'outcome'; tenantId: string | null; status: 'done'; instanceId: string }
  | { kind: 'outcome'; tenantId: string | null; status: 'error'; code: string; message: string };

type SlackOAuthRecord = SlackOAuthPending | SlackOAuthOutcome;

const oauthStore = createSingleUseStore<SlackOAuthRecord>({
  ttlMs: OAUTH_TTL_MS,
  maxEntries: OAUTH_MAX_ENTRIES,
  prefix: OAUTH_NONCE_PREFIX,
});

function errorOutcome(tenantId: string | null, code: string, message: string): SlackOAuthOutcome {
  return { kind: 'outcome', tenantId, status: 'error', code, message: redactSlackTokens(message) };
}

// ---------------------------------------------------------------------------
// GET /slack/app
// ---------------------------------------------------------------------------

slackRoutes.get('/app', async (c) => {
  const services = c.get('services');
  const config = await resolveSlackAppConfig(services.settings);
  return c.json({
    configured: config.configured,
    missing: config.missing,
    redirectUrl: config.redirectUrl,
    manifestUrl: config.manifestUrl,
  });
});

// ---------------------------------------------------------------------------
// POST /slack/oauth/start
// ---------------------------------------------------------------------------

const oauthStartSchema = z.object({
  mode: z
    .enum(['user', 'bot'])
    .default('user')
    .describe("Act as the authorizing person ('user') or as the workspace bot"),
  entry: z.enum(['ui', 'cli']).describe('Who is waiting: the dashboard (redirect) or a terminal (fixed page)'),
  returnTo: z
    .string()
    .min(1)
    .max(2048)
    .optional()
    .describe('Where the dashboard resumes after Slack: a path, or a URL on server.public_url'),
});

slackRoutes.post('/oauth/start', zValidator('json', oauthStartSchema), async (c) => {
  const { mode, entry, returnTo } = c.req.valid('json');
  const services = c.get('services');

  const app = await resolveSlackApp(services.settings);
  if (!app.ok) {
    const { missing } = app.config;
    return c.json(
      {
        error: {
          code: 'SLACK_APP_NOT_CONFIGURED',
          message: `Slack app is not configured; missing settings: ${missing.join(', ')}`,
          details: { missing },
        },
      },
      409,
    );
  }

  if (returnTo !== undefined && !isAllowedReturnTo(returnTo, app.credentials.publicOrigin)) {
    return c.json(
      {
        error: {
          code: 'VALIDATION',
          message: 'returnTo must be a path or a URL on server.public_url, without query or fragment',
        },
      },
      400,
    );
  }

  const expiresAt = Date.now() + OAUTH_TTL_MS;
  const pending: SlackOAuthPending = {
    kind: 'pending',
    tenantContext: c.get('authContext') ?? null,
    entry,
    mode,
    returnTo: returnTo ?? null,
    expiresAt,
  };
  const nonce = oauthStore.put(pending);
  const state = signState(nonce, app.credentials.clientSecret);
  const authorizeUrl = buildSlackAuthorizeUrl({
    clientId: app.credentials.clientId,
    redirectUri: app.credentials.redirectUrl,
    state,
    mode,
  });

  return c.json({ authorizeUrl, nonce, expiresAt: new Date(expiresAt).toISOString() });
});

// ---------------------------------------------------------------------------
// GET /slack/oauth/result/:nonce
// ---------------------------------------------------------------------------

const nonceParamSchema = z.object({ nonce: z.string().regex(NONCE_PARAM_PATTERN) });

/**
 * Who may read a parked outcome.
 *
 * A tenant credential may read only outcomes of flows its own tenant started.
 * A flow started without any tenant context (legacy, unscoped) belongs to the
 * deployment, so only a caller that itself carries no tenant context may read
 * it — a tenant credential holding a leaked nonce must not.
 */
function tenantMayRead(record: SlackOAuthRecord, caller: TenantAuthContext | undefined): boolean {
  const owner = record.kind === 'pending' ? (record.tenantContext?.tenantId ?? null) : record.tenantId;
  if (owner === null) return caller === undefined;
  return caller === undefined || owner === caller.tenantId;
}

slackRoutes.get('/oauth/result/:nonce', zValidator('param', nonceParamSchema), async (c) => {
  const { nonce } = c.req.valid('param');
  const record = oauthStore.take(nonce);
  if (!record) return c.json({ status: 'pending' });

  if (record.kind === 'pending' || !tenantMayRead(record, c.get('authContext'))) {
    // Not ours to consume: put it back (re-arms the store TTL; a pending
    // record's own `expiresAt` still bounds the flow).
    oauthStore.transition(nonce, record);
    return c.json({ status: 'pending' });
  }

  if (record.status === 'done') return c.json({ status: 'done', instanceId: record.instanceId });
  return c.json({ status: 'error', code: record.code, message: record.message });
});

// ---------------------------------------------------------------------------
// GET /api/v2/slack/oauth/callback  (public; mounted in app.ts)
// ---------------------------------------------------------------------------

const callbackQuerySchema = z.object({
  code: z.string().min(1).max(512).optional(),
  state: z.string().min(1).max(512).optional(),
  error: z.string().min(1).max(128).optional(),
});

type CallbackFailure = 'invalid_request' | 'not_configured' | 'invalid_state' | 'invalid_return';

/**
 * What the browser is told. `not_configured` and `invalid_state` deliberately
 * share one sentence: a page that named the deployment fact would let anyone
 * holding the callback URL learn whether a Slack app is configured here, and
 * the person in front of the browser can do nothing different either way.
 * The real reason is logged instead, where the operator reads it.
 */
const CALLBACK_FAILURE_TEXT: Record<CallbackFailure, string> = {
  invalid_request: 'This Slack sign-in link is incomplete.',
  not_configured: 'This Slack sign-in link has expired or was already used. Start again from Omni.',
  invalid_state: 'This Slack sign-in link has expired or was already used. Start again from Omni.',
  invalid_return: 'The return address for this sign-in is not allowed.',
};

/** Fixed pages: no instance id, name, tenant, connection state, or anything caller-supplied. */
function callbackPage(title: string, body: string): string {
  const style = 'body{font-family:system-ui,sans-serif;margin:3rem auto;max-width:32rem;padding:0 1rem;color:#222}';
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex">',
    `<title>${title}</title><style>${style}</style></head>`,
    `<body><h1>${title}</h1><p>${body}</p></body></html>`,
  ].join('');
}

function callbackFailure(c: Context<{ Variables: AppVariables }>, reason: CallbackFailure): Response {
  c.header('Cache-Control', 'no-store');
  oauthLog.warn('Slack OAuth callback refused', { reason });
  return c.html(callbackPage('Slack sign-in failed', CALLBACK_FAILURE_TEXT[reason]), 400);
}

/**
 * The tenant context the `start` behind this nonce recorded, WITHOUT consuming
 * the record: it is taken and parked straight back under the same handle (the
 * store's own transition path, as the result endpoint uses). `null` when the
 * nonce names nothing, or names a flow started without a tenant context.
 *
 * Re-arming the store TTL is harmless here — a pending record carries its own
 * `expiresAt`, which the callback checks after it consumes the record.
 */
function peekPendingTenant(nonce: string): TenantAuthContext | null {
  const record = oauthStore.take(nonce);
  if (!record) return null;
  oauthStore.transition(nonce, record);
  return record.kind === 'pending' ? record.tenantContext : null;
}

/**
 * Read the deployment's Slack app settings for a callback — as the tenant that
 * wrote them.
 *
 * The five keys are deployment-wide, but `PUT /settings` seals a secret under
 * the writing tenant's scope, and an unopenable sealed value reads back as
 * absent (fail closed). The public callback carries no credential and so no
 * scope of its own, so without this the keys a tenant-scoped operator
 * configured would be invisible here and every install would land on the
 * failure page while `GET /slack/app` still reported `configured: true`.
 *
 * The scope comes from the pending record the state names — never from the
 * request — which is the same rule the install itself follows. A flow started
 * without a tenant context (legacy, unscoped) is read unscoped, exactly as
 * before. `null` means the scope itself was refused: fail closed, and say so
 * in the log rather than quietly reading the deployment fallback.
 */
async function resolveSlackAppForCallback(
  c: Context<{ Variables: AppVariables }>,
  state: string,
): Promise<SlackAppResolution | null> {
  const settings = c.get('services').settings;
  const nonce = readStateNonce(state);
  const tenantContext = nonce ? peekPendingTenant(nonce) : null;
  if (!tenantContext) return resolveSlackApp(settings);
  try {
    return await runInTenantScope(c.get('db'), tenantContext, () => resolveSlackApp(settings));
  } catch (error) {
    oauthLog.error('Slack app settings unreadable in the flow tenant scope', {
      tenantId: tenantContext.tenantId,
      error: redactSlackTokens(error instanceof Error ? error.message : 'Unknown error'),
    });
    return null;
  }
}

interface CallbackDeps {
  services: Services;
  channelRegistry: ChannelRegistry | null;
  db: Database;
}

function slackError(code: string, message: string): string {
  return `${code}: ${message}`;
}

type SlackGrantTokens =
  | { ok: true; botToken?: string; userToken?: string }
  | { ok: false; code: string; message: string };

/**
 * The tokens a grant contributes, by the mode the flow asked for. Bot mode
 * needs the workspace bot token. User mode needs the person's token and takes
 * nothing else: its authorize requested no bot scope, and a bot token Slack
 * returns anyway is dropped, so a personal install never stores a bot.
 */
function grantTokens(mode: SlackOAuthMode, access: SlackOAuthAccess): SlackGrantTokens {
  if (mode === 'bot') {
    return access.access_token
      ? { ok: true, botToken: access.access_token }
      : { ok: false, code: 'SLACK_OAUTH_EXCHANGE_FAILED', message: 'Slack returned no workspace bot token' };
  }
  const userToken = access.authed_user.access_token;
  return userToken
    ? { ok: true, userToken }
    : {
        ok: false,
        code: 'SLACK_USER_TOKEN_MISSING',
        message: 'Slack granted no user token; the user scopes were not authorized',
      };
}

/** Exchange the code, then upsert + connect under the pending record's tenant. */
async function completeSlackInstall(
  deps: CallbackDeps,
  pending: SlackOAuthPending,
  code: string,
  credentials: SlackAppCredentials,
): Promise<SlackOAuthOutcome> {
  const tenantId = pending.tenantContext?.tenantId ?? null;

  let access: SlackOAuthAccess;
  try {
    access = await exchangeSlackOAuthCode({
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      code,
      redirectUri: credentials.redirectUrl,
    });
  } catch (error) {
    const reason = error instanceof SlackOAuthExchangeError ? error.slackError : 'request_failed';
    return errorOutcome(tenantId, 'SLACK_OAUTH_EXCHANGE_FAILED', `Slack refused the code exchange (${reason})`);
  }

  if (access.is_enterprise_install || access.enterprise) {
    return errorOutcome(
      tenantId,
      'SLACK_ENTERPRISE_INSTALL_UNSUPPORTED',
      'Enterprise Grid (org-wide) installs are not supported; install into a single workspace',
    );
  }
  const teamId = access.team?.id;
  if (!teamId) {
    return errorOutcome(tenantId, 'SLACK_OAUTH_EXCHANGE_FAILED', 'Slack returned no workspace id');
  }
  const tokens = grantTokens(pending.mode, access);
  if (!tokens.ok) return errorOutcome(tenantId, tokens.code, tokens.message);

  // User mode names the instance after the person, looked up with their own
  // token — the only token that mode holds.
  const displayName = tokens.userToken
    ? await fetchSlackUserDisplayName(tokens.userToken, access.authed_user.id)
    : undefined;

  const input: UpsertSlackOAuthInstanceInput = {
    mode: pending.mode,
    teamId,
    teamName: access.team?.name,
    userId: access.authed_user.id,
    displayName,
    botToken: tokens.botToken,
    userToken: tokens.userToken,
    appToken: credentials.appToken,
    signingSecret: credentials.signingSecret,
  };
  const work = () =>
    upsertSlackOAuthInstance({ instances: deps.services.instances, channelRegistry: deps.channelRegistry }, input);

  let result: UpsertSlackOAuthInstanceResult;
  try {
    result = pending.tenantContext ? await runInTenantScope(deps.db, pending.tenantContext, work) : await work();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    oauthLog.error('Slack OAuth install failed', { teamId, mode: pending.mode, error: redactSlackTokens(message) });
    return errorOutcome(tenantId, 'SLACK_INSTALL_FAILED', slackError('install', message));
  }

  if (result.connectError) {
    return errorOutcome(
      tenantId,
      'SLACK_CONNECT_FAILED',
      `Instance ${result.instanceId} was saved but failed to connect: ${result.connectError}`,
    );
  }
  return { kind: 'outcome', tenantId, status: 'done', instanceId: result.instanceId };
}

function finishCallback(
  c: Context<{ Variables: AppVariables }>,
  pending: SlackOAuthPending,
  nonce: string,
  outcome: SlackOAuthOutcome,
): Response {
  c.header('Cache-Control', 'no-store');
  if (pending.entry === 'cli') {
    return outcome.status === 'done'
      ? c.html(callbackPage('Slack connected', 'You can close this tab and return to your terminal.'))
      : c.html(callbackPage('Slack sign-in did not complete', 'Return to your terminal for details.'));
  }
  const returnTo = pending.returnTo ?? '/';
  return c.redirect(`${returnTo}?slack=${encodeURIComponent(nonce)}`, 302);
}

/**
 * Handler for `GET /api/v2/slack/oauth/callback`. Mounted by `app.ts` BEFORE
 * `protectedApp` behind `webhookIngressRateLimitMiddleware`; declared
 * `public-by-contract` in `tenancy/route-ownership.ts`.
 *
 * Order matters: read the app keys in the flow's own tenant scope (the only
 * step that needs the nonce the state names before its signature is checked),
 * verify the HMAC, take the pending record, and only THEN talk to Slack — a
 * replayed, forged, expired or unknown state never causes a network call or a
 * row.
 */
export async function slackOAuthCallback(c: Context<{ Variables: AppVariables }>): Promise<Response> {
  const query = callbackQuerySchema.safeParse(c.req.query());
  if (!query.success || !query.data.state) return callbackFailure(c, 'invalid_request');

  const services = c.get('services');
  const app = await resolveSlackAppForCallback(c, query.data.state);
  if (!app?.ok) return callbackFailure(c, 'not_configured');

  const nonce = verifyState(query.data.state, app.credentials.clientSecret);
  if (!nonce) return callbackFailure(c, 'invalid_state');

  const record = oauthStore.take(nonce);
  if (!record) return callbackFailure(c, 'invalid_state');
  if (record.kind !== 'pending') {
    // A completed flow replayed from browser history: keep the outcome for
    // the authenticated result endpoint and refuse the replay.
    oauthStore.transition(nonce, record);
    return callbackFailure(c, 'invalid_state');
  }
  if (record.expiresAt < Date.now()) return callbackFailure(c, 'invalid_state');
  if (record.returnTo !== null && !isAllowedReturnTo(record.returnTo, app.credentials.publicOrigin)) {
    return callbackFailure(c, 'invalid_return');
  }

  const tenantId = record.tenantContext?.tenantId ?? null;
  let outcome: SlackOAuthOutcome;
  if (query.data.error) {
    const denied = query.data.error === 'access_denied';
    outcome = errorOutcome(
      tenantId,
      denied ? 'SLACK_ACCESS_DENIED' : 'SLACK_OAUTH_ERROR',
      denied ? 'The Slack authorization was cancelled' : `Slack reported: ${query.data.error}`,
    );
  } else if (!query.data.code) {
    outcome = errorOutcome(tenantId, 'SLACK_OAUTH_ERROR', 'Slack returned neither a code nor an error');
  } else {
    outcome = await completeSlackInstall(
      { services, channelRegistry: c.get('channelRegistry'), db: c.get('db') },
      record,
      query.data.code,
      app.credentials,
    );
  }

  if (!oauthStore.transition(nonce, outcome)) {
    oauthLog.warn('Slack OAuth outcome could not be parked; the flow outlived its record', { status: outcome.status });
  }
  oauthLog.info('Slack OAuth callback finished', {
    status: outcome.status,
    code: outcome.status === 'error' ? outcome.code : undefined,
    entry: record.entry,
    mode: record.mode,
  });
  return finishCallback(c, record, nonce, outcome);
}
