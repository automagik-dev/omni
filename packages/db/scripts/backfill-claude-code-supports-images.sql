-- Backfill: set supportsImages = true for all existing claude-code providers
-- Claude Sonnet/Haiku support vision — the previous default of false was incorrect.
-- Safe to run multiple times (idempotent).
UPDATE agent_providers
SET supports_images = true
WHERE schema = 'claude-code'
  AND supports_images = false;
