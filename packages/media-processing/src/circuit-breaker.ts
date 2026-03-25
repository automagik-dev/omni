/**
 * Circuit Breaker
 *
 * Prevents cascading failures by tracking provider health and short-circuiting
 * requests when a provider is unhealthy. Each provider (groq, openai, gemini)
 * gets its own CircuitBreaker instance.
 *
 * States:
 * - CLOSED: Normal operation. Track failures in a rolling window.
 * - OPEN: After failureThreshold failures in windowMs, reject immediately for resetTimeoutMs.
 * - HALF-OPEN: After cooldown, allow one probe request. Success -> CLOSED, failure -> OPEN.
 */

import { createLogger } from '@omni/core';

const log = createLogger('media-processing:circuit-breaker');

/**
 * Circuit breaker state
 */
export type CircuitBreakerState = 'closed' | 'open' | 'half-open';

/**
 * Callback invoked when the circuit breaker transitions between states.
 */
export type CircuitBreakerStateChangeCallback = (
  name: string,
  from: CircuitBreakerState,
  to: CircuitBreakerState,
) => void;

/**
 * Configuration for the circuit breaker
 */
export interface CircuitBreakerOptions {
  /** Name of the provider (for logging) */
  name: string;
  /** Number of failures within windowMs to trip the breaker (default 5) */
  failureThreshold: number;
  /** Time in ms to keep the circuit open before allowing a probe (default 300000 = 5 min) */
  resetTimeoutMs: number;
  /** Rolling window in ms to track failures (default 600000 = 10 min) */
  windowMs: number;
  /** Optional callback for state transitions */
  onStateChange?: CircuitBreakerStateChangeCallback;
}

/**
 * Default circuit breaker options
 */
export const DEFAULT_CIRCUIT_BREAKER_OPTIONS: Omit<CircuitBreakerOptions, 'name'> = {
  failureThreshold: 5,
  resetTimeoutMs: 300_000, // 5 minutes
  windowMs: 600_000, // 10 minutes
};

/**
 * Statistics about the circuit breaker state
 */
export interface CircuitBreakerStats {
  /** Current number of failures in the window */
  failures: number;
  /** Current number of successes in the window */
  successes: number;
  /** Current state */
  state: CircuitBreakerState;
  /** Provider name */
  name: string;
}

/**
 * Error thrown when the circuit breaker is open
 */
export class CircuitOpenError extends Error {
  constructor(name: string) {
    super(`Circuit breaker is open for provider "${name}" — requests are being rejected`);
    this.name = 'CircuitOpenError';
  }
}

/**
 * Circuit breaker implementation with rolling window failure tracking.
 */
export class CircuitBreaker {
  private readonly name: string;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly windowMs: number;
  private onStateChangeCallback?: CircuitBreakerStateChangeCallback;

  private state: CircuitBreakerState = 'closed';
  private failureTimestamps: number[] = [];
  private successCount = 0;
  private lastFailureTime = 0;
  private halfOpenInFlight = false;

  constructor(options: Partial<CircuitBreakerOptions> & { name: string }) {
    this.name = options.name;
    this.failureThreshold = options.failureThreshold ?? DEFAULT_CIRCUIT_BREAKER_OPTIONS.failureThreshold;
    this.resetTimeoutMs = options.resetTimeoutMs ?? DEFAULT_CIRCUIT_BREAKER_OPTIONS.resetTimeoutMs;
    this.windowMs = options.windowMs ?? DEFAULT_CIRCUIT_BREAKER_OPTIONS.windowMs;
    this.onStateChangeCallback = options.onStateChange;
  }

  /**
   * Set a callback to be invoked on state transitions.
   * Replaces any previously set callback.
   */
  setOnStateChange(callback: CircuitBreakerStateChangeCallback | undefined): void {
    this.onStateChangeCallback = callback;
  }

  /**
   * Execute a function through the circuit breaker.
   *
   * - CLOSED: Execute normally, track failures.
   * - OPEN: Reject immediately with CircuitOpenError.
   * - HALF-OPEN: Allow one probe request; success closes, failure re-opens.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const currentState = this.evaluateState();

    if (currentState === 'open') {
      throw new CircuitOpenError(this.name);
    }

    if (currentState === 'half-open') {
      // Only allow one concurrent probe
      if (this.halfOpenInFlight) {
        throw new CircuitOpenError(this.name);
      }
      this.halfOpenInFlight = true;
    }

    try {
      const result = await fn();
      this.onSuccess(currentState);
      return result;
    } catch (error) {
      this.onFailure(currentState);
      throw error;
    }
  }

  /**
   * Get the current state of the circuit breaker.
   */
  getState(): CircuitBreakerState {
    return this.evaluateState();
  }

  /**
   * Get statistics about the circuit breaker.
   */
  getStats(): CircuitBreakerStats {
    this.pruneOldFailures();
    return {
      failures: this.failureTimestamps.length,
      successes: this.successCount,
      state: this.evaluateState(),
      name: this.name,
    };
  }

