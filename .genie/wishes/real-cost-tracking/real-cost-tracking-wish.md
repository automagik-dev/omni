# WISH: Real Cost Tracking for All Model API Calls

> Every model call costs money. Track it all — per message, per batch, per instance, per day.

**Status:** DRAFT
**Created:** 2026-02-11
**Author:** Felipe (requested) / Omni (drafted)
**Beads:** omni-mp2

---

## Summary

Replace hardcoded cost estimates with **real cost tracking** for every API call to external models (Groq, Gemini, OpenAI). Store per-message costs, accumulate on batch jobs, and surface in CLI/UI.

---

## Problem Statement

Currently `totalCostUsd` on batch jobs always shows `$0` because:
1. The batch processing pipeline doesn't capture actual API response usage metadata
2. Cost estimates exist only in `packages/media-processing/src/pricing.ts` as rough previews (audio 10¢, image 1¢, etc.)
3. No per-message cost storage exists

This means we have no visibility into actual spend, can't budget, can't alert on cost anomalies.

---

## Scope

### IN SCOPE

1. **Capture token usage from every model API call**
   - Groq: `response.usage.total_tokens`, `prompt_tokens`, `completion_tokens`
   - Gemini: `response.usageMetadata.promptTokenCount`, `candidatesTokenCount`
   - OpenAI: `response.usage.prompt_tokens`, `completion_tokens`

2. **Model pricing registry**
   - Configurable table/config mapping `model_id → cost_per_input_token, cost_per_output_token`
   - Updated periodically (providers change prices)
   - Fallback to estimates when usage metadata is missing

3. **Per-message cost storage**
   - New columns on `messages` table or a dedicated `media_processing_costs` table:
     - `processing_cost_usd` (decimal)
     - `processing_model` (string)
     - `processing_tokens_input` (int)
     - `processing_tokens_output` (int)

4. **Batch job cost accumulation**
   - `totalCostUsd` on batch_jobs reflects sum of actual per-item costs
   - Displayed in real-time during progress updates

5. **CLI/API visibility**
   - `omni batch status <id>` shows real cost
   - `omni batch estimate` uses pricing registry for pre-run estimates
   - New: `omni costs [--instance <id>] [--since <date>] [--until <date>]` — cost summary

### OUT OF SCOPE
- Billing / invoicing / payment integration
- Cost alerts / budgets (follow-up wish)
- Non-media model costs (agent provider calls) — separate wish

---

## Key Decisions

- **TBD:** Separate `media_processing_costs` table vs columns on `messages`
- **TBD:** Pricing registry as DB table vs config file vs hardcoded constants

---

## Execution Groups

### Group A — Capture usage metadata from providers

### Group B — Pricing registry

### Group C — Per-message cost storage + batch accumulation

### Group D — CLI/API cost visibility

---

## Notes

- Priority: medium — visibility matter, but not blocking daily ops
- Felipe requested this explicitly (2026-02-11)
