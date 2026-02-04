/**
 * Tests for pricing calculations
 */

import { describe, expect, it } from 'bun:test';
import { PRICING_REGISTRY, calculateCost, getPricingRate } from '../src/pricing';

describe('pricing', () => {
  describe('PRICING_REGISTRY', () => {
    it('contains Groq Whisper pricing', () => {
      expect(PRICING_REGISTRY['groq_whisper:whisper-large-v3-turbo']).toBeDefined();
      expect(PRICING_REGISTRY['groq_whisper:whisper-large-v3-turbo']?.inputRate).toBe(0.04);
    });

    it('contains OpenAI Whisper pricing', () => {
      expect(PRICING_REGISTRY['openai_whisper:whisper-1']).toBeDefined();
      expect(PRICING_REGISTRY['openai_whisper:whisper-1']?.unit).toBe('per_minute');
    });

    it('contains Gemini Vision pricing', () => {
      expect(PRICING_REGISTRY['gemini_vision:gemini-2.0-flash']).toBeDefined();
      expect(PRICING_REGISTRY['gemini_vision:gemini-2.0-flash']?.unit).toBe('per_million_tokens');
    });

    it('contains local processor pricing (free)', () => {
      expect(PRICING_REGISTRY['local:pdf-parse']).toBeDefined();
      expect(PRICING_REGISTRY['local:pdf-parse']?.inputRate).toBe(0);
    });
  });

  describe('getPricingRate', () => {
    it('returns rate for known processor/model', () => {
      const rate = getPricingRate('groq_whisper', 'whisper-large-v3-turbo');
      expect(rate).toBeDefined();
      expect(rate?.provider).toBe('groq');
    });

    it('returns undefined for unknown processor', () => {
      const rate = getPricingRate('unknown_processor', 'unknown_model');
      expect(rate).toBeUndefined();
    });
  });

  describe('calculateCost', () => {
    describe('per-hour pricing (Groq)', () => {
      it('calculates cost for 1 hour of audio', () => {
        const costCents = calculateCost('groq_whisper', 'whisper-large-v3-turbo', {
          durationSeconds: 3600, // 1 hour
        });
        // $0.04/hour = 4 cents
        expect(costCents).toBe(4);
      });

      it('calculates cost for 30 minutes of audio', () => {
        const costCents = calculateCost('groq_whisper', 'whisper-large-v3-turbo', {
          durationSeconds: 1800, // 30 minutes
        });
        // $0.04/hour * 0.5 = 2 cents
        expect(costCents).toBe(2);
      });

      it('calculates cost for 1 minute of audio', () => {
        const costCents = calculateCost('groq_whisper', 'whisper-large-v3-turbo', {
          durationSeconds: 60,
        });
        // $0.04/hour * (1/60) = ~0.07 cents
        expect(costCents).toBe(0);
      });
    });

    describe('per-minute pricing (OpenAI)', () => {
      it('calculates cost for 10 minutes of audio', () => {
        const costCents = calculateCost('openai_whisper', 'whisper-1', {
          durationSeconds: 600, // 10 minutes
        });
        // $0.006/minute * 10 = $0.06 = 6 cents
        expect(costCents).toBe(6);
      });

      it('calculates cost for 1 minute of audio', () => {
        const costCents = calculateCost('openai_whisper', 'whisper-1', {
          durationSeconds: 60,
        });
        // $0.006/minute = 0.6 cents, rounds to 1
        expect(costCents).toBe(1);
      });
    });

    describe('per-million-tokens pricing (Gemini)', () => {
      it('calculates cost for image processing', () => {
        const costCents = calculateCost('gemini_vision', 'gemini-2.0-flash', {
          inputTokens: 10000,
          outputTokens: 500,
        });
        // Input: $0.10/1M * 10000 = $0.001
        // Output: $0.40/1M * 500 = $0.0002
        // Total: ~$0.0012 = ~0.12 cents, rounds to 0
        expect(costCents).toBe(0);
      });

      it('calculates cost for larger usage', () => {
        const costCents = calculateCost('gemini_vision', 'gemini-2.0-flash', {
          inputTokens: 100000,
          outputTokens: 5000,
        });
        // Input: $0.10/1M * 100000 = $0.01
        // Output: $0.40/1M * 5000 = $0.002
        // Total: $0.012 = 1.2 cents, rounds to 1
        expect(costCents).toBe(1);
      });
    });

    describe('local processors', () => {
      it('returns 0 for pdf-parse', () => {
        const costCents = calculateCost('local', 'pdf-parse', {});
        expect(costCents).toBe(0);
      });

      it('returns 0 for mammoth', () => {
        const costCents = calculateCost('local', 'mammoth', {});
        expect(costCents).toBe(0);
      });
    });

    it('returns 0 for unknown processor', () => {
      const costCents = calculateCost('unknown', 'model', { durationSeconds: 3600 });
      expect(costCents).toBe(0);
    });
  });
});
