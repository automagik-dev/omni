/**
 * Media Processing Service
 *
 * Orchestrates media processing by routing to appropriate processors
 * based on MIME type.
 */

import { createLogger } from '@omni/core';
import { AudioProcessor, DocumentProcessor, ImageProcessor, VideoProcessor } from './processors';
import type { ProcessOptions, ProcessingResult, Processor, ProcessorConfig } from './types';

const log = createLogger('media-processing:service');

/**
 * Media Processing Service
 *
 * Routes media files to appropriate processors based on MIME type.
 * Handles processor initialization and error recovery.
 */
export class MediaProcessingService {
  private readonly processors: Processor[];
  private readonly config: ProcessorConfig;

  constructor(config: ProcessorConfig) {
    this.config = config;

    // Initialize processors
    this.processors = [
      new AudioProcessor(config),
      new ImageProcessor(config),
      new VideoProcessor(config),
      new DocumentProcessor(config),
    ];

    log.info('MediaProcessingService initialized', {
      processorCount: this.processors.length,
      hasGroq: !!config.groqApiKey,
      hasOpenAI: !!config.openaiApiKey,
      hasGemini: !!config.geminiApiKey,
    });
  }

  /**
   * Process a media file
   *
   * Routes to appropriate processor based on MIME type.
   *
   * @param filePath - Absolute path to the media file
   * @param mimeType - MIME type of the file
   * @param options - Processing options
   * @returns Processing result
   */
  async process(filePath: string, mimeType: string, options?: ProcessOptions): Promise<ProcessingResult> {
    // Find processor that can handle this MIME type
    const processor = this.findProcessor(mimeType);

    if (!processor) {
      log.warn('No processor found for MIME type', { mimeType, filePath });
      return {
        success: false,
        contentFormat: 'text',
        processingType: 'extraction',
        provider: 'none',
        model: 'none',
        processingTimeMs: 0,
        costCents: 0,
        errorMessage: `No processor available for MIME type: ${mimeType}`,
      };
    }

    log.debug('Processing media', {
      processor: processor.name,
      mimeType,
      filePath,
    });

    try {
      const result = await processor.process(filePath, mimeType, options);

      if (result.success) {
        log.info('Media processing complete', {
          processor: processor.name,
          provider: result.provider,
          model: result.model,
          processingTimeMs: result.processingTimeMs,
          costCents: result.costCents,
          contentLength: result.content?.length ?? 0,
        });
      } else {
        log.warn('Media processing failed', {
          processor: processor.name,
          error: result.errorMessage,
        });
      }

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error('Media processing error', {
        processor: processor.name,
        error: errorMsg,
      });

      return {
        success: false,
        contentFormat: 'text',
        processingType: 'extraction',
        provider: processor.name,
        model: 'unknown',
        processingTimeMs: 0,
        costCents: 0,
        errorMessage: errorMsg,
      };
    }
  }

  /**
   * Check if a MIME type can be processed
   */
  canProcess(mimeType: string): boolean {
    return this.findProcessor(mimeType) !== undefined;
  }

  /**
   * Get the processor name for a MIME type
   */
  getProcessorName(mimeType: string): string | undefined {
    return this.findProcessor(mimeType)?.name;
  }

  /**
   * Get all supported MIME types
   */
  getSupportedMimeTypes(): string[] {
    const mimeTypes = new Set<string>();
    for (const processor of this.processors) {
      for (const mimeType of processor.supportedMimeTypes) {
        mimeTypes.add(mimeType);
      }
    }
    return [...mimeTypes];
  }

  /**
   * Find processor that can handle the given MIME type
   */
  private findProcessor(mimeType: string): Processor | undefined {
    return this.processors.find((p) => p.canProcess(mimeType));
  }
}

/**
 * Create a MediaProcessingService with config from environment
 */
export function createMediaProcessingService(config?: Partial<ProcessorConfig>): MediaProcessingService {
  const fullConfig: ProcessorConfig = {
    groqApiKey: config?.groqApiKey ?? process.env.GROQ_API_KEY,
    openaiApiKey: config?.openaiApiKey ?? process.env.OPENAI_API_KEY,
    geminiApiKey: config?.geminiApiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY,
    defaultLanguage: config?.defaultLanguage ?? process.env.DEFAULT_LANGUAGE ?? 'pt',
    maxFileSizeMb: config?.maxFileSizeMb ?? 25,
  };

  return new MediaProcessingService(fullConfig);
}
