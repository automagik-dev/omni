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

// Pricing
export { calculateCost, getPricingRate, PRICING_REGISTRY } from './pricing';
