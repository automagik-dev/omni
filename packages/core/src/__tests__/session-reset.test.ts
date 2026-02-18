/**
 * Session Reset Strategy Engine Tests
 *
 * Tests for:
 * - checkSessionReset: daily, idle, none modes
 * - resolveResetConfig: per-type and default resolution
 * - InMemorySessionActivityStore: activity tracking
 * - getTodayResetTime: UTC hour boundary calculation
 * - Edge cases: missing config, no prior activity, boundary conditions
 */

import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_DAILY_HOUR,
  DEFAULT_IDLE_MINUTES,
  InMemorySessionActivityStore,
  type SessionResetConfig,
  checkSessionReset,
  getTodayResetTime,
  resolveResetConfig,
} from '../sessions/reset';

// ============================================================================
// Helpers
// ============================================================================

/** Create a timestamp for a specific UTC hour today */
function utcToday(hour: number, minute = 0): number {
  const d = new Date();
  d.setUTCHours(hour, minute, 0, 0);
  return d.getTime();
}

/** Create a timestamp N minutes ago */
function minutesAgo(n: number, from = Date.now()): number {
  return from - n * 60_000;
}

/** Create a timestamp N hours ago */
function hoursAgo(n: number, from = Date.now()): number {
  return from - n * 3_600_000;
}

// ============================================================================
// Tests
// ============================================================================

