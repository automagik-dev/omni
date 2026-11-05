/**
 * Schedule math unit tests.
 *
 * @see issue #404 — Configurable Idle-Chat Follow-Up Sequences
 */

import { describe, expect, test } from 'bun:test';
import type { FollowUpSchedule, FollowUpSequenceConfig } from '../../../schemas/follow-up';
import { FollowUpSequenceConfigSchema } from '../../../schemas/follow-up';
import { computeInitialFireAt, computeNextFireAt, intervalMinutesForIndex, jitteredMinutes } from '../schedule';

const fixed = (intervalsMinutes: number[]): FollowUpSchedule => ({ kind: 'fixed', intervalsMinutes });
const exponential = (initialMinutes: number, factor: number, maxMinutes: number): FollowUpSchedule => ({
  kind: 'exponential',
  initialMinutes,
  factor,
  maxMinutes,
});

const MS_PER_MINUTE = 60_000;

const baseConfig = (overrides: Partial<FollowUpSequenceConfig> = {}): FollowUpSequenceConfig => ({
  enabled: true,
  schedule: { kind: 'fixed', intervalsMinutes: [3, 5, 30] },
  maxFollowUps: 3,
  promptTemplate: 'Check in with the customer.',
  stopOutsideMessagingWindow: true,
  showTypingIndicator: true,
  ...overrides,
});

describe('intervalMinutesForIndex — fixed schedule', () => {
  test('returns intervals in order', () => {
    const schedule = fixed([3, 5, 30]);
    expect(intervalMinutesForIndex(schedule, 0)).toBe(3);
    expect(intervalMinutesForIndex(schedule, 1)).toBe(5);
    expect(intervalMinutesForIndex(schedule, 2)).toBe(30);
  });

  test('clamps to last interval when index exceeds list length', () => {
    const schedule = fixed([3, 5, 30]);
    expect(intervalMinutesForIndex(schedule, 3)).toBe(30);
    expect(intervalMinutesForIndex(schedule, 99)).toBe(30);
  });

  test('single-element list reuses the only interval', () => {
    const schedule = fixed([7]);
    expect(intervalMinutesForIndex(schedule, 0)).toBe(7);
    expect(intervalMinutesForIndex(schedule, 10)).toBe(7);
  });
});

describe('intervalMinutesForIndex — exponential schedule', () => {
  test('starts at initialMinutes', () => {
    const schedule = exponential(2, 2, 60);
    expect(intervalMinutesForIndex(schedule, 0)).toBe(2);
  });

  test('multiplies by factor each step', () => {
    const schedule = exponential(2, 3, 1000);
    expect(intervalMinutesForIndex(schedule, 1)).toBe(6);
    expect(intervalMinutesForIndex(schedule, 2)).toBe(18);
    expect(intervalMinutesForIndex(schedule, 3)).toBe(54);
  });

  test('caps at maxMinutes', () => {
    const schedule = exponential(2, 2, 10);
    expect(intervalMinutesForIndex(schedule, 0)).toBe(2);
    expect(intervalMinutesForIndex(schedule, 1)).toBe(4);
    expect(intervalMinutesForIndex(schedule, 2)).toBe(8);
    // 2 * 2^3 = 16, capped at 10
    expect(intervalMinutesForIndex(schedule, 3)).toBe(10);
    // 2 * 2^10 = 2048, capped at 10
    expect(intervalMinutesForIndex(schedule, 10)).toBe(10);
  });
});

describe('intervalMinutesForIndex — validation', () => {
  test('rejects negative index', () => {
    expect(() => intervalMinutesForIndex(fixed([1]), -1)).toThrow(/non-negative finite/);
  });

  test('rejects non-finite index', () => {
    expect(() => intervalMinutesForIndex(fixed([1]), Number.NaN)).toThrow(/non-negative finite/);
  });
});

describe('computeInitialFireAt', () => {
  test('places first fire intervalsMinutes[0] after armedAt', () => {
    const config = baseConfig();
    const armedAt = 1_700_000_000_000;
    expect(computeInitialFireAt(config, armedAt)).toBe(armedAt + 3 * MS_PER_MINUTE);
  });

  test('works for exponential schedule', () => {
    const config = baseConfig({
      schedule: { kind: 'exponential', initialMinutes: 5, factor: 2, maxMinutes: 60 },
    });
    const armedAt = 1_700_000_000_000;
    expect(computeInitialFireAt(config, armedAt)).toBe(armedAt + 5 * MS_PER_MINUTE);
  });

  test('handles sub-minute intervals via rounding', () => {
    const config = baseConfig({
      schedule: { kind: 'fixed', intervalsMinutes: [0.5] },
    });
    const armedAt = 1_700_000_000_000;
    expect(computeInitialFireAt(config, armedAt)).toBe(armedAt + 30_000);
  });
});

