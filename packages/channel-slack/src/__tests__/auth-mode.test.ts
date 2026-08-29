/**
 * User-token auth mode: token resolution, DM/mpim classification (#889).
 */

import { describe, expect, it } from 'bun:test';
import { extractMessageMeta, shouldSkipMessage } from '../handlers/messages';
import { buildSlackManifest } from '../manifest';

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
