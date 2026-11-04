/**
 * Slack OAuth install service (wish: slack-personal-oauth, Group 4).
 *
 * Two jobs, both behind the routes in `routes/v2/slack.ts`:
 *
 *   * `resolveSlackAppConfig` — read the deployment's Slack app settings
 *     (`SLACK_APP_SETTINGS`, settings row first, documented env fallback
 *     second) and report what is missing, plus the derived redirect URL and the
 *     pre-filled manifest link the operator creates the app from. The manifest
 *     link needs only `server.public_url`, because the operator needs it BEFORE
 *     the app (and its credentials) exists.
 *   * `upsertSlackOAuthInstance` — turn a completed `oauth.v2.access` exchange
 *     into an instance row keyed by (workspace, user) — workspace alone in bot
 *     mode — and connect it through the channel registry with the same options
 *     `POST /instances/:id/connect` builds. Tokens are written ONLY through
 *     `services.instances.createSlackOAuth` / `.update`, which is where credential
 *     sealing lives; this module never issues an insert or update of its own.
 *
 * Nothing here reads the Hono context or the request: the callback route
 * resolves the tenant from its server-side pending record and runs this under
 * `runInTenantScope` when that record carries a tenant context.
 */

import type { ChannelPlugin, ChannelRegistry } from '@omni/channel-sdk';
import { buildSlackManifest } from '@omni/channel-slack';
import { createLogger } from '@omni/core';
import type { Instance, NewInstance } from '@omni/db';
import { SLACK_APP_SETTINGS, SLACK_OAUTH_CALLBACK_PATH } from '../constants/slack-app';
import { type SlackOAuthMode, redactSlackTokens } from '../lib/slack-oauth';
import type { InstanceService } from './instances';
import type { SettingsService } from './settings';

const log = createLogger('api:slack-oauth');

// ---------------------------------------------------------------------------
// App configuration
// ---------------------------------------------------------------------------

/** The `GET /slack/app` shape: nothing secret, nothing tenant-specific. */
export interface SlackAppConfig {
  configured: boolean;
  /** Settings keys that are unset (or, for `server.public_url`, not an HTTPS URL). */
  missing: string[];
  redirectUrl: string | null;
  manifestUrl: string | null;
}

/** Everything the OAuth flow needs; present only when every key resolved. */
export interface SlackAppCredentials {
  clientId: string;
  clientSecret: string;
  signingSecret: string;
  appToken: string;
  /** `server.public_url` with any trailing slash removed. */
  publicUrl: string;
  /** `URL.origin` of `publicUrl`, the only origin an absolute `returnTo` may name. */
  publicOrigin: string;
  redirectUrl: string;
}

export type SlackAppResolution =
  | { ok: true; credentials: SlackAppCredentials; config: SlackAppConfig }
  | { ok: false; config: SlackAppConfig };

type SettingsReader = Pick<SettingsService, 'getSecret' | 'getString'>;

/**
 * Public URL is usable when it parses AND is HTTPS; `redirectUrl` keeps any
 * path prefix it carries.
 *
 * Slack refuses a non-HTTPS `redirect_uri`, so an `http://` origin can never
 * complete an install: reporting it as configured would hand the operator a
 * manifest link and an authorize URL that Slack rejects at the exchange
 * (`bad_redirect_uri`). It is reported as an unset `server.public_url` instead.
 */
function parsePublicUrl(raw: string | undefined): { publicUrl: string; publicOrigin: string } | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/\/+$/, '');
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:') return null;
    return { publicUrl: trimmed, publicOrigin: url.origin };
  } catch {
    return null;
  }
}

function buildSlackManifestUrl(redirectUrl: string): string {
  const manifest = buildSlackManifest({ redirectUrls: [redirectUrl], includeUserScopes: true });
  const params = new URLSearchParams({ new_app: '1', manifest_json: JSON.stringify(manifest) });
  return `https://api.slack.com/apps?${params.toString()}`;
}

/**
 * Resolve the five settings behind `SLACK_APP_SETTINGS`. The three secrets go
 * through `getSecret`, the two identifiers through `getString`; each falls
 * back to its documented env variable when the settings row is empty.
 */
