/**
 * Tests for pricing calculations
 */

import { describe, expect, it } from 'bun:test';
import { calculateCost, getPricingRate } from '../src/pricing';

describe('pricing', () => {
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
        // $0.04/hour * (1/60) = ~0.067 cents (fractional, not rounded)
        expect(costCents).toBeCloseTo(0.067, 2);
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

      it('calculates cost for 1 minute of legacy OpenAI audio', () => {
        const costCents = calculateCost('openai_whisper', 'whisper-1', {
          durationSeconds: 60,
        });
        // $0.006/minute = 0.6 cents (fractional, not rounded)
        expect(costCents).toBeCloseTo(0.6, 2);
      });

      it('calculates non-zero cost for current OpenAI STT defaults', () => {
        expect(calculateCost('openai_whisper', 'gpt-audio-mini', { durationSeconds: 60 })).toBeGreaterThan(0);
        expect(calculateCost('openai_whisper', 'gpt-4o-transcribe', { durationSeconds: 60 })).toBeGreaterThan(0);
      });
    });

    describe('per-million-tokens pricing (Gemini)', () => {
      it('calculates cost for image processing', () => {
        const costCents = calculateCost('gemini_vision', 'gemini-3-flash-preview', {
          inputTokens: 10000,
          outputTokens: 500,
        });
        // Input: $0.15/1M * 10000 = $0.0015
        // Output: $0.60/1M * 500 = $0.0003
        // Total: ~$0.0018 = ~0.18 cents (fractional, not rounded)
        expect(costCents).toBeCloseTo(0.18, 2);
      });

      it('calculates cost for larger usage', () => {
        const costCents = calculateCost('gemini_vision', 'gemini-3-flash-preview', {
          inputTokens: 100000,
          outputTokens: 5000,
        });
        // Input: $0.15/1M * 100000 = $0.015
        // Output: $0.60/1M * 5000 = $0.003
        // Total: $0.018 = 1.8 cents (fractional, not rounded)
        expect(costCents).toBeCloseTo(1.8, 2);
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
