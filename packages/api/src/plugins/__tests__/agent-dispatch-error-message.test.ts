/**
 * Tests for resolveDispatchErrorMessage — issue #737.
 *
 * Precedence: per-instance `agentErrorMessage` → `OMNI_AGENT_DISPATCH_ERROR_MESSAGE`
 * env → built-in default. Blank/whitespace values fall through to the next tier.
 */

import { describe, expect, it, mock } from 'bun:test';

// Mock the plugin loader to avoid real FS/channel-sdk imports — same pattern
// as agent-dispatcher-retry.test.ts. Without this the module init crashes
// loading the parent agent-dispatcher.ts.
mock.module('../loader', () => ({
  getPlugin: mock(() => Promise.resolve(undefined)),
}));

import { DEFAULT_DISPATCH_ERROR_MESSAGE, resolveDispatchErrorMessage } from '../agent-dispatcher';

describe('resolveDispatchErrorMessage', () => {
  it('falls back to the built-in default when nothing is configured', () => {
    expect(resolveDispatchErrorMessage(null, {})).toBe(DEFAULT_DISPATCH_ERROR_MESSAGE);
    expect(resolveDispatchErrorMessage(undefined, {})).toBe(DEFAULT_DISPATCH_ERROR_MESSAGE);
  });

  it('uses the env override when no per-instance value is set', () => {
    const env = { OMNI_AGENT_DISPATCH_ERROR_MESSAGE: 'Estamos com um problema, tente novamente.' };
    expect(resolveDispatchErrorMessage(null, env)).toBe('Estamos com um problema, tente novamente.');
  });

  it('prefers the per-instance value over env and default', () => {
    const env = { OMNI_AGENT_DISPATCH_ERROR_MESSAGE: 'env message' };
    expect(resolveDispatchErrorMessage('instance message', env)).toBe('instance message');
  });

  it('ignores blank/whitespace-only values and falls through', () => {
    const env = { OMNI_AGENT_DISPATCH_ERROR_MESSAGE: '  ' };
    // Blank instance + blank env → default.
    expect(resolveDispatchErrorMessage('   ', env)).toBe(DEFAULT_DISPATCH_ERROR_MESSAGE);
    // Blank instance + valid env → env.
    expect(resolveDispatchErrorMessage('  ', { OMNI_AGENT_DISPATCH_ERROR_MESSAGE: 'env msg' })).toBe('env msg');
  });

  it('trims surrounding whitespace from the resolved value', () => {
    expect(resolveDispatchErrorMessage('  hi there  ', {})).toBe('hi there');
  });
});
