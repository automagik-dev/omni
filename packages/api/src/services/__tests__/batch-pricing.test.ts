/**
 * Unit tests for the batch-job cost pricing table (#477).
 *
 * These tests pin two behaviors:
 *   1. `computeEstimatedCostCents` does the arithmetic correctly against a
 *      synthetic pricing table with known round numbers — so arithmetic
 *      bugs are caught without coupling the test to real provider prices.
 *   2. The real `BATCH_PRICING_V1` table produces a total within ~2× of
 *      the billing order-of-magnitude the original bug report observed
 *      ($1–2 for 1662 audio + 1256 image + 381 document items). This
 *      keeps #477's acceptance criteria enforceable in CI without
 *      freezing exact cents against drifting provider prices.
 */
import { describe, expect, test } from 'bun:test';

import { BATCH_PRICING_V1, type BatchPricingRates, computeEstimatedCostCents } from '../batch-pricing';

describe('computeEstimatedCostCents', () => {
  test('returns 0 for all-zero counts regardless of pricing', () => {
    expect(
      computeEstimatedCostCents({
        audioCount: 0,
        imageCount: 0,
        videoCount: 0,
        documentCount: 0,
      }),
    ).toBe(0);
  });

  test('computes a known total from a synthetic pricing table', () => {
    // Synthetic table chosen for clean arithmetic:
    //   audio: $0.001/min × 1 min/item × 1000 items = $1.00
    //   image: $0.15 / 1k × 1000 items              = $0.15
    //   video: $9.00 / 1k × 1000 items              = $9.00
    //   document: $0.50 / 1k × 1000 items           = $0.50
    //   total                                        = $10.65 → 1065¢
    const pricing: BatchPricingRates = {
      audioPerMinuteUsd: 0.001,
      audioAvgMinutes: 1,
      imagePer1kUsd: 0.15,
      videoPer1kUsd: 9.0,
      documentPer1kUsd: 0.5,
    };

    const cents = computeEstimatedCostCents(
      {
        audioCount: 1000,
        imageCount: 1000,
        videoCount: 1000,
        documentCount: 1000,
      },
      pricing,
    );

    expect(cents).toBe(1065);
  });

  test('rounds fractional cents up so totals never under-report', () => {
    // One image @ $0.00015 → 0.015¢ → ceil(0.015) = 1¢
    const pricing: BatchPricingRates = {
      audioPerMinuteUsd: 0,
      audioAvgMinutes: 0,
      imagePer1kUsd: 0.15,
      videoPer1kUsd: 0,
      documentPer1kUsd: 0,
    };
    expect(computeEstimatedCostCents({ audioCount: 0, imageCount: 1, videoCount: 0, documentCount: 0 }, pricing)).toBe(
      1,
    );
  });

  test('scales linearly per content type (additivity)', () => {
    const counts = {
      audioCount: 100,
      imageCount: 200,
      videoCount: 50,
      documentCount: 25,
    };
    const single = computeEstimatedCostCents(counts);
    const doubled = computeEstimatedCostCents({
      audioCount: counts.audioCount * 2,
      imageCount: counts.imageCount * 2,
      videoCount: counts.videoCount * 2,
      documentCount: counts.documentCount * 2,
    });
    // Doubling counts should (roughly) double the total. Allow a 2¢
    // tolerance for the per-segment ceil() rounding.
    expect(doubled).toBeGreaterThanOrEqual(single * 2 - 2);
    expect(doubled).toBeLessThanOrEqual(single * 2 + 2);
  });
});

describe('BATCH_PRICING_V1 sanity check (#477)', () => {
  test('issue #477 repro counts estimate in the $0.50–$5.00 range (not $178)', () => {
    // Exact counts from the #477 bug report:
    //   1662 audio, 1256 image, 0 video, 381 document
    // Old hardcoded estimator returned $178.76. Real provider bill was
    // $1–2. New estimator must land in the same order of magnitude as
    // the real bill (within ~2× is the acceptance target).
    const cents = computeEstimatedCostCents({
      audioCount: 1662,
      imageCount: 1256,
      videoCount: 0,
      documentCount: 381,
    });

    expect(cents).toBeGreaterThanOrEqual(50); // $0.50 lower bound
    expect(cents).toBeLessThanOrEqual(500); // $5.00 upper bound
  });

  test('documents never estimate at $0.00 (regression: old table had *0)', () => {
    const cents = computeEstimatedCostCents({
      audioCount: 0,
      imageCount: 0,
      videoCount: 0,
      documentCount: 10_000,
    });
    expect(cents).toBeGreaterThan(0);
  });

  test('all rates in BATCH_PRICING_V1 are non-negative finite numbers', () => {
    for (const value of Object.values(BATCH_PRICING_V1)) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });
});
