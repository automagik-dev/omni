/**
 * Unit tests for scope-enforcer primitives.
 *
 * These tests exercise the three allowlist checks and the route-target
 * extractor in isolation — no HTTP, no DB. The middleware body itself is
 * integration-tested via Group 5's QA wave.
 */

import { describe, expect, test } from 'bun:test';
import type { ApiKeyData } from '../../types';
import {
  enforceAllowlist,
  enforceChatAllowlist,
  enforceInstanceAllowlist,
  enforceOutboundRecipientAllowlist,
  extractLockTargets,
  isLockActive,
} from '../scope-enforcer';

function mkKey(overrides: Partial<ApiKeyData> = {}): ApiKeyData {
  return {
    id: 'k1',
    name: 'test',
    scopes: ['*'],
    instanceIds: null,
    expiresAt: null,
    profile: null,
    chatAllowlist: [],
    instanceAllowlist: [],
    outboundRecipientAllowlist: [],
    ...overrides,
  };
}

describe('isLockActive — profile-aware empty-allowlist semantics', () => {
  test('legacy (profile=null) key with empty chat allowlist → inactive', () => {
    expect(isLockActive(null, 'chatAllowlist', [])).toBe(false);
  });

  test('legacy key with non-empty chat allowlist → active', () => {
    expect(isLockActive(null, 'chatAllowlist', ['chat-1'])).toBe(true);
  });

  test('cs profile with empty chat allowlist → active (deny-all)', () => {
    // cs requires chatAllowlist + instanceAllowlist
    expect(isLockActive('cs', 'chatAllowlist', [])).toBe(true);
    expect(isLockActive('cs', 'instanceAllowlist', [])).toBe(true);
  });

  test('cs profile with empty outbound recipient allowlist → inactive (not a required lock for cs)', () => {
    expect(isLockActive('cs', 'outboundRecipientAllowlist', [])).toBe(false);
  });

  test('scout profile with empty outbound recipient allowlist → active (deny-all)', () => {
    expect(isLockActive('scout', 'outboundRecipientAllowlist', [])).toBe(true);
  });

  test('personal profile (instance lock required) with empty chat allowlist → inactive', () => {
    expect(isLockActive('personal', 'chatAllowlist', [])).toBe(false);
    expect(isLockActive('personal', 'instanceAllowlist', [])).toBe(true);
  });

  test('admin profile with empty allowlists → inactive (admin has no requiresLocks)', () => {
    expect(isLockActive('admin', 'chatAllowlist', [])).toBe(false);
    expect(isLockActive('admin', 'instanceAllowlist', [])).toBe(false);
    expect(isLockActive('admin', 'outboundRecipientAllowlist', [])).toBe(false);
  });
});

describe('enforceAllowlist — generic allow/deny logic', () => {
  test('inactive lock → always allowed (no target check)', () => {
    const r = enforceAllowlist(null, 'chatAllowlist', [], null);
    expect(r.allowed).toBe(true);
  });

  test('non-empty list, target in list → allowed', () => {
    const r = enforceAllowlist(null, 'chatAllowlist', ['chat-1', 'chat-2'], 'chat-1');
    expect(r.allowed).toBe(true);
  });

  test('non-empty list, target missing from list → denied with reason not-in-allowlist', () => {
    const r = enforceAllowlist(null, 'chatAllowlist', ['chat-1'], 'chat-2');
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('not-in-allowlist');
    expect(r.attempted).toBe('chat-2');
  });

  test('non-empty list, target missing entirely → denied with empty attempted', () => {
    const r = enforceAllowlist(null, 'chatAllowlist', ['chat-1'], null);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('not-in-allowlist');
  });

  test('profile key with requiresLocks + empty list + any target → denied with deny-all reason', () => {
    const r = enforceAllowlist('cs', 'chatAllowlist', [], 'some-chat');
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('deny-all-profile-requires-lock');
    expect(r.attempted).toBe('some-chat');
  });
});

