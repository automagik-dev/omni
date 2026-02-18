/**
 * Session Reset Strategy Engine
 *
 * Prevents unbounded conversation growth with configurable reset strategies:
 * - `none`: Current behavior, conversations grow indefinitely (default)
 * - `daily`: Reset at configurable hour (e.g., 03:00 UTC)
 * - `idle`: Reset after N minutes of inactivity (sliding window)
 *
 * Per-type config: different strategies for DM vs group vs thread.
 * Integration point: agent-dispatcher checks reset condition before processing.
 *
 * Reset clears agent conversation context but NOT message history in DB.
 * Coexists with ClaudeCodeProvider `sessionTtlMs` (provider-level TTL).
 */

// ============================================================================
// Types
// ============================================================================

/** Chat type classification */
export type ChatType = 'dm' | 'group' | 'thread';

/** Session reset mode */
export type SessionResetMode = 'none' | 'daily' | 'idle';

/** Session reset mode configuration (discriminated union) */
export type SessionResetModeConfig =
  | { mode: 'none' }
  | { mode: 'daily'; hour?: number }
  | { mode: 'idle'; minutes?: number };

/** Per-instance session reset configuration */
export interface SessionResetConfig {
  default?: SessionResetModeConfig;
  dm?: SessionResetModeConfig;
  group?: SessionResetModeConfig;
  thread?: SessionResetModeConfig;
}

/** Result of a session reset check */
export interface ResetResult {
  shouldReset: boolean;
  strategy: SessionResetMode;
}

/** Session activity info */
export interface SessionActivity {
  lastActivityAt: number | null;
  lastResetAt: number | null;
}

/** Interface for session activity storage */
export interface SessionActivityStore {
  getActivity(instanceId: string, sessionId: string): SessionActivity;
  recordActivity(instanceId: string, sessionId: string, timestamp: number): void;
  recordReset(instanceId: string, sessionId: string, timestamp: number): void;
}

// ============================================================================
// Default Configuration
// ============================================================================

/** Default reset mode: no reset (backward compatible) */
const DEFAULT_RESET_CONFIG: SessionResetModeConfig = { mode: 'none' };

/** Default daily reset hour: 03:00 UTC */
const DEFAULT_DAILY_HOUR = 3;

/** Default idle timeout: 60 minutes */
const DEFAULT_IDLE_MINUTES = 60;

// ============================================================================
// In-Memory Session Activity Store
// ============================================================================

/**
 * Simple in-memory store for session activity timestamps.
 * Key format: `${instanceId}:${sessionId}`
 *
 * Growth is bounded by `maxEntries` (default 50 000).  When the limit is
 * reached the oldest 10 % of entries are evicted (Map insertion order).
 */
export class InMemorySessionActivityStore implements SessionActivityStore {
  private activities: Map<string, { lastActivityAt: number | null; lastResetAt: number | null }> = new Map();
  private readonly maxEntries: number;

  constructor(maxEntries = 50_000) {
    this.maxEntries = maxEntries;
  }

  private key(instanceId: string, sessionId: string): string {
    return `${instanceId}:${sessionId}`;
  }

  /** Evict the oldest 10 % of entries when the store is at capacity. */
  private evictIfNeeded(): void {
    if (this.activities.size < this.maxEntries) return;
    const toDelete = Math.ceil(this.maxEntries * 0.1);
    let deleted = 0;
    for (const k of this.activities.keys()) {
      this.activities.delete(k);
      deleted++;
      if (deleted >= toDelete) break;
    }
  }

  getActivity(instanceId: string, sessionId: string): SessionActivity {
    const stored = this.activities.get(this.key(instanceId, sessionId));
    return {
      lastActivityAt: stored?.lastActivityAt ?? null,
      lastResetAt: stored?.lastResetAt ?? null,
    };
  }

