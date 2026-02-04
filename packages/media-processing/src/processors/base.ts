/**
 * Base Processor
 *
 * Abstract base class for all media processors.
 */

import { createLogger } from '@omni/core';
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
   * Sleep with exponential backoff
   */
  protected async sleep(attempt: number, baseMs = 2000, maxMs = 30000): Promise<void> {
    const delay = Math.min(baseMs * 2 ** attempt, maxMs);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}
