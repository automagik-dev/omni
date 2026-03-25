/**
 * @omni/media-processing
 *
 * Media processing package for Omni v2.
 * Handles audio transcription, image description, and document extraction.
 */

// Service
export { MediaProcessingService, createMediaProcessingService } from './service';

// Processors
export { BaseProcessor, AudioProcessor, ImageProcessor, DocumentProcessor } from './processors';

// Retry
export { withRetry, isTransientError, calculateBackoffDelay, DEFAULT_RETRY_OPTIONS } from './retry';
export type { RetryOptions } from './retry';

// Circuit Breaker
export {
  CircuitBreaker,
  CircuitOpenError,
  getCircuitBreaker,
  resetAllCircuitBreakers,
  setGlobalCircuitBreakerStateChangeCallback,
  DEFAULT_CIRCUIT_BREAKER_OPTIONS,
} from './circuit-breaker';
export type {
  CircuitBreakerOptions,
  CircuitBreakerState,
  CircuitBreakerStateChangeCallback,
  CircuitBreakerStats,
} from './circuit-breaker';

// Health
export { MediaHealthTracker, getMediaHealthTracker, resetMediaHealthTracker } from './health';
export type { ProviderMetrics, MediaHealthReport } from './health';

// Types
export type {
  ProcessingResult,
  ProcessorConfig,
  Processor,
  ProcessOptions,
  PricingUnit,
  PricingRate,
  MediaContentInput,
  MediaTimeoutConfig,
} from './types';
export { DEFAULT_MEDIA_TIMEOUTS, getMediaTimeouts } from './types';

// Models
export { GEMINI_MODEL, OPENAI_VISION_MODEL, OPENAI_WHISPER_MODEL, GROQ_WHISPER_MODEL } from './models';

// Prompts
export {
  IMAGE_DESCRIPTION_PROMPT,
  VIDEO_DESCRIPTION_PROMPT,
  DOCUMENT_OCR_PROMPT,
  RESPONSE_GATE_PROMPT,
  PROMPT_KEYS,
} from './prompts';

// Pricing
export { calculateCost, getPricingRate, PRICING_REGISTRY } from './pricing';
