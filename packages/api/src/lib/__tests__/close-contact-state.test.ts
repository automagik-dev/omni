/**
 * Unit tests for `isChatInActiveCloseState`.
 *
 * Pure predicate — no DB, no event bus. Asserts the same shape the
 * dispatcher's `applyCloseContactGate` skip logic uses, plus the
 * deliberate non-coverage of `closeOutcome` (audit data, not active state).
 */

import { describe, expect, test } from 'bun:test';
import type { ChatSettings } from '@omni/db';
import { isChatInActiveCloseState } from '../close-contact-state';

const HOUR = 60 * 60 * 1000;

const settings = (overrides: Partial<ChatSettings> & Record<string, unknown>): ChatSettings =>
  ({ ...overrides }) as ChatSettings;

describe('isChatInActiveCloseState', () => {
  test('null/undefined settings → false (open chat)', () => {
    expect(isChatInActiveCloseState(null)).toBe(false);
    expect(isChatInActiveCloseState(undefined)).toBe(false);
  });

  test('empty settings → false', () => {
    expect(isChatInActiveCloseState(settings({}))).toBe(false);
  });

  test('closed: true → true (hard terminal — won/lost or auto-promoted soft)', () => {
    expect(isChatInActiveCloseState(settings({ closed: true }))).toBe(true);
  });

  test('closed: false alone → false', () => {
    expect(isChatInActiveCloseState(settings({ closed: false }))).toBe(false);
  });

  test('closeUntil in the future → true (soft cooldown active)', () => {
    const future = new Date(Date.now() + HOUR).toISOString();
    expect(isChatInActiveCloseState(settings({ closeUntil: future }))).toBe(true);
  });

  test('closeUntil in the past → false (cooldown expired, dispatcher gate will clear it on next inbound)', () => {
    const past = new Date(Date.now() - HOUR).toISOString();
    expect(isChatInActiveCloseState(settings({ closeUntil: past }))).toBe(false);
  });

  test('closeUntil empty string → false', () => {
    expect(isChatInActiveCloseState(settings({ closeUntil: '' }))).toBe(false);
  });

  test('closeUntil malformed string → false (rejects invalid timestamps)', () => {
    expect(isChatInActiveCloseState(settings({ closeUntil: 'not-a-date' }))).toBe(false);
  });

  test('closeOutcome alone (audit leftover after expired cooldown) → false', () => {
    // This is the regression the predicate is built around. closeOutcome is
    // preserved across cooldown expiry by `applyCloseContactGate`; using it
    // as the gate would permanently silence follow-up on every chat that
    // ever hit a soft close, even months later when the customer returns
    // with a brand-new sales intent.
    expect(isChatInActiveCloseState(settings({ closeOutcome: 'redirected_sac' }))).toBe(false);
    expect(isChatInActiveCloseState(settings({ closeOutcome: 'unqualified' }))).toBe(false);
  });

  test('closed: true takes precedence over an expired closeUntil', () => {
    const past = new Date(Date.now() - HOUR).toISOString();
    expect(isChatInActiveCloseState(settings({ closed: true, closeUntil: past }))).toBe(true);
  });

  test('soft cooldown active alongside closeOutcome → true (active state, not just audit)', () => {
    const future = new Date(Date.now() + HOUR).toISOString();
    expect(isChatInActiveCloseState(settings({ closeUntil: future, closeOutcome: 'redirected_sac' }))).toBe(true);
  });
});
