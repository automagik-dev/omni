/**
 * Schedule math for idle-chat follow-up sequences.
 *
 * Pure functions — no I/O, no clock access. The caller passes `now` so the
 * sweeper can share a single wall clock across a sweep batch and tests can
 * pin time without monkeypatching.
 *
 * @see issue #404 — Configurable Idle-Chat Follow-Up Sequences
 */

import type { FollowUpSchedule, FollowUpSequenceConfig } from '../../schemas/follow-up';

const MS_PER_MINUTE = 60_000;

/**
 * Return the interval (in minutes) between the nth and (n+1)th follow-up for
 * a given schedule.
 *
 * - For `fixed` schedules this cycles through `intervalsMinutes` by index. If
 *   the index exceeds the list length, the final interval is reused —
 *   callers should rely on `maxFollowUps` to bound the sequence.
 * - For `exponential` schedules this starts at `initialMinutes` and
 *   multiplies by `factor` each step, capped at `maxMinutes`.
 *
 * @param schedule the schedule configuration
 * @param index zero-based index of the follow-up about to fire (0 = first)
 */
export function intervalMinutesForIndex(schedule: FollowUpSchedule, index: number): number {
  if (!Number.isFinite(index) || index < 0) {
    throw new Error(`intervalMinutesForIndex: index must be a non-negative finite number, got ${index}`);
  }

  if (schedule.kind === 'fixed') {
    const list = schedule.intervalsMinutes;
    if (list.length === 0) {
      throw new Error('intervalMinutesForIndex: fixed schedule has empty intervalsMinutes');
    }
    const clampedIndex = Math.min(index, list.length - 1);
    return list[clampedIndex] as number;
  }

  const { initialMinutes, factor, maxMinutes } = schedule;
  const raw = initialMinutes * factor ** index;
  return Math.min(raw, maxMinutes);
}

/**
 * Compute the next fire timestamp (ms since epoch) after the given index has
 * just fired. Returns `null` when the sequence has reached `maxFollowUps` and
 * no further fires should be scheduled.
 *
 * @param config resolved follow-up config
 * @param currentIndex zero-based index that was JUST fired
 * @param from wall clock reference in ms (usually the fire time)
 */
export function computeNextFireAt(config: FollowUpSequenceConfig, currentIndex: number, from: number): number | null {
  const nextIndex = currentIndex + 1;
  if (nextIndex >= config.maxFollowUps) {
    return null;
  }
  const minutes = intervalMinutesForIndex(config.schedule, nextIndex);
  return from + Math.round(minutes * MS_PER_MINUTE);
}

/**
 * Compute the initial fire timestamp for a brand-new sequence — the first
 * follow-up scheduled after `armedAt`.
 *
 * @param config resolved follow-up config
 * @param armedAt wall clock reference in ms (outbound agent message time)
 */
export function computeInitialFireAt(config: FollowUpSequenceConfig, armedAt: number): number {
  const minutes = intervalMinutesForIndex(config.schedule, 0);
  return armedAt + Math.round(minutes * MS_PER_MINUTE);
}
