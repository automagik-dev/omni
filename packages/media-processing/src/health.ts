/**
 * Media Health Tracker
 *
 * Tracks per-processor, per-provider metrics for media processing operations.
 * Provides health reports with success rates, latencies, and circuit breaker states.
 *
 * Usage:
 *   const tracker = getMediaHealthTracker();
 *   tracker.recordSuccess('audio', 'groq', 150);
 *   tracker.recordFailure('audio', 'groq', 'rate limit exceeded');
 *   const report = tracker.getReport();
 */

import { createLogger } from '@omni/core';
import { type CircuitBreakerState, getCircuitBreaker } from './circuit-breaker';

const log = createLogger('media-processing:health');

/**
 * Per-provider, per-processor metrics
 */
export interface ProviderMetrics {
  provider: string;
  processor: string; // 'audio' | 'image' | 'video' | 'document'
  successCount: number;
  failureCount: number;
  totalLatencyMs: number;
  avgLatencyMs: number;
  successRate: number; // 0-1
  circuitState: CircuitBreakerState;
  lastFailure?: string; // error message
  lastFailureAt?: number; // timestamp
}

/**
 * Overall media health report
 */
export interface MediaHealthReport {
  timestamp: number;
  processors: ProviderMetrics[];
  overall: {
    totalRequests: number;
    successRate: number;
    avgLatencyMs: number;
  };
}

/**
 * Internal mutable metrics for a processor+provider pair
 */
interface MetricsEntry {
  provider: string;
  processor: string;
  successCount: number;
  failureCount: number;
  totalLatencyMs: number;
  lastFailure?: string;
  lastFailureAt?: number;
}

/**
 * Build a composite key for the metrics map
 */
function metricsKey(processor: string, provider: string): string {
  return `${processor}:${provider}`;
}

/**
 * Tracks health metrics for media processing operations.
 *
 * Thread-safe for single-threaded Node/Bun runtimes (no concurrent writes).
 * Metrics accumulate until reset() is called.
 */
export class MediaHealthTracker {
  private readonly metrics = new Map<string, MetricsEntry>();

  /**
   * Record a successful provider call
   */
  recordSuccess(processor: string, provider: string, latencyMs: number): void {
    const entry = this.getOrCreate(processor, provider);
    entry.successCount++;
    entry.totalLatencyMs += latencyMs;
  }

  /**
   * Record a failed provider call
   */
  recordFailure(processor: string, provider: string, error: string): void {
    const entry = this.getOrCreate(processor, provider);
    entry.failureCount++;
    entry.lastFailure = error;
    entry.lastFailureAt = Date.now();
  }

  /**
   * Generate a full health report with computed metrics
   */
  getReport(): MediaHealthReport {
    const processors: ProviderMetrics[] = [];
    let totalRequests = 0;
    let totalSuccesses = 0;
    let totalLatencyMs = 0;

    for (const entry of this.metrics.values()) {
      const total = entry.successCount + entry.failureCount;
      const avgLatencyMs = entry.successCount > 0 ? Math.round(entry.totalLatencyMs / entry.successCount) : 0;
      const successRate = total > 0 ? entry.successCount / total : 0;

      // Look up circuit breaker state for this provider
      let circuitState: CircuitBreakerState = 'closed';
      try {
        const breaker = getCircuitBreaker(entry.provider);
        circuitState = breaker.getState();
      } catch {
        // No breaker registered — default to closed
      }

      processors.push({
        provider: entry.provider,
        processor: entry.processor,
        successCount: entry.successCount,
        failureCount: entry.failureCount,
        totalLatencyMs: entry.totalLatencyMs,
        avgLatencyMs,
        successRate: Math.round(successRate * 1000) / 1000, // 3 decimal places
        circuitState,
        lastFailure: entry.lastFailure,
        lastFailureAt: entry.lastFailureAt,
      });

      totalRequests += total;
      totalSuccesses += entry.successCount;
      totalLatencyMs += entry.totalLatencyMs;
    }

    const overallSuccessRate = totalRequests > 0 ? totalSuccesses / totalRequests : 0;
    const overallAvgLatency = totalSuccesses > 0 ? Math.round(totalLatencyMs / totalSuccesses) : 0;

    return {
      timestamp: Date.now(),
      processors,
      overall: {
        totalRequests,
        successRate: Math.round(overallSuccessRate * 1000) / 1000,
        avgLatencyMs: overallAvgLatency,
      },
    };
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.metrics.clear();
    log.info('Health metrics reset');
  }

  /**
   * Get or create a metrics entry for a processor+provider pair
   */
  private getOrCreate(processor: string, provider: string): MetricsEntry {
    const key = metricsKey(processor, provider);
    let entry = this.metrics.get(key);
    if (!entry) {
      entry = {
        provider,
        processor,
        successCount: 0,
        failureCount: 0,
        totalLatencyMs: 0,
      };
      this.metrics.set(key, entry);
    }
    return entry;
  }
}

/**
 * Singleton health tracker instance.
 * Shared across all processors within the same process.
 */
let globalTracker: MediaHealthTracker | null = null;

/**
 * Get the singleton MediaHealthTracker instance.
 */
export function getMediaHealthTracker(): MediaHealthTracker {
  if (!globalTracker) {
    globalTracker = new MediaHealthTracker();
  }
  return globalTracker;
}

/**
 * Reset the global tracker (useful for testing).
 */
export function resetMediaHealthTracker(): void {
  if (globalTracker) {
    globalTracker.reset();
  }
  globalTracker = null;
}