describe('computeNextFireAt', () => {
  test('cycles through fixed intervals in order', () => {
    const config = baseConfig();
    const from = 1_700_000_000_000;
    expect(computeNextFireAt(config, 0, from)).toBe(from + 5 * MS_PER_MINUTE);
    expect(computeNextFireAt(config, 1, from)).toBe(from + 30 * MS_PER_MINUTE);
  });

  test('returns null when cap reached (currentIndex + 1 >= maxFollowUps)', () => {
    const config = baseConfig({ maxFollowUps: 3 });
    expect(computeNextFireAt(config, 2, 0)).toBeNull();
    expect(computeNextFireAt(config, 5, 0)).toBeNull();
  });

  test('respects maxFollowUps smaller than schedule length', () => {
    const config = baseConfig({
      schedule: { kind: 'fixed', intervalsMinutes: [1, 2, 3, 4, 5] },
      maxFollowUps: 2,
    });
    const from = 1_700_000_000_000;
    expect(computeNextFireAt(config, 0, from)).toBe(from + 2 * MS_PER_MINUTE);
    expect(computeNextFireAt(config, 1, from)).toBeNull();
  });

  test('exponential progression across multiple advances', () => {
    const config = baseConfig({
      schedule: { kind: 'exponential', initialMinutes: 3, factor: 2, maxMinutes: 60 },
      maxFollowUps: 5,
    });
    const from = 1_700_000_000_000;
    expect(computeNextFireAt(config, 0, from)).toBe(from + 6 * MS_PER_MINUTE);
    expect(computeNextFireAt(config, 1, from)).toBe(from + 12 * MS_PER_MINUTE);
    expect(computeNextFireAt(config, 2, from)).toBe(from + 24 * MS_PER_MINUTE);
    expect(computeNextFireAt(config, 3, from)).toBe(from + 48 * MS_PER_MINUTE);
    expect(computeNextFireAt(config, 4, from)).toBeNull();
  });
});

describe('jitter (#1261)', () => {
  const at = (value: number) => () => value;
  const from = 1_700_000_000_000;

  test('absent: intervals stay exact, whatever random says', () => {
    expect(jitteredMinutes(fixed([60]), 60, at(0))).toBe(60);
    expect(computeInitialFireAt(baseConfig(), from, at(0.99))).toBe(from + 3 * MS_PER_MINUTE);
  });

  test('minutes: a uniform offset within ±minutes', () => {
    const schedule: FollowUpSchedule = { kind: 'fixed', intervalsMinutes: [60, 240], jitter: { minutes: 10 } };
    expect(jitteredMinutes(schedule, 60, at(0))).toBe(50);
    expect(jitteredMinutes(schedule, 60, at(0.5))).toBe(60);
    expect(jitteredMinutes(schedule, 60, at(0.75))).toBe(65);
    const config = baseConfig({ schedule, maxFollowUps: 2 });
    expect(computeInitialFireAt(config, from, at(0.75))).toBe(from + 65 * MS_PER_MINUTE);
    expect(computeNextFireAt(config, 0, from, at(0))).toBe(from + 230 * MS_PER_MINUTE);
  });

  test('ratio: a share of each interval, so it grows with an exponential schedule', () => {
    const schedule: FollowUpSchedule = {
      kind: 'exponential',
      initialMinutes: 60,
      factor: 2,
      maxMinutes: 1440,
      jitter: { ratio: 0.15 },
    };
    const config = baseConfig({ schedule, maxFollowUps: 3 });
    expect(computeInitialFireAt(config, from, at(0))).toBe(from + 51 * MS_PER_MINUTE);
    expect(computeNextFireAt(config, 0, from, at(0))).toBe(from + 102 * MS_PER_MINUTE);
  });

  test('never below the smaller of the interval and one minute', () => {
    expect(jitteredMinutes({ kind: 'fixed', intervalsMinutes: [5], jitter: { minutes: 30 } }, 5, at(0))).toBe(1);
    expect(jitteredMinutes({ kind: 'fixed', intervalsMinutes: [0.25], jitter: { ratio: 1 } }, 0.25, at(0))).toBe(0.25);
  });

  test('the config accepts one bound, positive, and a ratio of at most 1', () => {
    const withJitter = (jitter: unknown) =>
      FollowUpSequenceConfigSchema.safeParse({
        ...baseConfig(),
        schedule: { kind: 'fixed', intervalsMinutes: [60], jitter },
      }).success;
    expect(withJitter({ minutes: 10 })).toBe(true);
    expect(withJitter({ ratio: 0.15 })).toBe(true);
    expect(withJitter({ ratio: 1.5 })).toBe(false);
    expect(withJitter({ minutes: 0 })).toBe(false);
    expect(withJitter({ minutes: 10, ratio: 0.1 })).toBe(false);
  });
});
