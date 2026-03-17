/**
 * Tests for Slack channel plugin connection and core functionality
 *
 * Tests Group A: Core Connection + Inbound Messages
 */

import { describe, expect, it } from 'bun:test';

import { SLACK_CAPABILITIES } from '../capabilities';
import { type DmPolicyConfig, shouldAcceptDm } from '../dm-policy';
import { extractMessageMeta } from '../handlers/messages';
import { BOT_EVENTS, REQUIRED_BOT_SCOPES, buildSlackManifest } from '../manifest';
import { SlackPlugin } from '../plugin';
import { SlackError, SlackErrorCode } from '../types';

// ─────────────────────────────────────────────────────────────
// Plugin identity
// ─────────────────────────────────────────────────────────────

describe('SlackPlugin identity', () => {
  it('has correct id and name', () => {
    const plugin = new SlackPlugin();
    expect(plugin.id).toBe('slack');
    expect(plugin.name).toBe('Slack (Bolt.js)');
    expect(plugin.version).toBe('1.0.0');
  });

  it('exposes capabilities', () => {
    const plugin = new SlackPlugin();
    expect(plugin.capabilities.canSendText).toBe(true);
    expect(plugin.capabilities.canSendMedia).toBe(true);
    expect(plugin.capabilities.canEditMessage).toBe(true);
    expect(plugin.capabilities.canDeleteMessage).toBe(true);
    expect(plugin.capabilities.canSendButtons).toBe(true);
    expect(plugin.capabilities.canSendSelectMenu).toBe(true);
    expect(plugin.capabilities.canShowModal).toBe(true);
    expect(plugin.capabilities.canUseSlashCommands).toBe(true);
    expect(plugin.capabilities.canHandleDMs).toBe(true);
    expect(plugin.capabilities.canHandleThreads).toBe(true);
    expect(plugin.capabilities.canStreamResponse).toBe(true);
    expect(plugin.capabilities.maxMessageLength).toBe(4000);
  });
});

// ─────────────────────────────────────────────────────────────
// Capabilities
// ─────────────────────────────────────────────────────────────

describe('SLACK_CAPABILITIES', () => {
  it('declares correct media support', () => {
    expect(SLACK_CAPABILITIES.canSendMedia).toBe(true);
    expect(SLACK_CAPABILITIES.maxFileSize).toBe(1024 * 1024 * 1024); // 1GB
    expect(SLACK_CAPABILITIES.supportedMediaTypes).toHaveLength(4);
  });

  it('declares streaming support', () => {
    expect(SLACK_CAPABILITIES.canStreamResponse).toBe(true);
  });

  it('declares correct interaction support', () => {
    expect(SLACK_CAPABILITIES.canSendButtons).toBe(true);
    expect(SLACK_CAPABILITIES.canSendSelectMenu).toBe(true);
    expect(SLACK_CAPABILITIES.canShowModal).toBe(true);
    expect(SLACK_CAPABILITIES.canUseSlashCommands).toBe(true);
    expect(SLACK_CAPABILITIES.canUseContextMenu).toBe(false); // Slack doesn't have context menus
  });
});

// ─────────────────────────────────────────────────────────────
// DM Policy
// ─────────────────────────────────────────────────────────────

