/**
 * Base Processor
 *
 * Abstract base class for all media processors.
 * Provides retry with exponential backoff and circuit breaker integration.
 */

import { createLogger } from '@omni/core';
import { type CircuitBreaker, CircuitOpenError, getCircuitBreaker } from '../circuit-breaker';
import { getMediaHealthTracker } from '../health';
import { type RetryOptions, isTransientError, withRetry } from '../retry';
import type { ProcessOptions, ProcessingResult, Processor, ProcessorConfig } from '../types';

/**
 * Abstract base class for media processors
 */
export abstract class BaseProcessor implements Processor {
  protected readonly log;
  protected readonly config: ProcessorConfig;

  abstract readonly name: string;

  constructor(config: ProcessorConfig) {
    this.config = config;
    // Use a placeholder, subclasses override
    this.log = createLogger('media-processing:processor');
  }
  abstract readonly supportedMimeTypes: readonly string[];

  /**
   * Check if this processor can handle the given MIME type
   * Supports wildcards like 'audio/*'
   */
  canProcess(mimeType: string): boolean {
    if (!mimeType) {
      return false;
    }

    const normalizedMime = mimeType.toLowerCase();

    for (const supported of this.supportedMimeTypes) {
      // Check wildcard match (e.g., 'audio/*')
      if (supported.endsWith('/*')) {
        const prefix = supported.slice(0, -1); // Remove '*'
        if (normalizedMime.startsWith(prefix)) {
          return true;
        }
      }
      // Exact match
      if (normalizedMime === supported.toLowerCase()) {
        return true;
      }
    }

    return false;
  }

  abstract process(filePath: string, mimeType: string, options?: ProcessOptions): Promise<ProcessingResult>;

  /**
   * Create a failed result
   */
  protected createFailedResult(errorMessage: string, provider: string, model: string): ProcessingResult {
    return {
      success: false,
      contentFormat: 'text',
      processingType: 'transcription',
      provider,
      model,
      processingTimeMs: 0,
      costCents: 0,
      errorMessage,
    };
  }

  /**
   * Check if an error is a rate limit error (429)
   */
  protected isRateLimitError(error: unknown): boolean {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      return (
        msg.includes('429') ||
        msg.includes('rate limit') ||
        msg.includes('too many requests') ||
        msg.includes('resource exhausted')
      );
    }
    return false;
  }

  /**
   * Check if an error is transient (rate limits, timeouts, network, 5xx)
   */
  protected isTransientError(error: unknown): boolean {
    return isTransientError(error);
  }

  /**
   * Get or create a circuit breaker for a provider
   */
  protected getCircuitBreaker(providerName: string): CircuitBreaker {
    return getCircuitBreaker(providerName);
  }

  /**
   * Execute a provider call with circuit breaker and retry logic.
   *
   * This replaces the manual retry loops in individual processors.
   * The circuit breaker short-circuits if a provider is unhealthy.
   * The retry wrapper handles transient errors with exponential backoff.
   *
   * @param providerName - Provider identifier for circuit breaker (e.g. 'groq', 'openai', 'gemini')
   * @param fn - The async function to execute
   * @param retryOptions - Optional retry configuration overrides
   */
  protected async executeWithResilience<T>(
    providerName: string,
    fn: () => Promise<T>,
    retryOptions?: Partial<RetryOptions>,
  ): Promise<T> {
    const breaker = this.getCircuitBreaker(providerName);
    const tracker = getMediaHealthTracker();
    const startTime = performance.now();

    try {
      const result = await breaker.execute(() =>
        withRetry(fn, {
          maxRetries: 3,
          baseDelayMs: 1000,
          maxDelayMs: 10000,
          timeoutMs: 0,
          onRetry: (attempt, error) => {
            this.log.warn(`Retry attempt ${attempt} for ${providerName}`, {
              error: error.message,
            });
          },
          ...retryOptions,
        }),
      );

      const latencyMs = Math.round(performance.now() - startTime);
      tracker.recordSuccess(this.name, providerName, latencyMs);
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      tracker.recordFailure(this.name, providerName, errorMsg);
      throw error;
    }
  }

  /**
   * Check if an error is a circuit breaker open error.
   * Useful for processors to decide whether to try a fallback provider.
   */
  protected isCircuitOpen(error: unknown): boolean {
    return error instanceof CircuitOpenError;
  }

  /**
   * Sleep with exponential backoff
   * @deprecated Use executeWithResilience() instead. Kept for backwards compatibility.
   */
  protected async sleep(attempt: number, baseMs = 2000, maxMs = 30000): Promise<void> {
    const delay = Math.min(baseMs * 2 ** attempt, maxMs);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}
