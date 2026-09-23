/**
 * User-token auth mode: token resolution, DM/mpim classification (#889).
 */

import { describe, expect, it } from 'bun:test';
import { extractMessageMeta, shouldSkipMessage } from '../handlers/messages';
import {
  BOT_EVENTS,
  REQUIRED_BOT_SCOPES,
  REVOCATION_EVENTS,
  USER_EVENTS,
  USER_SCOPES,
  buildSlackManifest,
  slackAuthorizeScopes,
} from '../manifest';

describe('extractMessageMeta — DM classification', () => {
  const base = { channel: 'C1', ts: '1.1', user: 'U1' };

  it('treats an im as a direct conversation', () => {
    const meta = extractMessageMeta({ ...base, channel_type: 'im' });
    expect(meta.isDm).toBe(true);
    expect(meta.isMpim).toBe(false);
  });

  it('treats an mpim as a direct conversation too', () => {
    // Before #889 only 'im' counted, so a multi-person DM was filed as a channel.
    const meta = extractMessageMeta({ ...base, channel_type: 'mpim' });
    expect(meta.isDm).toBe(true);
    expect(meta.isMpim).toBe(true);
  });

  it('leaves a public channel as not-a-DM', () => {
    const meta = extractMessageMeta({ ...base, channel_type: 'channel' });
    expect(meta.isDm).toBe(false);
    expect(meta.isMpim).toBe(false);
  });
});

describe('buildSlackManifest — user scopes', () => {
  it('omits user scopes and user events by default', () => {
    const manifest = buildSlackManifest();
    expect(manifest.oauth_config.scopes.user).toBeUndefined();
    expect(manifest.settings.event_subscriptions.user_events).toBeUndefined();
  });

  it('includes search:read only in the user scope set', () => {
    // search.messages has no bot equivalent — asking for it as a bot scope
    // would be rejected by Slack.
    const manifest = buildSlackManifest({ includeUserScopes: true });
    expect(manifest.oauth_config.scopes.user).toContain('search:read');
    expect(manifest.oauth_config.scopes.bot).not.toContain('search:read');
  });

  it('requests files:write so user-mode media uploads work (files.uploadV2)', () => {
    // In user mode sendMediaContent uploads via the xoxp acting client, which
    // needs files:write — without it every user-mode media send fails with
    // missing_scope. Bot mode already has it via REQUIRED_BOT_SCOPES.
    const manifest = buildSlackManifest({ includeUserScopes: true });
    expect(manifest.oauth_config.scopes.user).toContain('files:write');
  });

  it('requests files:read so user-mode inbound file downloads work (url_private)', () => {
    // An inbound attachment is fetched from files.slack.com with an
    // Authorization header. In user mode the bot user need not be a member of
    // the channel the file was posted in, so the bot token 403s and the xoxp
    // token does the download — which it cannot do without files:read.
    const manifest = buildSlackManifest({ includeUserScopes: true });
    expect(manifest.oauth_config.scopes.user).toContain('files:read');
    expect(slackAuthorizeScopes().user_scope.split(',')).toContain('files:read');
  });

  it('requests im:write so DMs can be opened, and subscribes to user events', () => {
    const manifest = buildSlackManifest({ includeUserScopes: true });
    expect(manifest.oauth_config.scopes.user).toContain('im:write');
    expect(manifest.settings.event_subscriptions.user_events).toContain('message.im');
    expect(manifest.settings.event_subscriptions.user_events).toContain('message.mpim');
  });

  it('keeps socket mode on — a user token cannot open a realtime connection', () => {
    // The transport is unchanged in user mode; only the vantage point moves.
    const manifest = buildSlackManifest({ includeUserScopes: true });
    expect(manifest.settings.socket_mode_enabled).toBe(true);
  });
});

describe('buildSlackManifest — one-click OAuth install (slack-personal-oauth)', () => {
  const CALLBACK = 'https://omni.example.com/api/v2/slack/oauth/callback';

  it('emits redirect_urls, user scopes and the revocation events for the deployment app', () => {
    const manifest = buildSlackManifest({ redirectUrls: [CALLBACK], includeUserScopes: true });
    expect(manifest.oauth_config.redirect_urls).toEqual([CALLBACK]);
    expect(manifest.oauth_config.scopes.user).toEqual([...USER_SCOPES]);
    expect(manifest.settings.event_subscriptions.user_events).toEqual([...USER_EVENTS]);
    expect(manifest.settings.event_subscriptions.bot_events).toContain('tokens_revoked');
    expect(manifest.settings.event_subscriptions.bot_events).toContain('app_uninstalled');
  });

  it('omits redirect_urls when none are given — the manual-app manifest is unchanged', () => {
    expect(buildSlackManifest().oauth_config.redirect_urls).toBeUndefined();
    expect(buildSlackManifest({ redirectUrls: [] }).oauth_config.redirect_urls).toBeUndefined();
  });

  it('subscribes to both revocation events as bot events', () => {
    expect(REVOCATION_EVENTS).toEqual(['tokens_revoked', 'app_uninstalled']);
    for (const event of REVOCATION_EVENTS) {
      expect(BOT_EVENTS).toContain(event);
    }
  });

  it('slackAuthorizeScopes() comma-joins the bot and user scope sets for the authorize URL', () => {
    const { scope, user_scope } = slackAuthorizeScopes();
    expect(scope.split(',')).toEqual([...REQUIRED_BOT_SCOPES]);
    expect(user_scope.split(',')).toEqual([...USER_SCOPES]);
    expect(scope).not.toContain(' ');
    expect(user_scope).toContain('search:read');
  });
});

describe('self-filtering in user mode', () => {
  // Verified live against Slack (#889): a message posted with a user token
  // carries a bot_id (the app's) even though `user` is the human. Our own
  // outbound is therefore already skipped by the bot_id line — but a message
  // the human types HIMSELF has no bot_id, so the acting user id must be in
  // the self set or the agent answers in his own conversation.
  const BOT = 'U0BOT';
  const HUMAN = 'U05JY99CNSC';

  it('skips what we posted ourselves — a user-token post carries bot_id', () => {
    expect(shouldSkipMessage({ user: HUMAN, bot_id: 'B123' }, [BOT, HUMAN])).toBe(true);
  });

  it("skips the human's OWN typing in user mode (no bot_id)", () => {
    expect(shouldSkipMessage({ user: HUMAN }, [BOT, HUMAN])).toBe(true);
  });

  it('would NOT skip it with only the bot id — the bug this guards', () => {
    expect(shouldSkipMessage({ user: HUMAN }, [BOT])).toBe(false);
  });

  it('still processes a real counterpart', () => {
    expect(shouldSkipMessage({ user: 'U05J8EZQ1S7' }, [BOT, HUMAN])).toBe(false);
  });
});
