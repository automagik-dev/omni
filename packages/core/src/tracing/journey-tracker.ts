/**
 * JourneyTracker - In-memory message journey instrumentation
 *
 * Tracks message lifecycle checkpoints (T0→T11) for latency measurement.
 * Singleton service with configurable TTL, sampling rate, and LRU eviction.
 *
 * @see .wishes/message-journey-tracing/message-journey-tracing-wish.md
 */

/** Stage definitions for the message journey */
export const JOURNEY_STAGES = {
  // Inbound flow
  T0: 'platformReceivedAt',
  T1: 'pluginReceivedAt',
  T2: 'eventPublishedAt',
  T3: 'eventConsumedAt',
  T4: 'dbStoredAt',
  T5: 'agentNotifiedAt',
  // Agent processing (T6 not trackable - external)
  T7: 'agentCompletedAt',
  // Outbound flow
  T8: 'apiProcessedAt',
  T9: 'outboundEventPublishedAt',
  T10: 'pluginSentAt',
  T11: 'platformDeliveredAt',
} as const;

export type JourneyStage = keyof typeof JOURNEY_STAGES;
export type JourneyStageName = (typeof JOURNEY_STAGES)[JourneyStage];

/** Individual checkpoint in a journey */
export interface JourneyCheckpoint {
  name: string;
  stage: string;
  timestamp: number;
}

/** Calculated latencies between stages */
export interface JourneyLatencies {
  channelProcessing?: number; // T1 - T0
  eventPublish?: number; // T2 - T1
  natsDelivery?: number; // T3 - T2
  dbWrite?: number; // T4 - T3
  agentNotification?: number; // T5 - T4
  totalInbound?: number; // T5 - T0
  agentRoundTrip?: number; // T7 - T5
  apiProcessing?: number; // T8 - T7
  outboundEventPublish?: number; // T9 - T8
  outboundNatsDelivery?: number; // T10 - T9
  platformSend?: number; // T11 - T10
  totalOutbound?: number; // T11 - T7
  totalRoundTrip?: number; // T11 - T0
  omniProcessing?: number; // (T5 - T0) + (T11 - T7)
}

/** A complete message journey */
export interface Journey {
  correlationId: string;
  checkpoints: JourneyCheckpoint[];
  startedAt: number;
  completedAt?: number;
  latencies: JourneyLatencies;
}

/** Aggregated percentile stats for a single metric */
export interface PercentileStats {
  count: number;
  avg: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
}

/** Summary of journey metrics across tracked messages */
export interface JourneySummary {
  totalTracked: number;
  completedJourneys: number;
  activeJourneys: number;
  stages: Partial<Record<keyof JourneyLatencies, PercentileStats>>;
  since: number;
}

/** Options for getSummary */
export interface SummaryOptions {
  /** Only include journeys started after this timestamp (Unix ms) */
  since?: number;
}

/** Internal journey entry with LRU tracking */
interface JourneyEntry {
  journey: Journey;
  /** Monotonic access counter for LRU ordering */
  accessOrder: number;
  createdAt: number;
}

/** Stage pair definitions for latency calculation */
const LATENCY_PAIRS: Array<{
  key: keyof JourneyLatencies;
  from: string;
  to: string;
}> = [
  { key: 'channelProcessing', from: 'T0', to: 'T1' },
  { key: 'eventPublish', from: 'T1', to: 'T2' },
  { key: 'natsDelivery', from: 'T2', to: 'T3' },
  { key: 'dbWrite', from: 'T3', to: 'T4' },
  { key: 'agentNotification', from: 'T4', to: 'T5' },
  { key: 'totalInbound', from: 'T0', to: 'T5' },
  { key: 'agentRoundTrip', from: 'T5', to: 'T7' },
  { key: 'apiProcessing', from: 'T7', to: 'T8' },
  { key: 'outboundEventPublish', from: 'T8', to: 'T9' },
  { key: 'outboundNatsDelivery', from: 'T9', to: 'T10' },
  { key: 'platformSend', from: 'T10', to: 'T11' },
  { key: 'totalOutbound', from: 'T7', to: 'T11' },
  { key: 'totalRoundTrip', from: 'T0', to: 'T11' },
];

