/**
 * Tests for resolveDispatchErrorMessage — issue #737.
 *
 * Precedence: per-instance `agentErrorMessages` (random pick among variants) →
 * `OMNI_AGENT_DISPATCH_ERROR_MESSAGE` env → built-in default. Blank/whitespace
 * values fall through to the next tier.
 */

import { describe, expect, it, mock } from 'bun:test';

// Mock the plugin loader to avoid real FS/channel-sdk imports — same pattern
// as agent-dispatcher-retry.test.ts. Without this the module init crashes
// loading the parent agent-dispatcher.ts.
mock.module('../loader', () => ({
  getPlugin: mock(() => Promise.resolve(undefined)),
}));

import {
  DEFAULT_DISPATCH_ERROR_MESSAGE,
  DEFAULT_ERROR_HANDOFF_MESSAGE,
  resolveDispatchErrorMessage,
  resolveErrorHandoffMessage,
} from '../agent-dispatcher';

describe('resolveDispatchErrorMessage', () => {
  it('falls back to the built-in default when nothing is configured', () => {
    expect(resolveDispatchErrorMessage(null, {})).toBe(DEFAULT_DISPATCH_ERROR_MESSAGE);
    expect(resolveDispatchErrorMessage(undefined, {})).toBe(DEFAULT_DISPATCH_ERROR_MESSAGE);
    expect(resolveDispatchErrorMessage([], {})).toBe(DEFAULT_DISPATCH_ERROR_MESSAGE);
  });

  it('ships a pt-BR built-in default', () => {
    expect(DEFAULT_DISPATCH_ERROR_MESSAGE).toContain('Opa, tive um probleminha');
  });

  it('uses the env override when no per-instance list is set', () => {
    const env = { OMNI_AGENT_DISPATCH_ERROR_MESSAGE: 'Estamos com um problema, tente novamente.' };
    expect(resolveDispatchErrorMessage(null, env)).toBe('Estamos com um problema, tente novamente.');
  });

  it('prefers the per-instance list over env and default', () => {
    const env = { OMNI_AGENT_DISPATCH_ERROR_MESSAGE: 'env message' };
    expect(resolveDispatchErrorMessage(['instance message'], env)).toBe('instance message');
  });

  it('picks a variant by the injected random source', () => {
    const variants = ['first', 'second', 'third'];
    expect(resolveDispatchErrorMessage(variants, {}, () => 0)).toBe('first');
    expect(resolveDispatchErrorMessage(variants, {}, () => 0.5)).toBe('second');
    expect(resolveDispatchErrorMessage(variants, {}, () => 0.99)).toBe('third');
  });

  it('only ever picks from the configured variants with real randomness', () => {
    const variants = ['a', 'b'];
    for (let i = 0; i < 50; i++) {
      expect(variants).toContain(resolveDispatchErrorMessage(variants, {}));
    }
  });

  it('ignores blank/whitespace-only entries and falls through', () => {
    const env = { OMNI_AGENT_DISPATCH_ERROR_MESSAGE: '  ' };
    // Blank-only list + blank env → default.
    expect(resolveDispatchErrorMessage(['   '], env)).toBe(DEFAULT_DISPATCH_ERROR_MESSAGE);
    // Blank-only list + valid env → env.
    expect(resolveDispatchErrorMessage(['  '], { OMNI_AGENT_DISPATCH_ERROR_MESSAGE: 'env msg' })).toBe('env msg');
    // Blank entries are dropped BEFORE the pick, so a valid entry always wins.
    expect(resolveDispatchErrorMessage(['  ', 'valid'], {}, () => 0)).toBe('valid');
  });

  it('trims surrounding whitespace from the resolved value', () => {
    expect(resolveDispatchErrorMessage(['  hi there  '], {})).toBe('hi there');
  });
});

describe('resolveErrorHandoffMessage', () => {
  it('defaults to the built-in handoff message (promises a human, not a retry)', () => {
    expect(resolveErrorHandoffMessage({})).toBe(DEFAULT_ERROR_HANDOFF_MESSAGE);
    expect(DEFAULT_ERROR_HANDOFF_MESSAGE).toContain('entrar em contato');
  });

  it('honors OMNI_AGENT_ERROR_HANDOFF_MESSAGE', () => {
    expect(resolveErrorHandoffMessage({ OMNI_AGENT_ERROR_HANDOFF_MESSAGE: 'A human will reach out shortly.' })).toBe(
      'A human will reach out shortly.',
    );
  });

  it('ignores a blank override and falls back to default', () => {
    expect(resolveErrorHandoffMessage({ OMNI_AGENT_ERROR_HANDOFF_MESSAGE: '   ' })).toBe(DEFAULT_ERROR_HANDOFF_MESSAGE);
  });
});