describe('enforceChatAllowlist — cs profile (allowlist required)', () => {
  test('cs-locked key: target chat in allowlist → allowed', () => {
    const key = mkKey({ profile: 'cs', chatAllowlist: ['chat-1'] });
    expect(enforceChatAllowlist(key, 'chat-1').allowed).toBe(true);
  });

  test('cs-locked key: target chat NOT in allowlist → denied with lock=chatAllowlist semantics', () => {
    const key = mkKey({ profile: 'cs', chatAllowlist: ['chat-1'] });
    const r = enforceChatAllowlist(key, 'chat-other');
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('not-in-allowlist');
    expect(r.attempted).toBe('chat-other');
  });

  test('cs-locked key with cleared allowlist → deny-all (not "no lock")', () => {
    const key = mkKey({ profile: 'cs', chatAllowlist: [] });
    const r = enforceChatAllowlist(key, 'chat-1');
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('deny-all-profile-requires-lock');
  });

  test('legacy (profile=null) key with empty allowlist → allowed (no lock, backward compat)', () => {
    const key = mkKey({ profile: null, chatAllowlist: [] });
    const r = enforceChatAllowlist(key, 'chat-any');
    expect(r.allowed).toBe(true);
  });
});

describe('enforceInstanceAllowlist', () => {
  test('instance-locked key with matching instance → allowed', () => {
    const key = mkKey({ profile: 'personal', instanceAllowlist: ['inst-1'] });
    expect(enforceInstanceAllowlist(key, 'inst-1').allowed).toBe(true);
  });

  test('instance-locked key with non-matching instance → denied', () => {
    const key = mkKey({ profile: 'personal', instanceAllowlist: ['inst-1'] });
    const r = enforceInstanceAllowlist(key, 'inst-2');
    expect(r.allowed).toBe(false);
    expect(r.attempted).toBe('inst-2');
  });

  test('personal profile with cleared instance allowlist → deny-all', () => {
    const key = mkKey({ profile: 'personal', instanceAllowlist: [] });
    const r = enforceInstanceAllowlist(key, 'inst-1');
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('deny-all-profile-requires-lock');
  });

  test('legacy key (profile=null) with empty instance allowlist → allowed', () => {
    const key = mkKey({ profile: null, instanceAllowlist: [] });
    expect(enforceInstanceAllowlist(key, 'inst-any').allowed).toBe(true);
  });
});

describe('enforceOutboundRecipientAllowlist — scout profile', () => {
  test('scout key: recipient in allowlist → allowed', () => {
    const key = mkKey({ profile: 'scout', outboundRecipientAllowlist: ['owner-jid'] });
    expect(enforceOutboundRecipientAllowlist(key, 'owner-jid').allowed).toBe(true);
  });

  test('scout key: recipient NOT in allowlist → denied', () => {
    const key = mkKey({ profile: 'scout', outboundRecipientAllowlist: ['owner-jid'] });
    const r = enforceOutboundRecipientAllowlist(key, 'other-jid');
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('not-in-allowlist');
    expect(r.attempted).toBe('other-jid');
  });

  test('scout key: cleared recipient allowlist → deny-all', () => {
    const key = mkKey({ profile: 'scout', outboundRecipientAllowlist: [] });
    const r = enforceOutboundRecipientAllowlist(key, 'owner-jid');
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('deny-all-profile-requires-lock');
  });

  test('legacy key with empty recipient allowlist → allowed', () => {
    const key = mkKey({ profile: null, outboundRecipientAllowlist: [] });
    expect(enforceOutboundRecipientAllowlist(key, 'any-jid').allowed).toBe(true);
  });
});