export async function resolveSlackApp(settings: SettingsReader): Promise<SlackAppResolution> {
  const s = SLACK_APP_SETTINGS;
  const [clientId, clientSecret, signingSecret, appToken, rawPublicUrl] = await Promise.all([
    settings.getString(s.clientId.key, s.clientId.env),
    settings.getSecret(s.clientSecret.key, s.clientSecret.env),
    settings.getSecret(s.signingSecret.key, s.signingSecret.env),
    settings.getSecret(s.appToken.key, s.appToken.env),
    settings.getString(s.publicUrl.key, s.publicUrl.env),
  ]);

  const publicUrl = parsePublicUrl(rawPublicUrl);
  const missing: string[] = [];
  if (!clientId) missing.push(s.clientId.key);
  if (!clientSecret) missing.push(s.clientSecret.key);
  if (!signingSecret) missing.push(s.signingSecret.key);
  if (!appToken) missing.push(s.appToken.key);
  if (!publicUrl) missing.push(s.publicUrl.key);

  const redirectUrl = publicUrl ? `${publicUrl.publicUrl}${SLACK_OAUTH_CALLBACK_PATH}` : null;
  const config: SlackAppConfig = {
    configured: missing.length === 0,
    missing,
    redirectUrl,
    manifestUrl: redirectUrl ? buildSlackManifestUrl(redirectUrl) : null,
  };

  if (!clientId || !clientSecret || !signingSecret || !appToken || !publicUrl || !redirectUrl) {
    return { ok: false, config };
  }
  return {
    ok: true,
    config,
    credentials: {
      clientId,
      clientSecret,
      signingSecret,
      appToken,
      publicUrl: publicUrl.publicUrl,
      publicOrigin: publicUrl.publicOrigin,
      redirectUrl,
    },
  };
}

/** `{ configured, missing, redirectUrl, manifestUrl }` — the `GET /slack/app` body. */
export async function resolveSlackAppConfig(settings: SettingsReader): Promise<SlackAppConfig> {
  return (await resolveSlackApp(settings)).config;
}

// ---------------------------------------------------------------------------
// returnTo allowlist
// ---------------------------------------------------------------------------

/**
 * A `returnTo` is accepted when it is a path beginning with a single `/`
 * (`//host` and `/\host` are protocol-relative in browsers and refused) or an
 * absolute URL whose `URL.origin` equals the public origin. It may carry no
 * query or fragment, because the redirect appends `?slack=<nonce>` and the
 * callback contract says that is the whole query string. An absolute URL is
 * refused outright when `server.public_url` is unset — there is no origin to
 * compare against, and "starts with" comparisons are exactly the bug class
 * this rule exists to avoid.
 */
export function isAllowedReturnTo(returnTo: string, publicOrigin: string | null): boolean {
  if (returnTo.length === 0 || returnTo.length > 2048) return false;
  if (returnTo.includes('?') || returnTo.includes('#')) return false;
  if (/\s|\p{Cc}/u.test(returnTo)) return false;
  if (returnTo.startsWith('/')) {
    const second = returnTo.charAt(1);
    return second !== '/' && second !== '\\';
  }
  if (!publicOrigin) return false;
  let url: URL;
  try {
    url = new URL(returnTo);
  } catch {
    return false;
  }
  return url.origin === publicOrigin && url.search === '' && url.hash === '';
}

// ---------------------------------------------------------------------------
// Instance upsert + connect
// ---------------------------------------------------------------------------

export interface UpsertSlackOAuthInstanceInput {
  mode: SlackOAuthMode;
  teamId: string;
  teamName?: string;
  /** `authed_user.id` — the person who clicked Authorize. */
  userId: string;
  /** Resolved display name; falls back to the user id in the instance name. */
  displayName?: string;
  /** Workspace bot token (xoxb-…); required in bot mode, ignored in user mode, which installs no bot. */
  botToken?: string;
  /** Personal token (xoxp-…); required in user mode, ignored in bot mode. */
  userToken?: string;
  appToken: string;
  signingSecret: string;
}

export interface UpsertSlackOAuthInstanceDeps {
  instances: Pick<InstanceService, 'findBySlackIdentity' | 'createSlackOAuth' | 'update'>;
  channelRegistry: ChannelRegistry | null | undefined;
}

export interface UpsertSlackOAuthInstanceResult {
  instanceId: string;
  created: boolean;
  /** Set when the row was written but the plugin refused to connect. */
  connectError?: string;
}

const NAME_MAX = 200;
const NAME_SUFFIX_ATTEMPTS = 20;

/** The identity the #1235 unique indexes key on: the user in user mode, none (workspace bot) in bot mode. */
function findExisting(
  instances: UpsertSlackOAuthInstanceDeps['instances'],
  input: UpsertSlackOAuthInstanceInput,
): Promise<Instance | undefined> {
  return instances.findBySlackIdentity(input.teamId, input.mode === 'user' ? input.userId : null);
}

function baseName(input: UpsertSlackOAuthInstanceInput): string {
  const team = (input.teamName ?? input.teamId).trim() || input.teamId;
  const name =
    input.mode === 'user'
      ? `Slack · ${(input.displayName ?? input.userId).trim() || input.userId} @ ${team}`
      : `Slack · ${team} (bot)`;
  return name.length > NAME_MAX ? name.slice(0, NAME_MAX) : name;
}

/** Postgres `unique_violation` on `instances.name`, surfaced by postgres-js as `code`. */
function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === '23505') return true;
  const message = error instanceof Error ? error.message : '';
  return /duplicate key|unique constraint/i.test(message);
}

/**
 * Each mode writes only its own token and clears the other, so re-authorizing
 * a personal instance also drops a bot token an earlier install left on it.
 */
