/**
 * Humanized Delays & Rate Limiter for LinkedIn automation.
 *
 * Timing constants are derived from the linkedin-agent Python scripts
 * (scan_raw.py, reply.py, read_full.py) and randomized within a range
 * to avoid detection patterns.
 *
 * Rate limiter tracks action counts per time window and blocks when
 * configurable limits are exceeded.
 */

import type { Page } from 'playwright';
import type { ActiveHoursConfig, RateLimitsConfig } from '../types';
import { DEFAULT_RATE_LIMITS } from '../types';

// ---------------------------------------------------------------------------
// Timing Constants — baseline from linkedin-agent, randomized around center
// ---------------------------------------------------------------------------

/**
 * Delay ranges in milliseconds. Each range is centered around the
 * value used in the linkedin-agent Python scripts.
 */
export const TIMING = {
  /** Page navigation wait — scan_raw.py: page.wait_for_timeout(3000) */
  navigation: { min: 2000, max: 4000 },
  /** Message list load — scan_raw.py: page.wait_for_timeout(2500) */
  messageLoad: { min: 2000, max: 3500 },
  /** Scroll iteration pause — scan_raw.py: page.wait_for_timeout(1500) */
  scroll: { min: 800, max: 1500 },
  /** Post-click settle time — scan_raw.py: page.wait_for_timeout(1000) */
  postClick: { min: 700, max: 1300 },
  /** Per-character typing delay — simulates human typing speed */
  typing: { min: 30, max: 80 },
  /** Pause between sending separate messages */
  betweenMessages: { min: 3000, max: 8000 },
  /** Pause between feed actions (like, comment) */
  betweenFeedActions: { min: 5000, max: 15000 },
  /** Pause between navigating to different pages */
  betweenPageViews: { min: 2000, max: 5000 },
} as const;

export type TimingKey = keyof typeof TIMING;

// ---------------------------------------------------------------------------
// Navigation Constants — from linkedin-agent
// ---------------------------------------------------------------------------

/** scan_raw.py: 3 attempts for navigation retry */
export const NAV_RETRY_ATTEMPTS = 3;
/** scan_raw.py: 2s between retries */
export const NAV_RETRY_DELAY = 2000;
/** scan_raw.py: 20 scroll iterations to load conversation list */
export const CONVERSATION_SCROLL_MAX = 20;
/** read_full.py: 5 scroll-up iterations for full message history */
export const HISTORY_SCROLL_UP = 5;

// ---------------------------------------------------------------------------
// Delay Functions
// ---------------------------------------------------------------------------

/**
 * Generate a random integer between min and max (inclusive).
 */