describe('extractLockTargets — route & body target extraction', () => {
  test('POST /messages/send — body.to becomes recipient AND chat target', () => {
    const t = extractLockTargets('POST', '/api/v2/messages/send', {
      instanceId: 'inst-1',
      to: '5511999999999@s.whatsapp.net',
      text: 'hi',
    });
    expect(t.instance).toBe('inst-1');
    expect(t.recipient).toBe('5511999999999@s.whatsapp.net');
    expect(t.chat).toBe('5511999999999@s.whatsapp.net');
  });

  test('POST /messages/send/media — same extraction as /send', () => {
    const t = extractLockTargets('POST', '/api/v2/messages/send/media', {
      instanceId: 'inst-1',
      to: 'chat-jid',
      type: 'image',
      url: 'https://example.com/a.png',
    });
    expect(t.recipient).toBe('chat-jid');
  });

  test('PATCH /chats/:id — path param becomes chat target', () => {
    const t = extractLockTargets('PATCH', '/api/v2/chats/chat-abc', { name: 'renamed' });
    expect(t.chat).toBe('chat-abc');
    expect(t.recipient).toBeNull();
  });

  test('PATCH /instances/:id — path param becomes instance target', () => {
    const t = extractLockTargets('PATCH', '/api/v2/instances/inst-7', { status: 'active' });
    expect(t.instance).toBe('inst-7');
  });

  test('GET with no body — targets are null', () => {
    const t = extractLockTargets('GET', '/api/v2/messages', null);
    expect(t.instance).toBeNull();
    expect(t.chat).toBeNull();
    expect(t.recipient).toBeNull();
  });

  test('non-send route with `to` in body is treated as chat target, not recipient', () => {
    const t = extractLockTargets('POST', '/api/v2/something-else', { to: 'chat-x' });
    expect(t.recipient).toBeNull();
    expect(t.chat).toBe('chat-x');
  });

  test('empty string body fields are treated as missing', () => {
    const t = extractLockTargets('POST', '/api/v2/messages/send', { instanceId: '', to: '', text: 'x' });
    expect(t.instance).toBeNull();
    expect(t.recipient).toBeNull();
  });

  // ── Precedence: route-derived targets win over the body (scope-bypass guard) ──

  test('path instance wins over a conflicting body.instanceId (no body-injection bypass)', () => {
    const t = extractLockTargets('PATCH', '/api/v2/instances/real-inst', { instanceId: 'allowlisted-inst' });
    expect(t.instance).toBe('real-inst');
  });

  test('path chat wins over a conflicting body.chatId', () => {
    const t = extractLockTargets('PATCH', '/api/v2/chats/real-chat', { chatId: 'allowlisted-chat' });
    expect(t.chat).toBe('real-chat');
  });

  // ── Header-derived targets (x-omni-*) are extracted and rank above the body ──

  test('x-omni-instance / x-omni-chat headers become targets (header-scoped routes)', () => {
    const t = extractLockTargets('POST', '/api/v2/turns/close', null, {
      instance: 'hdr-inst',
      chat: 'hdr-chat',
    });
    expect(t.instance).toBe('hdr-inst');
    expect(t.chat).toBe('hdr-chat');
  });

  test('header target wins over a conflicting body target', () => {
    const t = extractLockTargets('POST', '/api/v2/turns/close', { instanceId: 'body-inst' }, { instance: 'hdr-inst' });
    expect(t.instance).toBe('hdr-inst');
  });

  test('path target still wins over the header', () => {
    const t = extractLockTargets('PATCH', '/api/v2/instances/path-inst', null, { instance: 'hdr-inst' });
    expect(t.instance).toBe('path-inst');
  });

  test('body is still used when neither path nor header supplies the target', () => {
    const t = extractLockTargets(
      'POST',
      '/api/v2/messages/send',
      { instanceId: 'body-inst', to: 'jid', text: 'x' },
      {},
    );
    expect(t.instance).toBe('body-inst');
  });
});

describe('Integration scenarios from wish acceptance criteria', () => {
  test('cs-locked key sending to a non-allowlisted chat → denied with lock=chatAllowlist', () => {
    const key = mkKey({
      profile: 'cs',
      chatAllowlist: ['locked-chat'],
      instanceAllowlist: ['locked-inst'],
    });
    const targets = extractLockTargets('POST', '/api/v2/messages/send', {
      instanceId: 'locked-inst',
      to: 'other-chat',
      text: 'hi',
    });
    expect(enforceInstanceAllowlist(key, targets.instance).allowed).toBe(true);
    const chatResult = enforceChatAllowlist(key, targets.chat);
    expect(chatResult.allowed).toBe(false);
    expect(chatResult.attempted).toBe('other-chat');
  });

  test('scout key sending to a non-owner recipient → denied with lock=outboundRecipientAllowlist', () => {
    const key = mkKey({
      profile: 'scout',
      outboundRecipientAllowlist: ['owner-jid'],
    });
    const targets = extractLockTargets('POST', '/api/v2/messages/send', {
      instanceId: 'inst-any',
      to: 'random-user',
      text: 'hi',
    });
    const r = enforceOutboundRecipientAllowlist(key, targets.recipient);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('not-in-allowlist');
    expect(r.attempted).toBe('random-user');
  });

  test('request against instance not in instance_allowlist → denied with lock=instanceAllowlist', () => {
    const key = mkKey({
      profile: 'personal',
      instanceAllowlist: ['allowed-inst'],
    });
    const targets = extractLockTargets('PATCH', '/api/v2/instances/other-inst', { status: 'connected' });
    const r = enforceInstanceAllowlist(key, targets.instance);
    expect(r.allowed).toBe(false);
    expect(r.attempted).toBe('other-inst');
  });
});
