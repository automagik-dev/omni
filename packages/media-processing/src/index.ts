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

// Types
export type {
  ProcessingResult,
  ProcessorConfig,
  Processor,
  ProcessOptions,
  PricingUnit,
  PricingRate,
  MediaContentInput,
} from './types';

// Models
export { GEMINI_MODEL, OPENAI_VISION_MODEL, OPENAI_WHISPER_MODEL, GROQ_WHISPER_MODEL } from './models';

// Pricing
export { calculateCost, getPricingRate, PRICING_REGISTRY } from './pricing';