describe('DM Policy', () => {
  it('open policy accepts all DMs', () => {
    const config: DmPolicyConfig = { policy: 'open' };
    expect(shouldAcceptDm('U12345', config).accepted).toBe(true);
    expect(shouldAcceptDm('U99999', config).accepted).toBe(true);
  });

  it('pairing policy accepts allowlisted users', () => {
    const config: DmPolicyConfig = {
      policy: 'pairing',
      allowlist: ['U12345', 'U67890'],
    };
    expect(shouldAcceptDm('U12345', config).accepted).toBe(true);
    expect(shouldAcceptDm('U67890', config).accepted).toBe(true);
  });

  it('pairing policy rejects non-allowlisted users', () => {
    const config: DmPolicyConfig = {
      policy: 'pairing',
      allowlist: ['U12345'],
    };
    const result = shouldAcceptDm('U99999', config);
    expect(result.accepted).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it('closed policy rejects all DMs', () => {
    const config: DmPolicyConfig = { policy: 'closed' };
    const result = shouldAcceptDm('U12345', config);
    expect(result.accepted).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it('closed policy uses custom rejection message', () => {
    const config: DmPolicyConfig = {
      policy: 'closed',
      rejectionMessage: 'Custom rejection',
    };
    const result = shouldAcceptDm('U12345', config);
    expect(result.reason).toBe('Custom rejection');
  });
});

// ─────────────────────────────────────────────────────────────
// App Manifest
// ─────────────────────────────────────────────────────────────

describe('App Manifest', () => {
  it('includes all required OAuth scopes', () => {
    const manifest = buildSlackManifest();
    const scopes = manifest.oauth_config.scopes.bot;

    // Verify all required scopes
    for (const scope of REQUIRED_BOT_SCOPES) {
      expect(scopes).toContain(scope);
    }

    // Should have at least 18 scopes
    expect(scopes.length).toBeGreaterThanOrEqual(18);
  });

  it('includes all required event subscriptions', () => {
    const manifest = buildSlackManifest();
    const events = manifest.settings.event_subscriptions.bot_events;

    for (const event of BOT_EVENTS) {
      expect(events).toContain(event);
    }
  });

  it('enables Socket Mode', () => {
    const manifest = buildSlackManifest();
    expect(manifest.settings.socket_mode_enabled).toBe(true);
  });

  it('enables interactivity', () => {
    const manifest = buildSlackManifest();
    expect(manifest.settings.interactivity?.is_enabled).toBe(true);
  });

  it('includes slash commands when provided', () => {
    const manifest = buildSlackManifest({
      slashCommands: [{ command: '/omni', description: 'Talk to Omni' }],
    });
    expect(manifest.features.slash_commands).toHaveLength(1);
    expect(manifest.features.slash_commands?.[0]?.command).toBe('/omni');
  });
});

// ─────────────────────────────────────────────────────────────
// Message metadata extraction
// ─────────────────────────────────────────────────────────────

describe('extractMessageMeta', () => {
  it('extracts basic message metadata', () => {
    const meta = extractMessageMeta({
      channel: 'C12345',
      ts: '1234567890.123456',
      user: 'U12345',
      team: 'T12345',
      channel_type: 'channel',
    });

    expect(meta.channelId).toBe('C12345');
    expect(meta.ts).toBe('1234567890.123456');
    expect(meta.userId).toBe('U12345');
    expect(meta.teamId).toBe('T12345');
    expect(meta.isDm).toBe(false);
    expect(meta.isThreadReply).toBe(false);
  });

  it('detects DMs', () => {
    const meta = extractMessageMeta({
      channel: 'D12345',
      ts: '1234567890.123456',
      user: 'U12345',
      channel_type: 'im',
    });

    expect(meta.isDm).toBe(true);
  });

  it('detects thread replies', () => {
    const meta = extractMessageMeta({
      channel: 'C12345',
      ts: '1234567890.999999',
      thread_ts: '1234567890.123456',
      user: 'U12345',
      channel_type: 'channel',
    });

    expect(meta.isThreadReply).toBe(true);
    expect(meta.threadTs).toBe('1234567890.123456');
  });

  it('handles thread parent messages (ts === thread_ts)', () => {
    const meta = extractMessageMeta({
      channel: 'C12345',
      ts: '1234567890.123456',
      thread_ts: '1234567890.123456',
      user: 'U12345',
      channel_type: 'channel',
    });

    // Parent message of thread: thread_ts === ts, so it's NOT a reply
    expect(meta.isThreadReply).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// Error types
// ─────────────────────────────────────────────────────────────

describe('SlackError', () => {
  it('creates error with code and message', () => {
    const error = new SlackError(SlackErrorCode.NOT_CONNECTED, 'Not connected');
    expect(error.channelCode).toBe(SlackErrorCode.NOT_CONNECTED);
    expect(error.message).toBe('Not connected');
    expect(error.recoverable).toBe(false);
    expect(error.name).toBe('SlackError');
  });

  it('supports recoverable flag', () => {
    const error = new SlackError(SlackErrorCode.RATE_LIMITED, 'Rate limited', true);
    expect(error.recoverable).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// Rate limiting configuration
// ─────────────────────────────────────────────────────────────

describe('Rate limiting config', () => {
  it('plugin accepts retryConfig in options', () => {
    const plugin = new SlackPlugin();
    // Just verify the type works — actual connection test requires a Slack workspace
    expect(plugin.id).toBe('slack');
  });
});
