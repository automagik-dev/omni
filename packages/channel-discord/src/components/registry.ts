/**
 * Instance-scoped component registry with TTL
 *
 * Tracks active interactive components (buttons, selects, etc.) per instance
 * and auto-expires stale interactions. Prevents ghost interactions and
 * cross-guild pollution via instance-scoped composite keys.
 *
 * Key format: `${instanceId}:${messageId}`
 *
 * Features:
 * - Configurable TTL (default 30 min)
 * - LRU eviction at 10000 max entries
 * - Reusable components (consume: false option)
 * - Per-user rate limiting for expired interaction attempts
 * - <1ms lookup performance
 * - <10MB memory footprint at max capacity
 */

/** Registered component entry */
export interface ComponentEntry {
  /** Components data associated with the message */
  components: unknown[];
  /** When this entry was registered */
  registeredAt: number;
  /** When this entry expires */
  expiresAt: number;
  /** Whether this entry persists after resolution (not consumed) */
  reusable: boolean;
  /** Instance ID for this entry */
  instanceId: string;
  /** Message ID for this entry */
  messageId: string;
}

/** Options for registering components */
export interface RegisterOptions {
  /** TTL in milliseconds (default: 30 min = 1800000) */
  ttlMs?: number;
  /** Whether component persists after interaction (default: false = consumed on resolve) */
  reusable?: boolean;
}

/** Options for resolving a component */
export interface ResolveOptions {
  /** Override consume behavior. When false, entry is NOT removed. (default: true = consume) */
  consume?: boolean;
}

/** Registry statistics */
export interface RegistryStats {
  /** Number of active (non-expired) entries */
  activeCount: number;
  /** Number of expired entries cleaned up since registry creation */
  expiredCount: number;
  /** Total entries currently in map (may include not-yet-cleaned expired) */
  totalEntries: number;
}

/** Rate limiter entry for expired interaction abuse */
interface RateLimitEntry {
  /** Timestamps of expired interaction attempts */
  attempts: number[];
}

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_ENTRIES = 10000;
const RATE_LIMIT_MAX_ATTEMPTS = 3;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 60 seconds

/**
 * Instance-scoped component registry with TTL and LRU eviction.
 *
 * Components are keyed by `instanceId:messageId` to ensure full
 * instance isolation — components from instance A are never accessible
 * from instance B.
 */
export class ComponentRegistry {
  /** Main storage: key = `instanceId:messageId` → entry */
  private entries = new Map<string, ComponentEntry>();

  /** Insertion order for LRU eviction */
  private insertionOrder: string[] = [];

  /** Expired interaction rate limiter: key = `userId:componentKey` */
  private rateLimits = new Map<string, RateLimitEntry>();

  /** Cumulative count of expired entries cleaned up */
  private expiredCount = 0;

  /** Cleanup interval handle */
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Periodic cleanup every 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  /**
   * Register components for a message.
   *
   * @param instanceId - Instance that sent the message
   * @param messageId - Message containing the components
   * @param components - Component data to store
   * @param options - Registration options (TTL, reusable)
   */
  register(instanceId: string, messageId: string, components: unknown[], options?: RegisterOptions): void {
    const key = this.makeKey(instanceId, messageId);
    const now = Date.now();
    const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;

    // Evict if at capacity
    if (this.entries.size >= MAX_ENTRIES && !this.entries.has(key)) {
      this.evictOldest();
    }

    const entry: ComponentEntry = {
      components,
      registeredAt: now,
      expiresAt: now + ttlMs,
      reusable: options?.reusable ?? false,
      instanceId,
      messageId,
    };

    this.entries.set(key, entry);

    // Track insertion order (remove if re-registering)
    const idx = this.insertionOrder.indexOf(key);
    if (idx !== -1) {
      this.insertionOrder.splice(idx, 1);
    }
    this.insertionOrder.push(key);
  }

  /**
   * Resolve a component entry for an interaction.
   *
   * Returns the entry if found, valid, and from the correct instance.
   * Returns null if not found, expired, or from a different instance.
   *
   * By default, consumed entries are removed (one-shot). Use `consume: false`
   * or register with `reusable: true` to keep the entry.
   *
   * @param instanceId - Instance receiving the interaction
   * @param messageId - Message the interaction originated from
   * @param options - Resolve options (consume behavior)
   * @returns Component entry or null
   */
  resolve(instanceId: string, messageId: string, options?: ResolveOptions): ComponentEntry | null {
    const key = this.makeKey(instanceId, messageId);
    const entry = this.entries.get(key);

    if (!entry) return null;

    // Instance isolation check (defense in depth — key already includes instanceId)
    if (entry.instanceId !== instanceId) return null;

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      this.removeFromInsertionOrder(key);
      this.expiredCount++;
      return null;
    }