/** Default configuration */
const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_SAMPLE_RATE = 1.0; // 100%
const DEFAULT_MAX_ENTRIES = 50_000;
const CLEANUP_INTERVAL_MS = 60_000; // 60 seconds

export interface JourneyTrackerConfig {
  ttlMs?: number;
  sampleRate?: number;
  maxEntries?: number;
}

export class JourneyTracker {
  private entries = new Map<string, JourneyEntry>();
  private readonly ttlMs: number;
  private readonly sampleRate: number;
  private readonly maxEntries: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private accessCounter = 0;

  constructor(config?: JourneyTrackerConfig) {
    this.ttlMs = config?.ttlMs ?? numberFromEnv('JOURNEY_TTL_MS', DEFAULT_TTL_MS);
    this.sampleRate = config?.sampleRate ?? numberFromEnv('JOURNEY_SAMPLE_RATE', DEFAULT_SAMPLE_RATE);
    this.maxEntries = config?.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.startCleanup();
  }

  /** Check if a new journey should be sampled (based on configured rate) */
  shouldSample(): boolean {
    if (this.sampleRate >= 1.0) return true;
    if (this.sampleRate <= 0) return false;
    return Math.random() < this.sampleRate;
  }

  /** Check if a journey is currently being tracked */
  isTracking(correlationId: string): boolean {
    return this.entries.has(correlationId);
  }

  /**
   * Record a checkpoint for a journey.
   * Creates the journey if it doesn't exist (first checkpoint).
   * Synchronous — uses Date.now() by default.
   */
  recordCheckpoint(correlationId: string, stage: string, name: string, timestamp: number = Date.now()): void {
    let entry = this.entries.get(correlationId);

    if (!entry) {
      // New journey — enforce max entries with LRU eviction
      if (this.entries.size >= this.maxEntries) {
        this.evictLRU();
      }

      const journey: Journey = {
        correlationId,
        checkpoints: [],
        startedAt: timestamp,
        latencies: {},
      };
      entry = {
        journey,
        accessOrder: ++this.accessCounter,
        createdAt: timestamp,
      };
      this.entries.set(correlationId, entry);
    }

    entry.journey.checkpoints.push({ name, stage, timestamp });
    entry.accessOrder = ++this.accessCounter;

    // Recalculate latencies
    this.calculateLatencies(entry.journey);

    // Mark as complete if T11 or T5 (if no outbound expected yet)
    if (stage === 'T11') {
      entry.journey.completedAt = timestamp;
    }
  }

  /** Get a journey by correlation ID, or null if not found */
  getJourney(correlationId: string): Journey | null {
    const entry = this.entries.get(correlationId);
    if (!entry) return null;
    entry.accessOrder = ++this.accessCounter;
    return entry.journey;
  }

  /** Get aggregated summary of all tracked journeys */
  getSummary(options?: SummaryOptions): JourneySummary {
    const since = options?.since ?? 0;
    const allJourneys = this.getJourneysSince(since);
    const stages = aggregateLatencies(allJourneys);

    return {
      totalTracked: allJourneys.length,
      completedJourneys: allJourneys.filter((j) => j.completedAt != null).length,
      activeJourneys: allJourneys.filter((j) => j.completedAt == null).length,
      stages,
      since,
    };
  }

  /** Get all journeys started after a given timestamp */
  private getJourneysSince(since: number): Journey[] {
    const result: Journey[] = [];
    for (const entry of this.entries.values()) {
      if (entry.journey.startedAt >= since) {
        result.push(entry.journey);
      }
    }
    return result;
  }

  /** Get the count of tracked journeys */
  get size(): number {
    return this.entries.size;
  }

  /** Clear all tracked journeys */
  clear(): void {
    this.entries.clear();
  }