function credentialColumns(input: UpsertSlackOAuthInstanceInput): Partial<NewInstance> {
  return {
    slackBotToken: input.mode === 'bot' ? (input.botToken ?? null) : null,
    slackUserToken: input.mode === 'user' ? (input.userToken ?? null) : null,
    slackAuthMode: input.mode,
    slackAppToken: input.appToken,
    slackSigningSecret: input.signingSecret,
    slackTeamId: input.teamId,
    slackUserId: input.mode === 'user' ? input.userId : null,
    slackConnectionMethod: 'oauth',
    isActive: true,
  };
}

/** Null when a concurrent callback created the identity's row first. */
async function createWithUniqueName(
  instances: UpsertSlackOAuthInstanceDeps['instances'],
  input: UpsertSlackOAuthInstanceInput,
): Promise<Instance | null> {
  const base = baseName(input);
  let lastError: unknown;
  for (let attempt = 1; attempt <= NAME_SUFFIX_ATTEMPTS; attempt++) {
    const name = attempt === 1 ? base : `${base} ${attempt}`;
    try {
      return await instances.createSlackOAuth({
        name,
        channel: 'slack',
        profileName: input.mode === 'user' ? (input.displayName ?? null) : (input.teamName ?? null),
        ...credentialColumns(input),
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('slack-oauth: could not pick a unique instance name');
}

/** Per-instance Slack settings kept in `profileMetadata` (#889), applied exactly as the connect route does. */
function applyProfileMetadata(
  options: Record<string, unknown>,
  metadata: Record<string, unknown> | null | undefined,
): void {
  if (!metadata) return;
  if (metadata.mode) options.mode = metadata.mode;
  if (metadata.httpPort) options.httpPort = metadata.httpPort;
  if (metadata.replyToMode) options.replyToMode = metadata.replyToMode;
  if (metadata.streamMode) options.streamMode = metadata.streamMode;
  if (metadata.dmPolicy) options.dmPolicy = metadata.dmPolicy;
  if (metadata.dmAllowlist) options.dmAllowlist = metadata.dmAllowlist;
}

/**
 * The options `POST /instances/:id/connect` hands the plugin for a Slack
 * instance: `token` + `botToken` (both, as the route sets them) in bot mode,
 * `userToken` in user mode, `authMode`, `appToken`, `signingSecret`, plus the
 * per-instance connection settings from `profileMetadata`.
 */
function buildConnectOptions(input: UpsertSlackOAuthInstanceInput, row: Instance): Record<string, unknown> {
  const options: Record<string, unknown> = { forceNewQr: false };
  applyProfileMetadata(options, row.profileMetadata as Record<string, unknown> | null | undefined);
  if (input.mode === 'bot' && input.botToken) {
    options.token = input.botToken;
    options.botToken = input.botToken;
  }
  if (input.mode === 'user' && input.userToken) options.userToken = input.userToken;
  options.authMode = input.mode;
  options.appToken = input.appToken;
  options.signingSecret = input.signingSecret;
  return options;
}

function resolvePlugin(registry: ChannelRegistry | null | undefined): ChannelPlugin {
  const plugin = registry?.get('slack');
  if (!plugin) throw new Error('Slack plugin not registered');
  return plugin;
}

/**
 * Create or update the instance for this authorization and connect it. On an
 * existing row the plugin's `connect` runs again so cached acting clients are
 * rebuilt for the fresh tokens (design D11 / wish Decision 10).
 */
export async function upsertSlackOAuthInstance(
  deps: UpsertSlackOAuthInstanceDeps,
  input: UpsertSlackOAuthInstanceInput,
): Promise<UpsertSlackOAuthInstanceResult> {
  const plugin = resolvePlugin(deps.channelRegistry);
  // Insert is ON CONFLICT DO NOTHING on the identity index, so a callback that
  // loses a race to a concurrent one gets null and updates the winner's row.
  const existing = await findExisting(deps.instances, input);
  let row = existing ? null : await createWithUniqueName(deps.instances, input);
  const created = row !== null;
  if (!row) {
    const current = existing ?? (await findExisting(deps.instances, input));
    if (!current) throw new Error('slack-oauth: identity conflict but no row found');
    row = await deps.instances.update(current.id, credentialColumns(input));
  }

  log.info(created ? 'Slack OAuth instance created' : 'Slack OAuth instance re-authorized', {
    instanceId: row.id,
    teamId: input.teamId,
    mode: input.mode,
  });

  try {
    await plugin.connect(row.id, { instanceId: row.id, credentials: {}, options: buildConnectOptions(input, row) });
  } catch (error) {
    // Redacted at the log site with the same rule the parked outcome uses: a
    // plugin error can quote the token it was handed.
    const connectError = redactSlackTokens(error instanceof Error ? error.message : 'Unknown error');
    log.error('Slack OAuth instance failed to connect', { instanceId: row.id, error: connectError });
    return { instanceId: row.id, created, connectError };
  }

  return { instanceId: row.id, created };
}