    // Determine if we should consume
    const shouldConsume = options?.consume !== undefined ? options.consume : !entry.reusable;

    if (shouldConsume) {
      this.entries.delete(key);
      this.removeFromInsertionOrder(key);
    }

    return entry;
  }

  /**
   * Check if a user's expired interaction should be suppressed.
   *
   * After 3 expired-interaction clicks within 60s from the same user
   * on the same component, further responses are suppressed.
   *
   * @param userId - User who clicked the expired component
   * @param instanceId - Instance ID
   * @param messageId - Message ID
   * @returns true if the response should be suppressed
   */
  shouldSuppressExpired(userId: string, instanceId: string, messageId: string): boolean {
    const rateLimitKey = `${userId}:${instanceId}:${messageId}`;
    const now = Date.now();

    let entry = this.rateLimits.get(rateLimitKey);
    if (!entry) {
      entry = { attempts: [] };
      this.rateLimits.set(rateLimitKey, entry);
    }

    // Prune attempts outside the window
    entry.attempts = entry.attempts.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);

    // Record this attempt
    entry.attempts.push(now);

    // Suppress if over the limit
    return entry.attempts.length > RATE_LIMIT_MAX_ATTEMPTS;
  }

  /**
   * Check if a component exists (without consuming it).
   */
  has(instanceId: string, messageId: string): boolean {
    const key = this.makeKey(instanceId, messageId);
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      this.removeFromInsertionOrder(key);
      this.expiredCount++;
      return false;
    }
    return true;
  }

  /**
   * Unregister a component entry.
   */
  unregister(instanceId: string, messageId: string): boolean {
    const key = this.makeKey(instanceId, messageId);
    const existed = this.entries.delete(key);
    if (existed) {
      this.removeFromInsertionOrder(key);
    }
    return existed;
  }

  /**
   * Get registry statistics.
   */
  stats(): RegistryStats {
    const now = Date.now();
    let activeCount = 0;
    for (const entry of this.entries.values()) {
      if (now <= entry.expiresAt) activeCount++;
    }
    return {
      activeCount,
      expiredCount: this.expiredCount,
      totalEntries: this.entries.size,
    };
  }

  /**
   * Clean up expired entries and stale rate limit records.
   */
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.entries) {
      if (now > entry.expiresAt) {
        this.entries.delete(key);
        this.removeFromInsertionOrder(key);
        this.expiredCount++;
        cleaned++;
      }
    }

    // Clean up stale rate limit entries
    for (const [key, entry] of this.rateLimits) {
      entry.attempts = entry.attempts.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
      if (entry.attempts.length === 0) {
        this.rateLimits.delete(key);
      }
    }

    return cleaned;
  }

  /**
   * Clear all entries and reset stats.
   */
  clear(): void {
    this.entries.clear();
    this.insertionOrder = [];
    this.rateLimits.clear();
    this.expiredCount = 0;
  }

  /**
   * Destroy the registry and stop the cleanup interval.
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.clear();
  }

  /** Build composite key */
  private makeKey(instanceId: string, messageId: string): string {
    return `${instanceId}:${messageId}`;
  }

  /** Remove key from insertion order array */
  private removeFromInsertionOrder(key: string): void {
    const idx = this.insertionOrder.indexOf(key);
    if (idx !== -1) {
      this.insertionOrder.splice(idx, 1);
    }
  }

  /** Evict the oldest entry (LRU) */
  private evictOldest(): void {
    if (this.insertionOrder.length === 0) return;

    // First try to evict expired entries
    const now = Date.now();
    for (let i = 0; i < this.insertionOrder.length; i++) {
      const key = this.insertionOrder[i];
      const entry = this.entries.get(key);
      if (entry && now > entry.expiresAt) {
        this.entries.delete(key);
        this.insertionOrder.splice(i, 1);
        this.expiredCount++;
        return;
      }
    }

    // No expired entries, evict oldest by insertion order
    const oldestKey = this.insertionOrder.shift();
    if (oldestKey) {
      this.entries.delete(oldestKey);
    }
  }
}

/** Singleton registry instance */
let globalRegistry: ComponentRegistry | null = null;

/**
 * Get or create the global component registry.
 */
export function getComponentRegistry(): ComponentRegistry {
  if (!globalRegistry) {
    globalRegistry = new ComponentRegistry();
  }
  return globalRegistry;
}

/**
 * Reset the global registry (for testing).
 */
export function resetComponentRegistry(): void {
  if (globalRegistry) {
    globalRegistry.destroy();
    globalRegistry = null;
  }
}