function randomInRange(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Wait for a humanized random duration within the specified timing range.
 *
 * @param type - Key from TIMING constants
 * @returns Promise that resolves after the random delay
 */
export async function humanDelay(type: TimingKey): Promise<void> {
  const range = TIMING[type];
  const ms = randomInRange(range.min, range.max);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for a specific number of milliseconds.
 * Prefer humanDelay() for most cases — use this only for exact waits.
 */
export async function exactDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Type text character by character with humanized per-key delays.
 * Simulates realistic typing speed to avoid bot detection.
 *
 * @param page - Playwright Page instance
 * @param selector - CSS selector for the input element
 * @param text - Text to type
 */
export async function typeText(page: Page, selector: string, text: string): Promise<void> {
  await page.click(selector);
  for (const char of text) {
    await page.keyboard.type(char, {
      delay: randomInRange(TIMING.typing.min, TIMING.typing.max),
    });
  }
}

// ---------------------------------------------------------------------------
// Rate Limiter
// ---------------------------------------------------------------------------

type RateLimitAction = keyof RateLimitsConfig;

interface ActionRecord {
  timestamps: number[];
}

/**
 * Tracks action counts per time window and blocks when limits are exceeded.
 * Each action type has an independent counter and configurable limit.
 */
export class RateLimiter {
  private readonly limits: RateLimitsConfig;
  private readonly actions: Map<RateLimitAction, ActionRecord> = new Map();

  constructor(limits?: Partial<RateLimitsConfig>) {
    this.limits = { ...DEFAULT_RATE_LIMITS, ...limits };
  }

  /**
   * Get the time window in milliseconds for a given action.
   * Actions ending in "PerDay" use a 24h window; others use 1h.
   */
  private getWindowMs(action: RateLimitAction): number {
    if (action.includes('PerDay')) {
      return 24 * 60 * 60 * 1000;
    }
    return 60 * 60 * 1000;
  }

  /**
   * Prune timestamps older than the time window for an action.
   */
  private prune(action: RateLimitAction): number[] {
    const record = this.actions.get(action);
    if (!record) return [];

    const windowMs = this.getWindowMs(action);
    const cutoff = Date.now() - windowMs;
    record.timestamps = record.timestamps.filter((t) => t > cutoff);
    return record.timestamps;
  }

  /**
   * Check if the action can be performed without exceeding the rate limit.
   *
   * @param action - The rate limit action key
   * @returns true if within limits, false if limit would be exceeded
   */
  canPerform(action: RateLimitAction): boolean {
    const recent = this.prune(action);
    const limit = this.limits[action];
    return recent.length < limit;
  }

  /**
   * Record that an action was performed. Call this AFTER the action succeeds.
   *
   * @param action - The rate limit action key
   */
  record(action: RateLimitAction): void {
    let record = this.actions.get(action);
    if (!record) {
      record = { timestamps: [] };
      this.actions.set(action, record);
    }
    record.timestamps.push(Date.now());
  }

  /**
   * Check if an action can be performed; if yes, record it and return true.
   * If limit is exceeded, return false without recording.
   *
   * @param action - The rate limit action key
   * @returns true if the action was allowed and recorded
   */
  tryPerform(action: RateLimitAction): boolean {
    if (!this.canPerform(action)) {
      return false;
    }
    this.record(action);
    return true;
  }

  /**
   * Get the number of remaining allowed actions in the current window.
   *
   * @param action - The rate limit action key
   * @returns Number of remaining actions
   */
  remaining(action: RateLimitAction): number {
    const recent = this.prune(action);
    const limit = this.limits[action];
    return Math.max(0, limit - recent.length);
  }

  /**
   * Reset all tracked action counts.
   */
  reset(): void {
    this.actions.clear();
  }

  /**
   * Get a summary of all action counts and limits.
   */
  getSummary(): Record<RateLimitAction, { used: number; limit: number; remaining: number }> {
    const summary = {} as Record<RateLimitAction, { used: number; limit: number; remaining: number }>;
    for (const action of Object.keys(this.limits) as RateLimitAction[]) {
      const recent = this.prune(action);
      const limit = this.limits[action];
      summary[action] = {
        used: recent.length,
        limit,
        remaining: Math.max(0, limit - recent.length),
      };
    }
    return summary;
  }
}

// ---------------------------------------------------------------------------
// Active Hours Check
// ---------------------------------------------------------------------------

/**
 * Check whether the current time falls within the configured active hours.
 * Used to avoid LinkedIn activity during unusual hours that might trigger
 * bot detection.
 *
 * @param config - Active hours configuration with start, end, and timezone
 * @returns true if current time is within active hours
 */
export function isActiveHours(config: ActiveHoursConfig): boolean {
  // Get current hour in the configured timezone
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hour12: false,
    timeZone: config.timezone,
  });
  const currentHour = Number.parseInt(formatter.format(now), 10);

  if (config.start <= config.end) {
    // Simple range, e.g. 8-22
    return currentHour >= config.start && currentHour < config.end;
  }
  // Wraps midnight, e.g. 22-6
  return currentHour >= config.start || currentHour < config.end;
}
