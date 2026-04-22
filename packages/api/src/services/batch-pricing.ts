/**
 * Batch cost pricing — declarative provider rate table.
 *
 * The batch-job cost estimator used to be hardcoded per-item cents
 * (`audio*10 + image*1 + video*2 + document*0`), which was off by ~150×
 * vs. real provider billing for the default Groq+Gemini-Flash-Lite mix
 * (issue #477). This module replaces that with a declarative rate table
 * pinned to the configured default providers, so the number in
 * `omni batch estimate` reflects order-of-magnitude real spend and
 * drifts only when provider prices actually change.
 *
 * **Source of truth (2026-04):**
 *
 * - Groq Whisper Large v3 Turbo (STT): $0.04 per audio-hour.
 *   https://groq.com/pricing
 * - Gemini 2.5 Flash-Lite vision input: ~$0.00015 per image.
 * - Gemini 2.5 Flash-Lite vision: ~$0.0003 per video-second
 *   (WhatsApp-style ~30s video → ~$0.009 per video).
 * - Gemini 2.5 Flash-Lite OCR/vision per document page: ~$0.0005.
 *   https://ai.google.dev/pricing
 *
 * Audio cost scales with duration (per-minute rate × average minutes per
 * item). Image/video/document scale as flat per-1k prices so the table
 * stays easy to eyeball-verify against published provider pricing pages.
 *
 * To update rates: edit `BATCH_PRICING_V1` below and bump the version
 * constant. The test in `batch-pricing.test.ts` pins a known-answer
 * computation against a synthetic pricing table — it does **not** pin
 * these real rates, so you can update them without editing tests.
 */

/**
 * Per-content-type provider pricing used by the batch-job cost estimator.
 *
 * All fields are USD. `audioPerMinuteUsd` × `audioAvgMinutes` gives the
 * per-item audio cost; image/video/document are expressed per 1k items
 * for readability when comparing against provider pricing pages.
 */
export interface BatchPricingRates {
  /** USD per minute of audio processed by the STT provider. */
  audioPerMinuteUsd: number;
  /**
   * Average audio duration per item (in minutes), used together with
   * `audioPerMinuteUsd` to estimate per-item audio cost. Defaults to a
   * WhatsApp-voice-note-ish ~40 seconds (0.667 min).
   */
  audioAvgMinutes: number;
  /** USD per 1,000 images processed by the vision provider. */
  imagePer1kUsd: number;
  /**
   * USD per 1,000 videos processed by the vision provider. Bakes in an
   * assumed average video duration (~30s) because per-video duration is
   * not known at estimate time.
   */
  videoPer1kUsd: number;
  /** USD per 1,000 documents processed by OCR/vision. */
  documentPer1kUsd: number;
}

/**
 * Rate table pinned against the default omni provider mix (Groq STT +
 * Gemini Flash-Lite vision/OCR) as of 2026-04. Update these numbers —
 * *not* the tests — when provider pricing changes.
 */
export const BATCH_PRICING_V1: BatchPricingRates = {
  // Groq Whisper Large v3 Turbo: $0.04 / audio-hour = $0.04/60 per minute.
  audioPerMinuteUsd: 0.04 / 60,
  // WhatsApp voice note average duration (~40 seconds).
  audioAvgMinutes: 40 / 60,
  // Gemini 2.5 Flash-Lite vision input ≈ $0.00015/image → $0.15 / 1k.
  imagePer1kUsd: 0.15,
  // Gemini vision @ $0.0003/sec × ~30s avg ≈ $0.009/video → $9.00 / 1k.
  videoPer1kUsd: 9.0,
  // Gemini OCR/vision per document page ≈ $0.0005/doc → $0.50 / 1k.
  documentPer1kUsd: 0.5,
};

/** Semver-ish tag for the current pricing table; bump on real rate changes. */
export const BATCH_PRICING_VERSION = '2026-04-v1';

/**
 * Per-content-type item counts fed into the estimator.
 */
export interface BatchContentCounts {
  audioCount: number;
  imageCount: number;
  videoCount: number;
  documentCount: number;
}

/**
 * Compute the estimated batch cost in whole cents for the given counts
 * against the given pricing table. Pure function — safe to unit test in
 * isolation. Rounds up (`Math.ceil`) so the displayed cents never
 * under-report fractional provider spend.
 */
export function computeEstimatedCostCents(
  counts: BatchContentCounts,
  pricing: BatchPricingRates = BATCH_PRICING_V1,
): number {
  const audioUsd = counts.audioCount * pricing.audioAvgMinutes * pricing.audioPerMinuteUsd;
  const imageUsd = (counts.imageCount / 1000) * pricing.imagePer1kUsd;
  const videoUsd = (counts.videoCount / 1000) * pricing.videoPer1kUsd;
  const documentUsd = (counts.documentCount / 1000) * pricing.documentPer1kUsd;
  const totalUsd = audioUsd + imageUsd + videoUsd + documentUsd;
  return Math.ceil(totalUsd * 100);
}
