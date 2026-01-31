/**
 * Log Ring Buffer
 *
 * In-memory circular buffer for storing recent log entries.
 * Supports real-time subscriptions for SSE streaming.
 */

import type { LogEntry, LogLevel, LogListener, Unsubscribe } from './types';
import { LOG_LEVEL_VALUES } from './types';

/**
 * Default buffer capacity
 */
const DEFAULT_CAPACITY = 1000;

/**
 * Filter options for retrieving logs
 */
export interface LogFilter {
  /** Minimum log level */
  level?: LogLevel;
  /** Module patterns to include (supports wildcards: 'whatsapp:*') */
  modules?: string[];
  /** Maximum number of entries to return */
  limit?: number;
}

/**
 * Check if a module matches a pattern
 *
 * Supports wildcards: 'whatsapp:*' matches 'whatsapp:auth', 'whatsapp:socket', etc.
 */
function matchesModule(module: string, pattern: string): boolean {
  if (pattern === '*') return true;

  if (pattern.endsWith(':*')) {
    const prefix = pattern.slice(0, -2);
    return module === prefix || module.startsWith(`${prefix}:`);
  }

  return module === pattern;
}

/**
 * Check if a module matches any of the patterns
 */
function matchesAnyModule(module: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesModule(module, pattern));
}

/**
 * Check if an entry passes the level filter
 */
function passesLevelFilter(entry: LogEntry, minLevel: LogLevel): boolean {
  return LOG_LEVEL_VALUES[entry.level] >= LOG_LEVEL_VALUES[minLevel];
}

/**
 * Subscriber with optional filters
 */
interface Subscriber {
  listener: LogListener;
  level?: LogLevel;
  modules?: string[];
}

/**
 * Ring buffer for log entries
 *
 * - Fixed capacity with circular overwrite
 * - Supports real-time subscriptions
 * - Filterable by level and module
 */
export class LogBuffer {
  private buffer: LogEntry[];
  private head = 0;
  private count = 0;
  private capacity: number;
  private subscribers = new Set<Subscriber>();

  constructor(capacity = DEFAULT_CAPACITY) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
  }

  /**
   * Add a log entry to the buffer
   *
   * Notifies all matching subscribers.
   */
  push(entry: LogEntry): void {
    // Add to circular buffer
    this.buffer[this.head] = entry;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count++;
    }

    // Notify subscribers
    for (const sub of this.subscribers) {
      // Apply filters
      if (sub.level && !passesLevelFilter(entry, sub.level)) continue;
      if (sub.modules && !matchesAnyModule(entry.module, sub.modules)) continue;

      try {
        sub.listener(entry);
      } catch {
        // Don't let subscriber errors affect logging
      }
    }
  }

  /**
   * Get recent log entries with optional filtering
   */
  getRecent(filter: LogFilter = {}): LogEntry[] {
    const { level, modules, limit = 100 } = filter;
    const result: LogEntry[] = [];

    // Start from oldest entry and work forward
    const start = this.count < this.capacity ? 0 : this.head;

    for (let i = 0; i < this.count && result.length < limit; i++) {
      const idx = (start + i) % this.capacity;
      const entry = this.buffer[idx];

      // Skip empty slots (shouldn't happen but TypeScript needs assurance)
      if (!entry) continue;

      // Apply filters
      if (level && !passesLevelFilter(entry, level)) continue;
      if (modules && !matchesAnyModule(entry.module, modules)) continue;

      result.push(entry);
    }

    // Return most recent first
    return result.reverse().slice(0, limit);
  }

  /**
   * Subscribe to new log entries
   *
   * @param listener - Function called for each matching log entry
   * @param options - Optional filters for level and modules
   * @returns Unsubscribe function
   */
  subscribe(listener: LogListener, options?: { level?: LogLevel; modules?: string[] }): Unsubscribe {
    const subscriber: Subscriber = {
      listener,
      level: options?.level,
      modules: options?.modules,
    };

    this.subscribers.add(subscriber);

    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  /**
   * Get the current number of entries in the buffer
   */
  get size(): number {
    return this.count;
  }

  /**
   * Get the buffer capacity
   */
  get maxSize(): number {
    return this.capacity;
  }

  /**
   * Get the number of active subscribers
   */
  get subscriberCount(): number {
    return this.subscribers.size;
  }

  /**
   * Clear all entries from the buffer
   */
  clear(): void {
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this.count = 0;
  }
}

/**
 * Singleton log buffer instance
 *
 * Used by the logger and API endpoints.
 */
let globalBuffer: LogBuffer | null = null;

/**
 * Get the global log buffer instance
 */
export function getLogBuffer(): LogBuffer {
  if (!globalBuffer) {
    globalBuffer = new LogBuffer();
  }
  return globalBuffer;
}

/**
 * Reset the global buffer (for testing)
 */
export function resetLogBuffer(): void {
  globalBuffer = null;
}
