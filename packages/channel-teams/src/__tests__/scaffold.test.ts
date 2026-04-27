/**
 * Scaffold smoke tests — proves the Group 2 skeleton compiles, the plugin
 * instance loads, capabilities are well-formed, and the auto-discovery hook
 * registers under the `'teams'` channel id.
 *
 * Group 3 / 4 / 5 add behavioural tests for connection, handlers, and
 * senders alongside their implementations.
 */

import { describe, expect, it } from 'bun:test';
import { channelRegistry } from '@omni/channel-sdk';
import teamsPlugin, {
  TEAMS_CAPABILITIES,
  TeamsError,
  TeamsErrorCode,
  TeamsPlugin,
  buildTeamsManifest,
  chunkMessage,
  markdownToTeams,
  shouldAcceptDm,
} from '../index';

describe('channel-teams scaffold', () => {
  it('exports a default plugin instance with the expected identity', () => {
    expect(teamsPlugin).toBeInstanceOf(TeamsPlugin);
    expect(teamsPlugin.id).toBe('teams');
    expect(teamsPlugin.name).toBe('Microsoft Teams (Bot Framework)');
    expect(teamsPlugin.version).toBe('0.1.0');
  });

  it('declares a non-empty capability matrix', () => {
    expect(teamsPlugin.capabilities).toBe(TEAMS_CAPABILITIES);
    expect(TEAMS_CAPABILITIES.canSendText).toBe(true);
    expect(TEAMS_CAPABILITIES.canSendMedia).toBe(true);
    expect(TEAMS_CAPABILITIES.canSendReaction).toBe(false);
    expect(TEAMS_CAPABILITIES.canSendTyping).toBe(true);
    expect(TEAMS_CAPABILITIES.canHandleDMs).toBe(true);
    expect(TEAMS_CAPABILITIES.canHandleThreads).toBe(true);
    expect(TEAMS_CAPABILITIES.maxMessageLength).toBeGreaterThan(0);
    expect(TEAMS_CAPABILITIES.supportedMediaTypes.length).toBeGreaterThan(0);
  });

  it('does not self-register on import (registration is owned by the loader)', () => {
    // Mirrors discord/telegram/slack/gupshup convention. The bundled CLI
    // server entry registers the plugin explicitly; auto-discovery picks it
    // up in dev. Self-registering here would double-register in bundled mode.
    channelRegistry.unregister('teams');
    expect(channelRegistry.get('teams')).toBeUndefined();
    channelRegistry.register(teamsPlugin);
    expect(channelRegistry.get('teams')).toBe(teamsPlugin);
  });
});

describe('TeamsError', () => {
  it('maps channel codes to ChannelError with channelType "teams"', () => {
    const err = new TeamsError(TeamsErrorCode.AUTH_FAILED, 'bad creds');
    expect(err).toBeInstanceOf(TeamsError);
    expect(err.channelCode).toBe(TeamsErrorCode.AUTH_FAILED);
    expect(err.channelType).toBe('teams');
    expect(err.name).toBe('TeamsError');
  });
});

describe('shouldAcceptDm', () => {
  it('accepts every user when policy is open', () => {
    expect(shouldAcceptDm('user-1', { policy: 'open' }).accepted).toBe(true);
  });

  it('honours the allowlist when policy is pairing', () => {
    expect(shouldAcceptDm('user-1', { policy: 'pairing', allowlist: ['user-1'] }).accepted).toBe(true);
    expect(shouldAcceptDm('user-2', { policy: 'pairing', allowlist: ['user-1'] }).accepted).toBe(false);
  });

  it('rejects everyone when policy is closed', () => {
    const result = shouldAcceptDm('user-1', { policy: 'closed' });
    expect(result.accepted).toBe(false);
    expect(result.reason).toBeTruthy();
  });
});

describe('markdownToTeams + chunkMessage', () => {
  it('normalises CRLF and trailing whitespace', () => {
    const out = markdownToTeams('Line 1   \r\nLine 2\t\n');
    expect(out).toBe('Line 1\nLine 2\n');
  });

  it('returns the input unchanged when below the limit', () => {
    expect(chunkMessage('short')).toEqual(['short']);
  });

  it('splits long input into chunks under the limit', () => {
    const block = 'word '.repeat(2000); // 10_000 chars
    const chunks = chunkMessage(block, 1000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(1000);
    }
  });
});

describe('buildTeamsManifest', () => {
  it('emits a valid Teams app manifest with the bot id wired in', () => {
    const manifest = buildTeamsManifest({ botId: '00000000-0000-0000-0000-000000000000' });
    expect(manifest.manifestVersion).toBe('1.16');
    expect(manifest.bots).toBeDefined();
    expect(manifest.bots?.[0]?.botId).toBe('00000000-0000-0000-0000-000000000000');
    expect(manifest.bots?.[0]?.scopes).toEqual(['personal', 'team', 'groupchat']);
  });
});
