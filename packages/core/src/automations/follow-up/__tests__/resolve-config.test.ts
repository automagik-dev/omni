/**
 * Tests for resolveFollowUpConfig — closest-wins hierarchy:
 *   chat → instance → agent → null
 *
 * @see issue #404 — Configurable Idle-Chat Follow-Up Sequences
 */

import { describe, expect, it } from 'bun:test';
import type { FollowUpSequenceConfig } from '../../../schemas/follow-up';
import { resolveFollowUpConfig } from '../resolve-config';

const baseConfig = (label: string, enabled = true): FollowUpSequenceConfig => ({
  enabled,
  schedule: { kind: 'fixed', intervalsMinutes: [3, 5, 30] },
  maxFollowUps: 3,
  promptTemplate: `[${label}] please follow up with the customer`,
  stopOutsideMessagingWindow: true,
  showTypingIndicator: true,
});

describe('resolveFollowUpConfig', () => {
  it('returns null when no scope defines a config', () => {
    expect(resolveFollowUpConfig({})).toBeNull();
    expect(resolveFollowUpConfig({ chat: null, instance: null, agent: null })).toBeNull();
    expect(resolveFollowUpConfig({ chat: undefined, instance: undefined, agent: undefined })).toBeNull();
  });

  it('falls back to agent config when chat and instance are unset', () => {
    const agent = baseConfig('agent');
    const result = resolveFollowUpConfig({ agent });
    expect(result).toBe(agent);
  });

  it('instance overrides agent', () => {
    const agent = baseConfig('agent');
    const instance = baseConfig('instance');
    const result = resolveFollowUpConfig({ agent, instance });
    expect(result).toBe(instance);
  });

  it('chat overrides instance and agent', () => {
    const agent = baseConfig('agent');
    const instance = baseConfig('instance');
    const chat = baseConfig('chat');
    const result = resolveFollowUpConfig({ agent, instance, chat });
    expect(result).toBe(chat);
  });

  it('chat: enabled=false short-circuits to null (broader scopes do not leak through)', () => {
    const agent = baseConfig('agent');
    const instance = baseConfig('instance');
    const chat = baseConfig('chat', false);
    expect(resolveFollowUpConfig({ agent, instance, chat })).toBeNull();
  });

  it('instance: enabled=false short-circuits when chat is unset', () => {
    const agent = baseConfig('agent');
    const instance = baseConfig('instance', false);
    expect(resolveFollowUpConfig({ agent, instance })).toBeNull();
  });

  it('agent: enabled=false returns null', () => {
    const agent = baseConfig('agent', false);
    expect(resolveFollowUpConfig({ agent })).toBeNull();
  });

  it('null at a scope is treated as "not defined" — falls through to broader scope', () => {
    const agent = baseConfig('agent');
    const result = resolveFollowUpConfig({ chat: null, instance: null, agent });
    expect(result).toBe(agent);
  });

  it('undefined at a scope is treated as "not defined" — falls through', () => {
    const instance = baseConfig('instance');
    const result = resolveFollowUpConfig({ chat: undefined, instance, agent: undefined });
    expect(result).toBe(instance);
  });
});
