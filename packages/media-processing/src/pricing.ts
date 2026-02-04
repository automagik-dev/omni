/**
 * Media Processing Pricing Configuration
 *
 * Defines pricing rates for each provider and model.
 * Rates are in USD, costs are stored as cents (integer).
 *
 * Sources:
 * - Groq: https://groq.com/pricing
 * - Google Gemini: https://ai.google.dev/gemini-api/docs/pricing
 * - OpenAI: https://openai.com/api/pricing/
 */

import type { PricingRate } from './types';

/**
 * Pricing registry - maps processor:model to pricing rates
 */
export const PRICING_REGISTRY: Record<string, PricingRate> = {
  // ============================================================================
  // GROQ WHISPER (Audio Transcription)
  // ============================================================================
  'groq_whisper:whisper-large-v3-turbo': {
    model: 'whisper-large-v3-turbo',
    provider: 'groq',
    unit: 'per_hour',
    inputRate: 0.04, // $0.04 per hour
  },
  'groq_whisper:whisper-large-v3': {
    model: 'whisper-large-v3',
    provider: 'groq',
    unit: 'per_hour',
    inputRate: 0.111, // $0.111 per hour
  },
  'groq_whisper:distil-whisper-large-v3-en': {
    model: 'distil-whisper-large-v3-en',
    provider: 'groq',
    unit: 'per_hour',
    inputRate: 0.02, // $0.02 per hour (English only)
  },

  // ============================================================================
  // OPENAI WHISPER (Audio Transcription - Fallback)
  // ============================================================================
  'openai_whisper:whisper-1': {
    model: 'whisper-1',
    provider: 'openai',
    unit: 'per_minute',
    inputRate: 0.006, // $0.006 per minute
  },

  // ============================================================================
  // OPENAI VISION (Image Description - Fallback)
  // ============================================================================
  'openai_vision:gpt-4o-mini': {
    model: 'gpt-4o-mini',
    provider: 'openai',
    unit: 'per_million_tokens',
    inputRate: 0.15, // $0.15 per 1M input tokens
    outputRate: 0.6, // $0.60 per 1M output tokens
  },
  'openai_vision:gpt-4o': {
    model: 'gpt-4o',
    provider: 'openai',
    unit: 'per_million_tokens',
    inputRate: 2.5, // $2.50 per 1M input tokens
    outputRate: 10.0, // $10.00 per 1M output tokens
  },

  // ============================================================================
  // GEMINI VISION (Image Description - Primary)
  // ============================================================================
  'gemini_vision:gemini-2.5-flash': {
    model: 'gemini-2.5-flash',
    provider: 'google',
    unit: 'per_million_tokens',
    inputRate: 0.15, // $0.15 per 1M input tokens
    outputRate: 0.6, // $0.60 per 1M output tokens
  },

  // ============================================================================
  // GEMINI VIDEO (Video Description)
  // ============================================================================
  'gemini_video:gemini-2.5-flash': {
    model: 'gemini-2.5-flash',
    provider: 'google',
    unit: 'per_million_tokens',
    inputRate: 0.15, // $0.15 per 1M input tokens (video frames + audio)
    outputRate: 0.6, // $0.60 per 1M output tokens
  },

  // ============================================================================
  // LOCAL PROCESSORS (No Cost)
  // ============================================================================
  'local:pdf-parse': {
    model: 'pdf-parse',
    provider: 'local',
    unit: 'per_document',
    inputRate: 0,
  },
  'local:mammoth': {
    model: 'mammoth',
    provider: 'local',
    unit: 'per_document',
    inputRate: 0,
  },
  'local:xlsx': {
    model: 'xlsx',
    provider: 'local',
    unit: 'per_document',
    inputRate: 0,
  },
  'local:text': {
    model: 'text',
    provider: 'local',
    unit: 'per_document',
    inputRate: 0,
  },
};

/**
 * Get pricing rate for a processor/model combination
 */
export function getPricingRate(processorName: string, model?: string): PricingRate | undefined {
  if (model) {
    const key = `${processorName}:${model}`;
    if (key in PRICING_REGISTRY) {
      return PRICING_REGISTRY[key];
    }
  }

  // Try without model (for local processors)
  const localKey = `${processorName}:local`;
  if (localKey in PRICING_REGISTRY) {
    return PRICING_REGISTRY[localKey];
  }

  return undefined;
}

/**
 * Calculate processing cost
 *
 * @param processorName - Name of the processor (e.g., 'groq_whisper')
 * @param model - Model name (e.g., 'whisper-large-v3-turbo')
 * @param durationSeconds - Audio duration in seconds
 * @param inputTokens - Number of input tokens (LLM)
 * @param outputTokens - Number of output tokens (LLM)
 * @returns Cost in cents (integer)
 */
export function calculateCost(
  processorName: string,
  model: string,
  options: {
    durationSeconds?: number;
    inputTokens?: number;
    outputTokens?: number;
  } = {},
): number {
  const key = `${processorName}:${model}`;
  const rate = PRICING_REGISTRY[key];

  if (!rate) {
    return 0;
  }

  const { durationSeconds, inputTokens, outputTokens } = options;
  let costUsd = 0;

  switch (rate.unit) {
    case 'per_hour': {
      if (durationSeconds !== undefined) {
        const hours = durationSeconds / 3600;
        costUsd = hours * rate.inputRate;
      }
      break;
    }
    case 'per_minute': {
      if (durationSeconds !== undefined) {
        const minutes = durationSeconds / 60;
        costUsd = minutes * rate.inputRate;
      }
      break;
    }
    case 'per_million_tokens': {
      if (inputTokens !== undefined) {
        costUsd += (inputTokens / 1_000_000) * rate.inputRate;
      }
      if (outputTokens !== undefined && rate.outputRate !== undefined) {
        costUsd += (outputTokens / 1_000_000) * rate.outputRate;
      }
      break;
    }
    case 'per_document': {
      costUsd = rate.inputRate;
      break;
    }
  }

  // Convert to cents and round to integer
  return Math.round(costUsd * 100);
}