  /**
   * Manually reset the circuit breaker to closed state.
   */
  reset(): void {
    this.state = 'closed';
    this.failureTimestamps = [];
    this.successCount = 0;
    this.lastFailureTime = 0;
    this.halfOpenInFlight = false;
    log.info('Circuit breaker manually reset', { name: this.name });
  }

  /**
   * Evaluate the current state, checking if OPEN should transition to HALF-OPEN.
   */
  private evaluateState(): CircuitBreakerState {
    if (this.state === 'open') {
      const timeSinceLastFailure = Date.now() - this.lastFailureTime;
      if (timeSinceLastFailure >= this.resetTimeoutMs) {
        const from = this.state;
        this.state = 'half-open';
        this.halfOpenInFlight = false;
        log.info('Circuit breaker transitioning to half-open', { name: this.name });
        this.emitStateChange(from, 'half-open');
      }
    }
    return this.state;
  }

  /**
   * Handle a successful execution.
   */
  private onSuccess(stateAtExecution: CircuitBreakerState): void {
    this.successCount++;
    this.halfOpenInFlight = false;

    if (stateAtExecution === 'half-open') {
      // Probe succeeded — close the circuit
      this.state = 'closed';
      this.failureTimestamps = [];
      log.info('Circuit breaker closed after successful probe', { name: this.name });
      this.emitStateChange('half-open', 'closed');
    }
  }

  /**
   * Handle a failed execution.
   */
  private onFailure(stateAtExecution: CircuitBreakerState): void {
    this.halfOpenInFlight = false;
    const now = Date.now();
    this.lastFailureTime = now;

    if (stateAtExecution === 'half-open') {
      // Probe failed — re-open the circuit
      this.state = 'open';
      log.warn('Circuit breaker re-opened after failed probe', { name: this.name });
      this.emitStateChange('half-open', 'open');
      return;
    }

    // Track failure in rolling window
    this.failureTimestamps.push(now);
    this.pruneOldFailures();

    if (this.failureTimestamps.length >= this.failureThreshold) {
      const from = stateAtExecution;
      this.state = 'open';
      log.warn('Circuit breaker opened', {
        name: this.name,
        failures: this.failureTimestamps.length,
        threshold: this.failureThreshold,
      });
      this.emitStateChange(from, 'open');
    }
  }

  /**
   * Emit a state change notification via the callback.
   */
  private emitStateChange(from: CircuitBreakerState, to: CircuitBreakerState): void {
    if (this.onStateChangeCallback) {
      try {
        this.onStateChangeCallback(this.name, from, to);
      } catch (err) {
        log.warn('onStateChange callback error', { name: this.name, error: String(err) });
      }
    }
  }

  /**
   * Remove failure timestamps outside the rolling window.
   */
  private pruneOldFailures(): void {
    const cutoff = Date.now() - this.windowMs;
    this.failureTimestamps = this.failureTimestamps.filter((ts) => ts > cutoff);
  }
}

/**
 * Registry of circuit breakers keyed by provider name.
 * Ensures each provider gets exactly one circuit breaker instance.
 */
const circuitBreakerRegistry = new Map<string, CircuitBreaker>();

/**
 * Global state change listener applied to all circuit breakers created via the registry.
 */
let globalStateChangeCallback: CircuitBreakerStateChangeCallback | undefined;

/**
 * Set a global callback that will be invoked whenever any registered circuit breaker
 * transitions between states. Also retroactively applies to existing breakers.
 */
export function setGlobalCircuitBreakerStateChangeCallback(
  callback: CircuitBreakerStateChangeCallback | undefined,
): void {
  globalStateChangeCallback = callback;
  // Apply to already-registered breakers
  for (const breaker of circuitBreakerRegistry.values()) {
    breaker.setOnStateChange(callback);
  }
}

/**
 * Get or create a circuit breaker for a provider.
 *
 * @param name - Provider name (e.g. 'groq', 'openai', 'gemini')
 * @param options - Optional configuration overrides
 * @returns The circuit breaker instance for this provider
 */
export function getCircuitBreaker(
  name: string,
  options?: Partial<Omit<CircuitBreakerOptions, 'name'>>,
): CircuitBreaker {
  let breaker = circuitBreakerRegistry.get(name);
  if (!breaker) {
    breaker = new CircuitBreaker({ name, onStateChange: globalStateChangeCallback, ...options });
    circuitBreakerRegistry.set(name, breaker);
    log.debug('Circuit breaker created', { name });
  }
  return breaker;
}

/**
 * Reset all circuit breakers. Useful for testing.
 */
export function resetAllCircuitBreakers(): void {
  for (const breaker of circuitBreakerRegistry.values()) {
    breaker.reset();
  }
  circuitBreakerRegistry.clear();
}
