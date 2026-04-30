/**
 * Tests for the close-contact config helper.
 *
 * Pure-function helpers — no DB, no event bus, no plugin. Asserts the
 * default table per outcome, the per-outcome override merge, and the
 * hard-vs-soft outcome predicate.
 */
import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_CLOSE_CONTACT_CONFIG,
  isHardTerminalOutcome,
  resolveCloseContactConfig,
} from '../_close-contact-config';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('DEFAULT_CLOSE_CONTACT_CONFIG', () => {
  test('hard outcomes have null cooldown/threshold/window', () => {
    expect(DEFAULT_CLOSE_CONTACT_CONFIG.won).toEqual({
      cooldownMs: null,
      escalationThreshold: null,
      escalationWindowMs: null,
    });
    expect(DEFAULT_CLOSE_CONTACT_CONFIG.lost).toEqual({
      cooldownMs: null,
      escalationThreshold: null,
      escalationWindowMs: null,
    });
  });

  test('redirected_sac uses 24h cooldown and never auto-escalates', () => {
    // Active Hapvida clients legitimately hit `redirected_sac` repeatedly
    // (every post-sale topic ends here). Auto-promoting the soft close to a
    // hard terminal would silence the reactive agent for normal client
    // activity — see the comment on DEFAULT_CLOSE_CONTACT_CONFIG.redirected_sac
    // for the full rationale.
    expect(DEFAULT_CLOSE_CONTACT_CONFIG.redirected_sac).toEqual({
      cooldownMs: 24 * HOUR,
      escalationThreshold: null,
      escalationWindowMs: null,
    });
  });

  test('unqualified uses 7d cooldown / threshold 3 / 30d window', () => {
    expect(DEFAULT_CLOSE_CONTACT_CONFIG.unqualified).toEqual({
      cooldownMs: 7 * DAY,
      escalationThreshold: 3,
      escalationWindowMs: 30 * DAY,
    });
  });

  test('no_response uses 48h cooldown / threshold 3 / 30d window', () => {
    expect(DEFAULT_CLOSE_CONTACT_CONFIG.no_response).toEqual({
      cooldownMs: 48 * HOUR,
      escalationThreshold: 3,
      escalationWindowMs: 30 * DAY,
    });
  });

  test('other defaults to 24h cooldown / threshold 2 / 14d window', () => {
    expect(DEFAULT_CLOSE_CONTACT_CONFIG.other).toEqual({
      cooldownMs: 24 * HOUR,
      escalationThreshold: 2,
      escalationWindowMs: 14 * DAY,
    });
  });
});

describe('resolveCloseContactConfig', () => {
  test('returns defaults when instance settings is null', () => {
    expect(resolveCloseContactConfig('redirected_sac', null)).toEqual(DEFAULT_CLOSE_CONTACT_CONFIG.redirected_sac);
  });

  test('returns defaults when instance settings has no closeContactConfig key', () => {
    expect(resolveCloseContactConfig('unqualified', { other: 'data' })).toEqual(
      DEFAULT_CLOSE_CONTACT_CONFIG.unqualified,
    );
  });

  test('per-outcome override merges with defaults', () => {
    const override = {
      closeContactConfig: {
        redirected_sac: { cooldownMs: 1000, escalationThreshold: 5, escalationWindowMs: 60000 },
      },
    };
    expect(resolveCloseContactConfig('redirected_sac', override)).toEqual({
      cooldownMs: 1000,
      escalationThreshold: 5,
      escalationWindowMs: 60000,
    });
  });

  test('partial override falls back per-key to default', () => {
    const override = {
      closeContactConfig: {
        unqualified: { cooldownMs: 999 } as Partial<{ cooldownMs: number }>,
      },
    };
    const result = resolveCloseContactConfig('unqualified', override);
    expect(result.cooldownMs).toBe(999);
    expect(result.escalationThreshold).toBe(DEFAULT_CLOSE_CONTACT_CONFIG.unqualified.escalationThreshold);
    expect(result.escalationWindowMs).toBe(DEFAULT_CLOSE_CONTACT_CONFIG.unqualified.escalationWindowMs);
  });

  test('override for a different outcome does not affect requested outcome', () => {
    const override = {
      closeContactConfig: {
        redirected_sac: { cooldownMs: 1, escalationThreshold: 1, escalationWindowMs: 1 },
      },
    };
    expect(resolveCloseContactConfig('unqualified', override)).toEqual(DEFAULT_CLOSE_CONTACT_CONFIG.unqualified);
  });

  test('explicit nulls in override are respected', () => {
    const override = {
      closeContactConfig: {
        other: { cooldownMs: null, escalationThreshold: null, escalationWindowMs: null },
      },
    };
    expect(resolveCloseContactConfig('other', override)).toEqual({
      cooldownMs: null,
      escalationThreshold: null,
      escalationWindowMs: null,
    });
  });

  test('non-numeric override values fall back to defaults', () => {
    const override = {
      closeContactConfig: {
        redirected_sac: { cooldownMs: 'not-a-number' as unknown as number },
      },
    };
    const result = resolveCloseContactConfig('redirected_sac', override);
    expect(result.cooldownMs).toBe(DEFAULT_CLOSE_CONTACT_CONFIG.redirected_sac.cooldownMs);
  });
});

describe('isHardTerminalOutcome', () => {
  test('won is hard terminal', () => {
    expect(isHardTerminalOutcome('won')).toBe(true);
  });
  test('lost is hard terminal', () => {
    expect(isHardTerminalOutcome('lost')).toBe(true);
  });
  test('redirected_sac is NOT hard terminal', () => {
    expect(isHardTerminalOutcome('redirected_sac')).toBe(false);
  });
  test('unqualified is NOT hard terminal', () => {
    expect(isHardTerminalOutcome('unqualified')).toBe(false);
  });
  test('no_response is NOT hard terminal', () => {
    expect(isHardTerminalOutcome('no_response')).toBe(false);
  });
  test('other is NOT hard terminal', () => {
    expect(isHardTerminalOutcome('other')).toBe(false);
  });
});