describe('Session Reset Strategy Engine', () => {
  describe('resolveResetConfig', () => {
    it('should return "none" for null config', () => {
      const result = resolveResetConfig(null, 'dm');
      expect(result.mode).toBe('none');
    });

    it('should return "none" for undefined config', () => {
      const result = resolveResetConfig(undefined, 'dm');
      expect(result.mode).toBe('none');
    });

    it('should return "none" for empty config', () => {
      const result = resolveResetConfig({}, 'dm');
      expect(result.mode).toBe('none');
    });

    it('should return chat-type-specific config when available', () => {
      const config: SessionResetConfig = {
        default: { mode: 'none' },
        dm: { mode: 'idle', minutes: 120 },
      };
      const result = resolveResetConfig(config, 'dm');
      expect(result.mode).toBe('idle');
      if (result.mode === 'idle') {
        expect(result.minutes).toBe(120);
      }
    });

    it('should fall back to default when chat-type not configured', () => {
      const config: SessionResetConfig = {
        default: { mode: 'daily', hour: 5 },
      };
      const result = resolveResetConfig(config, 'group');
      expect(result.mode).toBe('daily');
      if (result.mode === 'daily') {
        expect(result.hour).toBe(5);
      }
    });

    it('should support different configs per chat type', () => {
      const config: SessionResetConfig = {
        dm: { mode: 'idle', minutes: 120 },
        group: { mode: 'daily', hour: 3 },
        thread: { mode: 'none' },
      };
      expect(resolveResetConfig(config, 'dm').mode).toBe('idle');
      expect(resolveResetConfig(config, 'group').mode).toBe('daily');
      expect(resolveResetConfig(config, 'thread').mode).toBe('none');
    });
  });

  describe('checkSessionReset - none mode', () => {
    it('should never reset in none mode', () => {
      const result = checkSessionReset({ default: { mode: 'none' } }, 'dm', {
        lastActivityAt: hoursAgo(48),
        lastResetAt: null,
      });
      expect(result.shouldReset).toBe(false);
      expect(result.strategy).toBe('none');
    });

    it('should never reset with null config', () => {
      const result = checkSessionReset(null, 'dm', { lastActivityAt: hoursAgo(48), lastResetAt: null });
      expect(result.shouldReset).toBe(false);
      expect(result.strategy).toBe('none');
    });
  });

  describe('checkSessionReset - daily mode', () => {
    it('should reset when last activity was before reset hour', () => {
      // Simulate: it's 10:00 UTC, last activity was 02:00 UTC, reset hour is 03:00
      const now = utcToday(10);
      const lastActivity = utcToday(2);

      const result = checkSessionReset(
        { default: { mode: 'daily', hour: 3 } },
        'dm',
        { lastActivityAt: lastActivity, lastResetAt: null },
        now,
      );
      expect(result.shouldReset).toBe(true);
      expect(result.strategy).toBe('daily');
    });

    it('should NOT reset when last activity was after reset hour', () => {
      // Simulate: it's 10:00 UTC, last activity was 04:00 UTC, reset hour is 03:00
      const now = utcToday(10);
      const lastActivity = utcToday(4);

      const result = checkSessionReset(
        { default: { mode: 'daily', hour: 3 } },
        'dm',
        { lastActivityAt: lastActivity, lastResetAt: null },
        now,
      );
      expect(result.shouldReset).toBe(false);
    });

    it('should NOT reset if already reset today', () => {
      const now = utcToday(10);
      const lastActivity = utcToday(2);
      const lastReset = utcToday(5); // Reset happened after the 03:00 reset hour

      const result = checkSessionReset(
        { default: { mode: 'daily', hour: 3 } },
        'dm',
        { lastActivityAt: lastActivity, lastResetAt: lastReset },
        now,
      );
      expect(result.shouldReset).toBe(false);
    });

    it('should use default hour (3) when not specified', () => {
      expect(DEFAULT_DAILY_HOUR).toBe(3);

      const now = utcToday(10);
      const lastActivity = utcToday(2);

      const result = checkSessionReset(
        { default: { mode: 'daily' } },
        'dm',
        { lastActivityAt: lastActivity, lastResetAt: null },
        now,
      );
      expect(result.shouldReset).toBe(true);
    });

    it('should NOT reset when no prior activity', () => {
      const now = utcToday(10);

      const result = checkSessionReset(
        { default: { mode: 'daily', hour: 3 } },
        'dm',
        { lastActivityAt: null, lastResetAt: null },
        now,
      );
      // No activity = nothing to clear
      expect(result.shouldReset).toBe(false);
    });
  });

  describe('checkSessionReset - idle mode', () => {
    it('should reset when idle time exceeds threshold', () => {
      const now = Date.now();
      const result = checkSessionReset(
        { default: { mode: 'idle', minutes: 60 } },
        'dm',
        { lastActivityAt: minutesAgo(61, now), lastResetAt: null },
        now,
      );
      expect(result.shouldReset).toBe(true);
      expect(result.strategy).toBe('idle');
    });

    it('should NOT reset when idle time is under threshold', () => {
      const now = Date.now();
      const result = checkSessionReset(
        { default: { mode: 'idle', minutes: 60 } },
        'dm',
        { lastActivityAt: minutesAgo(30, now), lastResetAt: null },
        now,
      );
      expect(result.shouldReset).toBe(false);
    });

    it('should NOT reset when no prior activity', () => {
      const result = checkSessionReset({ default: { mode: 'idle', minutes: 60 } }, 'dm', {
        lastActivityAt: null,
        lastResetAt: null,
      });
      expect(result.shouldReset).toBe(false);
    });

    it('should use default idle minutes (60) when not specified', () => {
      expect(DEFAULT_IDLE_MINUTES).toBe(60);

      const now = Date.now();
      const result = checkSessionReset(
        { default: { mode: 'idle' } },
        'dm',
        { lastActivityAt: minutesAgo(61, now), lastResetAt: null },
        now,
      );
      expect(result.shouldReset).toBe(true);
    });

    it('should handle custom idle minutes', () => {
      const now = Date.now();
      const result = checkSessionReset(
        { default: { mode: 'idle', minutes: 30 } },
        'dm',
        { lastActivityAt: minutesAgo(31, now), lastResetAt: null },
        now,
      );
      expect(result.shouldReset).toBe(true);
    });
  });

  describe('checkSessionReset - per-type configs', () => {
    it('DMs can use idle while groups use daily', () => {
      const config: SessionResetConfig = {
        dm: { mode: 'idle', minutes: 120 },
        group: { mode: 'daily', hour: 3 },
      };

      const now = utcToday(10);
      const recentActivity = minutesAgo(30, now);
      const oldActivity = utcToday(2);

      // DM with recent activity: no reset
      const dmResult = checkSessionReset(config, 'dm', { lastActivityAt: recentActivity, lastResetAt: null }, now);
      expect(dmResult.shouldReset).toBe(false);

      // Group with pre-reset activity: should reset
      const groupResult = checkSessionReset(config, 'group', { lastActivityAt: oldActivity, lastResetAt: null }, now);
      expect(groupResult.shouldReset).toBe(true);
    });
  });

  describe('getTodayResetTime', () => {
    it('should return today reset time when past the hour', () => {
      const now = utcToday(10);
      const resetTime = getTodayResetTime(now, 3);
      const resetDate = new Date(resetTime);
      expect(resetDate.getUTCHours()).toBe(3);
      expect(resetTime).toBeLessThan(now);
    });

    it('should return yesterday reset time when before the hour', () => {
      const now = utcToday(2);
      const resetTime = getTodayResetTime(now, 3);
      expect(resetTime).toBeLessThan(now);
      const resetDate = new Date(resetTime);
      expect(resetDate.getUTCHours()).toBe(3);
    });
  });

  describe('InMemorySessionActivityStore', () => {
    it('should return null activity for unknown sessions', () => {
      const store = new InMemorySessionActivityStore();
      const activity = store.getActivity('inst-1', 'session-1');
      expect(activity.lastActivityAt).toBeNull();
      expect(activity.lastResetAt).toBeNull();
    });

    it('should record and retrieve activity', () => {
      const store = new InMemorySessionActivityStore();
      const now = Date.now();

      store.recordActivity('inst-1', 'session-1', now);
      const activity = store.getActivity('inst-1', 'session-1');

      expect(activity.lastActivityAt).toBe(now);
      expect(activity.lastResetAt).toBeNull();
    });

    it('should record and retrieve reset', () => {
      const store = new InMemorySessionActivityStore();
      const activityTime = Date.now() - 1000;
      const resetTime = Date.now();

      store.recordActivity('inst-1', 'session-1', activityTime);
      store.recordReset('inst-1', 'session-1', resetTime);

      const activity = store.getActivity('inst-1', 'session-1');
      expect(activity.lastResetAt).toBe(resetTime);
      // Activity should be cleared on reset
      expect(activity.lastActivityAt).toBeNull();
    });

    it('should track sessions independently', () => {
      const store = new InMemorySessionActivityStore();
      const now = Date.now();

      store.recordActivity('inst-1', 'session-1', now);
      store.recordActivity('inst-1', 'session-2', now + 1000);

      expect(store.getActivity('inst-1', 'session-1').lastActivityAt).toBe(now);
      expect(store.getActivity('inst-1', 'session-2').lastActivityAt).toBe(now + 1000);
    });

    it('should support clear', () => {
      const store = new InMemorySessionActivityStore();
      store.recordActivity('inst-1', 'session-1', Date.now());
      store.clear();
      expect(store.size).toBe(0);
    });
  });
});