  recordActivity(instanceId: string, sessionId: string, timestamp: number): void {
    const k = this.key(instanceId, sessionId);
    const existing = this.activities.get(k);
    if (existing) {
      existing.lastActivityAt = timestamp;
    } else {
      this.evictIfNeeded();
      this.activities.set(k, { lastActivityAt: timestamp, lastResetAt: null });
    }
  }

  recordReset(instanceId: string, sessionId: string, timestamp: number): void {
    const k = this.key(instanceId, sessionId);
    const existing = this.activities.get(k);
    if (existing) {
      existing.lastResetAt = timestamp;
      // Clear last activity on reset so next message is treated as fresh
      existing.lastActivityAt = null;
    } else {
      this.evictIfNeeded();
      this.activities.set(k, { lastActivityAt: null, lastResetAt: timestamp });
    }
  }

  /** Get size (for testing/monitoring) */
  get size(): number {
    return this.activities.size;
  }

  /** Clear all entries */
  clear(): void {
    this.activities.clear();
  }
}

// ============================================================================
// Reset Check Logic
// ============================================================================

/**
 * Get today's reset time (a specific UTC hour) as a timestamp.
 * Returns the most recent occurrence of that hour.
 */
export function getTodayResetTime(now: number, hour: number): number {
  const date = new Date(now);
  date.setUTCHours(hour, 0, 0, 0);
  // If the reset time is in the future, use yesterday's reset time
  if (date.getTime() > now) {
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return date.getTime();
}

/**
 * Resolve the effective reset config for a given chat type.
 * Priority: chat-type-specific > default > none
 */
export function resolveResetConfig(
  config: SessionResetConfig | null | undefined,
  chatType: ChatType,
): SessionResetModeConfig {
  if (!config) return DEFAULT_RESET_CONFIG;
  return config[chatType] ?? config.default ?? DEFAULT_RESET_CONFIG;
}

/**
 * Check daily reset condition.
 * Resets if last activity was before today's reset hour and no reset since.
 */
function checkDailyReset(hour: number, activity: SessionActivity, now: number): boolean {
  const todayResetTime = getTodayResetTime(now, hour);
  const { lastActivityAt, lastResetAt } = activity;

  // No prior activity — nothing to clear
  if (lastActivityAt === null) return false;

  // Activity before reset time + no reset since = should reset
  return lastActivityAt < todayResetTime && (!lastResetAt || lastResetAt < todayResetTime);
}

/**
 * Check idle reset condition.
 * Resets if last activity was more than N minutes ago.
 */
function checkIdleReset(minutes: number, activity: SessionActivity, now: number): boolean {
  if (activity.lastActivityAt === null) return false;
  return now - activity.lastActivityAt > minutes * 60_000;
}

/**
 * Check if a session should be reset based on the configured strategy.
 *
 * @param config - Session reset config from instance
 * @param chatType - Type of chat (dm, group, thread)
 * @param activity - Session activity timestamps
 * @param now - Current timestamp (injectable for testing)
 * @returns ResetResult indicating whether to reset and which strategy triggered
 */
export function checkSessionReset(
  config: SessionResetConfig | null | undefined,
  chatType: ChatType,
  activity: SessionActivity,
  now: number = Date.now(),
): ResetResult {
  const modeConfig = resolveResetConfig(config, chatType);

  if (modeConfig.mode === 'daily') {
    const shouldReset = checkDailyReset(modeConfig.hour ?? DEFAULT_DAILY_HOUR, activity, now);
    return { shouldReset, strategy: 'daily' };
  }

  if (modeConfig.mode === 'idle') {
    const shouldReset = checkIdleReset(modeConfig.minutes ?? DEFAULT_IDLE_MINUTES, activity, now);
    return { shouldReset, strategy: 'idle' };
  }

  return { shouldReset: false, strategy: 'none' };
}

// ============================================================================
// Exports
// ============================================================================

export { DEFAULT_RESET_CONFIG, DEFAULT_DAILY_HOUR, DEFAULT_IDLE_MINUTES };