  /** Stop the cleanup timer (call on shutdown) */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.entries.clear();
  }

  /** Calculate latencies from checkpoint timestamps */
  private calculateLatencies(journey: Journey): void {
    const stageMap = new Map<string, number>();
    for (const cp of journey.checkpoints) {
      // Keep first occurrence of each stage (in case of duplicates)
      if (!stageMap.has(cp.stage)) {
        stageMap.set(cp.stage, cp.timestamp);
      }
    }

    const latencies: JourneyLatencies = {};

    for (const pair of LATENCY_PAIRS) {
      const fromTs = stageMap.get(pair.from);
      const toTs = stageMap.get(pair.to);
      if (fromTs != null && toTs != null) {
        latencies[pair.key] = toTs - fromTs;
      }
    }

    // Special: omniProcessing = (T5 - T0) + (T11 - T7), excluding agent time
    const t0 = stageMap.get('T0');
    const t5 = stageMap.get('T5');
    const t7 = stageMap.get('T7');
    const t11 = stageMap.get('T11');
    if (t0 != null && t5 != null) {
      const inbound = t5 - t0;
      if (t7 != null && t11 != null) {
        latencies.omniProcessing = inbound + (t11 - t7);
      } else {
        latencies.omniProcessing = inbound;
      }
    }

    journey.latencies = latencies;
  }

  /** Remove the least recently accessed entry */
  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestOrder = Number.POSITIVE_INFINITY;

    for (const [key, entry] of this.entries) {
      if (entry.accessOrder < oldestOrder) {
        oldestOrder = entry.accessOrder;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.entries.delete(oldestKey);
    }
  }

  /** Periodic cleanup of expired entries */
  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      const cutoff = now - this.ttlMs;
      for (const [key, entry] of this.entries) {
        if (entry.createdAt < cutoff) {
          this.entries.delete(key);
        }
      }
    }, CLEANUP_INTERVAL_MS);

    // Don't prevent process exit
    if (this.cleanupTimer && typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      this.cleanupTimer.unref();
    }
  }
}

/** Collect and aggregate latency values across journeys */
function aggregateLatencies(journeys: Journey[]): Partial<Record<keyof JourneyLatencies, PercentileStats>> {
  const buckets: Partial<Record<keyof JourneyLatencies, number[]>> = {};

  for (const journey of journeys) {
    for (const [key, value] of Object.entries(journey.latencies)) {
      if (value == null || value < 0) continue;
      const k = key as keyof JourneyLatencies;
      if (!buckets[k]) buckets[k] = [];
      buckets[k]?.push(value);
    }
  }

  const result: Partial<Record<keyof JourneyLatencies, PercentileStats>> = {};
  for (const [key, values] of Object.entries(buckets)) {
    if (values && values.length > 0) {
      result[key as keyof JourneyLatencies] = calculatePercentiles(values);
    }
  }
  return result;
}

/** Calculate percentile stats from a non-empty array of numbers */
function calculatePercentiles(values: number[]): PercentileStats {
  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.length;
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const first = sorted[0] ?? 0;
  const last = sorted[count - 1] ?? 0;

  return {
    count,
    avg: Math.round(sum / count),
    min: first,
    max: last,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
  };
}

/** Get a percentile value from a sorted array (must be non-empty) */
function percentile(sorted: number[], p: number): number {
  if (sorted.length <= 1) return sorted[0] ?? 0;
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const lowerVal = sorted[lower] ?? 0;
  const upperVal = sorted[upper] ?? 0;
  if (lower === upper) return lowerVal;
  const weight = index - lower;
  return Math.round(lowerVal * (1 - weight) + upperVal * weight);
}

/** Read a number from env var with fallback */
function numberFromEnv(name: string, fallback: number): number {
  const val = typeof process !== 'undefined' ? process.env[name] : undefined;
  if (val == null) return fallback;
  const parsed = Number(val);
  return Number.isNaN(parsed) ? fallback : parsed;
}

// --- Singleton ---

let instance: JourneyTracker | null = null;

/** Get the singleton JourneyTracker instance */
export function getJourneyTracker(config?: JourneyTrackerConfig): JourneyTracker {
  if (!instance) {
    instance = new JourneyTracker(config);
  }
  return instance;
}

/** Reset the singleton (for testing) */
export function resetJourneyTracker(): void {
  if (instance) {
    instance.destroy();
    instance = null;
  }
}
